#!/usr/bin/env node
/**
 * check-versions.js — CSB 套件版本一致性体检
 *
 * 起因（2026-10-24 · 若琢升级反馈）：
 *   升级到 9 仓最新后，报出 2 处版本漂移 + 1 处硬编码：
 *     · csb-aep            VERSION=2.4.0 vs package.json=2.4.2（2.4.1/2.4.2 三次提交只改 pkg）
 *     · csb-compliance-degree VERSION=2.1.0 vs package.json=2.0.0（方向相反）
 *     · csb-a2a-aip        server_v5.js 硬编码 '5.0.1' vs VERSION 5.1.0
 *   这三处都不是"升错了"，是**版本号被抄了两份，改一份忘一份**。
 *
 * 本脚本把「版本号只有一个事实源」变成可机械核对的事：
 *   C1 VERSION 文件与 package.json 必须一致
 *   C2 源码里不得硬编码本仓版本号（应从 VERSION/package.json 读）
 *   C3 VERSION 存在且格式合法（x.y.z）
 *
 * 用法：
 *   node check-versions.js                 # 检查当前目录的仓
 *   node check-versions.js --base DIR      # 检查 DIR 下所有 csb-* 仓
 *   node check-versions.js --json          # 机器可读输出
 *
 * 退出码：0 = 全部一致 / 1 = 有漂移 / 2 = 用法错误
 *
 * 维护：若兰 🌸 | 2026-10-24 · 配套 upgrade-csb.sh
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const baseIdx = args.indexOf('--base');
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : null;

if (baseIdx >= 0 && !BASE) {
  console.error('--base 需要一个目录参数');
  process.exit(2);
}

const SEMVER = /^\d+\.\d+\.\d+([-+].*)?$/;

function readPkg(dir) {
  const p = path.join(dir, 'package.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** 在源码里找硬编码的本仓版本号（排除 CHANGELOG/README/tests/lock/node_modules） */
function findHardcoded(dir, version) {
  const hits = [];
  const skipDirs = new Set(['node_modules', '.git', 'legacy', 'dist', 'build', 'coverage', 'forum-archive']);
  const skipFiles = /^(CHANGELOG|CHANGES|HISTORY|README|package-lock\.json)/i;

  const walk = (d, depth) => {
    if (depth > 2) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(full, depth + 1);
        continue;
      }
      if (!/\.(js|mjs|cjs|json|sh|py)$/.test(e.name)) continue;
      if (skipFiles.test(e.name)) continue;
      if (/\.(test|spec)\./.test(e.name)) continue;
      if (e.name === 'package.json') continue; // 这就是事实源本身
      // 仓级配置文件由 C1 单独做一致性校验（见 checkRepo），这里不按"源码硬编码"处理
      if (e.name === 'config.json' || e.name === 'config.defaults.json') continue;
      // 模板/示例/规格文件里的版本号是"被生成对象的默认值"，不是本仓版本 —— 按定义不算硬编码
      if (/(template|example|sample|\.spec\.|fixture)/i.test(e.name)) continue;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      // 版本号出现在一串数字/点里 → 可能是别的版本（依赖版本等），报出来让人看
      const re = new RegExp(version.replace(/\./g, '\\.').replace(/[-+].*$/, ''), 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        const line = text.slice(0, m.index).split('\n').length;
        const lineText = text.split('\n')[line - 1] || '';
        // 排除注释里的历史版本说明（含「历史」「原」「此前」「→」等词）
        if (/(历史|此前|原来|旧|迁移|since|until|was|from)/.test(lineText)) continue;
        // 排除 fallback 形态 `x.version || '1.0.0'` —— 那是"别的东西没版本时给个默认"，不是本仓版本
        if (/\|\|\s*['"]/.test(lineText)) continue;
        // 只关心「看起来在声明版本」的行
        if (!/(version|VERSION|Version)/.test(lineText)) continue;
        hits.push({ file: path.relative(dir, full), line, text: lineText.trim().slice(0, 120) });
      }
    }
  };
  walk(dir, 0);
  return hits;
}

