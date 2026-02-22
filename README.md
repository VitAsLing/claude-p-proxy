# claude-p-proxy

> 通过 `claude -p`（Claude Code CLI）实现的 OpenAI 兼容 API 代理，让你的 Claude Max 订阅可以被 OpenClaw 等工具使用。
> 基于 Bun + TypeScript，支持 Session 管理、流式输出、模型映射。

---

## 从零开始：完整配置指南

> 适合新手，从什么都没有到 OpenClaw 用上 Claude Max 订阅。

### 第一步：确认你有 Claude Max 订阅

登录 [claude.ai](https://claude.ai)，确认你的账号是 **Max** 或 **Pro** 订阅。免费账号不支持 Claude Code CLI。

### 第二步：安装 Bun

[Bun](https://bun.sh) 是本项目的运行时（替代 Node.js，更快更轻量）。

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# 安装完刷新环境
source ~/.bashrc   # Linux
source ~/.zshrc    # macOS
```

验证：
```bash
bun --version
# 应输出版本号，如 1.x.x
```

### 第三步：安装 Claude Code CLI 并登录

```bash
# 安装 Claude Code CLI
npm install -g @anthropic-ai/claude-code

# 首次运行，会引导你登录
claude

# 按提示在浏览器中用你的 Max 账号完成 OAuth 登录
# 登录成功后终端会显示欢迎信息
```

验证 CLI 可用：
```bash
claude -p "说一句话测试" --output-format text
# 应输出 Claude 的回复
```

> **如果这一步失败**：说明 CLI 没有正确认证。重新运行 `claude` 完成登录流程。

### 第四步：启动 claude-p-proxy

```bash
# 克隆项目
git clone <你的仓库地址> claude-p-proxy
cd claude-p-proxy

# 安装依赖
bun install

# 启动代理服务
bun run start
```

看到以下输出说明启动成功：
```
┌──────────────────────────────────────────────────┐
│          claude-p-proxy v1.0.0                   │
│          Powered by Bun + Claude CLI             │
├──────────────────────────────────────────────────┤
│  🌐 http://127.0.0.1:3456                       │
│  🤖 Model:   claude-sonnet-4-6                  │
└──────────────────────────────────────────────────┘
```

快速验证 proxy 正常工作：
```bash
# 新开一个终端窗口，测试健康检查
curl http://localhost:3456/health

# 测试实际对话（第一次会慢 3-10 秒，是正常的）
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4","messages":[{"role":"user","content":"你好"}]}'
```

> **保持这个终端运行**，proxy 需要一直开着。后面可以用 systemd 设为后台服务（见[部署为系统服务](#部署为系统服务)）。

### 第五步：安装 OpenClaw

如果你还没装 OpenClaw：

```bash
# macOS
brew install openclaw

# 或通用方式
npm install -g openclaw
```

首次运行会引导初始化：
```bash
openclaw onboard
```

> 在 onboard 向导中，provider 选择可以先跳过，我们接下来手动配置。

### 第六步：配置 OpenClaw 连接 proxy

有两种方式，选一种即可：

#### 方式 A：直接编辑配置文件（推荐）

打开 `~/.openclaw/openclaw.json`，添加/修改以下内容：

```json5
{
  models: {
    providers: {
      "claude-p-proxy": {
        baseUrl: "http://127.0.0.1:3456/v1",
        apiKey: "not-needed",
        api: "openai-completions",
        models: [
          { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
          { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
          { id: "claude-opus-4", name: "Claude Opus 4" },
          { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" }
        ]
      }
    }
  },
  agents: {
    defaults: {
      model: { primary: "claude-p-proxy/claude-sonnet-4" }
    }
  }
}
```

#### 方式 B：CLI 快速配置

```bash
openclaw config set env.OPENAI_API_KEY "not-needed"
openclaw config set env.OPENAI_BASE_URL "http://localhost:3456/v1"
openclaw config set agents.defaults.model "openai/claude-sonnet-4"
openclaw gateway restart
```

### 第七步：验证 OpenClaw 已连通

```bash
# 在 OpenClaw 中发送一条消息测试
openclaw chat "你好，测试一下连通性"
```

如果收到 Claude 的回复，恭喜，配置完成！

### 完整流程图

```
你的 Claude Max 账号
        ↓ (OAuth 登录)
Claude Code CLI (claude -p)
        ↓ (本地调用)
claude-p-proxy (localhost:3456)
        ↓ (OpenAI 兼容 API)
OpenClaw / 其他工具
```

### 常见问题

| 问题 | 解决方法 |
|------|---------|
| `bun: command not found` | 重新 `source ~/.zshrc` 或 `source ~/.bashrc` |
| `claude: command not found` | 运行 `npm install -g @anthropic-ai/claude-code` |
| proxy 启动后测试返回错误 | 运行 `claude` 重新登录 Max 账号 |
| OpenClaw 报 connection refused | 确认 proxy 终端还在运行，端口 3456 没被占用 |
| 响应很慢（>10秒） | 正常，每次 spawn 进程需要几秒；建议开启 `stream: true` |
| 想换模型 | 改 OpenClaw 配置中的 model 为 `claude-opus-4` 或 `claude-haiku-4-5` |

---

## 工作原理

```
Your App → claude-p-proxy → Claude Code CLI → Anthropic (via subscription)
     (OpenAI format)        (converts format)     (uses your login)
```

1. 接收 OpenAI 格式请求（`/v1/chat/completions`）
2. 通过 adapter 转换为 Claude CLI 参数
3. spawn `claude -p` 子进程执行
4. 将 CLI 输出转换为 OpenAI 格式返回（支持流式）

---

## 核心特性

- **真实 CLI 调用** — 每次请求都是 `claude -p`，不偷 token、不伪造请求头
- **Session 管理** — 映射外部 session ID 到 CLI session，保持对话上下文
- **Session 持久化** — 依赖 Claude CLI 自身的 session 存储（`~/.claude/`），proxy 重启不丢上下文
- **流式输出** — SSE streaming 支持
- **模型映射** — 简写模型名 → CLI 实际模型 ID
- **OpenAI 兼容** — 标准 `/v1/chat/completions`，任何 OpenAI 客户端直接对接
- **安全设计** — 使用 `spawn()` 而非 `exec()`，防止 shell 注入

---

## 和其他方案的区别

| 方案 | 原理 | 风险 |
|---|---|---|
| OAuth token proxy | 直接读取 CLI 的 OAuth token 调 API | 较高，请求特征可被检测 |
| Agent SDK proxy | 用 `@anthropic-ai/claude-agent-sdk` | 中等，SDK 有特征 |
| **claude-p-proxy** | **spawn `claude -p` CLI** | **较低，标准 CLI 调用** |

---

## 项目结构

```
claude-p-proxy/
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts              # Bun HTTP 服务、路由
│   ├── config.ts              # 配置管理
│   ├── types/
│   │   ├── openai.ts          # OpenAI API 类型定义
│   │   └── claude-cli.ts      # Claude CLI JSON 输出类型
│   ├── adapter/
│   │   ├── openai-to-cli.ts   # OpenAI 请求 → CLI 参数
│   │   └── cli-to-openai.ts   # CLI 输出 → OpenAI 响应
│   ├── subprocess/
│   │   └── manager.ts         # spawn claude -p，管理子进程
│   └── session/
│       └── manager.ts         # Session ID 映射
├── scripts/
│   └── setup-systemd.sh       # systemd 服务安装脚本
└── README.md
```

---

## 测试

```bash
# 健康检查
curl http://localhost:3456/health

# 模型列表
curl http://localhost:3456/v1/models

# 非流式请求
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# 流式请求
curl -N -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

---

## Session 管理

### 原理

proxy 维护一个 **Session ID 映射表**：

```
外部 Session ID（来自 OpenClaw / 请求头）  →  Claude CLI Session ID（UUID）
```

- **首次请求**：创建新 CLI session（`claude -p --session-id <uuid>`），记录映射
- **后续请求**：复用 session（`claude -p --resume <cli-session-id>`），Claude 保持上下文
- **持久化**：对话内容由 Claude CLI 自动存储在 `~/.claude/` 中

### Session ID 来源

1. 请求头 `X-Session-Id`
2. 请求体 `session_id` 字段
3. 未提供时自动生成（独立请求，无上下文）

### 示例

```bash
# 第一轮
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "X-Session-Id: tg-user-12345" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4","messages":[{"role":"user","content":"我叫小明"}]}'

# 第二轮（Claude 记住你是小明）
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "X-Session-Id: tg-user-12345" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4","messages":[{"role":"user","content":"我叫什么？"}]}'
```

---

## Available Models

| Model ID | Maps To |
|---|---|
| `claude-opus-4` | Claude Opus 4 |
| `claude-opus-4-6` | Claude Opus 4.6 |
| `claude-sonnet-4` | Claude Sonnet 4 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-haiku-4-5` | Claude Haiku 4.5 |

不在映射表中的模型名会直接传给 CLI。

---

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/chat/completions` | 聊天补全（OpenAI 兼容） |
| `GET` | `/v1/models` | 模型列表 |
| `GET` | `/health` | 健康检查 |
| `GET` | `/sessions` | 活跃 Session 列表 |
| `DELETE` | `/sessions/:id` | 删除指定 Session |

---

## 配置

通过环境变量配置：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PROXY_PORT` | `3456` | 监听端口 |
| `PROXY_HOST` | `127.0.0.1` | 绑定地址（保持 localhost） |
| `CLAUDE_PATH` | `claude` | CLI 路径 |
| `DEFAULT_MODEL` | `claude-sonnet-4-6` | 默认模型 |
| `CLAUDE_TIMEOUT` | `120000` | 超时（毫秒） |
| `VERBOSE` | `false` | 详细日志 |

---

## 部署为系统服务

```bash
chmod +x scripts/setup-systemd.sh
sudo bash scripts/setup-systemd.sh
```

```bash
systemctl status claude-p-proxy
systemctl restart claude-p-proxy
journalctl -u claude-p-proxy -f
```

---

## 故障排除

**"Failed to spawn Claude CLI"**
```bash
which claude
claude -p "test"
```

**"exited with code 1"**
```bash
claude     # 重新登录
```

**响应慢**
- 每次 spawn 进程预期 3-10 秒
- 开 streaming 改善体验
- Session 复用后后续请求更快

---

## Notes

- 这是社区工具，不受 Anthropic 或 OpenClaw 官方支持
- 需要有效的 Claude Max/Pro 订阅且 Claude Code CLI 已认证
- proxy 在本地运行，不会向任何第三方服务器发送数据
- 完整支持流式响应

## See Also

- [Anthropic provider](https://docs.openclaw.ai/providers/anthropic) — OpenClaw 原生 Claude 集成（API key）
- [OpenAI provider](https://docs.openclaw.ai/providers/openai) — OpenAI 兼容端点
- [claude-max-api-proxy](https://docs.openclaw.ai/providers/claude-max-api-proxy) — 类似项目（Node.js）
