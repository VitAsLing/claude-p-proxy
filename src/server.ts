import config from "./config";
import type { ChatCompletionRequest } from "./types/openai";
import { requestToCliArgs, resolveModel } from "./adapter/openai-to-cli";
import { buildChatResponse, buildStreamChunk, encodeSSE } from "./adapter/cli-to-openai";
import { runClaude, runClaudeStream, ConcurrencyLimitError, getActiveCount } from "./subprocess/manager";
import { SessionManager } from "./session/manager";

// ── 初始化 ─────────────────────────────────────────────────────
const sessions = new SessionManager();
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Session-Id",
};

// ── 路由处理 ───────────────────────────────────────────────────

async function handleChatCompletions(req: Request): Promise<Response> {
  let body: ChatCompletionRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const { messages, stream } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: { message: "messages array is required" } },
      { status: 400 }
    );
  }

  // Session 处理
  const externalSessionId = sessions.extractSessionId(req.headers, body);
  let sessionId: string | undefined;
  let resume: string | undefined;

  if (externalSessionId) {
    const { cliSessionId, isNew } = sessions.getOrCreate(externalSessionId);
    if (isNew) {
      sessionId = cliSessionId;
    } else {
      resume = cliSessionId;
    }
  }

  const requestModel = resolveModel(body.model);

  // ── 流式响应 ──
  if (stream) {
    const cliArgs = requestToCliArgs(body, { stream: true, sessionId, resume });
    const requestId = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    let isFirst = true;

    // 在构造 ReadableStream 之前启动子进程（acquireSlot 可能抛出 ConcurrencyLimitError）
    let streamHandle: ReturnType<typeof runClaudeStream>;
    try {
      // 用临时数组缓冲 start() 之前到达的 chunks（几乎不会发生，但安全起见）
      let controller: ReadableStreamDefaultController | null = null;
      const pendingChunks: Uint8Array[] = [];

      streamHandle = runClaudeStream(
        cliArgs,
        (text) => {
          const encoded = encodeSSE(buildStreamChunk(text, requestModel, requestId, { isFirst }));
          isFirst = false;
          if (controller) {
            controller.enqueue(encoded);
          } else {
            pendingChunks.push(encoded);
          }
        },
        (_sid) => {
          // 可选：捕获 CLI 返回的 session_id 用于后续更新映射
        }
      );

      const readable = new ReadableStream({
        start(ctrl) {
          controller = ctrl;
          // flush any buffered chunks
          for (const chunk of pendingChunks) {
            ctrl.enqueue(chunk);
          }
          pendingChunks.length = 0;

          streamHandle.done
            .then(() => {
              try {
                ctrl.enqueue(encodeSSE(buildStreamChunk("", requestModel, requestId, { done: true })));
                ctrl.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                ctrl.close();
              } catch { /* stream already closed (client disconnected) */ }
            })
            .catch((err: any) => {
              try {
                ctrl.enqueue(encodeSSE({ error: { message: err.message } }));
                ctrl.close();
              } catch { /* stream already closed */ }
            });
        },
        cancel() {
          // 客户端断开连接时终止子进程
          streamHandle.kill();
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (err: any) {
      if (err instanceof ConcurrencyLimitError) {
        return Response.json(
          { error: { message: err.message, type: "rate_limit_error" } },
          { status: 429, headers: { "Retry-After": "5" } }
        );
      }
      throw err;
    }
  }

  // ── 非流式响应 ──
  try {
    const cliArgs = requestToCliArgs(body, { stream: false, sessionId, resume });
    const result = await runClaude(cliArgs);
    return Response.json(buildChatResponse(result.text, requestModel));
  } catch (err: any) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json(
        { error: { message: err.message, type: "rate_limit_error" } },
        { status: 429, headers: { "Retry-After": "5" } }
      );
    }
    console.error(`[server] error: ${err.message}`);
    return Response.json(
      { error: { message: err.message } },
      { status: 500 }
    );
  }
}

function handleModels(): Response {
  const data = Object.keys(config.models).map((id) => ({
    id,
    object: "model" as const,
    created: Math.floor(Date.now() / 1000),
    owned_by: "anthropic",
  }));
  return Response.json({ object: "list", data });
}

function handleHealth(): Response {
  return Response.json({
    status: "ok",
    version: "1.0.0",
    models: Object.keys(config.models),
    sessions: sessions.size,
    activeProcesses: getActiveCount(),
    config: {
      defaultModel: config.defaultModel,
      timeout: `${config.timeout / 1000}s`,
      maxConcurrent: config.maxConcurrent,
    },
  });
}

function handleSessions(): Response {
  return Response.json({
    sessions: sessions.listSessions(),
    total: sessions.size,
  });
}

function handleDeleteSession(id: string): Response {
  const deleted = sessions.delete(id);
  return Response.json({ deleted, id });
}

// ── Bun HTTP 服务 ──────────────────────────────────────────────

const server = Bun.serve({
  port: config.port,
  hostname: config.host,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (config.verbose) {
      console.log(`[server] ${req.method} ${path}`);
    }

    // CORS 预检
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // 路由
    let response: Response;

    if (path === "/v1/chat/completions" && req.method === "POST") {
      response = await handleChatCompletions(req);
    } else if (path === "/v1/models" && req.method === "GET") {
      response = handleModels();
    } else if (path === "/health" && req.method === "GET") {
      response = handleHealth();
    } else if (path === "/sessions" && req.method === "GET") {
      response = handleSessions();
    } else if (path.startsWith("/sessions/") && req.method === "DELETE") {
      const id = path.replace("/sessions/", "");
      response = handleDeleteSession(id);
    } else {
      response = Response.json(
        { error: { message: `Not found: ${path}` } },
        { status: 404 }
      );
    }

    // 所有响应加 CORS 头
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  },
});

