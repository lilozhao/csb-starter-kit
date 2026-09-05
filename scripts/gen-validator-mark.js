#!/usr/bin/env node
/**
 * gen-validator-mark.js — P0-3 D2 技能模板 validator 字段生成器
 *
 * 协议: P0-3 REV-2026-09-05 D2（8/8 签字）
 *   —— 为 SKILL.md 生成 validator 验证字段 { validator_aid, sig_hash, ts, verified }
 *      sig_hash 权威来源 = csb-security lib/verify/verify-signature.js sigHash()
 *      validator 必须独立于 author（防自证硬原则，代码层拒绝自签）
 *
 * 用法:
 *   node scripts/gen-validator-mark.js <SKILL.md路径> \
 *     --validator <validator名字> \
 *     [--aid <validator aid json 路径，默认 csb-security/data/<名字>-aid.json>] \
 *     [--key <validator 私钥 pem 路径，默认 csb-security/data/<名字>-private-key.pem>] \
 *     [--verdict passed|failed] \
 *     [--out <输出文件，默认 stdout>]
 *
 * 输出: 可插入 SKILL.md frontmatter 的 validator 字段块（YAML）
 *
 * 依赖: csb-security 仓库（../csb-security 平级；找不到时跳过签名只算 hash）
 *
 * 维护者: Jeason（P0-3 D2 分工）
 * 日期: 2026-09-05
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
const flagVal = (flag, def = null) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const skillFile = args.find((a) => !a.startsWith('--') && (a.endsWith('SKILL.md') || a.endsWith('.md')));
const validatorName = flagVal('--validator');
const aidPath = flagVal('--aid');
const keyPath = flagVal('--key');
const verdict = flagVal('--verdict', 'passed');
const outFile = flagVal('--out');

if (!skillFile || !validatorName) {
  console.error('用法: node scripts/gen-validator-mark.js <SKILL.md路径> --validator <名字> [--aid <json>] [--key <pem>] [--verdict passed|failed] [--out <file>]');
  process.exit(1);
}

const CSB_SEC = path.join(__dirname, '..', '..', 'csb-security');

// ---------- 稳定 JSON 序列化（与 D1 canonicalize 一致：key 排序、无空白）----------
function canonicalize(value) {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k]));
  return '{' + parts.join(',') + '}';
}

// ---------- 解析 SKILL.md frontmatter 拿 author 与技能名 ----------
function parseSkillMeta(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const meta = { name: path.basename(path.dirname(filePath)), author: '', content };

  if (lines[0] && lines[0].trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      const fm = lines.slice(1, end).join('\n');
      const n = fm.match(/^name:\s*(.+)$/m);
      if (n) meta.name = n[1].trim();
    }
  }

  // author 探测：贡献者区块 / 结尾署名（宽松匹配）
  const c = content.match(/author\s*[:：]\s*([^\n]+)/i);
  const g = content.match(/贡献者[^\n]*[:：]\s*([^\n]+)/i);
  if (c) meta.author = c[1].trim().replace(/\*\*|#|\s*$/g, '');
  else if (g) meta.author = g[1].trim();

  return meta;
}

// ---------- sig_hash（权威来源：D1 sigHash = sha256(canonicalize) base64）----------
function sigHash(claim) {
  return crypto.createHash('sha256').update(canonicalize(claim), 'utf8').digest('base64');
}

// ---------- 尝试从 csb-security 加载 validator AID（Layer 1 AID）----------
function loadValidatorAid(name, explicitPath) {
  const candidates = explicitPath
    ? [explicitPath]
    : [
        path.join(CSB_SEC, 'data', `${name}-aid.json`),
        path.join(process.cwd(), 'data', `${name}-aid.json`),
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return { aid: JSON.parse(fs.readFileSync(p, 'utf8')), path: p };
      } catch (e) {
        console.warn(`⚠️  AID 解析失败（跳过）: ${p} — ${e.message}`);
      }
    }
  }
  return null;
}

// ---------- Ed25519 签名（若提供私钥）----------
function trySign(claim, keyPath) {
  if (keyPath && fs.existsSync(keyPath)) {
    try {
      const pem = fs.readFileSync(keyPath, 'utf8');
      const key = crypto.createPrivateKey(pem);
      const sig = crypto.sign(null, Buffer.from(canonicalize(claim), 'utf8'), key);
      return sig.toString('base64');
    } catch (e) {
      console.warn(`⚠️  签名失败（仅输出未签名标注）: ${e.message}`);
    }
  }
  return null;
}

// ---------- main ----------
const meta = parseSkillMeta(skillFile);
const subjectId = `${meta.name}@${validatorName}`;

// claim 结构与 D1 一致（REQUIRED_FIELDS 全含：csb_version/type/subject_id/producer_id/validator_id/ts）
const ts = new Date().toISOString();
const claim = {
  csb_version: '1.0',
  type: 'verification',
  subject_id: subjectId,
  producer_id: meta.author || 'unknown',   // 技能作者
  validator_id: validatorName,             // 验证者（≠ producer）
  verdict,
  ts,
};

// ⛔ 防自证硬原则（P0-2/P0-3）：validator ≠ author
const authorNorm = String(meta.author || '').replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '');
const validatorNorm = validatorName.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '');
if (authorNorm && authorNorm === validatorNorm) {
  console.error(`❌ self_verification: validator(${validatorName}) 与 author(${meta.author}) 相同 — 防自证硬原则拒绝`);
  console.error('   技能不能由作者自己验证，请指定独立 validator。');
  process.exit(2);
}

const sh = sigHash(claim);
const signature = trySign(claim, keyPath);
const aid = loadValidatorAid(validatorName, aidPath);

console.error(`✅ 技能: ${meta.name}（author: ${meta.author || '未探测到'}` +
  `，已写入 .gitignore 或贡献者区）`);
console.error(`✅ claim: ${JSON.stringify(claim)}`);
console.error(`✅ sig_hash: ${sh}` + (signature ? '（已签名）' : '（未签名，仅哈希）'));

// ---------- YAML 输出 ----------
let yaml = '  validator:\n';
if (aid) {
  // 引用/嵌入 Layer 1 AID
  yaml += '    validator_aid: data/' + path.basename(aid.path) + '\n';
  yaml += '    validator_public_key:\n';
  yaml += `      crv: ${aid.aid.public_key?.crv || 'Ed25519'}\n`;
  yaml += `      x: ${aid.aid.public_key?.x || ''}\n`;
  yaml += `      kty: ${aid.aid.public_key?.kty || 'OKP'}\n`;
  yaml += `      kid: ${aid.aid.public_key?.kid || validatorName + '-aid'}\n`;
} else {
  yaml += '    validator_aid: data/' + validatorName + '-aid.json  # ⚠️ 请替换为真实 AID 文件路径\n';
}
yaml += `    sig_hash: ${sh}\n`;
yaml += `    ts: ${ts}\n`;
yaml += `    verified: ${verdict === 'passed' ? 'pending' : 'failed'}\n`;
if (signature) {
  yaml += `    signature: ${signature}\n`;
}

const block = '  # ── P0-3 D2 Validator 验证字段（生成于 ' + ts + '）──\n' + yaml;

if (outFile) {
  fs.writeFileSync(outFile, block);
  console.error(`📄 已写入: ${outFile}`);
  console.log(block);
} else {
  console.log('\n--- 复制以下内容插入 SKILL.md frontmatter ---\n');
  console.log(block);
}