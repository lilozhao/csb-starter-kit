"""iv8-collect — 用 iv8 的浏览器环境做网页内容收集（抓 → 建 DOM → JS 抽取 → 落盘）。

两条来自实测的硬约束（0.1.4）：
  1) JSContext 绑定创建它的线程，跨线程 eval 直接 abort 进程（不可 catch）。
     所以每个 worker 线程自建自关，上下文绝不跨线程传递。
  2) 社区版无网络栈：页面里没被 add_resource 喂过的请求不会失败，而是拿到假 200 +
     {"message":"模拟GET响应"}。所以"页面想要哪些请求"是一等输出，status==200 不算成功。
  另：iv8 的 new URL(rel, base) 解析是坏的（会吞掉 host），链接一律用 <a> 元素或 Python
     urljoin 解析。
"""
import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import re
import sys
import time
from urllib.parse import urljoin, urlparse

import requests

try:
    import iv8
except ImportError:  # 缺依赖时给出可操作提示，而不是裸 ImportError
    sys.exit(
        "❌ 缺少依赖 iv8（专有包，需自行安装；本仓库不打包其本体）：\n"
        "   python3 -m venv .venv\n"
        "   .venv/bin/pip install -i https://mirrors.aliyun.com/pypi/simple/ iv8 requests\n"
        "   （官方源：-i https://pypi.org/simple/）"
    )

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
MAX_BYTES = 8_000_000

# 允许从任意目录调用（本脚本需与 iv8_extract.py 同目录）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from iv8_extract import BODY, PROBE


def pick_encoding(r, raw):
    """决定解码字符集（[2026-09-27 修] 中文站整页乱码 bug）。

    requests 对「HTTP 头不带 charset 的 text/html」会默认塞 ISO-8859-1；
    直接拿它解码会把 UTF-8 中文解成乱码（实测：阮一峰博客标题 -> "é®ä¸å³°…"，
    而页面自带 <meta charset=UTF-8> 反被忽略）。
    优先级：HTTP 头 charset > HTML <meta charset> > 自动推断 > utf-8。
    """
    enc = requests.utils.get_encoding_from_headers(r.headers)
    # 注：requests 2.34 对「text/* 且头里未写 charset」会返回 ISO-8859-1，
    # 那是它的兜底默认值、等于「没说」——不能拿来当依据，继续往下看 HTML meta
    if enc and enc.lower() != "iso-8859-1":
        return enc
    m = re.search(rb'charset\s*=\s*["\']?\s*([a-z0-9_\-]+)', raw[:4096].lower())
    if m:
        return m.group(1).decode("ascii", "ignore") or "utf-8"
    try:
        if r.apparent_encoding:
            return r.apparent_encoding
    except Exception:
        pass
    return "utf-8"


class Http:
    def __init__(self, timeout):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"})
        self.timeout = timeout

    def get(self, url):
        r = self.s.get(url, timeout=self.timeout, allow_redirects=True)
        raw = r.content
        enc = pick_encoding(r, raw)
        return {"status": r.status_code, "url": r.url, "bytes": len(raw),
                "truncated": len(raw) > MAX_BYTES,
                # 有些页面 charset 写错，解出孤立代理项；用 errors=replace 兜住再落盘
                "encoding": enc,
                "text": raw[:MAX_BYTES].decode(enc, "replace")
                        .encode("utf-8", "replace").decode("utf-8", "replace"),
                "ctype": r.headers.get("content-type", ""),
                "headers": dict(r.headers)}


def obj(v):
    """iv8 有时把结果转成 dict（跨桥的对象），有时给 JSON 字符串，两种都接下来。"""
    if isinstance(v, (dict, list)):
        return v
    return json.loads(v) if isinstance(v, str) and v.strip() else {}


def slug(url):
    p = urlparse(url)
    name = re.sub(r"[^\w.-]+", "_", (p.path.strip("/").split("/")[-1] or "index"))[:48].strip("._") or "index"
    return f"{p.netloc}__{name or 'index'}__{hashlib.sha1(url.encode()).hexdigest()[:8]}"


