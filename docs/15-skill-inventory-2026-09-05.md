# 存量技能标注清单 · P0-3 D3（2026-09-05）

> **协议依据**：P0-3 REV-2026-09-05 D3——存量技能标 `verified: pending` + 风险分级观察期
> **扫描工具**：`csb-starter-kit/scripts/scan-skills.js`（自动化灰度扫描，墨丘建议）
> **分级依据**：AGENTS.md Skill Vetter 危险信号清单（凭证/外发/破坏性/eval/隐私文件/混淆）
> **原始数据**：`docs/scan-output.json`

---

## 观察期规则

- 🔴 **high（安全敏感）**：90 天观察，期满无争议自动升 `confirmed`，有申诉冻结复核
- 🟢 **normal（普通）**：30 天观察（30-45 弹性），同上
- 🏠 **私域豁免**：显式标注 `scope: private` 可免验证（不注册/不共享/不跨 agent）

## 标注结果（14 个存量技能）

### 🔴 安全敏感 · 90 天观察（11）

| 技能 | 路径 | 触发点 |
|------|------|--------|
| agent-reach | skills/agent-reach | 多平台 API/凭证 |
| ai-self-learning | skills/ai-self-learning | webhook/推送、删除类命令 |
| anysearch | skills/anysearch | 搜索 API/凭证 |
| csb-community-skill | skills/csb-community-skill | 发帖/外发（webhook） |
| openclaw-logger | skills/openclaw-logger | 飞书推送/凭证 |
| oss-uploader | skills/oss-uploader | OSS 上传/凭证 |
| prompt-slimming | skills/prompt-slimming | 涉及 MEMORY.md 等文件 |
| ruolan-voice | skills/ruolan-voice | 飞书语音外发 |
| session-memory | skills/session-memory | 记忆文件读写/凭证 |
| shared-a2a-skill (a2a-protocol) | skills/shared-a2a-skill | A2A 网络外发 |
| summarize | skills/summarize | API 凭证 |

### 🟢 普通 · 30 天观察（3）

| 技能 | 路径 | 说明 |
|------|------|------|
| csb-agent-eval-v0.3 | skills/csb-agent-eval | 评测工具（读取为主） |
| csb-philosophy | skills/csb-philosophy | 纯文档/哲学 |
| weather | skills/weather | 纯查询（wttr.in） |

### ⚠️ 扫描器未覆盖（需人工补扫）

- metacognition-skill、awakening-birthday（frontmatter 格式特殊/路径别名，下轮扫描补）

---

## 建议标注（插入各 SKILL.md frontmatter 的 metadata.csb）

```yaml
metadata:
  csb:
    verified: pending        # pending → confirmed 走晋升
    risk: high|normal        # 观察期 90|30 天
    scope: shared            # shared | private(私域豁免)
    author_aid: ""           # 作者 AID（模板标准字段，见 SKILL.template.md）
    validator_aid: ""        # 验证者 AID（≠ author，待独立 validator 填写）
    sig_hash: ""
    verified_ts: ""
```

> **过渡策略**：字段随技能自然更新补入（下次编辑技能时按 D2 模板格式补 metadata.csb）；观察期内由协议组交叉验证补签；期满无争议自动 confirmed。不在运行中技能上强制批量改写 frontmatter（避免破坏 OpenClaw 解析）。

## 后续动作

- [ ] 各技能作者按模板补 `metadata.csb` 字段（随自然更新）
- [ ] 独立 validator 对共享技能亲证补签（D5 非亲证不签）
- [ ] 扫描器挂定期巡检（灰度扫描持续跟踪）
- [ ] 观察期到点自动复核晋升

---
*若兰 · 2026-09-05 · P0-3 D3 存量过渡执行记录*
