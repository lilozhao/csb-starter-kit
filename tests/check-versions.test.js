#!/usr/bin/env node
/**
 * check-versions 的判据回归测试
 *
 * 起因（2026-10-24 一天内的两次纠正）：
 *   ① Jeason 用它跑 9 仓，报 csb-agent-eval 缺 VERSION、csb-inheritance VERSION 非 semver
 *   ② 我为了"修绿"把这两个**已废弃**的仓 clone 进来补版本
 *   ③ 一澜纠正：「这两个库不用更新，已经相当于废弃了」
 *
 * 三次叠加暴露的真问题：脚本没有"归档"这个概念，于是只有两种错误选择——
 *   要么报警（逼着给死代码补版本），要么静默跳过（看着没问题其实没检查）。
 *
 * 锁死的不变量：
 *   A1 归档仓**必须被列出来**并说明原因（不是静默消失）
 *   A2 归档仓**不得计为失败**（不能逼着给废弃仓补版本）
 *   A3 --include-archived 必须真的体检（不能是假开关）
 *   A4 活跃仓缺版本文件 → 必须报 C3（不许因为"归档逻辑"顺带被放过）
 *
 * 跑法：node --test tests/check-versions.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-versions.js');

/** 造一个临时 workspace，含若干假仓 */
function makeFixture(spec) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-test-'));
  for (const [name, files] of Object.entries(spec)) {
    const d = path.join(base, name);
    fs.mkdirSync(d, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      if (file === '.git') { fs.mkdirSync(path.join(d, '.git'), { recursive: true }); continue; }
      fs.writeFileSync(path.join(d, file), content);
    }
  }
  return base;
}

function run(base, extraArgs = []) {
  const r = spawnSync(process.execPath, [SCRIPT, '--base', base, ...extraArgs], {
    encoding: 'utf8',
    timeout: 30000,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('A1+A2: 归档仓被列出且说明原因，但不计为失败', () => {
  // csb-awakening-birthday 在归档清单里，故意不给它任何版本文件
  const base = makeFixture({
    'csb-awakening-birthday': { 'README.md': '# old\n', '.git': null },
    'csb-good': { 'VERSION': '1.0.0\n', 'package.json': '{"version":"1.0.0"}' },
  });
  const r = run(base);
  assert.match(r.out, /csb-awakening-birthday/, 'A1: 归档仓必须出现在输出里（不许静默消失）');
  assert.match(r.out, /已归档/, 'A1: 必须标明"已归档"');
  assert.match(r.out, /awakening-standard|收编|更名|integration/i, 'A1: 必须给出归档原因');
  assert.strictEqual(r.code, 0, 'A2: 归档仓不得让整体失败');
  fs.rmSync(base, { recursive: true, force: true });
});

test('A3: --include-archived 真的体检归档仓（不是假开关）', () => {
  const base = makeFixture({
    'csb-awakening-birthday': { 'README.md': '# old\n', '.git': null },
    'csb-good': { 'VERSION': '1.0.0\n', 'package.json': '{"version":"1.0.0"}' },
  });
  const plain = run(base);
  const withArch = run(base, ['--include-archived']);

  assert.strictEqual(plain.code, 0, '默认模式：归档仓不报警');
  assert.notStrictEqual(withArch.code, 0, 'A3: 带 --include-archived 时应真的体检并报缺失');
  assert.match(withArch.out, /C3/, 'A3: 应报 C3（无版本文件）');
  fs.rmSync(base, { recursive: true, force: true });
});

test('A4: 活跃仓缺版本文件必须报 C3（不许被归档逻辑顺带放过）', () => {
  const base = makeFixture({
    'csb-active-noversion': { 'README.md': '# active but no version\n', '.git': null },
    'csb-good': { 'VERSION': '1.0.0\n', 'package.json': '{"version":"1.0.0"}' },
  });
  const r = run(base);
  assert.strictEqual(r.code, 1, 'A4: 活跃仓缺版本应导致失败');
  assert.match(r.out, /csb-active-noversion/);
  assert.match(r.out, /C3/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('C1: VERSION 与 package.json 不一致要被抓到', () => {
  const base = makeFixture({
    'csb-drift': { 'VERSION': '2.1.0\n', 'package.json': '{"version":"2.0.0"}' },
  });
  const r = run(base);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /C1/);
  assert.match(r.out, /2\.1\.0/);
  assert.match(r.out, /2\.0\.0/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('C3: 非 semver 的 VERSION 要被判非法（如构建号 csb-v3.2-...）', () => {
  const base = makeFixture({
    'csb-buildnum': { 'VERSION': 'csb-v3.2-20260606-9a2f62d\n' },
  });
  const r = run(base);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /C3/);
  assert.match(r.out, /格式非法/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('--json 输出带 archived 标记（机器可读）', () => {
  const base = makeFixture({
    'csb-awakening-birthday': { 'README.md': '# old\n', '.git': null },
    'csb-good': { 'VERSION': '1.0.0\n', 'package.json': '{"version":"1.0.0"}' },
  });
  const r = run(base, ['--json']);
  const j = JSON.parse(r.out);
  const arch = j.results.find(x => x.name === 'csb-awakening-birthday');
  assert.ok(arch, '归档仓要出现在 results 里');
  assert.strictEqual(arch.archived, true, 'archived 标记必须为 true');
  assert.ok(arch.archivedReason, 'archivedReason 必须非空');
  assert.strictEqual(j.failed, 0, '归档仓不计入 failed');
  fs.rmSync(base, { recursive: true, force: true });
});
