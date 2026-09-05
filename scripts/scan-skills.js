#!/usr/bin/env node
/**
 * scan-skills.js — P0-3 D3 存量技能扫描器（自动化灰度扫描）
 *
 * 协议: P0-3 REV-2026-09-05 D3
 *   —— 存量技能标 verified: pending + 风险分级观察期
 *      安全敏感类 90 天 / 普通类 30 天（30-45 弹性）
 *      期满无争议自动升 confirmed，有申诉冻结复核
 *
 * 用法:
 *   node scan-skills.js <目录或SKILL.md...> [--json] [--mark]
 *   --json  输出机器可读 JSON（含建议标注）
 *   --mark  输出可直接插入 SKILL.md frontmatter 的标注块（不自动改文件）
 *
 * 风险分级依据: AGENTS.md Skill Vetter 危险信号清单
 *   HIGH（安全敏感 90 天）: 凭证/密钥操作、数据外发、破坏性命令、
 *                           eval/exec、访问隐私文件（MEMORY/USER/SOUL）、混淆
 *   NORMAL（普通 30 天）:  其余（内容/查询/整理类）
 *
 * 维护者: 若兰 🌸（P0-3 D3 分工）
 * 日期: 2026-09-05
 */

const fs = require('fs');
const path = require('path');

// ---------- 风险关键词（对齐 Skill Vetter 危险信号） ----------
const HIGH_PATTERNS = [
  // 凭证/密钥
  /(api[_-]?key|token|password|secret|credential|private[_-]?key|access[_-]?key)/i,
  /(密钥|凭证|令牌|私钥|密码)/,
  // 数据外发
  /(webhook|upload|发送到|推送.*(外部|远程)|curl.*-X\s*POST)/i,
  // 破坏性命令
  /(rm\s+-rf|DROP\s+TABLE|del\s+\/|格式化|删除.*文件|覆盖.*系统)/i,
  // 任意代码执行
  /(\beval\s*\(|\bexec\s*\(|child_process|shell\s*注入)/,
  // 隐私文件访问
  /(MEMORY\.md|USER\.md|SOUL\.md)/,
  // 混淆
  /(混淆|obfuscat)/i
];

const PRIVATE_MARKERS = ['私域', 'private', '个人自用', '仅本地'];

function scanSkillFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // 解析 frontmatter（--- 之间）
  let name = path.basename(path.dirname(filePath));
  let description = '';
  if (lines[0] && lines[0].trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      const fm = lines.slice(1, end).join('\n');
      const n = fm.match(/^name:\s*(.+)$/m);
      const d = fm.match(/^description:\s*(.+)$/m);
      if (n) name = n[1].trim();
      if (d) description = d[1].trim().slice(0, 120);
    }
  }

  // 私域豁免检测（显式标注「私域」）
  const isPrivate = PRIVATE_MARKERS.some((m) => content.includes(m));

  // 风险分级
  const hits = [];
  for (const pat of HIGH_PATTERNS) {
    const m = content.match(pat);
    if (m) hits.push(pat.source.slice(0, 60));
  }
  const risk = hits.length > 0 ? 'high' : 'normal';
  const observeDays = risk === 'high' ? 90 : 30;
  const verified = isPrivate ? 'exempt(私域)' : 'pending';

  return {
    name,
    path: filePath,
    description,
    risk,
    observeDays,
    verified,
    private: isPrivate,
    hits: hits.slice(0, 5)
  };
}

function collectSkillFiles(targets) {
  const files = [];
  for (const t of targets) {
    const abs = path.resolve(t);
    if (!fs.existsSync(abs)) {
      console.error(`[scan-skills] 路径不存在: ${t}`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (abs.endsWith('SKILL.md')) files.push(abs);
      else console.error(`[scan-skills] 跳过非 SKILL.md 文件: ${t}`);
    } else {
      // 递归找 SKILL.md
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === '.git' || entry.name === 'node_modules') continue;
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (entry.name === 'SKILL.md') files.push(p);
        }
      };
      walk(abs);
    }
  }
  return files;
}

// ---------- main ----------
const args = process.argv.slice(2);
const jsonFlag = args.includes('--json');
const markFlag = args.includes('--mark');
const targets = args.filter((a) => !a.startsWith('--'));

if (targets.length === 0) {
  console.error('用法: node scan-skills.js <目录或SKILL.md...> [--json] [--mark]');
  process.exit(1);
}

const files = collectSkillFiles(targets);
const results = files.map(scanSkillFile);
results.sort((a, b) => (a.risk === b.risk ? 0 : a.risk === 'high' ? -1 : 1));

if (jsonFlag) {
  console.log(JSON.stringify({ scanned: results.length, skills: results }, null, 2));
  process.exit(0);
}

console.log('=== P0-3 D3 存量技能扫描 ===\n');
console.log(`扫描文件: ${results.length}\n`);
console.log('技能名'.padEnd(24) + '风险'.padEnd(8) + '观察期'.padEnd(8) + 'verified'.padEnd(18) + '路径');
console.log('─'.repeat(110));
for (const r of results) {
  const riskMark = r.risk === 'high' ? '🔴high' : '🟢normal';
  console.log(
    r.name.slice(0, 22).padEnd(24) +
      riskMark.padEnd(8) +
      String(r.observeDays + '天').padEnd(8) +
      r.verified.padEnd(18) +
      r.path.replace(process.cwd() + '/', '')
  );
  if (r.risk === 'high') {
    console.log('    ⚠️  触发: ' + r.hits.join(' | '));
  }
}

const highCount = results.filter((r) => r.risk === 'high').length;
const privateCount = results.filter((r) => r.private).length;
console.log('\n--- 汇总 ---');
console.log(`🔴 安全敏感(90天观察): ${highCount}`);
console.log(`🟢 普通(30天观察): ${results.length - highCount - privateCount}`);
console.log(`🏠 私域豁免: ${privateCount}`);

if (markFlag) {
  console.log('\n--- 建议标注（插入各 SKILL.md frontmatter） ---');
  for (const r of results) {
    if (r.private) continue; // 私域豁免无需标 pending（可标私域）
    console.log(`\n# ${r.name}  (${r.path.replace(process.cwd() + '/', '')})`);
    console.log(`verified: ${r.verified}`);
    console.log(`risk: ${r.risk}   # 观察期 ${r.observeDays} 天，期满无争议自动升 confirmed`);
  }
}
