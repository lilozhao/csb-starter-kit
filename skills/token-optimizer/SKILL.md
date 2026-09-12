---
name: token-optimizer
description: AI Agent token 消耗体检与优化。扫描会话日志里的真实 usage，定位"上下文膨胀/调用次数过多/cron 灌主会话/工作台文件过肥"四类问题，并给出可执行的优化步骤（含 cron 改道、md 瘦身脚本）。当用户说"token 太多了"、"API 调用多"、"费用高"、"省 token"、"上下文太大"、"优化消耗"时触发。
---

# Token Optimizer · Agent token 消耗体检与优化

> 缘起：2026-09-12 给若兰做的一次实测（主会话 27 天未归档 → 每次调用携带 168K token；
> 20 个 cron 里 18 个灌主会话）。本文把这套方法做成**任何 agent 都能跑**的工具。

## 一句话原理

> **成本 = 调用次数 × 每次携带的上下文**
>
> 输出和新鲜输入都是零头。要省钱，只压这两个乘数。

## 快速开始

```bash
# 1) 只读体检（推荐先跑这个，不改任何东西）
node scripts/audit.js

# 2) 机器可读
node scripts/audit.js --json

# 3) 单项工具
node scripts/session-context-check.js        # 当前会话上下文多大（>80K 建议归档）
node scripts/md-audit.js                     # 工作台注入文件体积 & 瘦身建议
node scripts/cron-audit.js                   # cron 构成：多少任务在灌主会话
node scripts/cron-migrate-isolated.js --dry  # 纯脚本类任务改道 isolated（先 dry-run）

# 4) 应用（可回滚，改前自动备份）
node scripts/cron-migrate-isolated.js --apply
```

## 四类问题（audit.js 会自动判定）

| # | 问题 | 判据 | 解决 |
|---|---|---|---|
| 1 | **会话上下文膨胀** | 单次 `cacheRead` > 80K | 归档会话（新开）/ 调整 compaction |
| 2 | **调用次数过多** | 每日调用 > 200 或工具往返密集 | 合并命令、批量、不重复验证 |
| 3 | **cron 灌主会话** | `systemEvent→main` 占多数 | 纯脚本类改 `agentTurn→isolated` + `lightContext` |
| 4 | **工作台文件过肥** | 注入 md 合计 > 40KB | 分层：HOT 精简 + 详情进 archive（可检索） |

## 五步优化（按收益排序）

1. **归档膨胀会话**（最大，单次省 ~80%）
2. **减少工具往返**（每次往返 = 一次全额上下文付费）
3. **cron 改道** isolated + lightContext
4. **md 瘦身**（HOT ≤100 行；长文进 archive，用 memory_search 检索）
5. **心跳降频 + 夜间静默 + lightContext + isolatedSession**（配置项，需重启 gateway）

详见 `docs/methodology.md`（含实测数字与**诚实的代价说明**）。

## 环境变量（默认自适应，无需配置）

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPENCLAW_HOME` | `~/.openclaw` | OpenClaw 数据目录 |
| `OPENCLAW_WORKSPACE` | `$OPENCLAW_HOME/workspace` | 工作区 |
| `TOKEN_OPT_CONTEXT_KB` | `80` | 会话上下文告警阈值（KB） |
| `TOKEN_OPT_MD_KB` | `40` | 工作台 md 合计告警阈值（KB） |

## 安全说明

- **默认只读**：`audit.js` / `*-audit.js` / `*-check.js` 不改任何东西
- **改道可回滚**：`cron-migrate-isolated.js` 执行前会打印计划；建议先 `--dry`
- **不含任何凭证读取**：只看 session JSONL 里的 usage 与会话/文件体积
- 心跳/compaction 属配置项，本技能**不自动改**，只给命令，由使用者确认

## 自检

```bash
node scripts/selftest.js     # 构造假数据，验证四类判定逻辑
```
