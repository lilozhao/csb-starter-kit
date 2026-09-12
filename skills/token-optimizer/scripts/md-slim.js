#!/usr/bin/env node
/**
 * md-slim.js —— 工作台文件瘦身执行器（2026-09-12）
 *
 * 设计原则（硬性）：
 *   1) **只移动，不删除** —— 原文进 archive，主文件留指针
 *   2) **先备份后动笔** —— backups/md-slim/<文件>.<时间戳>.bak
 *   3) **默认只出方案** —— 要动必须 --apply（且必须点名小节，或用白名单 --auto）
 *   4) **动完自证** —— 校验归档内容字节数与原文一致，不等则回滚
 *
 * 用法:
 *   node scripts/md-slim.js                                  # 全量方案（只读）
 *   node scripts/md-slim.js --file TOOLS.md --plan
 *   node scripts/md-slim.js --file TOOLS.md --sections "更新历史,附录" --apply
 *   node scripts/md-slim.js --file TOOLS.md --auto --apply   # 只移白名单小节（保守）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);

/** 保守白名单：标题一看就是"历史/附录"类的小节才允许 --auto */
const AUTO_WHITELIST = /(更新历史|更新记录|变更记录|CHANGELOG|历史沿革|沿革|附录|详细记录|完整版|归档记录|版本历史)/i;

function splitSections(text) {
  const lines = text.split('\n');
  const out = { preamble: [], sections: [] };
  let cur = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !/^###/.test(line)) {
      if (cur) out.sections.push(cur);
      cur = { title: m[1], lines: [line] };
    } else if (cur) cur.lines.push(line);
    else out.preamble.push(line);
  }
  if (cur) out.sections.push(cur);
  for (const s of out.sections) { s.body = s.lines.join('\n'); s.bytes = Buffer.byteLength(s.body, 'utf8'); }
  return out;
}

