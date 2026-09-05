---
name: csb-skill-example
description: CSB 社区共享技能示例（已由独立 validator 验证，演示 D2 字段完整用法）
metadata:
  csb:
    author_aid: Jeason@172.28.0.6:3300
    validator_aid: ruolan@172.28.0.214:3100
    sig_hash: cDZTiL6GANKca3AkuuzTmTSXznvUO+6KSMLMUxJpmdU=
    verified_ts: 2026-09-05T14:15:00.000Z
    verified: confirmed
    risk: normal
    scope: shared
---

# csb-skill-example

> 示例技能：演示 D2 validator 字段的合规 `confirmed` 状态（author ≠ validator，真实签名）。

## 用途

- 作为 SKILL.template.md 的完整示例
- 供 validate-skill-meta.js 做合规样例（验收标准第 2 项 PASS）

## 验证记录（D1 真实签名）

- producer（author）: `Jeason@172.28.0.6:3300`
- validator: `ruolan@172.28.0.214:3100`（独立验证者，≠ author ✅）
- sig_hash: `sha256(canonicalize(claim))` base64 —— 与 csb-security `sigHash()` 一致
- 签名: Ed25519，可经 `verifyVerificationRecord(claim, signature, validatorAid)` 复核

## 注意事项

- 此示例的 validator 密钥对是演示用（ruolan-validator-demo），实际验证请使用验证者真实私钥
- 验证流程与 claim 结构见 `skills/SKILL.template.md` 与 `docs/14-skill-validator-field.md`