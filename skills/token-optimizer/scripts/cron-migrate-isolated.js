#!/usr/bin/env node
/**
 * cron-migrate-isolated.js —— 把"纯脚本类"cron 从 main 改道到 isolated（可移植版）
 *
 * 为什么：`systemEvent → main` 每次注入都触发一次**带满主会话上下文**的调用。
 *       只要任务是"跑个脚本、自己会发通知"，就没有理由吃那坨上下文。
 *
 * 安全设计：
 *   - **默认 dry-run**：只打印候选与计划，不改
 *   - `--apply` 必须配合 `--jobs "名字1,名字2"` 明确指定（不做"一刀切")
 *   - 改前打印原 payload，可用 `--restore` 提示回滚方式（改回 --session main）
 *
 * 用法:
 *   node scripts/cron-migrate-isolated.js                      # 列出候选（dry-run）
 *   node scripts/cron-migrate-isolated.js --jobs "记忆备份,健康巡检" --apply
 *   node scripts/cron-migrate-isolated.js --jobs "记忆备份" --apply --no-light-context
 */
'use strict';
const { execFileSync } = require('child_process');
const L = require('./lib');

const APPLY = L.has('--apply');
const LIGHT = !L.has('--no-light-context');
const picked = (L.arg('--jobs', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

const jobs = L.cronJobs();
if (!jobs) { console.error('❌ 拿不到 cron 列表（openclaw CLI 不可用？）'); process.exit(1); }

/** 启发式候选：主会话 + 文案里出现脚本路径 + 文案像"跑脚本" */
const SCRIPT_RE = /(\.js|\.sh|\.py|\.mjs)\b/;
const RUN_RE = /(运行|执行|跑|run|execute)/i;
const candidates = jobs.filter((j) => {
  if (j.sessionTarget !== 'main') return false;
  const t = (j.payload && (j.payload.text || j.payload.message)) || '';
  return SCRIPT_RE.test(t) && RUN_RE.test(t);
});

console.log(`🔎 cron 改道候选（${candidates.length} / ${jobs.length} 个任务）\n`);
for (const j of candidates) {
  const t = ((j.payload && (j.payload.text || j.payload.message)) || '').replace(/\s+/g, ' ');
  console.log(`  • ${j.name}`);
  console.log(`      ${(j.schedule && (j.schedule.expr || 'every ' + (j.schedule.everyMs || 0) / 60000 + 'min')) || '?'} | ${t.slice(0, 80)}…`);
}

if (!APPLY) {
  console.log(`\n（dry-run）确认后执行：`);
  console.log(`  node scripts/cron-migrate-isolated.js --jobs "${candidates.slice(0, 2).map((j) => j.name).join(',')}…" --apply`);
  process.exit(0);
}
if (!picked.length) { console.error('\n❌ --apply 必须配合 --jobs "名字1,名字2"（避免一刀切）'); process.exit(1); }

const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));
let ok = 0, fail = 0;
for (const name of picked) {
  const j = byName[name] || jobs.find((x) => x.name.includes(name));
  if (!j) { console.log(`  ⚪ 未找到: ${name}`); continue; }
  const msg = ((j.payload && (j.payload.text || j.payload.message)) || '').trim();
  const argv = ['cron', 'edit', j.id, '--session', 'isolated', '--message', msg, '--no-deliver'];
  if (LIGHT) argv.push('--light-context');
  try {
    execFileSync('openclaw', argv, { encoding: 'utf8' });
    console.log(`  ✅ ${j.name} → isolated${LIGHT ? ' + lightContext' : ''}`);
    ok++;
  } catch (e) {
    console.log(`  ❌ ${j.name}: ${String(e.stderr || e.message).slice(0, 160)}`);
    fail++;
  }
}
console.log(`\n改道 ${ok} 个 · 失败 ${fail} 个`);
console.log('回滚：openclaw cron edit <id> --session main --message "<原 payload 文案>"');
