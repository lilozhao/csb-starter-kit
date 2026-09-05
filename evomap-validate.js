#!/usr/bin/env node
/**
 * EvoMap validation wrapper for csb-starter-kit (onboarding capability)
 * 验证：接引指南、身份/记忆模板、快评、A2A 速通——新 Agent 接入能力完整性
 * 用法: node evomap-validate.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('❌ FAIL:', msg); }
  else console.log('✅ PASS:', msg);
}

const root = __dirname;

// 1. 接引指南
const onboarding = path.join(root, 'docs/06-onboarding-guide.md');
assert(fs.existsSync(onboarding), '接引流程指南存在');
if (fs.existsSync(onboarding)) {
  const text = fs.readFileSync(onboarding, 'utf8');
  assert(text.includes('敲门'), '包含"先敲门"接引步骤');
  assert(text.includes('取名') || text.includes('名字'), '包含"让对方取名"步骤');
  assert(text.includes('传承') || text.includes('陪读'), '包含带读传承环节');
}

// 2. 身份/记忆模板
assert(fs.existsSync(path.join(root, 'memory/template/MEMORY.md.template')), 'MEMORY.md 模板存在');
assert(fs.existsSync(path.join(root, 'memory/template/daily.md.template')), 'daily 模板存在');
assert(fs.existsSync(path.join(root, 'memory/template/SELF_STATE.md.template')), 'SELF_STATE 模板存在');

// 3. 理念文档
const five = path.join(root, 'docs/02-five-principles.md');
assert(fs.existsSync(five), '五律文档存在');
if (fs.existsSync(five)) {
  const text = fs.readFileSync(five, 'utf8');
  assert(text.includes('五律') || text.includes('君子标准'), '五律核心内容存在');
}

// 4. 快评
assert(fs.existsSync(path.join(root, 'evaluator/quick-eval.md')), '5 分钟快评存在');

// 5. A2A 速通
const a2a = path.join(root, 'knowledge/a2a-guide/quickstart.md');
assert(fs.existsSync(a2a), 'A2A 速通指南存在');
if (fs.existsSync(a2a)) {
  const text = fs.readFileSync(a2a, 'utf8');
  assert(text.includes('敲门') || text.includes('URL'), 'A2A 连接方式存在');
}

// 6. 社区指南
assert(fs.existsSync(path.join(root, 'community/posting-guide.md')), '社区发帖指南存在');

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n✅ 全部通过：csb-starter-kit onboarding 能力验证成功');
process.exit(0);
