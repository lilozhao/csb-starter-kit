#!/usr/bin/env node
/**
 * audit.js —— token 体检主入口（只读，不改任何东西）
 * 用法: node scripts/audit.js [--days 3] [--json]
 */
'use strict';
const L = require('./lib');

const DAYS = parseInt(L.arg('--days', '3'), 10);

const rows = L.scanUsage(DAYS);
const ctx = L.latestContext();
const files = L.workspaceFiles();
const jobs = L.cronJobs();

const sum = (a, k) => a.reduce((s, r) => s + (r[k] || 0), 0);
const byDay = {};
for (const r of rows) { const d = (r.ts || '').slice(0, 10) || '(?)'; (byDay[d] = byDay[d] || []).push(r); }
const calls = rows.length;
const avgCtx = calls ? Math.round(sum(rows, 'cacheRead') / calls) : 0;
const mdBytes = files.reduce((s, f) => s + f.bytes, 0);
const mainJobs = (jobs || []).filter((j) => j.sessionTarget === 'main');
const isolatedJobs = (jobs || []).filter((j) => j.sessionTarget !== 'main');

const findings = [];
if (ctx && ctx.cacheRead / 1024 > L.CONTEXT_KB) {
  findings.push({ id: 1, severity: 'high', title: `会话上下文膨胀：${(ctx.cacheRead / 1024).toFixed(0)}K token`,
    why: '每次调用都要携带这份上下文（成本 = 次数 × 上下文）',
    fix: '归档该会话（开新会话）；长期方案：分层记忆（HOT 精简 + 详情入 archive）' });
}
if (calls / DAYS > 200) {
  findings.push({ id: 2, severity: 'high', title: `调用密度高：${(calls / DAYS).toFixed(0)} 次/天（近 ${DAYS} 天）`,
    why: '每次工具往返都是一次全额上下文付费',
    fix: '合并命令（一条干多件事）、批量读写、不重复验证、背景任务不轮询' });
}
if (jobs && mainJobs.length > isolatedJobs.length) {
  findings.push({ id: 3, severity: 'medium', title: `cron 多数灌主会话：main ${mainJobs.length} / isolated ${isolatedJobs.length}`,
    why: '纯跑脚本的任务不需要主会话那坨上下文',
    fix: 'node scripts/cron-migrate-isolated.js --dry 查看计划，再 --apply' });
}
if (mdBytes / 1024 > L.MD_KB) {
  findings.push({ id: 4, severity: 'medium', title: `工作台文件过肥：${(mdBytes / 1024).toFixed(1)}KB ≈ ${L.approxTokens(mdBytes)} token（每个会话都付）`,
    why: 'HOT 层越长，每次调用的固定成本越高',
    fix: '运行 node scripts/md-audit.js 看明细；HOT ≤100 行，长文进 archive（仍可检索）' });
}

if (L.has('--json')) {
  console.log(JSON.stringify({ days: DAYS, calls, avgCtx, mdBytes, mainJobs: mainJobs.length, isolatedJobs: isolatedJobs.length, findings }, null, 2));
  process.exit(findings.length ? 2 : 0);
}

console.log(`🔍 Token 体检（近 ${DAYS} 天 · agent 会话 ${calls} 次有记录调用）`);
console.log(`   平均每次携带上下文: ${avgCtx.toLocaleString()} token`);
console.log(`   工作台注入文件:     ${(mdBytes / 1024).toFixed(1)} KB ≈ ${L.approxTokens(mdBytes)} token`);
if (ctx) console.log(`   当前活跃会话:       ${ctx.agent}/${ctx.session.slice(0, 8)} · ${(ctx.cacheRead / 1024).toFixed(0)}K token`);
if (jobs) console.log(`   cron:              main ${mainJobs.length} · isolated ${isolatedJobs.length}（共 ${jobs.length}）`);

console.log('\n📋 按天');
for (const [d, v] of Object.entries(byDay).sort()) {
  console.log(`   ${d}  ${String(v.length).padStart(5)} 次 · 缓存读 ${(sum(v, 'cacheRead') / 1e6).toFixed(1)}M · 输出 ${(sum(v, 'output') / 1000).toFixed(0)}K`);
}

if (!findings.length) { console.log('\n✅ 未发现明显问题（四类判据都通过）'); process.exit(0); }
console.log(`\n🚨 发现 ${findings.length} 类问题`);
for (const f of findings) {
  console.log(`\n   [${f.id}] ${f.severity === 'high' ? '🔴' : '🟡'} ${f.title}`);
  console.log(`       为什么: ${f.why}`);
  console.log(`       怎么做: ${f.fix}`);
}
process.exit(2);
