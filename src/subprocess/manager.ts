import type { CliArgs, CliJsonResponse } from "../types/claude-cli";
import config from "../config";

/**
 * 构建 CLI 启动参数
 */
function buildArgs(cliArgs: CliArgs): string[] {
  const args = ["-p", cliArgs.prompt, "--model", cliArgs.model];

  // 输出格式
  args.push("--output-format", cliArgs.outputFormat);

  // Session 参数
  if (cliArgs.resume) {
    args.push("--resume", cliArgs.resume);
  } else if (cliArgs.sessionId) {
    args.push("--session-id", cliArgs.sessionId);
  }

  return args;
}

/**
 * CLI 子进程环境变量
 */
function buildEnv(): Record<string, string> {
  const env: Record<string, string | undefined> = { ...process.env };

  // 标记为非交互环境
  env.CI = "true";
  env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = "1";
  // 标记入口点
  env.CLAUDE_CODE_ENTRYPOINT = "claude-p-proxy";

  // 删除 API key，强制走订阅
  delete env.ANTHROPIC_API_KEY;

  // 清除父 Claude Code 会话的环境变量，避免嵌套检测和参数污染
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.CLAUDE_ARGS;

  return env as Record<string, string>;
}

/**
 * 非流式调用：spawn claude -p，等待完成，返回结果文本
 */
export async function runClaude(cliArgs: CliArgs): Promise<{
  text: string;
  sessionId?: string;
}> {
  const args = buildArgs(cliArgs);

  if (config.verbose) {
    console.log(`[subprocess] spawn: claude ${args.filter(a => a !== cliArgs.prompt).join(" ")}`);
  }

  const startTime = performance.now();

  const proc = Bun.spawn([config.claudePath, ...args], {
    env: buildEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, config.timeout);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  clearTimeout(timer);

  const elapsed = (performance.now() - startTime).toFixed(0);

  if (config.verbose) {
    console.log(`[subprocess] done in ${elapsed}ms (exit: ${exitCode})`);
    if (stderr.trim()) console.log(`[subprocess] stderr: ${stderr.trim()}`);
  }

  if (exitCode !== 0) {
    throw new Error(
      `claude -p exited with code ${exitCode}: ${stderr.trim() || "unknown error"}`
    );
  }

  // --output-format json 时解析 JSON 获取 session_id
  if (cliArgs.outputFormat === "json") {
    try {
      const json: CliJsonResponse = JSON.parse(stdout);
      return {
        text: json.result || stdout.trim(),
        sessionId: json.session_id,
      };
    } catch {
      // JSON 解析失败，回退到纯文本
      return { text: stdout.trim() };
    }
  }

  return { text: stdout.trim() };
}

/**
 * 解析一行 stream-json，提取文本 delta
 * 兼容两种 CLI 输出格式：
 *   1. 扁平格式: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
 *   2. 包装格式: {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}},"session_id":"..."}
 */
function extractTextDelta(raw: any): string | null {
  // 包装格式 (--verbose / --include-partial-messages)
  if (raw.type === "stream_event" && raw.event) {
    const evt = raw.event;
    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
      return evt.delta.text ?? null;
    }
    return null;
  }
  // 扁平格式
  if (raw.type === "content_block_delta" && raw.delta?.type === "text_delta") {
    return raw.delta.text ?? null;
  }
  // 也检查顶层 delta（某些版本）
  if (raw.delta?.type === "text_delta" && raw.delta.text) {
    return raw.delta.text;
  }
  return null;
}

/**
 * 从一行 stream-json 中提取 session_id
 */
function extractSessionId(raw: any): string | null {
  return raw.session_id ?? raw.event?.session_id ?? null;
}

export interface StreamHandle {
  /** 终止子进程 */
  kill(): void;
  /** 等待子进程结束 */
  done: Promise<void>;
}

/**
 * 流式调用：spawn claude -p --output-format stream-json，逐行回调
 * 返回 StreamHandle 用于外部 kill（如客户端断开连接）
 */
export function runClaudeStream(
  cliArgs: CliArgs,
  onChunk: (text: string) => void,
  onSessionId?: (sessionId: string) => void
): StreamHandle {
  const args = buildArgs(cliArgs);

  if (config.verbose) {
    console.log(`[subprocess] spawn stream: claude ${args.filter(a => a !== cliArgs.prompt).join(" ")}`);
  }

  const proc = Bun.spawn([config.claudePath, ...args], {
    env: buildEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });

  let killed = false;

  const timer = setTimeout(() => {
    if (!killed) {
      killed = true;
      proc.kill();
    }
  }, config.timeout);

  const done = (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done: eof, value } = await reader.read();
      if (eof) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line);

          // 捕获 session_id
          const sid = extractSessionId(raw);
          if (sid && onSessionId) {
            onSessionId(sid);
          }

          // 提取文本 delta
          const text = extractTextDelta(raw);
          if (text) {
            onChunk(text);
          }
        } catch {
          // 跳过非 JSON 行
        }
      }
    }

    clearTimeout(timer);

    const exitCode = await proc.exited;
    if (exitCode !== 0 && !killed) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `claude -p stream exited with code ${exitCode}: ${stderr.trim()}`
      );
    }
  })();

  return {
    kill() {
      if (!killed) {
        killed = true;
        clearTimeout(timer);
        proc.kill();
      }
    },
    done,
  };
}
