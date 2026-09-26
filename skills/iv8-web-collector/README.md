# iv8-web-collector

基于 **iv8**（Python 内嵌 V8 + 模拟浏览器环境，**不启动真实浏览器**）的快速网页内容收集工具集。

把一个或多个网页抓成结构化内容：Markdown + JSON + 汇总索引。适合**批量采集**、**结构化字段抽取**、论坛/卡片流列表页，以及需要 DOM 级精度（`querySelector`）的场景。

- 上游 `iv8`：https://github.com/HanZzzzz000/iv8 （Gitee 镜像：https://gitee.com/hobinleon/iv8 ）
- 许可：本包装层 **MIT**（见 `LICENSE`）；`iv8` 本体为**专有许可**（见下文与 `NOTICE.md`）

---

## 与真浏览器方案的分工

| | 本工具（iv8） | Playwright / Puppeteer |
|---|---|---|
| 依赖 | 纯 Python，不启浏览器 | 需 chromium 二进制 |
| 强项 | 轻量 · 批量并发 · `--field` 结构化定点 · 假 200 识别 | 反爬强（stealth）· 真 JS 执行 |
| 弱项 | 社区版**无真实网络栈**、反爬弱 | 重、慢 |

> 经验分工：日常"读一篇文章"用真浏览器方案更省心；**批量采集 / 要结构化字段 / 论坛列表**用本工具。

---

## 安装

```bash
python3 -m venv .venv
# 阿里云镜像（国内推荐，实测收录 iv8 0.1.4）：
.venv/bin/pip install -i https://mirrors.aliyun.com/pypi/simple/ iv8 requests
# 或官方源：
.venv/bin/pip install -i https://pypi.org/simple/ iv8 requests
```

自检：

```bash
.venv/bin/python verify_iv8.py
# 期望：版本横幅 0.1.4 · defaults count = 405 · eval/DOM/指纹全 ✓ · ALL CHECKS PASSED
```

> `iv8` 是**可选的外部专有依赖**：不装 → 脚本会打印上面的安装指令后退出（不会抛裸 `ImportError`）。

---

## 目录结构

```
iv8-web-collector/
├── SKILL.md                 # 技能描述（面向 Agent 的用法）
├── README.md                # 本文件
├── AUDIT.md                 # 安全审计记录
├── NOTICE.md                # 第三方依赖声明（iv8 = 专有，不可再分发）
├── LICENSE                  # MIT（仅覆盖本包装层）
├── verify_iv8.py            # 环境自检
└── scripts/
    ├── iv8_collect.py       # 收集器①（默认推荐，功能全）
    ├── iv8_extract.py       # 收集器① 的抽取模块（必须与 iv8_collect 同目录）
    └── web_collect.py       # 收集器②（简单快）
```

---

## 快速开始

### 收集器① `iv8_collect.py`（默认推荐）

```bash
.venv/bin/python scripts/iv8_collect.py <url1> [url2 ...] [--list urls.txt] \
  [--mode raw|run] [--field 名=CSS[@属性]] [--out collected] [--workers 4] [--harvest 2]
```

- 静态页用默认 `--mode raw`（快稳）；**JS 渲染页必须 `--mode run --harvest 2`**（子资源补齐回环），否则拿到假 200 空壳
- 产出：每页 `<域名>__<路径>__<hash8>.md` + `.json` + 目录级 `index.json`（含 stubbed 警告）
- 硬约束清单（线程绑定 / 假 200 / URL 解析坑 / 字符集）见 `SKILL.md`

### 收集器② `web_collect.py`（简单快）

```bash
.venv/bin/python scripts/web_collect.py <url1> [url2 ...] [--out 输出目录] [--keep-js] [--timeout 15]
```

- 默认剥离 `<script>`/CSS（更快更稳）；SPA 动态渲染页加 `--keep-js`（仍不行改用收集器① 的 run 模式）
- 产出：每页 `<域名-路径>.md` + `.json`，目录级 `_index.json` 汇总

---

## 实测样例

| 页面 | 模式 | 结果 |
|---|---|---|
| `example.com` | raw | 200 · 1 段 · 101 字 · 0 stubbed |
| 静态博客首页（中文） | raw | 200 · 8 段 · 0 stubbed · 编码 utf-8 ✅ |
| 新闻门户首页（中文） | raw | 200 · 280 段 / 6145 字 · 0 stubbed ✅ |
| 论坛（SPA） | **run --harvest 2** | 127 字 → **5397 字 / DOM 401 节点 / 0 stubbed / 无报错** ✅ |

> 最后一行是 run 模式的价值所在：raw 只拿到 SPA 空壳（搜索框那点字），run 模式靠真实 HTTP 把 `/api/posts`（736KB）补回来 reload，列表全出。

---

## 已知限制与坑位

1. **社区版无真实网络栈**：XHR/fetch 走离线 bundle —— 本架构是 Python 侧 `requests` 抓取、V8 只做 DOM 提取；不要在 JS 里发真实请求
2. **本机代理**可能拦外网站点（实测维基百科 502），国内站点直连正常
3. **SPA 页**：默认剥离 script 会拿到空壳，加 `--keep-js`；仍不行用收集器① 的 `--mode run --harvest`
4. **`debugger;` 被禁用**，断点用 `vdebugger;`；V8 执行期间释放 GIL，多线程可并行
5. **Context 很轻量**（约 3ms/次），每次新建即可获得干净环境，无需复用
6. **`index.json` 每次运行覆盖（非追加）** —— 多批抓取请分目录

---

## 许可

- 本仓库（包装层）：**MIT** —— 见 `LICENSE`
- `iv8`（第三方依赖，**本仓库不包含、不分发**）：`iv8 Community Edition License` —— 免费用于个人/教育/非商用；**禁止反编译**；**禁止再分发**；商用需购 Pro 授权。详见 `NOTICE.md`
- 使用前请自行阅读并遵守上游许可。仅用于收集**公开可访问**页面，不绕过登录/验证码/付费墙。

---

## 变更记录

- **2026-09-27**：修中文站整页乱码（`pick_encoding()` 四级优先）；缺依赖友好提示；`iv8_collect.py` 可从任意目录调用
- **2026-09-26**：首发（Linux 适配 + 审计留痕），`iv8 0.1.4` + `requests`，端到端自检通过
