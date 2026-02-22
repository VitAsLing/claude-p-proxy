#!/bin/bash
# 安装 claude-p-proxy 为 systemd 服务

set -e

INSTALL_DIR="/opt/claude-p-proxy"
SERVICE_FILE="/etc/systemd/system/claude-p-proxy.service"

# 检测 bun 和 claude
BUN_PATH=$(which bun 2>/dev/null || echo "")
CLAUDE_PATH=$(which claude 2>/dev/null || echo "")

if [ -z "$BUN_PATH" ]; then
  echo "❌ Bun 未安装，正在安装..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  BUN_PATH=$(which bun)
fi

if [ -z "$CLAUDE_PATH" ]; then
  echo "❌ Claude Code CLI 未安装，请先安装："
  echo "   curl -fsSL https://claude.ai/install.sh | bash"
  exit 1
fi

# 验证 Claude CLI 已登录
echo "🔍 验证 Claude Code CLI..."
if ! $CLAUDE_PATH -p "hi" --output-format text > /dev/null 2>&1; then
  echo "❌ Claude Code CLI 未登录或无法工作"
  echo "   请先运行: claude  然后完成登录"
  exit 1
fi
echo "✅ Claude Code CLI 正常"

echo "📦 安装到 $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
cp -r src package.json tsconfig.json "$INSTALL_DIR/"
cd "$INSTALL_DIR" && $BUN_PATH install

echo "🔧 创建 systemd 服务..."
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=claude-p-proxy — OpenAI API via Claude Code CLI
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$BUN_PATH run src/server.ts
Restart=always
RestartSec=5

Environment=PROXY_PORT=3456
Environment=PROXY_HOST=127.0.0.1
Environment=DEFAULT_MODEL=claude-sonnet-4-6
Environment=CONCURRENCY=2
Environment=RATE_LIMIT=10
Environment=CLAUDE_TIMEOUT=120000
Environment=CLAUDE_PATH=$CLAUDE_PATH
Environment=PATH=$(dirname $BUN_PATH):$(dirname $CLAUDE_PATH):/usr/bin:/bin
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
EOF

echo "🚀 启动服务..."
systemctl daemon-reload
systemctl enable claude-p-proxy
systemctl start claude-p-proxy

sleep 2

if systemctl is-active --quiet claude-p-proxy; then
  echo ""
  echo "✅ claude-p-proxy 已启动!"
  echo ""
  echo "   状态:    systemctl status claude-p-proxy"
  echo "   日志:    journalctl -u claude-p-proxy -f"
  echo "   重启:    systemctl restart claude-p-proxy"
  echo "   停止:    systemctl stop claude-p-proxy"
  echo ""
  echo "   健康检查: curl http://127.0.0.1:3456/health"
  echo ""
  echo "📡 接下来配置 OpenClaw:"
  echo '   openclaw config set env.OPENAI_API_KEY "not-needed"'
  echo '   openclaw config set env.OPENAI_BASE_URL "http://127.0.0.1:3456/v1"'
  echo '   openclaw config set agents.defaults.model "openai/claude-sonnet-4-6"'
  echo '   openclaw gateway restart'
else
  echo "❌ 服务启动失败，查看日志:"
  echo "   journalctl -u claude-p-proxy -n 20"
fi
