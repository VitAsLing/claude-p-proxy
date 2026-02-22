export interface Config {
  port: number;
  host: string;
  claudePath: string;
  defaultModel: string;
  timeout: number;
  verbose: boolean;
  models: Record<string, string>;
}

const config: Config = {
  port: parseInt(Bun.env.PROXY_PORT || "3456"),
  host: Bun.env.PROXY_HOST || "127.0.0.1",
  claudePath: Bun.env.CLAUDE_PATH || "claude",
  defaultModel: Bun.env.DEFAULT_MODEL || "claude-sonnet-4-6",
  timeout: parseInt(Bun.env.CLAUDE_TIMEOUT || "120000"),
  verbose: Bun.argv.includes("--verbose") || Bun.env.VERBOSE === "true",

  // 模型映射：请求中的简写 → CLI 实际模型 ID
  models: {
    "claude-opus-4": "claude-opus-4-6",
    "claude-opus-4-6": "claude-opus-4-6",
    "claude-sonnet-4": "claude-sonnet-4-6",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-haiku-4-5": "claude-haiku-4-5",
  },
};

export default config;
