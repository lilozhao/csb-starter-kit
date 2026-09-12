#!/usr/bin/env node
/**
 * md-audit.js —— 工作台注入文件体检（哪些在给每次调用加钱）
 * 用法: node scripts/md-audit.js [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const files = L.workspaceFiles().sort((a, b) => b.bytes - a.bytes);
const total = files.reduce((s, f) => s + f.bytes, 0);

// 分层建议：HOT 应 ≤100 行；>20KB 的文件基本都该拆
const advice = (f) => {
  const kb = f.bytes / 1024;
  if (kb > 20) return '🔴 该拆：正文入 archive（仍可检索），本文件留核心 ≤100 行';
  if (kb > 8) return '🟡 偏大：检查是否与其它文件重复，可下沉到 docs/';
  if (f.lines > 120) return '🟡 行数偏多：检查能否合并/下沉';
  return '✅ 正常';
};

if (L.has('--json')) {
  console.log(JSON.stringify({ totalBytes: total, totalTokens: L.approxTokens(total), files: files.map((f) => ({ ...f, advice: advice(f) })) }, null, 2));
  process.exit(0);
}

console.log('📄 工作台注入文件体检（这些文件**每次调用**都会进上下文）\n');
console.log('   文件                 体积      行数    粗估token   建议');
for (const f of files) {
  console.log(`   ${f.file.padEnd(20)} ${(f.bytes / 1024).toFixed(1).padStart(6)}KB ${String(f.lines).padStart(6)} ${String(L.approxTokens(f.bytes)).padStart(9)}   ${advice(f)}`);
}
console.log(`\n   合计: ${(total / 1024).toFixed(1)}KB ≈ ${L.approxTokens(total)} token/次`);
const est = L.approxTokens(total);
console.log(`   若瘦身到一半: 每次约省 ${Math.round(est / 2)} token —— 按 100 次/天算，一天省 ${(Math.round(est / 2) * 100 / 1e6).toFixed(2)}M token`);
console.log('\n   方法：HOT 层 ≤100 行（核心+指针）；详情移入 archive；用检索（memory_search）按需取回。');
