#!/usr/bin/env node
/**
 * lib.js —— token-optimizer 共用工具（可移植，无硬编码路径）
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_HOME, 'workspace');
const AGENTS_DIR = path.join(OPENCLAW_HOME, 'agents');
const CONTEXT_KB = parseInt(process.env.TOKEN_OPT_CONTEXT_KB || '80', 10);
const MD_KB = parseInt(process.env.TOKEN_OPT_MD_KB || '40', 10);

/** 工作台里会被注入上下文的文件（各框架命名不一，这里取通用的几个） */
const WORKSPACE_CONTEXT_FILES = ['SOUL.md', 'AGENTS.md', 'USER.md', 'TOOLS.md', 'MEMORY.md', 'HEARTBEAT.md', 'IDENTITY.md', 'META_RULES.md'];

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(name);

/** 扫描所有 agent 的会话 usage（近 N 天） */
function scanUsage(days = 3) {
  const since = Date.now() - days * 86400000;
  const rows = [];
  if (!fs.existsSync(AGENTS_DIR)) return rows;
  for (const agent of fs.readdirSync(AGENTS_DIR)) {
    const sdir = path.join(AGENTS_DIR, agent, 'sessions');
    if (!fs.existsSync(sdir)) continue;
    for (const f of fs.readdirSync(sdir).filter((x) => x.endsWith('.jsonl'))) {
      const full = path.join(sdir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (st.mtimeMs < since) continue;
      let model = '?';
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      for (const l of lines) {
        if (!l) continue;
        let d; try { d = JSON.parse(l); } catch { continue; }
        if (d.type === 'model_change') model = `${d.provider || ''}/${d.modelId || ''}`;
        const u = d.usage || (d.message && d.message.usage);
        if (!u) continue;
        const ts = d.timestamp || '';
        // 按记录时间过滤（文件可能横跨多天）
        if (ts && Date.parse(ts) && Date.parse(ts) < since) continue;
        rows.push({
          agent, session: f.replace('.jsonl', ''), model, ts,
          input: u.input || 0, output: u.output || 0,
          cacheRead: u.cacheRead || 0, total: u.totalTokens || 0, bytes: st.size,
        });
      }
    }
  }
  return rows;
}

/** 最近活跃会话的最后一次 usage（= 当前上下文规模） */
function latestContext() {
  if (!fs.existsSync(AGENTS_DIR)) return null;
  let newest = null;
  for (const agent of fs.readdirSync(AGENTS_DIR)) {
    const dir = path.join(AGENTS_DIR, agent, 'sessions');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { p, agent, mtimeMs: st.mtimeMs };
    }
  }
  if (!newest) return null;
  let last = null;
  for (const l of fs.readFileSync(newest.p, 'utf8').split('\n')) {
    if (!l) continue;
    let d; try { d = JSON.parse(l); } catch { continue; }
    const u = d.usage || (d.message && d.message.usage);
    if (u) last = { ...u, ts: d.timestamp };
  }
  if (!last) return null;
  return { agent: newest.agent, session: path.basename(newest.p, '.jsonl'), cacheRead: last.cacheRead || 0, ts: last.ts };
}

/** 工作台注入文件体积 */
function workspaceFiles() {
  const out = [];
  for (const f of WORKSPACE_CONTEXT_FILES) {
    const p = path.join(WORKSPACE, f);
    if (!fs.existsSync(p)) continue;
    const size = fs.statSync(p).size;
    out.push({ file: f, bytes: size, lines: fs.readFileSync(p, 'utf8').split('\n').length });
  }
  return out;
}

/** cron 任务（走 CLI，拿不到就返回 null） */
function cronJobs() {
  try {
    const raw = execFileSync('openclaw', ['cron', 'list', '--json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(raw).jobs || [];
  } catch { return null; }
}

/** 粗估 token（中日韩≈1 token/字符，英文≈4 字符/token） */
function approxTokens(bytes) { return Math.round(bytes / 2.5); }

module.exports = {
  OPENCLAW_HOME, WORKSPACE, AGENTS_DIR, CONTEXT_KB, MD_KB, WORKSPACE_CONTEXT_FILES,
  arg, has, scanUsage, latestContext, workspaceFiles, cronJobs, approxTokens,
};
