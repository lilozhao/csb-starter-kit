#!/usr/bin/env node
/**
 * session-context-check.js —— 当前会话上下文体检（可移植版）
 * 退出码: 0 正常；2 超过阈值（建议归档会话）
 * 用法: node scripts/session-context-check.js [--quiet]
 */
'use strict';
const L = require('./lib');

const ctx = L.latestContext();
if (!ctx) { console.log('⚪ 未找到会话 usage 记录'); process.exit(0); }
const kb = ctx.cacheRead / 1024;
const over = kb > L.CONTEXT_KB;
if (L.has('--quiet') && !over) process.exit(0);

if (over) {
  console.log(`🚨 会话上下文偏大：${kb.toFixed(0)}K token（阈值 ${L.CONTEXT_KB}K）`);
  console.log(`   会话: ${ctx.agent}/${ctx.session.slice(0, 8)} · 最后活跃 ${ctx.ts}`);
  console.log(`   建议：归档本会话（开新会话）→ 上下文可回到 ~30K，每次调用省 ~80%`);
} else {
  console.log(`✅ 会话上下文 ${kb.toFixed(0)}K token（阈值 ${L.CONTEXT_KB}K）`);
}
process.exit(over ? 2 : 0);