// ── 启动信息 ───────────────────────────────────────────────────

console.log(`
┌──────────────────────────────────────────────────┐
│          claude-p-proxy v1.0.0                   │
│          Powered by Bun + Claude CLI             │
├──────────────────────────────────────────────────┤
│  🌐 http://${config.host}:${config.port}                         │
│  🤖 Model:   ${config.defaultModel.padEnd(34)}│
│  ⏱️  Timeout: ${(config.timeout / 1000 + "s").padEnd(34)}│
│  🔀 Concur:  ${(config.maxConcurrent + " max").padEnd(34)}│
└──────────────────────────────────────────────────┘

Endpoints:
  POST   /v1/chat/completions  — Chat (OpenAI 兼容)
  GET    /v1/models            — 模型列表
  GET    /health               — 健康检查
  GET    /sessions             — 活跃 Session 列表
  DELETE /sessions/:id         — 删除 Session

OpenClaw 配置:
  openclaw config set env.OPENAI_API_KEY "not-needed"
  openclaw config set env.OPENAI_BASE_URL "http://${config.host}:${config.port}/v1"
  openclaw config set agents.defaults.model "openai/claude-sonnet-4"
`);

// ── Graceful Shutdown ───────────────────────────────────────────

let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n[shutdown] Received ${signal}, shutting down gracefully...`);

  // 停止接受新连接
  server.stop();
  console.log("[shutdown] Stopped accepting new connections");

  // 等待活跃进程完成（最多等 30 秒）
  const maxWait = 30_000;
  const start = performance.now();
  while (getActiveCount() > 0 && performance.now() - start < maxWait) {
    console.log(`[shutdown] Waiting for ${getActiveCount()} active process(es)...`);
    await Bun.sleep(1000);
  }

  if (getActiveCount() > 0) {
    console.log(`[shutdown] Timed out with ${getActiveCount()} active process(es), forcing exit`);
  } else {
    console.log("[shutdown] All processes completed");
  }

  console.log("[shutdown] Bye!");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
