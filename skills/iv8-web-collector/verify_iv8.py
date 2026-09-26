# -*- coding: utf-8 -*-
# iv8 安装验证 + 最小示例
import iv8

print("iv8 version:", iv8.__version__ if hasattr(iv8, '__version__') else '(no attr)')
print("defaults count:", len(iv8.JSContext.get_defaults()))

with iv8.JSContext() as ctx:
    print("eval 1+2 =", ctx.eval("1 + 2"))
    print("navigator.userAgent =", ctx.eval("navigator.userAgent"))
    print("navigator.webdriver =", ctx.eval("navigator.webdriver"))

    ctx.eval("""
        window.__iv8__.page.load({
            baseURL: 'https://example.com',
            html: '<html><body><div id="app">Hello</div></body></html>'
        });
    """)
    print("DOM textContent =", ctx.eval('document.getElementById("app").textContent'))

print("ALL CHECKS PASSED")
