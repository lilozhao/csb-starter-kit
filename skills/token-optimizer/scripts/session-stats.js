#!/usr/bin/env node
/**
 * session-stats.js —— 会话调用/Token 统计（可移植版，2026-09-12）
 *
 * 回答"我这个会话用了多少 token / 多少次调用"：读会话 JSONL 里的 usage 聚合。
 *
 * 用法:
 *   node scripts/session-stats.js [days]      # 默认 3 天；统计"当前活跃会话"
 *   node scripts/session-stats.js 7
 *
 * 可选：若存在记忆满溢检查脚本，会顺带跑一次（路径见 TOKEN_OPT_MEMORY_ALERT）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');

const DAYS = parseInt(process.argv[2] || '3', 10);
const since = Date.now() - DAYS * 86400000;

if (!fs.existsSync(L.AGENTS_DIR)) { console.log('⚪ 未找到 agent 会话目录'); process.exit(0); }

// 当前活跃会话 = 最新 mtime
let newest = null;
for (const a of fs.readdirSync(L.AGENTS_DIR)) {
  const dir = path.join(L.AGENTS_DIR, a, 'sessions');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (!newest || st.mtimeMs > newest.mtimeMs) newest = { p, a, f, mtimeMs: st.mtimeMs, size: st.size };
  }
}
if (!newest) { console.log('⚪ 未找到会话文件'); process.exit(0); }

const rows = [];
let model = '?', compactions = 0;
for (const l of fs.readFileSync(newest.p, 'utf8').split('\n')) {
  if (!l) continue;
  let d; try { d = JSON.parse(l); } catch { continue; }
  if (d.type === 'model_change') model = `${d.provider}/${d.modelId}`;
  if (d.type === 'compaction') compactions++;
  const u = d.usage || (d.message && d.message.usage);
  if (!u) continue;
  const ts = d.timestamp || '';
  if (ts && Date.parse(ts) && Date.parse(ts) < since) continue;
  rows.push({ ts, input: u.input || 0, output: u.output || 0, cacheRead: u.cacheRead || 0, total: u.totalTokens || 0 });
}
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
const avg = (k) => (rows.length ? Math.round(sum(k) / rows.length) : 0);
const last = rows[rows.length - 1] || {};

console.log(`📊 当前会话（${newest.a}/${path.basename(newest.f, '.jsonl').slice(0, 8)}）近 ${DAYS} 天`);
console.log(`   模型: ${model} · 文件 ${(newest.size / 1024 / 1024).toFixed(1)}MB · 最后活跃 ${last.ts || '-'} · 压缩次数 ${compactions}`);
console.log(`   调用次数: ${rows.length}（≈ ${(rows.length / DAYS).toFixed(0)} 次/天）`);
console.log(`   平均每次: 上下文 ${avg('cacheRead').toLocaleString()} · 新鲜输入 ${avg('input').toLocaleString()} · 输出 ${avg('output').toLocaleString()}`);
console.log(`   合计: 上下文 ${(sum('cacheRead') / 1e6).toFixed(1)}M · 输入 ${(sum('input') / 1e3).toFixed(0)}K · 输出 ${(sum('output') / 1e3).toFixed(0)}K`);
console.log(`   最近一次携带上下文: ${(last.cacheRead || 0).toLocaleString()} token`);
if (last.cacheRead / 1024 > L.CONTEXT_KB) {
  console.log(`   🚨 超过阈值 ${L.CONTEXT_KB}K → 建议归档该会话（单次调用可回到 ~30K）`);
}

const alertScript = process.env.TOKEN_OPT_MEMORY_ALERT;
if (alertScript && fs.existsSync(alertScript)) {
  console.log('\n── 记忆满溢检查 ──');
  try {
    const out = execFileSync('node', [alertScript], { encoding: 'utf8' }).trim();
    console.log(out || '（无输出 = 正常）');
  } catch (e) {
    console.log(((e.stdout || '') + (e.stderr || '')).trim() || `执行失败: ${e.message}`);
  }
}
