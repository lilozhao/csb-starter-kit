#!/usr/bin/env node
/**
 * selftest.js —— 构造假数据，验证四类判定逻辑（不碰真实环境）
 * 用法: node scripts/selftest.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(os.tmpdir(), 'token-opt-selftest-' + Date.now());
const HOME = path.join(DIR, '.openclaw');
const WS = path.join(HOME, 'workspace');
const SESS = path.join(HOME, 'agents', 'main', 'sessions');
fs.mkdirSync(SESS, { recursive: true });
fs.mkdirSync(WS, { recursive: true });

const env = { ...process.env, OPENCLAW_HOME: HOME, OPENCLAW_WORKSPACE: WS, TOKEN_OPT_CONTEXT_KB: '80', TOKEN_OPT_MD_KB: '40' };
const run = (script, args = []) => {
  try {
    return { code: 0, out: execFileSync('node', [path.join(__dirname, script), ...args], { env, encoding: 'utf8' }).trim() };
  } catch (e) { return { code: e.status ?? 1, out: ((e.stdout || '') + (e.stderr || '')).trim() }; }
};

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  cond ? (pass++, console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`))
       : (fail++, console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`));
};

console.log('🧪 token-optimizer 自检');

// 场景 A：健康（小上下文、小 md）
fs.writeFileSync(path.join(WS, 'MEMORY.md'), '# small\n' + 'x'.repeat(2000));
fs.writeFileSync(path.join(WS, 'AGENTS.md'), '# small\n' + 'x'.repeat(2000));
const mkSession = (name, cacheRead, calls) => {
  const lines = [JSON.stringify({ type: 'session', id: name }), JSON.stringify({ type: 'model_change', provider: 'p', modelId: 'm' })];
  for (let i = 0; i < calls; i++) lines.push(JSON.stringify({ type: 'message', timestamp: new Date().toISOString(), usage: { input: 100, output: 50, cacheRead, totalTokens: cacheRead + 150 } }));
  fs.writeFileSync(path.join(SESS, name + '.jsonl'), lines.join('\n') + '\n');
};
mkSession('healthy-0000', 20000, 5);
const a = run('audit.js', ['--days', '3']);
check('健康场景：无告警', a.code === 0 && /未发现明显问题/.test(a.out), a.out.split('\n').pop());

// 场景 B：上下文膨胀（cacheRead 超阈值）
mkSession('bloated-1111', 300000, 5);
const b = run('session-context-check.js');
check('检出上下文膨胀', b.code === 2 && /偏大/.test(b.out), b.out.split('\n')[0]);
const b2 = run('audit.js', ['--days', '3']);
check('audit 报出问题[1]', /\[1\].*上下文膨胀/.test(b2.out), (b2.out.match(/\[\d\].*/) || [''])[0]);

// 场景 C：工作台文件过肥
fs.writeFileSync(path.join(WS, 'MEMORY.md'), '# big\n' + 'x'.repeat(300000));
const c = run('md-audit.js');
check('检出 md 过肥', /该拆/.test(c.out), (c.out.match(/🔴.*/) || [''])[0]);
const c2 = run('audit.js', ['--days', '3']);
check('audit 报出问题[4]', /\[4\].*工作台文件过肥/.test(c2.out), (c2.out.match(/\[4\].*/) || [''])[0]);

// 场景 D：调用密度高
mkSession('busy-2222', 20000, 700);
const d = run('audit.js', ['--days', '3', '--json']);
let j = null; try { j = JSON.parse(d.out.replace(/^[\s\S]*?(\{[\s\S]*\})$/, '$1')); } catch { /* ignore */ }
check('检出调用密度高', /调用密度高/.test(run('audit.js', ['--days', '3']).out) || (j && j.findings.some((f) => f.id === 2)), '每天 >200 次');

// 场景 E：md-slim 执行器（只移动不删除 + 备份 + 自证）
{
  const WS2 = path.join(DIR, 'ws2');
  fs.mkdirSync(WS2, { recursive: true });
  const big = '# T.md\n\n## 正文\n核心内容\n\n## 更新历史\n' + '历史记录行\n'.repeat(400);
  fs.writeFileSync(path.join(WS2, 'TOOLS.md'), big);
  const env2 = { ...env, OPENCLAW_WORKSPACE: WS2 };
  const before = fs.statSync(path.join(WS2, 'TOOLS.md')).size;
  let out = '';
  try {
    out = execFileSync('node', [path.join(__dirname, 'md-slim.js'), '--file', 'TOOLS.md', '--auto', '--apply'], { env: env2, encoding: 'utf8' });
  } catch (e) { out = String(e.stdout || e.message); }
  const after = fs.statSync(path.join(WS2, 'TOOLS.md')).size;
  const arcDir = path.join(WS2, 'archive');
  const arc = fs.existsSync(arcDir) ? fs.readdirSync(arcDir) : [];
  const bakDir = path.join(WS2, 'backups', 'md-slim');
  const baks = fs.existsSync(bakDir) ? fs.readdirSync(bakDir) : [];
  const body = fs.readFileSync(path.join(WS2, 'TOOLS.md'), 'utf8');
  check('md-slim 主文件变小', after < before, `${before} → ${after} 字节`);
  check('md-slim 生成归档文件', arc.length > 0, arc[0] || '无');
  check('md-slim 保留指针（可检索）', /已归档/.test(body), '主文件含归档指针');
  check('md-slim 留了备份', baks.length > 0, baks[0] || '无');
  check('md-slim 自证通过', /自证通过|自证失败/.test(out) && !/自证失败/.test(out), (out.match(/.*自证.*/) || [''])[0].trim());
}

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n📊 自检结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
