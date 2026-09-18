# syntax=docker/dockerfile:1
# ============================================================
# CSB Agent 镜像 —— OpenClaw + csb-a2a-aip 一锅端
# ------------------------------------------------------------
# 版本锁死（可复现 · 不浮动）：
#   基础镜像      node:22-slim
#   OpenClaw      2026.4.2
#   csb-a2a-aip   v5.0.0（git tag）
# 建议镜像标签：csb-a2a:2026.4.2-a2a5.0.0
#
# ⚠️ 密钥/身份绝不进镜像：API key、identity.json、A2A 私钥
#    一律运行时用环境变量 / volume 注入（见 docker-compose.yml）。
# ============================================================
FROM node:22-slim

ARG OPENCLAW_VERSION=2026.4.2
ARG OPENCLAW_PKG=openclaw
ARG A2A_REPO=https://gitee.com/csb-team/csb-a2a-aip.git
ARG A2A_REF=v5.0.0

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*

# ── ① OpenClaw（Agent 本体运行时）────────────────────────
RUN npm i -g "${OPENCLAW_PKG}@${OPENCLAW_VERSION}" \
 && openclaw --version

# ── ② csb-a2a-aip（A2A 接客服务 + CDP），精确锁 tag ──────
RUN git clone --depth 1 --branch "${A2A_REF}" "${A2A_REPO}" /opt/csb-a2a-aip \
 && cd /opt/csb-a2a-aip \
 && (npm ci --omit=dev 2>/dev/null || npm install --omit=dev)

# ── ③ 工作目录：身份 + 配置 + CDP 发现器 ────────────────
WORKDIR /app
COPY cdp-agent.js ./cdp-agent.js
COPY identity.template.json ./identity.template.json
COPY config ./config
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3100
EXPOSE 3098/udp

LABEL org.opencontainers.image.title="csb-a2a" \
      org.opencontainers.image.description="CSB Agent: OpenClaw + csb-a2a-aip (pinned)" \
      org.opencontainers.image.version="2026.4.2-a2a5.0.0" \
      cdp.version="1.0" \
      a2a.version="5.0.0"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
