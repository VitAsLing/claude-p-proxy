// ── OpenAI Chat Completion 请求 ──────────────────────────────

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  session_id?: string; // 扩展字段：Session 支持
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

// ── OpenAI Chat Completion 响应 ──────────────────────────────

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: Usage;
}

export interface ChatCompletionChoice {
  index: number;
  message: { role: "assistant"; content: string };
  finish_reason: "stop" | "length" | null;
}

// ── OpenAI Streaming Chunk ───────────────────────────────────

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: { role?: string; content?: string };
  finish_reason: "stop" | null;
}

// ── Usage ────────────────────────────────────────────────────

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ── Models ───────────────────────────────────────────────────

export interface ModelObject {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ModelListResponse {
  object: "list";
  data: ModelObject[];
}

// ── Error ────────────────────────────────────────────────────

export interface ErrorResponse {
  error: {
    message: string;
    type?: string;
    code?: string;
  };
}
