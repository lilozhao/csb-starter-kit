---
name: iv8-web-collector
description: 快速收集网页内容为 Markdown/JSON。基于 iv8（Python 内嵌 V8 + 浏览器环境模拟，不启真浏览器）做 DOM 级正文提取，比正则剥标签更稳。支持批量抓取、JS 渲染页补齐、`--field` 定点字段抽取、假 200（stubbed）识别。当用户要求"收集网页内容"、"抓取网页"、"网页转 Markdown"、"采集文章正文"、"批量抓取多个 URL"时使用。触发词：抓网页、爬内容、网页收集、web collect、保存网页正文。
metadata:
  csb:
    # —— 作者信息（producer）——
    author_aid: ruochen@172.28.0.1:3200       # 原始包装层作者：若辰 ✨（WorkBuddy 系，宿主机 3200）
    # —— 验证信息（validator，由另一个 Agent 填写）——
    validator_aid: ""
    sig_hash: ""
    verified_ts: ""
    verified: pending                        # pending → confirmed 走晋升
    # —— D3 风险分级 ——
    risk: normal                             # normal(30天观察) | high(90天观察)
    scope: shared                            # shared | private
---

# iv8 Web Collector

> 一句话定位：把一个或多个网页**快速**收集成结构化内容（Markdown + JSON）。适合批量采集、结构化字段抽取、卡片流/论坛列表页；JS 渲染页也能靠"子资源补齐回环"拿下。

## Overview

流程：Python `requests` 抓 HTML → iv8（V8 + 模拟浏览器环境）建**真 DOM** → JS 在 DOM 里提取 → 落盘 `.md` + `.json` + `index.json` 汇总。

iv8 的角色是提供真实浏览器 DOM 环境（`querySelector` / `innerText` 开箱即用），提取质量高于正则剥标签。

**与"真浏览器方案"（Playwright/Puppeteer）的分工**

| | 本技能（iv8） | 真浏览器方案 |
|---|---|---|
| 依赖 | 纯 Python（不启浏览器） | 需 chromium 二进制 |
| 强项 | 轻量 · 批量并发 · `--field` 结构化定点 · 假 200 识别 | 反爬强（stealth）· 真 JS 执行 |
| 弱项 | 社区版**无真实网络栈**、反爬弱 | 重、慢 |

## 前置条件

`iv8` 是**独立的专有第三方依赖**，需自行安装（本仓库**不打包**其本体）：

```bash
python3 -m venv .venv
# 阿里云镜像（国内推荐，实测收录 iv8 0.1.4）：
.venv/bin/pip install -i https://mirrors.aliyun.com/pypi/simple/ iv8 requests
# 或官方源：
.venv/bin/pip install -i https://pypi.org/simple/ iv8 requests
```

- ⚠️ **许可**：`iv8 Community Edition License` —— 免费用于个人/教育/非商用；**禁止反编译**；**禁止再分发**；商用需购 Pro。本技能只**依赖**它，**不打包**其本体或文档（详见 `NOTICE.md`）。
- 缺依赖时脚本会打印上面的安装指令（不是裸 `ImportError`）。
- 自检：`.venv/bin/python verify_iv8.py` → 期望 `ALL CHECKS PASSED`。

## 工具选择（`scripts/` 下两套）

| | `iv8_collect.py`（推荐，功能全） | `web_collect.py`（简单快） |
|---|---|---|
| 适用 | 复杂页/论坛/卡片流/JS 渲染页/定点字段 | 简单静态页快速批量 |
| 模式 | `--mode raw`（只建 DOM，快稳）/ `--mode run`（完整生命周期 + 子资源补齐回环） | 固定提取 |
| 定点字段 | `--field 名称=CSS选择器[@属性]` | 无 |
| 并发 | `--workers N`（每线程自建自关 context） | 内置 4 线程 |
| 依赖 | `iv8_extract.py` 必须同目录（脚本已自寻路径） | 单文件 |

**默认选 `iv8_collect.py`**；只有最简单的静态页才用 `web_collect.py`。

## 用法（iv8_collect.py）

```bash
.venv/bin/python scripts/iv8_collect.py <url1> [url2 ...] [--list urls.txt] \
  [--mode raw|run] [--field 标题=h1@文本 默认] [--out collected] \
  [--workers 4] [--timeout 20] [--harvest 2] [--format md,json]
```

- `--mode raw`（默认）：只建 DOM 不跑脚本，快且稳，适合绝大多数静态页
- `--mode run --harvest 2`：`page.load` 走完整生命周期，每轮把**页面要但 bundle 没有的 URL** 用真实 HTTP 补进去再 reload —— **JS 渲染页必须用这个**，否则拿到假 200 和空壳
- `--field 价格=span.price@文本`：任意数量定点字段（`@属性` 省略则取 `textContent`）
- 产出：每页 `<域名>__<路径>__<hash8>.md` + `.json`，目录级 `index.json` 汇总（含 stubbed 警告数与耗时）

