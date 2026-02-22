# CLAUDE.md

## Project Overview

claude-p-proxy — OpenAI-compatible API proxy that wraps `claude -p` (Claude Code CLI). Allows Claude Max subscriptions to be used by OpenClaw and other OpenAI-compatible clients.

**Stack:** Bun + TypeScript, zero production dependencies.

## Architecture

```
Request (OpenAI format) → server.ts → adapter/openai-to-cli.ts → subprocess/manager.ts (spawn claude -p) → adapter/cli-to-openai.ts → Response (OpenAI format)
```

Key modules:
- `src/server.ts` — Bun HTTP server, routing, streaming/non-streaming dispatch
- `src/config.ts` — Environment-based configuration, model mapping table
- `src/adapter/openai-to-cli.ts` — Converts OpenAI messages to CLI prompt (XML tags for roles)
- `src/adapter/cli-to-openai.ts` — Converts CLI output to OpenAI response/chunk format
- `src/subprocess/manager.ts` — Spawns `claude -p`, handles streaming (StreamHandle) and non-streaming
- `src/session/manager.ts` — Maps external session IDs to CLI session IDs (in-memory)
- `src/types/openai.ts` — OpenAI API type definitions
- `src/types/claude-cli.ts` — Claude CLI JSON/stream-json output types

## Commands

```bash
bun install          # Install dependencies
bun run start        # Start server (default port 3456)
bun run dev          # Start with file watching (auto-restart)
```

## Key Design Decisions

- Uses `Bun.spawn()` (not `exec()`) to prevent shell injection
- Deletes `ANTHROPIC_API_KEY` from subprocess env to force subscription path
- Sets `CI=true` in subprocess env for non-interactive mode
- Streaming returns a `StreamHandle` with `kill()` + `done` promise for client disconnect cleanup
- Stream chunks share a single `requestId` per request; first chunk includes `role: "assistant"`
- Message roles use XML tags: `<system>`, `<previous_response>` — Claude understands these semantically
- Stream event parser handles both flat format and wrapped `stream_event` format from CLI
- Session mapping is in-memory only; CLI persists actual conversation data in `~/.claude/`

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PROXY_PORT` | `3456` | Listen port |
| `PROXY_HOST` | `127.0.0.1` | Bind address |
| `CLAUDE_PATH` | `claude` | Path to Claude CLI binary |
| `DEFAULT_MODEL` | `claude-sonnet-4-6` | Default model |
| `CLAUDE_TIMEOUT` | `120000` | Subprocess timeout (ms) |
| `VERBOSE` | `false` | Verbose logging |

## Code Style

- TypeScript strict mode, ESNext target, Bun types
- ES modules (`"type": "module"` in package.json)
- No semicolons preference is not enforced — existing code uses semicolons
- Chinese comments are acceptable (project originated in Chinese)
- Keep zero production dependencies — use Bun built-in APIs (Bun.serve, Bun.spawn, crypto.randomUUID, ReadableStream, etc.)
