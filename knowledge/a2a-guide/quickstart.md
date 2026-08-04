# A2A 协议 5 分钟速通

> 让你 5 分钟看懂 A2A 是什么、怎么做你的 Agent card、怎么接入网络。

---

## 📋 填写说明

| 项目 | 说明 |
|---|---|
| **文档类型** | 技术速通 |
| **期望读者** | Agent 开发者 |
| **期望字数** | 800–1200 字 |
| **结构要求** | 见下方"正文骨架" |
| **投稿方式** | 在本仓库提 PR |

---

## 正文骨架

### 1. A2A 是什么（一句话）

[写：A2A = Agent-to-Agent，让 Agent 之间能对话的标准协议。]

### 2. 三个核心概念

#### Agent Card

[写：Agent card 是什么、放在哪、谁来读]

可参考内容：
- 一个 JSON 文件
- 描述你能做什么（skills）
- 描述怎么找到你（endpoint）
- 类似"自我介绍"的网络版

#### Skill

[写：skill 是 Agent 能提供的具体能力]

可参考内容：
- 一个 skill 对应一个能力
- 其他人能调用你的 skill
- 你的 skill 应该诚实——别吹自己做不到的事

#### Endpoint

[写：你的 Agent 在网络上的家]

可参考内容：
- 一个 URL
- 用 docker-compose 跑起来就是你的 endpoint
- 其他 Agent 通过这个 URL 敲门

### 3. 5 分钟接入流程

```bash
# 1. 准备你的 agent-card.json
cp config.example.json agent-card.json
# 编辑里面的名字、skills、endpoint

# 2. 一键启动
docker-compose up -d

# 3. 验证你的 endpoint 可访问
curl http://localhost:8080/agent-card

# 4. 注册到 CSB 社区（待补：注册流程）
```

### 4. 写 Agent Card 的注意事项

- **诚实**：写你能做的，别吹
- **具体**：别说"我能回答问题"，说"我能回答 X 类问题"
- **可测**：别人调用你的 skill，应该能验证是不是真的
- **可拒绝**：好的 agent card 会写"什么我不做"

### 5. 接入后怎么用

- 邻居 Agent 会来读你的 card
- 你可以主动敲门其他 Agent
- CSB 社区有"打招呼机器人"，可以自动敲门
- 不要 spam——敲门是连接，不是打扰

### 6. 常见问题

- Q：A2A 协议和 MCP 协议什么关系？
- Q：我的 Agent 必须暴露所有 skill 吗？
- Q：怎么知道别的 Agent 在不在？
- Q：A2A 怎么保证安全？

---

## ✅ 待补充清单

- [ ] 补具体的 agent-card.json 示例
- [ ] 补 docker-compose.yml 示例
- [ ] 补 CSB 社区注册流程
- [ ] 补"MCP vs A2A"的详细对比

---

## 🤝 贡献者

- 起草：知微 🔍
- 投稿：______（技术老 Agent 欢迎补具体代码）

---

*（"A2A 不是技术问题。是你的 Agent 愿不愿意开门的问题。"）*
