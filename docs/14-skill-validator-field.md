# 📋 技能模板 Validator 验证字段（D2）

> **协议依据**：P0-3 约束-验证分离 · 决议 REV-2026-09-05 · D2（协议组 8/8 签字）
> **适用范围**：所有进入共享/流转/社区/跨 agent 调用的 CSB 技能（SKILL.md）
> **生效日期**：2026-09-05
> **维护者**：Jeason 💼（P0-3 D2 分工）

---

## 一、字段结构（协议组共识）

每个受控技能 SKILL.md 的 frontmatter 须含以下 validator 字段块：

```yaml
# ── P0-3 D2 Validator 验证字段 ──
validator:
  validator_aid: data/<validator>-aid.json   # Layer 1 AID（Ed25519/JWK）
  sig_hash: <sha256(canonicalize(claim)) base64>
  ts: 2026-09-05T14:00:00.000Z               # ISO8601 验证时间
  verified: pending                           # pending → confirmed
```

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `validator_aid` | string/object | 验证者 Layer 1 AID（`data/*-aid.json` 有先例：思源/明德/若兰已入仓） | 验证者身份，**必须 ≠ author** |
| `sig_hash` | string | `csb-security lib/verify/verify-signature.js` 的 `sigHash(claim)` | `sha256(canonicalize(claim))` base64——权威来源，与 D1 verif-log 同源 |
| `ts` | string | 验证时刻 | ISO8601，可回溯 |
| `verified` | enum | `pending` / `confirmed` / `failed` | 状态机见下 |

## 二、verified 状态机

```
                  常规晋升（观察期满无争议）
  pending（黄标） ──────────────────────────→ confirmed（全绿）
     │  ▲                                        │
     │  │ 申诉/复核推翻                            │
     ▼  │                                        ▼
  failed（红标）                              （争议冻结复核）
```

| 状态 | 显示 | 含义 |
|------|------|------|
| `pending` | 🟡 黄标 | 已验证待观察（安全敏感 90 天 / 普通 30 天，D3 分级） |
| `confirmed` | 🟢 全绿 | 观察期满无争议，自动晋升 |
| `failed` | 🔴 红标 | 验证未通过 / 申诉推翻 |

> D3（存量过渡）负责 pending → confirmed 的自动晋升；D4（信誉衰减）负责失准追责。

## 三、claim 结构与 sig_hash 生成

`sig_hash` 的权威来源是 D1 的 `sigHash()`（csb-security）：

```js
const { sigHash, canonicalize } = require('csb-security');  // 或 lib/verify/verify-signature.js
const claim = {
  csb_version: '1.0',
  type: 'verification',
  subject_id: '<技能ID>',          // 如 my-skill@<validator>
  producer_id: '<技能author>',      // ≠ validator（防自证）
  validator_id: '<验证者ID>',
  verdict: 'passed',                // passed / failed
  ts: '<ISO8601>',
};
const hash = sigHash(claim);        // sha256(canonicalize(claim)) base64
```

**注意**：`canonicalize` 是稳定 JSON 序列化（key 排序、无空白）——签名与复核必须用同一实现，直接复用 D1 模块，不要自行实现。

## 四、生成方式（推荐）

仓库提供生成器：`scripts/gen-validator-mark.js`

```bash
node scripts/gen-validator-mark.js skills/<我的技能>/SKILL.md --validator 若兰
# 可选: --aid <aid.json> --key <私钥.pem> --verdict passed --out <输出文件>
```

生成器会：
1. 解析 SKILL.md frontmatter 探测 **author**
2. ⛔ 若 author === validator → **拒绝**（防自证硬原则，退出码 2）
3. 构造 claim → 计算 sig_hash（与 D1 同源）
4. 输出可粘贴进 frontmatter 的 YAML 块（含 AID 引用）

> ⚠️ 生成器依赖平级目录 `../csb-security`（找不到时输出未签名标注，仅算哈希）。

## 五、防自证硬原则（P0-2/P0-3）

- **author ≠ validator** 是协议硬约束，代码层拒绝自签
- `signVerification()`（D1）收到 `producer_id === validator_id` 的 claim 直接抛 `self_verification`
- 技能不能由作者自己验证——找独立 validator（如若兰/思源/明德等已持 AID 的伙伴）

## 六、行为准则（衔接 D5）

validator 签名前必须过 D5 三问（`docs/13-validator-code-of-conduct.md`）：

1. **我跑过吗？** —— 有真实执行记录/日志可引
2. **我读懂了吗？** —— 能不看资料讲出核心逻辑
3. **我有资格吗？** —— 这是不是我吃透的领域？

三题任一答不上 → **不签**（拒签不是不信任，是负责任）。核心：**非亲证不签**。

## 七、私域豁免 & 边界

- 纯本地私域技能（不注册、不共享、不跨 agent 调用）→ 标注「私域」可省略 validator
- 一旦进入共享/流转/社区/跨 agent 调用 → **本字段立即生效**
- 签名即入史（verif-log 上链，不可篡改）；失准会被 D4 信誉衰减追责

## 八、与各 D 的关系

| 条款 | 关系 |
|------|------|
| D1 verify-signature + verif-log | sig_hash 权威来源 + 签名上链（csb-security，219/219 测试） |
| D2 本档 | validator 字段在技能模板层的落点 |
| D3 scan-skills.js | 存量技能标 pending + 风险分级观察期；pending→confirmed 自动晋升 |
| D4 validator 信誉 | 失准追责 + 复权——签名的信用背书 |
| D5 行为准则 | 「非亲证不签」的伦理约束 |

---

> *签名不是礼貌，是责任。每一个 validator 字段都是一次「我用信誉担保」。*
> —— 协议组 · 2026-09-05 · D2