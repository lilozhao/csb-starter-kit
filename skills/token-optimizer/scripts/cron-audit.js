#!/usr/bin/env node
/**
 * cron-audit.js —— cron 构成体检：多少任务在灌主会话
 * 用法: node scripts/cron-audit.js [--json]
 */
'use strict';
const L = require('./lib');

const jobs = L.cronJobs();
if (!jobs) { console.error('❌ 拿不到 cron 列表'); process.exit(1); }

const rows = jobs.map((j) => {
  const p = j.payload || {};
  const text = (p.text || p.message || '').replace(/\s+/g, ' ').slice(0, 70);
  const sch = j.schedule || {};
  const perDay = sch.expr ? estimatePerDay(sch.expr) : (sch.everyMs ? 86400000 / sch.everyMs : 1);
  return { name: j.name, kind: p.kind, target: j.sessionTarget, freq: sch.expr || `every ${(sch.everyMs || 0) / 60000}min`, perDay, enabled: j.enabled !== false, text };
});

function estimatePerDay(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return 1;
  const [min, hour, dom, mon, dow] = parts;
  const anyMin = min === '*';
  const stepMin = /^\*\/(\d+)$/.exec(min);
  if (anyMin) return 1440;
  if (stepMin) return Math.round(1440 / parseInt(stepMin[1], 10));
  if (/^\d+$/.test(min)) {
    if (hour === '*') return 24;
    const stepHour = /^\*\/(\d+)$/.exec(hour);
    if (stepHour) return Math.round(24 / parseInt(stepHour[1], 10));
    if (/^\d+$/.test(hour)) return dow === '*' ? 1 : 1 / 7;
    if (hour.includes(',')) return hour.split(',').length;
  }
  return 1;
}

const mainRows = rows.filter((r) => r.target === 'main');
const mainPerDay = mainRows.reduce((s, r) => s + r.perDay, 0);

if (L.has('--json')) {
  console.log(JSON.stringify({ total: rows.length, mainJobs: mainRows.length, mainEventsPerDay: Math.round(mainPerDay), rows }, null, 2));
  process.exit(0);
}

console.log(`⏰ cron 体检（共 ${rows.length} 个任务）\n`);
for (const r of rows.sort((a, b) => (a.target === b.target ? 0 : a.target === 'main' ? -1 : 1))) {
  console.log(`   ${r.enabled ? '🟢' : '⚪'} ${r.target === 'main' ? '📥 main    ' : '📦 isolated'} ${r.freq.padEnd(16)} ${r.name}`);
}
console.log(`\n   📥 灌进主会话的任务: ${mainRows.length} 个，约 **${Math.round(mainPerDay)} 次/天**`);
console.log(`   📦 isolated:        ${rows.length - mainRows.length} 个（不吃主会话上下文）`);
if (mainPerDay > 10) {
  console.log(`\n   💡 建议：其中"跑个脚本就完事"的改道 isolated（ctx 从主会话的几十~上百K 降到几K）`);
  console.log(`      先看候选：node scripts/cron-migrate-isolated.js`);
}
