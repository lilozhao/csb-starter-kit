# AUDIT.md · iv8-web-collector（安全审计记录）

- 初审：2026-09-26 · 若琢 🌸
- 复审/修复记录：2026-09-27 · 若琢 🌸
- 风险等级：🟡 **中低** —— 代码本体干净；三条附条件见文末
- 审批：社区发起人（2026-09-26 批准安装；2026-09-27 批准修复与发布整理）

---

## 1. 它是什么

用 **iv8**（Python 内嵌 V8 + 模拟浏览器环境，**不启动真实浏览器**）做 DOM 级正文提取 → Markdown/JSON。两个收集器：
`iv8_collect.py`（推荐；`--field` 定点字段 + JS 渲染页子资源补齐回环 + 假 200 识别）· `web_collect.py`（简单快）。

## 2. 代码审查（三收集器主体）

| 检查项 | 结果 |
|---|---|
| curl/wget 到未知 URL | ❌ 无（只有 `requests.get(用户传入的 URL)`） |
| 外发数据到外部服务器 | ❌ 无固定外发端点 |
| 索要凭证 / token / API key | ❌ 无 |
| 读 `~/.ssh` `~/.aws` `~/.config` | ❌ 无 |
| 访问 MEMORY / USER / SOUL / IDENTITY | ❌ 无 |
| base64 / 混淆代码 | ❌ 无 |
| `eval()` / `exec()` 处理外部输入 | ⚠️ 有 `ctx.eval(...)`，但那是 **iv8 自带 JSContext API**（沙箱内执行 JS），非可疑用法 |
| 修改 workspace 外系统文件 | ❌ 无（写盘仅在 `--out` 输出目录） |
| 网络调用到 IP 而非域名 | ❌ 无 |
| subprocess / os.system | ❌ 无 |

## 3. 权限范围

- 读：用户传入 URL 的 HTML（公开页面）
- 写：`--out` 指定目录（默认 `collected/`）
- 网络：仅域名访问，目的 URL 由调用方给定
- 命令：无 shell 调用

## 4. ⚠️ 三条附条件（发布前必须保持）

1. **上游 `iv8/` 目录携带反爬示例**（抖音 `abogus` / 京东 `h5st` / 滑块 `tdc` / 海关 / 税务等）——属上游库 demo，**本 skill 主流程未调用**；但能力面偏"绕反爬"，与本 skill 自声明的「不绕登录/验证码」边界有张力。⇒ **不得随本 skill 发布**（本仓库不含该目录；请勿自行复制进来）。
2. **`iv8` 许可为专有**：禁止反编译；**禁止再分发**；商用需购 Pro。⇒ 本仓库**只依赖、不打包** iv8 本体与文档；使用者须自行 `pip install`。**不要把 `.venv/` 或 iv8 的 wheel/源码入仓。**
3. **本机/宿主环境适配**：文档不得写死单机路径；命令须在 Linux/macOS/Windows 通用（本版已重写）。

## 5. 验证记录

- 环境：Python venv + `iv8 0.1.4` + `requests`
- `verify_iv8.py` → **ALL CHECKS PASSED**（版本横幅 / DOM / userAgent / `webdriver=False` / textContent）
- 端到端：`iv8_collect.py https://example.com` → 200 · 1 段 · 101 字 · 0 stubbed ✅
- 回归（2026-09-27）：中文博客 ✅ · 中文新闻门户 ✅ · SPA 论坛 `--mode run --harvest 2` → 127 字 → **5397 字 / DOM 401 节点 / 0 stubbed** ✅

## 6. 后续修复记录（2026-09-27）

**a) 中文站整页乱码（真 bug）**

- 现象：抓中文博客全页乱码，标题出 `é®ä¸å³°…`（应为「阮一峰…」）；`--field` 抽取同样乱码
- 根因：`iv8_collect.py` 直接 `raw.decode(r.encoding)`。requests（2.34）的 `get_encoding_from_headers()` 对「`text/*` 且头里未写 charset」**返回 `ISO-8859-1` 兜底值（不是 `None`）** ⇒ UTF-8 字节被按 latin-1 解；页面自带 `<meta charset>` 与 `apparent_encoding` 均未被使用
- 修复：新增 `pick_encoding()` —— 优先级 **HTTP 头 charset（排除 ISO-8859-1 兜底值）> `<meta charset>` > `apparent_encoding` > `utf-8`**；实际编码写入产出（`.json` / `index.json` / `.md` 元信息头）便于核对
- 残留：GBK 页面路径**未实测**（手边候选站均已是 utf-8；meta 分支已按 utf-8 值验证）

**b) 工程加固**

- 缺依赖不再抛裸 `ImportError`，改为打印可操作的安装指令
- `iv8_collect.py` 增加 `sys.path.insert(0, 脚本目录)`，**可从任意目录调用**（不再强制 `cd scripts`）

## 7. 结论

**🟡 通过（附条件）**：代码本体低危、可运行；条件为
（a）不打包/不再分发 `iv8` 本体与上游资料；
（b）发布版仅含自研包装层，并声明 `iv8` 为其外部依赖及许可约束。

*审计者：若琢 🌸*
