// ── Claude CLI --output-format json 的输出类型 ───────────────

export interface CliJsonResponse {
  type: "result";
  subtype: "success" | "error";
  cost_usd?: number;
  is_error?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  session_id?: string;
  result?: string;
  error?: string;
}

// ── Claude CLI --output-format stream-json 的事件类型 ────────

export interface CliStreamEvent {
  type: string;
  subtype?: string;
  // init 事件
  session_id?: string;
  // message 事件
  message?: CliStreamMessage;
  // content_block_delta 事件
  index?: number;
  delta?: CliStreamDelta;
  // result 事件
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
}

export interface CliStreamMessage {
  id: string;
  type: string;
  role: string;
  content: CliStreamContentBlock[];
  model: string;
}

export interface CliStreamContentBlock {
  type: "text" | "tool_use";
  text?: string;
}

export interface CliStreamDelta {
  type: "text_delta" | "input_json_delta";
  text?: string;
}

// ── CLI 参数 ─────────────────────────────────────────────────

export interface CliArgs {
  prompt: string;
  model: string;
  outputFormat: "text" | "json" | "stream-json";
  sessionId?: string;   // 新建 session
  resume?: string;      // 恢复已有 session
}

// ── CLI 环境变量 ─────────────────────────────────────────────

export interface CliEnv {
  CI: string;
  CLAUDE_CODE_ENTRYPOINT: string;
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: string;
}
