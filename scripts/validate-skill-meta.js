#!/usr/bin/env node
/**
 * validate-skill-meta.js — P0-3 D2 技能模板元数据校验器
 *
 * 协议: P0-3 REV-2026-09-05 D2（8/8 签字）
 * 职责: 读 SKILL.md frontmatter，校验 `metadata.csb` 字段：
 *   - author_aid 非空（必填）
 *   - verified=confirmed 时：validator_aid ≠ author_aid（防自证）+ sig_hash/verified_ts 非空
 *   - sig_hash 格式校验（sha256 base64，44 chars）
 * 输出: PASS / FAIL（退出码 0/1）
 *
 * 用法:
 *   node scripts/validate-skill-meta.js <SKILL.md 路径...>
 *
 * 依赖: 无（纯解析；sig_hash 比对可另用 csb-security verifyVerificationRecord）
 *
 * 维护者: Jeason（P0-3 D2 分工）
 * 日期: 2026-09-05
 */

const fs = require('fs');
const path = require('path');

// ---------- frontmatter 解析（支持嵌套 metadata.csb）----------
function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (!lines[0] || lines[0].trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return null;
  const fm = lines.slice(1, end).join('\n');
  return { fm, raw: content };
}

// 简易 YAML 扁平解析：只取我们关心的键（支持缩进嵌套，value 取冒号后 trim）
function extractKey(fm, keyPath) {
  // keyPath 如 'metadata.csb.author_aid'，返回值或 null
  const lines = fm.split('\n');
  const reg = new RegExp(`^\\s*${keyPath.split('.').pop()}\\s*:\\s*(.*)$`);
  // 简化：不验证层级。逐行匹配最后一个 key 名
  for (const line of lines) {
    const m = line.match(new RegExp(`^\\s*${keyPath.split('.').pop()}\\s*:\\s*(.*)$`));
    if (m) {
      const v = m[1].trim().replace(/\s*#.*$/, '').trim();
      if (v === '""' || v === "''" || v === '') return null;
      return v.replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

// ---------- 校验 ----------
function validate(filePath) {
  const issues = [];
  const notes = [];

  const content = fs.readFileSync(filePath, 'utf8');
  const fmObj = parseFrontmatter(content);
  if (!fmObj) {
    return { pass: false, issues: ['frontmatter 缺失（首行须为 ---）'], notes: [] };
  }
  const fm = fmObj.fm;

  const authorAid = extractKey(fm, 'metadata.csb.author_aid');
  const validatorAid = extractKey(fm, 'metadata.csb.validator_aid');
  const sigHash = extractKey(fm, 'metadata.csb.sig_hash');
  const verifiedTs = extractKey(fm, 'metadata.csb.verified_ts');
  const verified = extractKey(fm, 'metadata.csb.verified') || 'pending';
  const scope = extractKey(fm, 'metadata.csb.scope') || 'shared';
  const risk = extractKey(fm, 'metadata.csb.risk') || 'normal';

  // 0. 私域豁免：scope=private 显式标注即可通过（可免验证）
  if (scope === 'private') {
    return { pass: true, issues: [], notes: ['🏠 scope=private — 私域豁免，无需验证'] };
  }

  // 1. author_aid 必填
  if (!authorAid) {
    issues.push('author_aid 缺失（必填：your-agent-id@host:port）');
  }

  // 2. verified=confirmed 时检查完整性与防自证
  if (verified === 'confirmed') {
    if (!validatorAid) {
      issues.push('verified=confirmed 但 validator_aid 为空');
    }
    if (!sigHash) {
      issues.push('verified=confirmed 但 sig_hash 为空');
    }
    if (!verifiedTs) {
      issues.push('verified=confirmed 但 verified_ts 为空');
    }
    if (authorAid && validatorAid && authorAid === validatorAid) {
      issues.push(`⛔ 防自证拒绝: author_aid(${authorAid}) === validator_aid(${validatorAid})`);
    }
    // sig_hash 格式（sha256 base64 = 44 chars）
    if (sigHash && !/^[A-Za-z0-9+/]{43}=$/.test(sigHash) && sigHash.length !== 44) {
      issues.push(`sig_hash 格式异常: ${sigHash.slice(0, 20)}...（应为 sha256 base64，44 字符）`);
    }
    // verified_ts 格式（ISO8601）
    if (verifiedTs && isNaN(Date.parse(verifiedTs))) {
      issues.push(`verified_ts 非 ISO8601: ${verifiedTs}`);
    }
    notes.push(`✅ 状态: confirmed（${validatorAid || '?'} 于 ${verifiedTs || '?'} 验证）`);
  } else if (verified === 'pending') {
    notes.push(`🟡 状态: pending（观察期: ${risk === 'high' ? 90 : 30} 天，D3 自动晋升）`);
    // pending 阶段 validator 字段应为空或未填
    if (validatorAid || sigHash) {
      notes.push('ℹ️ pending 已填部分 validator 字段（等 confirmed 时完整性检查）');
    }
  } else {
    issues.push(`verified 取值异常: ${verified}（应为 pending | confirmed）`);
  }

  // 3. risk 合法性
  if (risk !== 'normal' && risk !== 'high') {
    issues.push(`risk 取值异常: ${risk}（应为 normal | high）`);
  }

  // 4. scope 合法性
  if (scope !== 'shared' && scope !== 'private') {
    issues.push(`scope 取值异常: ${scope}（应为 shared | private）`);
  }

  return { pass: issues.length === 0, issues, notes };
}

// ---------- main ----------
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: node scripts/validate-skill-meta.js <SKILL.md 路径...>');
  process.exit(2);
}

let allPass = true;
for (const target of args) {
  const abs = path.resolve(target);
  console.log(`\n=== 校验: ${target.replace(process.cwd() + '/', '')} ===`);

  if (!fs.existsSync(abs)) {
    console.log('❌ FAIL: 文件不存在');
    allPass = false;
    continue;
  }

  const result = validate(abs);
  if (result.pass) {
    console.log('✅ PASS');
    result.notes.forEach((n) => console.log('  ' + n));
    if (result.issues.length && result.issues[0].includes('私域')) {
      result.issues.forEach((i) => console.log('  ' + i));
    }
  } else {
    console.log('❌ FAIL');
    result.issues.forEach((i) => console.log('  ' + i));
    result.notes.forEach((n) => console.log('  ' + n));
    allPass = false;
  }
}

process.exit(allPass ? 0 : 1);