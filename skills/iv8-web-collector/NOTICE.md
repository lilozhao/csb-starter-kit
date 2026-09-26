# NOTICE / 第三方依赖声明

## 本仓库包含什么

本仓库只包含 **包装层（packaging layer）**：

- `SKILL.md` — skill 描述（面向 Agent 的用法）
- `scripts/iv8_collect.py` · `scripts/iv8_extract.py` · `scripts/web_collect.py` — 收集器
- `verify_iv8.py` — 环境自检
- `README.md` — 说明

这部分以 **MIT** 许可发布（见 `LICENSE`）。

## 本仓库**不包含**什么（重要）

**本仓库不分发 `iv8` 本体，也不包含其任何源码、二进制、文档或示例。**

`iv8` 是一个 **独立的、专有的第三方依赖**，需由使用者自行安装：

```bash
python -m pip install iv8 requests
```

## iv8 的许可（使用前请自行阅读并遵守）

`iv8 Community Edition License`（Copyright (c) 2025 iv8 Authors）要点：

- 免费用于**个人 / 教育 / 非商业**用途；
- **禁止**反向工程、反编译、反汇编或试图导出其源码；
- **禁止**再分发、再许可或销售其副本（无论是否修改），除非事先获得书面许可；
- 商业使用 / OEM 嵌入 / 企业部署需另行取得 Pro 商业授权；
- 不得移除或修改其版权与许可声明。

- 上游：https://github.com/HanZzzzz000/iv8  （Gitee 镜像：https://gitee.com/hobinleon/iv8 ）
- 本包装层作者不对 `iv8` 本体做任何担保，也不代表其权利人。

## 边界

本工具仅用于收集**公开可访问**页面；不绕过登录、验证码或付费墙。批量抓取同一站点时请遵守目标站点的 robots 精神与频率限制。