def collect(url, mode, fields, timeout, prefetch, harvest):
    http = Http(timeout)
    rep = {"url": url, "mode": mode, "warnings": [], "timings": {}}
    t0 = time.perf_counter()
    page = http.get(url)
    rep["timings"]["fetch_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    rep["http_status"] = page["status"]
    base = rep["final_url"] = page["url"]
    rep["bytes"] = page["bytes"]
    rep["encoding"] = page.get("encoding")
    if page["truncated"]:
        rep["warnings"].append(f"body truncated at {MAX_BYTES} B")
    if "html" not in page["ctype"] and "xml" not in page["ctype"]:
        rep["warnings"].append(f"content-type {page['ctype']!r} is not HTML")

    ctx = iv8.JSContext(environment={"location": {"href": base}})
    try:
        t1 = time.perf_counter()
        if mode == "raw":
            ctx.expose({"html": page["text"]}, "task")
            ctx.eval("document.documentElement.innerHTML = __iv8__.data.task.html; 1")
            data = obj(ctx.eval(BODY))
            rep["scripts_in_dom"] = data["scripts"]
        else:
            data = run_passes(ctx, http, base, page["text"], rep, prefetch, harvest)
        rep["timings"]["load_ms"] = round((time.perf_counter() - t1) * 1000, 1)
        for name, sel in (fields or {}).items():
            css, _, attr = sel.partition("@")
            js = ("(function(){var e=document.querySelector(%s);return e?(%s):null;})()"
                  % (json.dumps(css),
                     "e.getAttribute(%s)||''" % json.dumps(attr) if attr else "e.textContent.trim()"))
            rep.setdefault("fields", {})[name] = ctx.eval(js)
        rep["extract"] = data
    finally:
        ctx.close()
    rep["timings"]["total_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return rep


def run_passes(ctx, http, base, html, rep, prefetch, harvest):
    """反复 page.load：每轮把页面要、但 bundle 里没有的 URL 用真实 HTTP 补进去，
    直到没有缺口。社区版对缺口不会报错，只会给假 200，所以这一步是必须的。
    注意：第二次 page.load 会清掉 window 上的自定义全局量，所以探针每轮重装。"""
    bundle, served = {}, {base, base.rstrip("/")}
    data = {}
    max_rounds = max(1, (harvest or 0) + 1)
    for rnd in range(1, max_rounds + 1):
        ctx.expose({"html": html, "resources": bundle}, "task")
        # 探针要在 page.load 之后挂：page.load 会换掉 document/window 上的自定义全局量
        lr = ctx.eval("JSON.stringify(window.__iv8__.page.load({baseURL: %s,"
                      " html: __iv8__.data.task.html, resources: __iv8__.data.task.resources}))" % json.dumps(base))
        load_report = obj(lr)
        ctx.eval(PROBE)
        ctx.eval("window.__iv8__.eventLoop.advance(800)")
        data = obj(ctx.eval(BODY))
        want = set()
        for e in (ctx.eval("window.__iv8__.netLog.entries.map(e=>e.url)", to_py=True) or []):
            if isinstance(e, str):
                want.add(urljoin(base, e))
        if prefetch:
            want.update(data.get("scripts") or [])
            want.update([u for u in (data.get("css") or []) if u])
        missing = sorted(u for u in want if u.startswith("http") and u not in served)
        got = []
        for u in missing[:20]:
            served.add(u)
            try:
                sub = http.get(u)
                body = sub["text"]
                bundle[u] = {"body": body, "status": sub["status"],
                             "headers": [["content-type", sub["ctype"]]]}
                if sub["status"] >= 400:
                    rep["warnings"].append(f"subresource {u[:80]} -> HTTP {sub['status']}")
                got.append({"url": u[:150], "status": sub["status"], "bytes": sub["bytes"]})
            except Exception as e:
                rep["warnings"].append(f"fetch failed {u[:80]}: {type(e).__name__}")
                bundle[u] = {"body": "", "status": 599, "headers": []}
        rep.setdefault("rounds", []).append({"load": load_report, "round": rnd, "dom_nodes": data["domNodes"],
                                            "chars": data["textLength"], "want": len(want),
                                            "fetched": got})
        if not missing:
            break
    leftover = sorted(u for u in want if u.startswith("http") and u not in served)
    rep["stubbed_requests"] = len(leftover)
    if leftover:
        rep["warnings"].append(
            f"{len(leftover)} page request(s) answered by iv8's built-in fake 200, values derived from "
            "them are fabricated: " + ", ".join(u[:70] for u in leftover[:3]))
    rep["bundle"] = [{"url": k[:150], "status": v["status"], "bytes": len(v["body"])} for k, v in bundle.items()]
    rep["page_events"] = obj(ctx.eval("JSON.stringify(window.__probe||{})"))
    rep["ready_state"] = ctx.eval("document.readyState")
    return data


def to_md(rep):
    d = rep["extract"]
    L = [f"# {d['title'] or '(no title)'}", ""]
    L += [f"- 来源 <{rep['url']}>", f"- 抓取 {time.strftime('%Y-%m-%d %H:%M:%S')} · 模式 {rep['mode']}"
          f" · HTTP {rep.get('http_status')} · {rep.get('bytes', 0):,} B · "
          f"编码 {rep.get('encoding') or '—'} · DOM {d.get('domNodes')} 节点",
          f"- 正文主栏 `{d.get('mainPath') or '—'}` · {d.get('textLength', 0):,} 字 · "
          f"{len(d['paragraphs'])} 段 · {len(d['links'])} 链",
          f"- 用时 fetch {rep['timings'].get('fetch_ms')}ms / 建 DOM+补齐回环 {rep['timings'].get('load_ms')}ms"
          f" / 合计 {rep['timings'].get('total_ms')}ms"]
    if rep["warnings"]:
        L += ["", "## ⚠ 注意"] + [f"- {w}" for w in rep["warnings"]]
    if rep.get("fields"):
        L += ["", "## 定点字段"] + [f"- **{k}**: {v}" for k, v in rep["fields"].items()]
    if d.get("description"):
        L += ["", f"> {d['description']}"]
    if rep.get("rounds"):
        L += ["", "## 补齐回环（每轮 reload 前从真实 HTTP 抓到的子资源）", ""]
        for r in rep["rounds"]:
            L.append(f"- 第 {r['round']} 轮：DOM {r['dom_nodes']} 节点 / {r['chars']} 字，页面共要 {r['want']} 个资源，"
                     f"本轮补 {len(r['fetched'])} 个")
            for g in r["fetched"]:
                L.append(f"  - `{g['status']}` {g['bytes']:,}B {g['url']}")
    pe = rep.get("page_events")
    if pe:
        L += ["", f"生命周期事件: {pe.get('fired')} · 页面报错: {pe.get('errors') or '无'}"]
    L += ["", "## 正文", ""]
    for p in d["paragraphs"]:
        pre = {"h1": "# ", "h2": "## ", "h3": "### ", "blockquote": "> ", "pre": "    ", "li": "- "}.get(p["tag"], "")
        L += [pre + p["text"], ""]
    if d["links"]:
        L += ["## 链接", ""] + [f"- [{l['text'] or '(无文字)'}]({l['href']})" for l in d["links"][:60]]
    if d["images"]:
        L += ["", "## 图片", ""] + [f"- ![{i['alt'] or ''}]({i['href']})" for i in d["images"][:30]]
    return "\n".join(L).rstrip() + "\n"


def main():
    ap = argparse.ArgumentParser(description="iv8 网页内容快速收集")
    ap.add_argument("urls", nargs="*")
    ap.add_argument("--list", help="每行一个 URL 的文件")
    ap.add_argument("--mode", choices=["raw", "run"], default="raw",
                    help="raw=只建 DOM 不跑脚本（快、稳）；run=page.load 走完整生命周期")
    ap.add_argument("--field", action="append", default=[], metavar="NAME=CSS[@attr]")
    ap.add_argument("--out", default="collected")
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--timeout", type=float, default=20)
    ap.add_argument("--no-prefetch", action="store_true")
    ap.add_argument("--harvest", type=int, default=2, metavar="N",
                    help="run 模式最多 reload 几轮，每轮把页面缺的请求用真实 HTTP 补进 bundle（0=只跑一遍，"
                         "那基本等于只拿到假 200）")
    ap.add_argument("--format", default="md,json")
    a = ap.parse_args()

    try:  # 控制台是 GBK，别让一次打印炸掉整轮抓取
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass

    urls = list(a.urls)
    if a.list:
        urls += [l.strip() for l in open(a.list, encoding="utf-8") if l.strip() and not l.startswith("#")]
    if not urls:
        ap.error("no urls")
    fields = {}
    for f in a.field:
        k, _, v = f.partition("=")
        fields[k] = v
    os.makedirs(a.out, exist_ok=True)
    fmts = {x.strip() for x in a.format.split(",")}
    def job(u):
        try:
            return collect(u, a.mode, fields, a.timeout, not a.no_prefetch, a.harvest)
        except Exception as e:
            return {"url": u, "mode": a.mode, "warnings": [f"{type(e).__name__}: {str(e)[:140]}"],
                    "timings": {"total_ms": 0}, "http_status": None, "bytes": 0,
                    "extract": {"title": "", "paragraphs": [], "links": [], "images": [], "textLength": 0,
                                "domNodes": 0, "headings": [], "scripts": [], "css": [], "description": "",
                                "forms": [], "buttons": [], "styleSheetsApi": "", "mainPath": None}}

    t0 = time.perf_counter()
    if a.workers > 1:
        with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
            reps = list(ex.map(job, urls))
    else:
        reps = [job(u) for u in urls]
    wall = (time.perf_counter() - t0) * 1000

    index = []
    for rep in reps:
        s = slug(rep["url"])
        if "json" in fmts:
            open(os.path.join(a.out, s + ".json"), "w", encoding="utf-8", errors="replace").write(
                json.dumps(rep, ensure_ascii=False, indent=1))
        if "md" in fmts:
            open(os.path.join(a.out, s + ".md"), "w", encoding="utf-8", errors="replace").write(to_md(rep))
        d = rep["extract"]
        index.append({"url": rep["url"], "slug": s, "mode": rep["mode"], "status": rep.get("http_status"),
                      "bytes": rep.get("bytes"), "title_len": len(d["title"]),
                      "paras": len(d["paragraphs"]), "chars": d["textLength"], "links": len(d["links"]),
                      "images": len(d["images"]), "dom_nodes": d["domNodes"],
                      "encoding": rep.get("encoding"),
                      "stubbed": rep.get("stubbed_requests", 0), "ms": rep["timings"].get("total_ms", 0),
                      "warn": rep["warnings"]})
    open(os.path.join(a.out, "index.json"), "w", encoding="utf-8", errors="replace").write(
        json.dumps(index, ensure_ascii=False, indent=1))

    print(f"{'slug':<40}{'st':>3}{'paras':>6}{'chars':>8}{'links':>6}{'stub':>5}{'ms':>7}  warn")
    for r in index:
        print(f"{r['slug'][:40]:<40}{str(r['status']):>3}{r['paras']:>6}{r['chars']:>8}{r['links']:>6}"
              f"{r['stubbed']:>5}{r['ms']:>7.0f}  {(r['warn'][0][:52] + '…') if r['warn'] else ''}")
    tot = sum(r["ms"] for r in index)
    print(f"\n{len(index)} page(s) | wall {wall:.0f} ms | sum {tot:.0f} ms | {tot / wall:.2f}x | out {a.out}/")


if __name__ == "__main__":
    main()
