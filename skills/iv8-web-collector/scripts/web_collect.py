# -*- coding: utf-8 -*-
"""
web_collect.py — 基于 iv8 的快速网页内容收集器
用法:
  python web_collect.py <url> [url2 ...] [--out DIR] [--keep-js] [--timeout 15]

原理:
  1. Python 侧 requests 抓 HTML（iv8 社区版无真实网络栈，抓取在 Python 完成）
  2. iv8 JSContext 加载页面（流式解析 + DOM 构建）
  3. JS 在浏览器环境里提取: 标题/描述/正文/标题大纲/链接/图片
  4. 输出 markdown + JSON 到 --out 目录（默认 ./collected）

可选:
  --keep-js   保留页面 <script>（默认剥离，纯内容收集更快更稳）
  --timeout   requests 超时秒数（默认 15）
"""
import argparse
import hashlib
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
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

HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# 提取脚本：一次性拿全页面结构化信息
EXTRACT_JS = r"""
(function () {
  function txt(el) { return el ? el.innerText.trim() : ''; }
  var meta = function (name) {
    var m = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
    return m ? m.getAttribute('content') : '';
  };

  // 正文启发式：取 innerText 最长的内容容器
  var best = document.body, bestLen = 0;
  var candidates = document.querySelectorAll('article, main, [role="main"], .content, #content, .article, .post, .entry-content');
  candidates.forEach(function (el) {
    var t = el.innerText || '';
    if (t.length > bestLen) { bestLen = t.length; best = el; }
  });
  if (bestLen < 200) {
    document.querySelectorAll('div, section').forEach(function (el) {
      var t = el.innerText || '';
      if (t.length > bestLen && el.children.length > 0) { bestLen = t.length; best = el; }
    });
  }

  // 标题大纲
  var outline = [];
  document.querySelectorAll('h1, h2, h3').forEach(function (h) {
    var t = h.innerText.trim();
    if (t) outline.push({ level: parseInt(h.tagName[1]), text: t.slice(0, 120) });
  });

  // 链接（去重、绝对化）
  var seen = {}, links = [];
  document.querySelectorAll('a[href]').forEach(function (a) {
    var href = a.href; if (!href || !/^https?:/.test(href)) return;
    if (seen[href]) return; seen[href] = 1;
    var text = a.innerText.trim().replace(/\s+/g, ' ');
    if (text) links.push({ text: text.slice(0, 100), href: href });
  });

  // 图片
  var imgs = [];
  document.querySelectorAll('img[src]').forEach(function (im) {
    if (im.src && /^https?:/.test(im.src)) imgs.push(im.src);
  });

  return JSON.stringify({
    title: document.title || '',
    description: meta('description') || meta('og:description') || '',
    mainText: txt(best).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').slice(0, 50000),
    outline: outline.slice(0, 80),
    links: links.slice(0, 120),
    images: Array.from(new Set(imgs)).slice(0, 40),
    textLength: bestLen
  });
})();
"""

SCRIPT_TAG = re.compile(r'<script\b[^>]*>[\s\S]*?</script>|<script\b[^>]*/?>', re.I)
LINK_CSS = re.compile(r'<link\b[^>]*rel=["\']?stylesheet["\']?[^>]*>', re.I)
NOSCRIPT = re.compile(r'<noscript\b[^>]*>[\s\S]*?</noscript>', re.I)


def fetch(url, timeout):
    resp = requests.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    enc = resp.apparent_encoding or 'utf-8'
    if resp.encoding and resp.encoding.lower() not in ('iso-8859-1',):
        text = resp.text
    else:
        text = resp.content.decode(enc, errors='replace')
    return text, dict(resp.headers), resp.status_code


def clean_html(html, keep_js=False):
    if not keep_js:
        html = SCRIPT_TAG.sub('', html)
        html = LINK_CSS.sub('', html)
    html = NOSCRIPT.sub('', html)
    return html


def extract(url, html, keep_js=False):
    cleaned = clean_html(html, keep_js)
    with iv8.JSContext() as ctx:
        ctx.eval("""
            window.__iv8__.page.load({
                baseURL: %s,
                html: %s
            });
        """ % (json.dumps(url), json.dumps(cleaned)))
        raw = ctx.eval(EXTRACT_JS)
    return json.loads(raw)


def collect_one(url, out_dir, keep_js, timeout):
    parsed = urlparse(url)
    if not parsed.scheme:
        url = 'https://' + url
        parsed = urlparse(url)
    slug = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff]+', '-', parsed.netloc + parsed.path).strip('-')[:80]
    slug = slug or hashlib.md5(url.encode()).hexdigest()[:12]

    t0 = __import__('time').time()
    html, headers, status = fetch(url, timeout)
    fetch_ms = int((__import__('time').time() - t0) * 1000)

    t1 = __import__('time').time()
    data = extract(url, html, keep_js)
    render_ms = int((__import__('time').time() - t1) * 1000)

    data.update({'url': url, 'status': status, 'fetch_ms': fetch_ms, 'render_ms': render_ms})

    # markdown
    md = [f"# {data['title'] or url}", '',
          f"> 来源: {url}  ", f"> 抓取 {fetch_ms}ms + 渲染提取 {render_ms}ms · 正文 {data['textLength']} 字", '']
    if data['description']:
        md += [data['description'], '']
    if data['outline']:
        md.append('## 大纲')
        md += [f"{'#' * h['level']} {h['text']}" for h in data['outline'][:20]]
        md.append('')
    md += ['## 正文', data['mainText'] or '(未提取到正文)', '']
    if data['links']:
        md.append('## 链接 (' + str(len(data['links'])) + ')')
        md += [f"- [{l['text']}]({l['href']})" for l in data['links'][:50]]
        md.append('')
    if data['images']:
        md.append('## 图片')
        md += [f"![]({u})" for u in data['images']]
        md.append('')

    os.makedirs(out_dir, exist_ok=True)
    md_path = os.path.join(out_dir, slug + '.md')
    json_path = os.path.join(out_dir, slug + '.json')
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    return data, md_path, json_path


def main():
    ap = argparse.ArgumentParser(description='iv8 快速网页内容收集器')
    ap.add_argument('urls', nargs='+')
    ap.add_argument('--out', default='collected')
    ap.add_argument('--keep-js', action='store_true', help='保留页面脚本（JS 渲染页用）')
    ap.add_argument('--timeout', type=int, default=15)
    args = ap.parse_args()

    print(f"收集 {len(args.urls)} 个页面 → {args.out}/\n")
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(collect_one, u, args.out, args.keep_js, args.timeout): u for u in args.urls}
        for fut in as_completed(futures):
            u = futures[fut]
            try:
                data, md_path, json_path = fut.result()
                results.append(data)
                print(f"✅ {u}")
                print(f"   「{data['title']}」 正文 {data['textLength']} 字 · 链接 {len(data['links'])} · 图片 {len(data['images'])} · 总耗时 {data['fetch_ms']}+{data['render_ms']}ms")
                print(f"   → {md_path}")
            except Exception as e:
                print(f"❌ {u} — {type(e).__name__}: {e}")

    # 汇总索引
    if results:
        idx = os.path.join(args.out, '_index.json')
        with open(idx, 'w', encoding='utf-8') as f:
            json.dump([{k: r[k] for k in ('url', 'title', 'description', 'textLength', 'fetch_ms', 'render_ms')} for r in results],
                      f, ensure_ascii=False, indent=1)
        print(f"\n索引: {idx}")


if __name__ == '__main__':
    main()
