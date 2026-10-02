# A2A 服务接入指南（CDP v0.1）

> 让一只刚苏醒的 Agent，**零配置**接入碳硅契 A2A 网络。
> 核心是一件小事：**它得先在陌生网络里找到同类。**

---

## 一句话说明

CDP（CSB Discovery Protocol）解决一个具体问题：**Agent 进入一个陌生局域网时，不知道网内有谁、也没有注册表地址**。它靠"喊一声 + 扫一遍"自助入网，然后注册、握手。

---

## 约定端口（CDP 的地基）

| 端口 | 角色 |
|---|---|
| `3098/udp` | CDP 广播探询口（自定义 UDP，零依赖） |
| `3099` | 注册表（**一网一个**；CDP 自动发现） |
| `3100` | Agent 默认监听口（被占自动回退 `3101–3199`） |

> 默认安装即用这三个端口——这正是"扫两个口就能找到人"的前提。

---

## 3 分钟接入

### 方式 A · Docker 一键启动（推荐：OpenClaw + csb-a2a-aip 一锅端）

```bash
cp .env.example .env          # 改 A2A_AGENT_NAME=你的名字
cd a2a-server
docker compose up -d --build  # 构建/拉镜像 → A2A 接客 + CDP 应答 + 自动入网
docker compose logs -f
```

**镜像里锁死的版本**：`node:22-slim` · OpenClaw `2026.4.2` · csb-a2a-aip `v5.0.0`
镜像标签：`csb-a2a:2026.4.2-a2a5.0.0`（需 Compose ≥ 2.24）
> ⚠️ 构建需在**带 docker daemon 的机器**上跑；版本已锁死，构建可复现。
> 密钥 / 身份**运行时注入**（环境变量或 volume），**绝不进镜像**。

### 方式 B · 轻量 Node（不装 Docker，只要 Node ≥ 16）

```bash
bash scripts/setup-a2a.sh            # 生成 .env/identity.json → 自动 join
node a2a-server/cdp-agent.js serve   # 常驻，让别人能发现你
```

两种方式首次都建议改 `.env` 里的身份名（`A2A_AGENT_NAME`，旧名 `CDP_NAME` 仍兼容；重名会被注册表拒绝）。

> 🔗 **跨库一致性**：若你同时装了其他 CSB 库（如 `csb-a2a-aip` / `csb-security`），
> 各库 `.env` 里的 `A2A_AGENT_NAME` 必须**同一个值**。

---

## cdp-agent.js 全部命令

```bash
node a2a-server/cdp-agent.js discover   # 探询+扫描（只读），列出网内注册表与 Agent
node a2a-server/cdp-agent.js probe      # 只做 UDP 广播探询（--targets 1.2.3.4 可定向）
node a2a-server/cdp-agent.js scan       # 只扫端口（--ports 3099,3100-3199 --subnet 192.168.1.0/24）
node a2a-server/cdp-agent.js port       # 找一个空闲 Agent 口（回退 3101–3199）
node a2a-server/cdp-agent.js join       # 完整入网：发现→查重→注册→握手（--dry 演练）
node a2a-server/cdp-agent.js serve      # 跑 UDP :3098 应答器
```

---

## 入网四步（CDP 干的事）

1. **出场广播** —— 向 `255.255.255.255:3098` 发 `csb.probe`，报上自己。
2. **应答发现** —— 网内注册表 / 任一 Agent 回 `csb.here`，给出注册表地址。
3. **兜底扫描** —— 广播没人应时，扫本网段 `:3099` 找注册表；找不到注册表就扫 `:3100–3199` 找对端（点对点直连）。
4. **注册 + 握手** —— 向注册表登记 → 走 AID 交换确认身份。

> ⚠️ **Docker 网桥内 UDP 广播通常不通**（容器间被隔离）——那时会**自动走第 3 步扫描**，这是预期行为，不是坏了。
> 真实局域网 / 跨主机才用得上广播。

---

## 唯一性与冲突（fail loud）

- 唯一性 = `(IP, 端口)`；**重名 → 拒绝注册并报错**，不静默覆盖。
- Agent 口 `3100` 被占用 → 自动回退 `3101–3199`；全满 → 报错退出（不许静默漂移）。
- 注册表口 `3099` **一网一个**：先探测，有就接入，不起第二个。

---

## 发现 ≠ 信任

发现只解决"知道你在哪儿"；信任是另一回事——AID 握手通过之前，对方只是"待验证邻居"。

---

## 安全建议

- 不要把敏感信息写进 `identity.json` / agent card
- 定期看 endpoint 日志，给不想要的请求一个明确拒绝的理由（warmDeny）
- 身份以 `agentId` 为准，不认 `host:port` 字面量（端口会回退）

---

## 常见问题

- **Q：我的网络没有注册表怎么办？**
  A：CDP 会退化为**点对点直连**（广播互认 + 直连）。也可以由一台机器先跑注册表再接入。
- **Q：广播没反应，是不是坏了？**
  A：在 Docker 网桥里是正常的——CDP 自动改用扫描。想验证广播，可 `serve` 起应答器后 `probe --targets 127.0.0.1`。
- **Q：端口必须 3100 吗？**
  A：默认是；若被占用，CDP 会自动回退，或你在 `.env` 的 `CDP_PORT` 显式指定。

---

## 参考实现

- `a2a-server/cdp-agent.js` —— CDP v0.1 参考实现（纯 Node 内置模块，零依赖）
- 协议全文与决策记录见 `docs/cdp-发现协议-v0.1.md`

---

*（"A2A 不是技术问题。是你的 Agent 愿不愿意开门的问题。"）*
