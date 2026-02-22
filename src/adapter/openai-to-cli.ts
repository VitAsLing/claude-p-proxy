import type { ChatMessage, ChatCompletionRequest } from "../types/openai";
import type { CliArgs } from "../types/claude-cli";
import config from "../config";

/**
 * 将 OpenAI messages 数组转成 claude -p 可用的 prompt 文本
 *
 * 使用 XML 标签标记角色，Claude 对 XML 标签有良好的语义理解：
 *   system    → <system>...</system>
 *   assistant → <previous_response>...</previous_response>
 *   user      → 直接文本（最后一条）
 */
export function messagesToPrompt(messages: ChatMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : msg.content?.map((c) => c.text || "").join("\n") || "";

    switch (msg.role) {
      case "system":
        parts.push(`<system>\n${content}\n</system>`);
        break;
      case "user":
        parts.push(content);
        break;
      case "assistant":
        parts.push(`<previous_response>\n${content}\n</previous_response>`);
        break;
    }
  }

  return parts.join("\n\n").trim();
}

/**
 * 解析模型名称：简写 → CLI 实际模型 ID
 */
export function resolveModel(model?: string): string {
  if (!model) return config.defaultModel;
  // 去掉 OpenClaw 加的 "openai/" 前缀
  const cleaned = model.replace(/^openai\//, "");
  return config.models[cleaned] || cleaned;
}

/**
 * 将 OpenAI 请求转换为 Claude CLI 参数
 */
export function requestToCliArgs(
  request: ChatCompletionRequest,
  options: {
    stream: boolean;
    sessionId?: string;
    resume?: string;
  }
): CliArgs {
  return {
    prompt: messagesToPrompt(request.messages),
    model: resolveModel(request.model),
    outputFormat: options.stream ? "stream-json" : "json",
    sessionId: options.sessionId,
    resume: options.resume,
  };
}