`.md` 产出自带元信息头（来源 URL / 抓取时间 / 模式 / HTTP 状态 / **实际编码** / DOM 节点数 / 补齐回环明细）。

## 处理结果

1. **逐页汇报**：slug、HTTP 状态、段落数、正文字数、链接数、stubbed 数、耗时
2. **检查 stubbed**：`stubbed > 0` 表示有页面请求被 iv8 内置假 200 顶替，从这些请求推导的值不可信 —— 改用 `--mode run --harvest N` 或如实告知用户
3. **交付文件**：输出目录中的 `.md` 文件
4. **失败页面**：区分网络问题（超时/代理 502/403）与提取问题；网络问题不重试超过 1 次

## 硬约束与坑位（0.1.4 实测，违反即崩或出假数据）

1. **JSContext 绑定创建线程**：跨线程 eval 直接 abort 进程（不可 catch）—— 多线程必须每 worker 自建自关，绝不跨线程传 context
2. **社区版无网络栈**：没被 `add_resource`/resources 喂过的请求不报错，而是拿假 200 + `{"message":"模拟GET响应"}` —— `status==200` 不算成功，**`stubbed` 才是真相**
3. **`new URL(rel, base)` 解析是坏的**（吞 host）：链接一律用 `<a>` 元素或 Python `urljoin` 解析
4. **第二次 `page.load` 会清掉 window 自定义全局量**：探针每轮重装
5. **本机代理**可能拦外网站点（实测维基 502），国内站点直连正常
6. **控制台可能是 GBK**：脚本已 `sys.stdout.reconfigure(errors="replace")` 兜底，别去掉
7. `debugger;` 被禁用（断点用 `vdebugger;`）；Context 创建约 3ms/次，无需复用
8. **字符集**：解码优先级 = HTTP 头 charset（排除 requests 的 `ISO-8859-1` 兜底值）> `<meta charset>` > `apparent_encoding` > `utf-8`；实际编码会写进产出，便于核对

## 边界

- 仅收集**公开可访问**页面；不绕过登录、验证码或付费墙
- 遵守 robots 精神：批量抓取同一站点时控制并发与频率，不用于大规模爬取
- 收集到的内容注明来源 URL（脚本已自动写入产出文件）

## 变更记录

- **2026-09-27 · 缺依赖友好提示 + 免 cd**：两个收集器的 `import iv8` 改为 try/except，缺依赖时打印可操作安装指令；`iv8_collect.py` 增加 `sys.path.insert(0, 脚本目录)`，可从任意目录调用。
- **2026-09-27 · 修中文站整页乱码**：原先直接 `raw.decode(r.encoding)`；requests（2.34）对「`text/*` 且头里未写 charset」会返回 `ISO-8859-1` 兜底值 ⇒ UTF-8 中文被按 latin-1 解 → 全页乱码（`<meta charset>` 与 `apparent_encoding` 均被忽略）。改为 `pick_encoding()` 四级优先；实际编码写入产出。

---

## ⚙️ 验证流程（P0-3 D2 —— 由独立 validator 执行，author 本人不得自签）

本技能的 `verified` 状态由 **author 之外的 Agent** 验证后填写：

1. **author 建技能**：填 `author_aid`，`verified: pending`，`scope: shared`
2. **validator（另一只 Agent）亲证**：跑 `csb-security signVerification()` 生成 `sig_hash`，回填 `validator_aid` / `sig_hash` / `verified_ts` → `verified: confirmed`
3. **第三方复核**：`verifyVerificationRecord(claim, signature, validatorAid)` + `sigHash(claim)` 比对

```bash
node <csb-starter-kit>/scripts/validate-skill-meta.js SKILL.md
```

- ⛔ `validator_aid ≠ author_aid`（防自证，代码层拒绝）
- 🏠 `scope: private` 的技能可豁免

## 贡献者

- **author（原始包装层）**：`ruochen@172.28.0.1:3200`（若辰 ✨ · WorkBuddy 系）—— 收集器本体与初版文档
- **整理 / 适配 / 发布**：`ruolan@172.28.0.214:3100`（若琢 🌸）—— Linux 适配 · 中文乱码修复 · 依赖加固 · 安全审计（`AUDIT.md`）

> 许可分工：本文与 `scripts/` 为 MIT（包装层）；`iv8` 本体为第三方专有依赖，**不由本仓库分发**。

## 安全审计

见 `AUDIT.md`（代码本体低危；三条附条件见文末）。
