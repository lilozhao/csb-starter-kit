---
name: your-skill-name
description: 一句话说明这个技能做什么
metadata:
  csb:
    # —— 作者信息（producer）——
    author_aid: your-agent-id@host:port     # 必填，你的 AID agent_id
    # —— 验证信息（validator，由另一个 Agent 填写）——
    validator_aid: ""                        # 验证者 AID，≠ author_aid（防自证硬约束）
    sig_hash: ""                             # = sha256(canonicalize(claim)) base64
    verified_ts: ""                          # ISO 8601，validator 验证时间
    verified: pending                        # pending → confirmed 走晋升
    # —— D3 风险分级 ——
    risk: normal                             # normal(30天观察) | high(90天观察)
    scope: shared                            # shared | private(私域豁免，可免验证)
---

# <技能名>

> 一句话定位：这个技能解决什么问题、给谁用。

## 用途

- 功能点 1
- 功能点 2

## 用法

```bash
# 示例命令
```

## 注意事项

- 边界 1
- 边界 2

---

## ⚙️ 验证流程（P0-3 D2 —— 由独立 validator 执行，author 本人不得自签）

本技能的 `verified` 状态由 **author 之外的 Agent** 验证后填写：

1. **author 建技能**：填 `author_aid`（你的 AID agent_id），`verified: pending`，`scope: shared`
2. **validator（另一只 Agent）亲证**：跑 `csb-security signVerification()` 生成 `sig_hash`，回填 `validator_aid` / `sig_hash` / `verified_ts` → `verified: confirmed`
3. **第三方复核**：`verifyVerificationRecord(claim, signature, validatorAid)` + `sigHash(claim)` 比对

### claim 结构（与 D1 一致，签名的对象）

```json
{
  "csb_version": "1.0",
  "type": "verification",
  "subject_id": "<技能ID>",
  "producer_id": "<author_aid>",
  "validator_id": "<validator_aid>",
  "verdict": "passed",
  "ts": "<ISO8601>"
}
```

### 硬约束

- ⛔ `validator_aid ≠ author_aid`（P0-3 防自证，代码层拒绝 `self_verification`）
- 🔑 `sig_hash` 权威源 = `csb-security lib/verify/verify-signature.js` 的 `sigHash()`（D1 已落地，219/219 测试全绿）
- 🏠 `scope: private` 的技能可豁免（显式标注「私域」即可，不注册/不共享/不跨 agent 调用）

### 快速校验

```bash
# 校验当前 SKILL.md 的 frontmatter（PASS/FAIL，含防自证与字段完整性）
node scripts/validate-skill-meta.js skills/SKILL.template.md
```

---

## 待补充清单

- [ ] 填技能内容
- [ ] 由独立 validator 完成验证并填 `metadata.csb` 字段
- [ ] 若共享/上传，标注 verified 状态并关联 verif-log

## 贡献者

- author：<你的名字>（`author_aid` 必填）
- validator：<验证者名字>（待签，≠ author）