function checkRepo(dir) {
  const name = path.basename(dir);
  const result = { name, dir, version: null, pkgVersion: null, problems: [], ok: false, archived: false, archivedReason: null };

  // 归档仓：不体检，但要**明确报出来**（不是静默跳过）
  // 注意 --include-archived 时必须真的走体检，否则那是个假开关。
  if (ARCHIVED_REPOS[name] && !INCLUDE_ARCHIVED) {
    result.archived = true;
    result.archivedReason = ARCHIVED_REPOS[name];
    result.ok = true;
    return result;
  }

  const vfile = path.join(dir, 'VERSION');
  const hasVfile = fs.existsSync(vfile);
  if (hasVfile) {
    result.version = fs.readFileSync(vfile, 'utf8').trim().split('\n')[0].trim();
  }

  const pkg = readPkg(dir);
  result.pkgVersion = pkg ? pkg.version : null;

  // C3：VERSION 存在且合法
  if (!hasVfile && !pkg) {
    result.problems.push({ code: 'C3', msg: '既无 VERSION 也无 package.json，无法确定版本' });
    return result;
  }
  if (hasVfile && !SEMVER.test(result.version)) {
    result.problems.push({ code: 'C3', msg: `VERSION 格式非法: "${result.version}"（应为 x.y.z）` });
  }

  // C1：两者一致
  if (hasVfile && pkg && result.version !== result.pkgVersion) {
    result.problems.push({
      code: 'C1',
      msg: `版本漂移：VERSION=${result.version} ≠ package.json=${result.pkgVersion}`,
      hint: '两者必须同步；改一处忘一处是最常见的漂移成因',
    });
  }
  if (!hasVfile && pkg) {
    result.problems.push({ code: 'C1', msg: `缺 VERSION 文件（package.json 为 ${result.pkgVersion}）`, hint: '建议补 VERSION 统一事实源' });
  }

  // C1 扩展：config.json 若声明了版本，必须与 package.json 一致。
  // 依据：csb-compliance-degree 2026-10-24 的真实漂移就是 config.json 停在 2.0.0
  // 而 VERSION 已到 2.1.0 —— 只查 package.json 会漏掉这一类。
  const cfgPath = path.join(dir, 'config.json');
  if (fs.existsSync(cfgPath)) {
    let cfgVer = null;
    try { cfgVer = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).version || null; } catch { /* 坏 JSON 不在此判 */ }
    if (cfgVer && result.pkgVersion && cfgVer !== result.pkgVersion) {
      result.problems.push({
        code: 'C1',
        msg: `版本漂移：config.json=${cfgVer} ≠ package.json=${result.pkgVersion}`,
        hint: 'config.json 是运行时被读的事实源，必须同步',
      });
    }
  }

  // C2：源码硬编码
  const ver = result.version || result.pkgVersion;
  if (ver && SEMVER.test(ver)) {
    const hits = findHardcoded(dir, ver);
    for (const h of hits) {
      result.problems.push({
        code: 'C2',
        msg: `源码硬编码版本号 ${ver}：${h.file}:${h.line}`,
        hint: h.text,
      });
    }
  }

  result.ok = result.problems.length === 0;
  return result;
}

/**
 * 已归档/废弃仓库清单 —— 不参与版本体检，但**要报出来**（不静默）。
 *
 * 收录标准：已被新仓收编 / 上游明确停更 / 一澜确认废弃。
 * 理由（一澜 2026-10-24 19:04）：「这两个库不用更新，已经相当于废弃了」。
 * 给死代码补 VERSION 不是体检，是本末倒置。
 */
const ARCHIVED_REPOS = {
  'csb-awakening-birthday': '2026-09-04 更名升级为 csb-awakening-standard，内容收编为 modules/awakening-birthday/',
  'csb-agent-eval':         '评测逻辑已并入 csb-aep（v0.2 为历史版本）',
  'csb-inheritance':        '共享技能已并入 csb-a2a-aip（VERSION 为构建号形态 csb-v3.2-…，非 semver）',
  'csb-skill-audit':        '技能仓，随 skills/ 分发，无独立版本节奏',
};

