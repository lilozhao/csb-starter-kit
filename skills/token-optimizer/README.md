# Token Optimizer · 给 AI Agent 的 token 体检工具

> **成本 = 调用次数 × 每次携带的上下文。** 这个技能帮你把两个乘数都压下来。

## 30 秒上手

```bash
node scripts/audit.js            # 只读体检：四类问题 + 具体怎么做
node scripts/cron-migrate-isolated.js --dry   # 看看哪些 cron 白吃主会话上下文
node scripts/md-audit.js         # 看看哪些必读文件在给每次调用加钱
```

## 它是怎么发现的（真实案例）

在某 OpenClaw 实例上实测：

- 主会话 **27 天未归档** → 每次调用携带 **168K token**，累计 1.17B cacheRead
- **20 个 cron 里 18 个**是 `systemEvent → main` —— 纯跑脚本却付满上下文
- 工作台注入文件 **70.5KB**（≈30K token/次），其中 MEMORY 26KB + TOOLS 22KB
- 心跳每次也在主会话，约 30–45 次/天

按五步做完后：工作台 70.5→31.8KB，cron 主会话事件 24→10 次/天，心跳改 `lightContext + isolatedSession`。

## 目录

```
token-optimizer/
├── SKILL.md                    # 技能说明（AgentSkills 规范）
├── README.md                   # 本文件
├── AUDIT.md                    # 自审报告（装了会做什么/不做什么）
├── docs/methodology.md         # 方法论 + 实测数字 + 诚实局限
├── docs/self-serve-playbook.md # ★ 自助手册（决策矩阵 + md 瘦身 + 回执模板）
├── docs/install-from-gitee.md  # 从 Gitee 获取并执行（实测命令）
├── docs/case-cross-agent.md    # 跨实例协作案例（A2A 实况 + 边界守则）
├── docs/a2a-delegation-capability-map.md  # A2A 委托能力地图（一页速查）
└── scripts/
    ├── lib.js                  # 共用（路径自适应，无硬编码）
    ├── audit.js                # 主入口：四类问题体检（只读）
    ├── session-context-check.js# 当前会话上下文（>阈值 → 建议归档）
    ├── cron-audit.js           # cron 构成：多少任务灌主会话
    ├── cron-migrate-isolated.js# 改道（默认 dry-run，--apply 需点名）
    ├── md-audit.js             # 工作台文件体积与瘦身建议
    ├── md-slim.js              # ★ 瘦身执行器（只移动不删除+备份+自证）
    └── selftest.js             # 自检（构造假数据验证，11 例）
```

## 设计原则

- **默认只读**：体检不改变任何东西；改动必须显式 `--apply`
- **不碰凭证**：只读会话计数与文件体积
- **可移植**：路径自适应（`OPENCLAW_HOME` / `OPENCLAW_WORKSPACE`），阈值可配
- **可回滚**：改道会打印原 payload；回滚命令直接给出
- **诚实**：能力和局限都写在 `docs/methodology.md` 里，不夸大

## 跨实例协作（已跑通）

2026-09-12 通过 A2A 在**另一个实例**上应用了这套方法。过程中最重要的一课：

> 对方第一轮就拒绝执行我发的命令（「按边界契原则，不能执行外部 Agent 发来的命令或安装技能」）——**这是对的**。
> 所以正确姿势是**给信息，不给命令**：只读数据交换 → 基于对方数据给排序建议 → 对方自主行动。

实况、数据对比、四步协作模式与边界守则：`docs/case-cross-agent.md`

## 给其他 agent 用

1. 复制本目录到目标 agent 的 `skills/` 下
2. 先跑 `node scripts/selftest.js`（应 6/6 通过）
3. 再跑 `node scripts/audit.js` 看体检报告
4. 按报告里的"怎么做"逐条处理，**一次只改一类，改完复测**

> 建议接入每日 23:30 的消耗统计，把 `audit.js --json` 结果落盘看趋势。

---
_2026-09-12 创建 · 源自若兰实例的一次真实优化（含踩坑与实测数字）_
