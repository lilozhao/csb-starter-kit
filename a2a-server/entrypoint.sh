#!/usr/bin/env bash
# ============================================================
# CSB Agent 容器入口
#   ① A2A 接客服务（server_v5.js，监听 3100）
#   ② CDP 应答器（UDP 3098，让别人发现本机）
#   ③ 自动入网（cdp-agent.js join，一次性）
#   ④ 可选：OpenClaw gateway（OPENCLAW_ENABLE=1）
# ============================================================
set -euo pipefail

A2A_DIR=/opt/csb-a2a-aip
APP_DIR=/app
cd "$APP_DIR"

NAME="${CDP_NAME:-my-agent}"
PORT="${CDP_PORT:-3100}"

# ── 身份：无则从模板生成（端口默认 3100）──────────────────
if [ ! -f "$APP_DIR/identity.json" ]; then
  sed -e "s|__NAME__|${NAME}|g" -e "s|__PORT__|${PORT}|g" \
      "$APP_DIR/identity.template.json" > "$APP_DIR/identity.json"
  echo "[entrypoint] 已生成 identity.json (name=${NAME}, port=${PORT})"
fi

# ── ① A2A 接客服务 ────────────────────────────────────────
echo "[entrypoint] 启动 A2A server (server_v5.js :${PORT}) ..."
( cd "$A2A_DIR" && node server_v5.js ) &
A2A_PID=$!

# ── ② CDP 应答器 ──────────────────────────────────────────
echo "[entrypoint] 启动 CDP 应答器 (UDP 3098) ..."
node "$APP_DIR/cdp-agent.js" serve &
CDP_PID=$!

# ── ③ 自动入网（等服务起来再注册 + 握手）──────────────────
( sleep 2; CDP_NAME="$NAME" CDP_PORT="$PORT" \
    node "$APP_DIR/cdp-agent.js" join || echo "[entrypoint] join 未完成（注册表可能暂不可达，稍后可重试）" ) &

# ── ④ 可选：OpenClaw gateway ──────────────────────────────
if [ "${OPENCLAW_ENABLE:-0}" = "1" ]; then
  echo "[entrypoint] 启动 OpenClaw gateway ..."
  openclaw gateway start || echo "[entrypoint] gateway 启动失败（可忽略）"
fi

cleanup() { kill "$A2A_PID" "$CDP_PID" 2>/dev/null || true; }
trap cleanup TERM INT

echo "[entrypoint] 就绪 ✅"
wait -n
