"""抽取函数单独放这里，便于阅读；iv8_collect.py 启动时读入。
页面内容不以 <p> 为单位（论坛、卡片流、后台页大多是 div/li + 无链接的 onclick 行），
所以这里先取「最大文本叶」，再从 body 往下贪心下降找正文主栏。
"""
BODY = r"""
(function () {
  var BLOCKISH = 'p,div,li,ul,ol,td,th,tr,h1,h2,h3,h4,h5,h6,section,article,blockquote,pre,table,tbody,dl,dt,dd,main,form,figure';
  var SKIP_TAG = {SCRIPT:1, STYLE:1, NOSCRIPT:1, TEXTAREA:1, OPTION:1, SELECT:1, INPUT:1,
                  HEAD:1, META:1, TITLE:1, LINK:1, TEMPLATE:1, SVG:1, PATH:1, BR:1};
  var CHROME_TAG = {NAV:1, HEADER:1, FOOTER:1, ASIDE:1, FORM:1};
  function txt(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function abs(u) { if (!u) return null; var a = document.createElement('a'); a.href = u;
                    return /^https?:/i.test(a.href) ? a.href : null; }

  var all = Array.prototype.slice.call(document.body ? document.body.querySelectorAll('*') : []);
  var leaves = [];
  all.forEach(function (el) {
    if (SKIP_TAG[el.tagName]) return;
    if (el.querySelector(BLOCKISH)) return;
    var t = txt(el);
    if (t.length < 3 || t.length > 1500) return;
    leaves.push({ el: el, text: t });
  });
  var leafEls = new Set(leaves.map(function (L) { return L.el; }));
  var leafSet = leaves.filter(function (L) { return !leafEls.has(L.el.parentElement); });
  leafSet.forEach(function (L) { L.weight = L.el.closest ? (L.el.closest('a') ? 0.5 : 1) : 1; });
  function inChrome(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (CHROME_TAG[n.tagName]) return true;
    }
    return false;
  }
  leafSet = leafSet.filter(function (L) { return !inChrome(L.el); });
  function scoreSub(el) {
    var s = 0, n = 0;
    leafSet.forEach(function (L) {
      if (el === L.el || el.contains(L.el)) { s += L.text.length * L.weight; n++; }
    });
    return { s: s, n: n };
  }

  // 贪心下降：只要某个子节点的文本量占父节点 55% 以上，就钻进它
  var node = document.body, path = ['body'], guard = 0;
  while (node && guard++ < 25) {
    var cur = scoreSub(node);
    if (cur.n < 3 || cur.s < 120) break;
    var bestChild = null, bestScore = 0;
    Array.prototype.forEach.call(node.children, function (c) {
      if (SKIP_TAG[c.tagName] || CHROME_TAG[c.tagName]) return;
      var sc = scoreSub(c);
      if (sc.s > bestScore) { bestScore = sc.s; bestChild = c; }
    });
    if (!bestChild || bestScore < cur.s * 0.55) break;
    node = bestChild;
    path.push(node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') +
              (node.className ? '.' + String(node.className).trim().split(/\s+/)[0] : ''));
  }
  var paras = [], seen = {};
  leafSet.forEach(function (L) {
    if (node === L.el || node.contains(L.el)) {
      var t = L.text;
      if (!seen[t]) { seen[t] = 1; paras.push({ tag: L.el.tagName.toLowerCase(),
        cls: String(L.el.className || '').slice(0, 40), text: t }); }
    }
  });
  // 主栏没抓到东西时退回整页，别交白卷
  if (!paras.length) {
    leafSet.forEach(function (L) {
      if (!seen[L.text]) { seen[L.text] = 1; paras.push({ tag: L.el.tagName.toLowerCase(),
        cls: String(L.el.className || '').slice(0, 40), text: L.text }); }
    });
    path = ['body(fallback)'];
  }

  function list(sel, map) {
    return Array.prototype.slice.call(document.querySelectorAll(sel), 0, 300).map(map)
      .filter(function (x) { return x && (x.text || x.href || x.src); });
  }
  var out = {};
  var md = document.querySelector('meta[name="description"], meta[property="og:description"]');
  out.url = location.href;
  out.title = txt(document.querySelector('title')) || txt(document.querySelector('h1'));
  out.description = md ? (md.getAttribute('content') || '').trim() : '';
  out.headings = list('h1,h2,h3', function (h) { return { tag: h.tagName.toLowerCase(), text: txt(h) }; });
  out.links = list('a[href]', function (a) { return { text: txt(a).slice(0, 100), href: abs(a.getAttribute('href')) }; });
  out.images = list('img[src],img[data-src]', function (i) {
    return { alt: i.getAttribute('alt') || '', href: abs(i.getAttribute('src') || i.getAttribute('data-src')) }; });
  out.scripts = Array.prototype.slice.call(document.querySelectorAll('script[src]'))
    .map(function (s) { return s.src; }).filter(function (u) { return /^https?:/i.test(u); });
  out.css = list('link[rel~="stylesheet"][href]', function (l) { return { href: abs(l.getAttribute('href')) }; })
    .map(function (x) { return x.href; });
  out.styleSheetsApi = document.styleSheets === null ? 'null' : String(document.styleSheets.length);
  out.forms = Array.prototype.slice.call(document.querySelectorAll('input[name],select[name],textarea[name]'))
    .slice(0, 60).map(function (el) { return el.tagName.toLowerCase() + ':' + el.getAttribute('name'); });
  out.buttons = list('button,[role="button"]', function (b) { return { text: txt(b) }; }).map(function (x) { return x.text; });
  out.mainPath = path.join(' > ');
  out.mainScore = Math.round(paras.reduce(function (a, p) { return a + p.text.length; }, 0));
  out.paragraphs = paras.slice(0, 500);
  out.textLength = out.mainScore;
  out.allLeafCount = leafSet.length;
  out.domNodes = document.getElementsByTagName('*').length;
  return JSON.stringify(out);
})()
"""

PROBE = r"""
window.__probe = { fired: [], errors: [] };
document.addEventListener('DOMContentLoaded', function () { window.__probe.fired.push('DOMContentLoaded'); });
window.addEventListener('load', function () { window.__probe.fired.push('load'); });
window.addEventListener('error', function (e) { window.__probe.errors.push(String(e.message).slice(0, 160)); });
"""
