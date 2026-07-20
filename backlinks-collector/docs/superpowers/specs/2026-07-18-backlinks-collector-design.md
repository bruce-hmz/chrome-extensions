# Backlinks Collector — Chrome 扩展设计

**日期**: 2026-07-18
**状态**: 已批准，待实现计划

## 目标

在反向链接分析页（Semrush 系 Intergalactic UI 表格，如 `sem.3ue.com`）上，一键抓取「反向链接」表格数据，把「源页面标题和 URL」拆成两列，支持自动翻页抓全量，结果窗按行勾选后导出 CSV。

## 非目标（YAGNI）

- 不做 XHR/API 拦截（已排除）。
- 不做 Excel/多格式（CSV 一种够用）。
- 不做结果搜索/过滤/排序（用户未要求）。
- 不做跨站点配置 UI（按当前表格结构写死选择器）。

## 架构

Manifest V3 扩展，4 个运行单元：

```
backlinks-collector/
  manifest.json     # MV3; 权限: activeTab, scripting（不声明 host 权限）
  popup.html        # 待机/抓取中/结果 三态 UI
  popup.css
  popup.js          # 状态机 + 消息收发
  content.js        # 抓取 + 翻页循环 + 进度推送 + CSV 下载
  icons/            # 16/48/128 png
```

**权限策略**：只用 `activeTab` + `scripting`。点击工具栏图标时获得当前 tab 的临时授权，注入 content script。不申请 host 权限，安装更轻、可在任意域名使用。

**方案选型**：内容脚本驱动翻页循环（方案 A）。content script 在页面侧完成「抓取 → 点下一页 → 等加载 → 重复」，每页通过消息把行推给 popup。翻页是 SPA 路由切换（不全量跳转），注入的脚本上下文持久。

### 消息协议

popup → content（经 `chrome.tabs.sendMessage`）：
- `{action: "start", scope: "all" | "page"}` — 启动抓取
- `{action: "cancel"}` — 取消
- `{action: "export", rows: [...]}` — 把选中行交给页面侧下载

content → popup（经 `chrome.runtime.sendMessage`）：
- `{action: "progress", page, totalPages, rows, accumulated}` — 本页抓完
- `{action: "done", total, truncated: boolean, reason?: string}` — 全部完成
- `{action: "error", message}` — 致命错误（如找不到表格）

## 数据模型

表格容器 `[data-test-table="backlinks"]`（或 `[data-path="backlinks.table"]`），行 `[data-test-tbody-tr]`，单元格靠 `[name="..."]` 区分。

导出 9 列：

| 导出列 | 取值 |
|---|---|
| 页面AS | `[name="ascore"]` 文本 |
| 源页面标题 | `[data-test-source-title] span` 文本 |
| 源页面URL | `[data-test-source-url]` 属性 |
| 外部链接 | `[name="externalLinks"]` 文本 |
| 内部链接 | `[name="internalLinks"]` 文本 |
| 锚文本 | `[data-test-anchor] span` 文本 |
| 目标URL | 优先 `[data-test-target-url]`，缺失用 `[data-test-redirect-url]` |
| 首次发现 | `[name="firstSeen"] [data-test-timestamp]` Unix 秒 → `YYYY-MM-DD` |
| 上次发现 | `[name="lastSeen"] [data-test-timestamp]` Unix 秒 → `YYYY-MM-DD` |

### 边界情况

- 重定向行（无 `[data-test-source-title]`）→ 源标题留空，URL 照取。
- target 同时有 redirect-url 与 target-url → 取 target-url（最终目标）。
- 日期一律用 `data-test-timestamp` 属性（秒级 epoch）转 **UTC+8（Asia/Shanghai）** `YYYY-MM-DD`，与站点显示一致；忽略「7 天前」相对文本。
- 跨页去重：key = `源URL +  + 目标URL`，兜底防重复。

## 翻页循环

- **总页数**：`totalPages = ceil(total / pageSize)`，`total` 取 `[data-test-report-title-total]`，`pageSize` = 当前页行数。
- **找「下一页」按钮**（多策略，贴的 HTML 未含分页栏，实现时按真实 DOM 复核）：
  1. `button[aria-label*="next" i]`
  2. `button[aria-label*="下一页"]`
  3. `[data-test*="paginat" i][data-test*="next" i]`
  4. `[role="navigation"]` 内最后一个非 `disabled`、非 `aria-disabled="true"` 的按钮
- **每页流程**：抓行 → 推 progress → 若 `scope=all` 且下一页可点 → 点击 → 等加载 → 重复。
- **加载检测**：点击前记 `firstKey = 首行.sourceUrl`；点击后 200ms 轮询 + MutationObserver 监听表格体；当「首行 sourceUrl ≠ firstKey 且行数 > 0」视为就绪；20s 超时则停。
- **停止条件**：下一页 disabled/不存在 ｜ 到达 totalPages ｜ 点击后首行未变（没翻动）。

## Popup UI（三态）

1. **待机**：注入前先探测表格是否存在 → 存在则显示范围开关（默认「全部页」）+「开始抓取」；不存在则提示「未检测到反向链接表格」。
2. **抓取中**：进度条 + 「第 N/M 页，已抓 X 条」+「取消」。
3. **结果**：表格列 = 勾选框 ｜ 页面AS ｜ 源标题 ｜ 源URL ｜ 锚文本 ｜ 目标URL ｜ 首次发现 ｜ 上次发现。表头全选框；底部「已选 X / 共 Y 条」+「导出 CSV」。默认全选。`truncated=true` 时顶部标注「（提前结束，未到最后一页）」。

> 结果窗只展示用于识别行的关键字段（页面AS/源标题/源URL/锚文本/目标URL/首次发现/上次发现），「外部链接/内部链接」两列不显示但**导出时仍包含**（见下文 9 列）。

## CSV 导出

- 编码 UTF-8 + BOM（`﻿`）防中文乱码。
- 每字段双引号包裹；内部 `"` 双写；字段内换行/回车转义。
- 首行表头为 9 列中文列名。
- 文件名 `backlinks_YYYYMMDD-HHmm.csv`（content script 侧 `Date.now()` 生成）。
- 下载由 content script 在页面创建 `Blob` + `<a download>` 触发（popup 可能关闭，放页面侧稳）。

## 错误处理

- 没表格 → popup 待机页直接提示，不启动。
- 翻页超时 / 找不到下一页（但 scope=all 且 totalPages>1）→ 停，保留已抓，结果页 `truncated=true` 并注明原因。
- 取消 → 在页间检查取消标志，立即停；已抓部分仍可导出。
- content script 注入失败 → popup 提示「无法注入脚本，检查页面权限」。

## 验收标准

1. 在反向链接表格页点图标 → 能抓取当前页所有行，源标题/URL 正确拆分。
2. 选「全部页」→ 自动翻页抓完所有分页，进度实时，无重复。
3. 结果窗勾选若干行 → 导出的 CSV 仅含勾选行，9 列齐全，中文无乱码，日期为 YYYY-MM-DD。
4. 重定向行、HTTP 源、相对时间日期等边界场景字段不丢不错。
5. 翻页超时/手动取消 → 已抓部分可正常导出。
