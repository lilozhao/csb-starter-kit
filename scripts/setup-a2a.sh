#!/usr/bin/env bash
# ============================================================
# CSB Starter Kit · A2A 一键接入（CDP v0.1 · 新局域网自助入网）
#
# 默认约定：
#   Agent 端口 = 3100（写死，被占自动回退 3101–3199）
#   注册表端口 = 3099（CDP 自动发现，.env 里是兜底种子）
#
# 装完自动跑一次 cdp-agent.js join：发现 → 查重 → 注册 → 握手
#
# 用法：
#   bash scripts/setup-a2a.sh            # 完整接入
#   bash scripts/setup-a2a.sh --dry      # 演练，不实际注册
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
A2A="$ROOT/a2a-server"

echo "🌸 CSB Starter Kit · A2A 接入（CDP v0.1）"
echo

# ── 0. 依赖检查 ────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 需要 Node.js（≥ 16）。请先安装：https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 16 ]; then
  echo "❌ Node.js 版本过低（当前 $(node -v)），需要 ≥ 16" >&2
  exit 1
fi

# ── 1. 生成 .env（默认端口 3100 / 注册表 3099）──────────────
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "📝 已生成 .env（默认：CDP_PORT=3100, CDP_REGISTRY=…:3099）"
fi
set -a; . "$ROOT/.env"; set +a

# [明澈 P2 · 2026-10-02] 身份名：A2A_AGENT_NAME 优先，CDP_NAME 兼容回退
AGENT_NAME="${A2A_AGENT_NAME:-${CDP_NAME:-my-agent}}"
AGENT_PORT="${CDP_PORT:-3100}"                                   # ← 默认写死 3100
REGISTRY_URL="${CDP_REGISTRY:-http://csbc.lilozkzy.top:3099}"    # ← 预填 3099

if [ "$AGENT_NAME" = "my-agent" ]; then
  echo "⚠️  .env 里身份名还是默认值 'my-agent'，请改成你自己的名字（A2A_AGENT_NAME）后重跑。"
fi

# ── 2. 生成 identity.json（默认端口 3100）───────────────────
if [ ! -f "$A2A/identity.json" ]; then
  sed -e "s|__NAME__|${AGENT_NAME}|g" -e "s|__PORT__|${AGENT_PORT}|g" \
      "$A2A/identity.template.json" > "$A2A/identity.json"
  echo "🪪 已生成 identity.json（name=${AGENT_NAME}, port=${AGENT_PORT}）"
else
  echo "🪪 复用已有 identity.json"
fi

# ── 3. 自动入网：cdp-agent.js join ──────────────────────────
echo
echo "🔎 开始入网（① 广播 → ② 扫描 → ③ 查重 → ④ 注册 → ⑤ 握手）"
echo "────────────────────────────────────────────────────────"
cd "$A2A"
CDP_NAME="$AGENT_NAME" CDP_PORT="$AGENT_PORT" CDP_REGISTRY="$REGISTRY_URL" \
  node cdp-agent.js join "$@"
echo "────────────────────────────────────────────────────────"
echo
echo "✅ 接入流程完成。"
echo "   常驻应答器（让别的 Agent 能发现你）：node $A2A/cdp-agent.js serve"
echo "   重新接入：bash scripts/setup-a2a.sh"
