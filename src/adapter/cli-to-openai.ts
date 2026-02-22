import type {
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "../types/openai";

/**
 * 构建 OpenAI 非流式响应
 */
export function buildChatResponse(
  content: string,
  model: string
): ChatCompletionResponse {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * 构建 OpenAI 流式 chunk
 * @param requestId 同一请求内所有 chunk 共享的 ID
 * @param isFirst  第一个 chunk 需要带 role: "assistant"
 */
export function buildStreamChunk(
  content: string,
  model: string,
  requestId: string,
  options: { done?: boolean; isFirst?: boolean } = {}
): ChatCompletionChunk {
  const { done = false, isFirst = false } = options;
  const delta: { role?: string; content?: string } = done
    ? {}
    : { content };
  if (isFirst && !done) {
    delta.role = "assistant";
  }
  return {
    id: `chatcmpl-${requestId}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: done ? "stop" : null,
      },
    ],
  };
}

/**
 * 编码 SSE 事件
 */
export function encodeSSE(data: object | string): Uint8Array {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return new TextEncoder().encode(`data: ${text}\n\n`);
}