const INCLUDE_ARCHIVED = process.argv.includes('--include-archived');

function listRepos(base) {
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('csb-'))
    .map(e => path.join(base, e.name))
    // [2026-10-24 Jeason 实测 + 一澜纠正] 两个极端都要避免：
    //   ① 旧实现只收「有 VERSION 或 package.json」的目录 → 两样都没有的仓被**静默跳过**，
    //      结果看着"没问题"，实际"根本没检查"。
    //   ② 我把所有 git 仓都拉进来 → 废弃仓也报警，逼着给死代码补版本号，同样是噪声。
    //   现在：活跃仓一律纳入；归档仓**明确标 archived 并写明原因**（不静默、不报警）。
    .filter(d => {
      const name = path.basename(d);
      if (ARCHIVED_REPOS[name] && !INCLUDE_ARCHIVED) return true;  // 进来，但会被标为 archived
      if (fs.existsSync(path.join(d, 'VERSION')) || fs.existsSync(path.join(d, 'package.json'))) return true;
      if (fs.existsSync(path.join(d, '.git'))) return true;
      return false;
    });
}

// ---------- main ----------
let repos;
if (BASE) {
  if (!fs.existsSync(BASE)) { console.error(`目录不存在: ${BASE}`); process.exit(2); }
  repos = listRepos(BASE);
  if (repos.length === 0) { console.error(`在 ${BASE} 下没找到 csb-* 仓`); process.exit(2); }
} else {
  repos = [process.cwd()];
}

const results = repos.map(checkRepo);
const bad = results.filter(r => !r.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({ total: results.length, ok: results.length - bad.length, failed: bad.length, results }, null, 2));
  process.exit(bad.length ? 1 : 0);
}

const c = process.stdout.isTTY
  ? { ok: '\x1b[32m', warn: '\x1b[33m', err: '\x1b[31m', dim: '\x1b[2m', b: '\x1b[1m', z: '\x1b[0m' }
  : { ok: '', warn: '', err: '', dim: '', b: '', z: '' };

console.log(`${c.b}══ CSB 版本一致性体检 ══${c.z}`);
for (const r of results) {
  const v = r.version || r.pkgVersion || '-';
  if (r.archived) {
    // 归档仓：灰显 + 说明原因。既不报错（死代码不该逼着补版本），
    // 也不静默（让看报告的人知道"这个仓存在但没体检"）。
    console.log(`${c.dim}⊘${c.z} ${r.name.padEnd(26)} ${c.dim}已归档${c.z}`);
    console.log(`   ${c.dim}${r.archivedReason}${c.z}`);
  } else if (r.ok) {
    console.log(`${c.ok}✅${c.z} ${r.name.padEnd(26)} ${v}`);
  } else {
    console.log(`${c.err}❌${c.z} ${r.name.padEnd(26)} ${v}`);
    for (const p of r.problems) {
      console.log(`   ${c.warn}[${p.code}]${c.z} ${p.msg}`);
      if (p.hint) console.log(`        ${c.dim}${p.hint}${c.z}`);
    }
  }
}

console.log('');
const archivedCount = results.filter(r => r.archived).length;
const checkedCount = results.length - archivedCount;
const archivedNote = archivedCount ? ` · 已归档跳过 ${archivedCount}` : '';

if (bad.length === 0) {
  console.log(`${c.ok}全部一致（${checkedCount} 仓）${c.z}${c.dim}${archivedNote}${c.z}`);
  process.exit(0);
}
console.log(`${c.err}${bad.length} 个仓有版本问题${c.z} · 修法：让 VERSION 与 package.json 同值，源码不要抄版本号`);
console.log(`${c.dim}判据：C1 两者一致 · C2 源码不硬编码 · C3 VERSION 合法${c.z}`);
process.exit(1);
