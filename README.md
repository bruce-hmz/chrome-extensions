# Chrome Extensions

Chrome 扩展插件库。每个子目录是一个独立、自包含的插件（各自的 `manifest.json`、源码与依赖）。

## 插件列表

| 插件 | 说明 |
| --- | --- |
| [backlinks-collector](./backlinks-collector) | 抓取反向链接表格，拆分标题/URL，自动翻页，勾选导出 CSV |

## 目录约定

- `<plugin-name>/manifest.json` — 插件清单（Manifest V3）
- `<plugin-name>/README.md` — 该插件自身的说明
- 源码、测试、依赖均在各自子目录内

进入对应子目录查看各插件的安装与使用方式。新增插件时，在本表追加一行即可。
