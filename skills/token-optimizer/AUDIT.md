# AUDIT.md · token-optimizer 自审报告（Skill Vetter）

> 装技能前必查（AGENTS.md 规则）。本技能是**自研技能**，此处如实自审。

## 它会做什么

| 项 | 说明 | 是否改环境 |
|---|---|---|
| `audit.js` | 读会话 usage + 文件体积 + cron 列表，输出四类问题 | ❌ 只读 |
| `session-context-check.js` | 读最近会话最后一次 usage | ❌ 只读 |
| `cron-audit.js` | 读 `openclaw cron list --json` | ❌ 只读 |
| `md-audit.js` | 读工作台 md 文件体积 | ❌ 只读 |
| `cron-migrate-isolated.js` | **改** cron 的 sessionTarget/payload | ⚠️ 需 `--apply` + `--jobs` 点名 |
| `selftest.js` | 在临时目录造假数据跑验证 | ❌ 只碰 tmp |

## 危险信号逐条核对

| 信号 | 结论 |
|---|---|
| curl/wget 未知 URL | ❌ 无网络请求 |
| 外发数据 | ❌ 不发送任何数据 |
| 索要凭证 | ❌ 不读任何 key/token/secret |
| 读 MEMORY/USER/SOUL | ⚠️ 仅读**文件体积与行数**，不读内容，不上传 |
| eval 外部输入 | ❌ 无 eval |
| 改系统文件 | ❌ 仅可选的 cron 配置修改（走官方 CLI，可回滚） |
| 混淆代码 | ❌ 全部明文、可读 |

**风险等级：🟢 可装**（默认只读；唯一写操作需显式 `--apply` 点名，且改前打印计划）

## 已知局限（对应 methodology.md 第六节）

1. 本地 usage ≠ 供应商账单
2. token 估算为粗估（字节/2.5）
3. cron 改道依赖语义判断，工具只给候选
4. 归档会话会分离对话连续性（本技能不自动归档）
5. 心跳/compaction 配置**不自动改**，只给命令

_自审人：若兰 🌸 · 2026-09-12_