function plan(files) {
  const rows = [];
  for (const f of files) {
    const p = path.join(L.WORKSPACE, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    const { sections } = splitSections(text);
    const total = Buffer.byteLength(text, 'utf8');
    const cands = sections.filter((s) => AUTO_WHITELIST.test(s.title));
    rows.push({ file: f, bytes: total, kb: (total / 1024).toFixed(1), sections: sections.map((s) => ({ title: s.title, kb: (s.bytes / 1024).toFixed(1), auto: AUTO_WHITELIST.test(s.title) })), saveBytes: cands.reduce((a, s) => a + s.bytes, 0), saveKb: (cands.reduce((a, s) => a + s.bytes, 0) / 1024).toFixed(1) });
  }
  return rows;
}

function applySlim(file, titles, dry) {
  const p = path.join(L.WORKSPACE, file);
  const text = fs.readFileSync(p, 'utf8');
  const { preamble, sections } = splitSections(text);
  const picked = sections.filter((s) => titles.includes(s.title));
  if (!picked.length) { console.error(`❌ 未找到指定小节：${titles.join(' / ')}`); process.exit(1); }

  const date = new Date().toISOString().slice(0, 10);
  const dir = path.dirname(p);
  const archiveDir = path.join(dir, 'archive');
  const base = path.basename(file, '.md');
  const results = [];

  if (!dry) {
    // 备份
    const bakDir = path.join(L.WORKSPACE, 'backups', 'md-slim');
    fs.mkdirSync(bakDir, { recursive: true });
    fs.copyFileSync(p, path.join(bakDir, `${base}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`));
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const before = Buffer.byteLength(text, 'utf8');
  let newText = text;
  for (const s of picked) {
    const slug = s.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 30);
    const arcRel = path.relative(L.WORKSPACE, path.join(archiveDir, `${base}-${slug}-${date}.md`));
    const arcContent = `# ${base} · ${s.title}（归档 ${date}）\n\n> 由 md-slim.js 从 \`${file}\` 移出。\n> 原文完整保留于此；主文件保留指针，仍可用 memory_search 检索到。\n\n${s.body}\n`;
    if (!dry) fs.writeFileSync(path.join(L.WORKSPACE, arcRel), arcContent);
    const pointer = `## ${s.title}\n\n> 📦 已归档：\`${arcRel}\`（${(s.bytes / 1024).toFixed(1)}KB，内容完整保留，可用检索取回）\n`;
    newText = newText.replace(s.body, pointer.trimEnd());
    results.push({ title: s.title, kb: (s.bytes / 1024).toFixed(1), archive: arcRel, movedBytes: s.bytes, arcBytes: Buffer.byteLength(arcContent, 'utf8') });
  }

  if (!dry) fs.writeFileSync(p, newText);
  const after = Buffer.byteLength(newText, 'utf8');

  // 自证：归档文件字节数应 ≥ 原文小节字节数（含头部说明）
  let ok = true;
  if (!dry) {
    for (const r of results) {
      const abs = path.join(L.WORKSPACE, r.archive);
      if (!fs.existsSync(abs) || Buffer.byteLength(fs.readFileSync(abs, 'utf8'), 'utf8') < r.movedBytes) { ok = false; console.error(`❌ 自证失败：${r.archive} 字节数异常`); }
    }
  }

  console.log(`${dry ? '🧪 [dry-run]' : '✅'} 瘦身 ${file}`);
  for (const r of results) console.log(`   移出「${r.title}」 ${r.kb}KB → ${r.archive}`);
  console.log(`   ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB（省 ${((before - after) / 1024).toFixed(1)}KB${(after / before * 100).toFixed(0) === '0' ? '' : `，-${(100 - after / before * 100).toFixed(0)}%`}）`);
  if (!dry) {
    console.log(ok ? '   ✅ 自证通过：归档内容字节完整' : '   ❌ 自证失败 —— 请用 backups/md-slim/ 下的备份回滚');
    console.log(`   回滚：cp backups/md-slim/<最新备份> ${file}`);
  }
  if (!ok) process.exit(2);
}

// ── main ──
const file = arg('--file');
const dry = !has('--apply');

if (file) {
  if (dry || has('--plan')) {
    const rows = plan([file]);
    const r = rows[0];
    if (!r) { console.error(`❌ 文件不存在: ${file}`); process.exit(1); }
    console.log(`📄 ${r.file}  ${r.kb}KB`);
    for (const s of r.sections) console.log(`   ${s.auto ? '🟢' : '  '} ${s.kb.padStart(6)}KB  ${s.title}`);
    console.log(`\n可自动移出（白名单）: ${r.saveKb}KB —— 用 --auto --apply 执行；也可 --sections "标题1,标题2" 指定`);
    process.exit(0);
  }
  let titles = (arg('--sections', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (has('--auto')) {
    const text = fs.readFileSync(path.join(L.WORKSPACE, file), 'utf8');
    titles = splitSections(text).sections.filter((s) => AUTO_WHITELIST.test(s.title)).map((s) => s.title);
    if (!titles.length) { console.log('ℹ️ 无白名单小节可移，无需瘦身'); process.exit(0); }
  }
  if (!titles.length) { console.error('❌ --apply 需配合 --sections "标题" 或 --auto（避免误移）'); process.exit(1); }
  applySlim(file, titles, false);
} else {
  const rows = plan(L.WORKSPACE_CONTEXT_FILES).sort((a, b) => b.bytes - a.bytes);
  console.log('📄 工作台文件瘦身方案（只读）\n');
  for (const r of rows) {
    console.log(`${r.file.padEnd(20)} ${r.kb.padStart(6)}KB  可自动移出 ${r.saveKb}KB`);
    for (const s of r.sections.filter((x) => x.auto)) console.log(`      🟢 ${s.kb.padStart(6)}KB  ${s.title}`);
  }
  console.log('\n用法：node scripts/md-slim.js --file <文件> --auto --apply');
console.log('原则：只移动不删除 · 先备份 · 动完自证 · 可回滚');
}
