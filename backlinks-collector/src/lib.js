(function (root) {
  'use strict';

  // 9 个导出列：key=行字段，label=结果表表头(短)，header=CSV 表头(全称)。
  // 默认顺序即此数组顺序；popup 可拖拽重排，并把重排后的 columns 传给 rowsToCsv。
  const COLUMNS = [
    { key: 'ascore', label: 'AS', header: '页面AS' },
    { key: 'sourceTitle', label: '源标题', header: '源页面标题' },
    { key: 'sourceUrl', label: '源URL', header: '源页面URL' },
    { key: 'externalLinks', label: '外部', header: '外部链接' },
    { key: 'internalLinks', label: '内部', header: '内部链接' },
    { key: 'anchor', label: '锚文本', header: '锚文本' },
    { key: 'targetUrl', label: '目标URL', header: '目标URL' },
    { key: 'firstSeen', label: '首次', header: '首次发现' },
    { key: 'lastSeen', label: '上次', header: '上次发现' },
  ];
  const CSV_HEADERS = COLUMNS.map((c) => c.header);

  function epochToDate(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return '';
    // 站点按 UTC+8 显示日期；加 8h 后取 ISO 日期，等价于 UTC+8 墙钟日期
    return new Date(n * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  // columns 可选；不传用默认 COLUMNS（9 列）。传空数组则只有 BOM。
  function rowsToCsv(rows, columns) {
    const cols = columns || COLUMNS;
    const lines = [cols.map((c) => csvCell(c.header)).join(',')];
    for (const r of rows) {
      lines.push(cols.map((c) => csvCell(r[c.key])).join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  // \u9ED8\u8BA4\u5BFC\u51FA\u6587\u4EF6\u540D(\u4E3B\u540D)\uFF1Abacklinks_YYYYMMDD-HHMM\uFF0CUTC+8 \u53E3\u5F84\u4E0E epochToDate \u4E00\u81F4
  function defaultFilename() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return 'backlinks_' + d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate())
      + '-' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes());
  }

  // \u6E05\u7406\u7528\u6237\u8F93\u5165\u7684\u6587\u4EF6\u540D(\u4E3B\u540D\uFF0C\u4E0D\u542B\u6269\u5C55\u540D)\uFF1A\u5220 Windows \u975E\u6CD5\u5B57\u7B26\u3001\u53BB\u5C3E\u90E8\u91CD\u590D .csv\uFF1B\u7A7A\u5219\u56DE\u9000\u9ED8\u8BA4\u540D\u3002
  function sanitizeFilename(name) {
    let s = String(name == null ? '' : name).trim();
    if (!s) return defaultFilename();
    s = s.replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\.csv$/i, '');
    return s || defaultFilename();
  }

  function dedupe(rows) {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const k = r.sourceUrl || '';
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  }

  function cellText(tr, name) {
    const c = tr.querySelector('[name="' + name + '"]');
    return c ? c.textContent.trim() : '';
  }

  function extractRow(tr) {
    const sourceCell = tr.querySelector('[name="source"]');
    const targetCell = tr.querySelector('[name="target"]');
    const titleEl = sourceCell && sourceCell.querySelector('[data-test-source-title] span');
    const sourceUrlEl = sourceCell && sourceCell.querySelector('[data-test-source-url]');
    const anchorEl = targetCell && targetCell.querySelector('[data-test-anchor] span');
    const targetUrlEl = targetCell && targetCell.querySelector('[data-test-target-url]');
    const redirectUrlEl = targetCell && targetCell.querySelector('[data-test-redirect-url]');
    const firstTs = tr.querySelector('[name="firstSeen"] [data-test-timestamp]');
    const lastTs = tr.querySelector('[name="lastSeen"] [data-test-timestamp]');
    return {
      ascore: cellText(tr, 'ascore'),
      sourceTitle: titleEl ? titleEl.textContent.trim() : '',
      sourceUrl: sourceUrlEl ? sourceUrlEl.getAttribute('data-test-source-url') : '',
      externalLinks: cellText(tr, 'externalLinks'),
      internalLinks: cellText(tr, 'internalLinks'),
      anchor: anchorEl ? anchorEl.textContent.trim() : '',
      targetUrl: (targetUrlEl && targetUrlEl.getAttribute('data-test-target-url'))
        || (redirectUrlEl && redirectUrlEl.getAttribute('data-test-redirect-url'))
        || '',
      firstSeen: epochToDate(firstTs ? firstTs.getAttribute('data-test-timestamp') : ''),
      lastSeen: epochToDate(lastTs ? lastTs.getAttribute('data-test-timestamp') : ''),
    };
  }

  function extractPage(root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc) return { rows: [], total: 0 };
    const table = doc.querySelector('[data-test-table="backlinks"]')
      || doc.querySelector('[data-path="backlinks.table"]');
    if (!table) return { rows: [], total: 0 };
    const rows = Array.from(table.querySelectorAll('[data-test-tbody-tr]')).map(extractRow);
    const totalEl = doc.querySelector('[data-test-report-title-total]');
    const total = totalEl ? parseInt(totalEl.textContent.trim(), 10) : rows.length;
    return { rows, total: Number.isFinite(total) ? total : rows.length };
  }

  function isBtnEnabled(b) {
    return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  }

  function findNextButton(root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    const selectors = [
      // Semrush/Intergalactal 命名属性约定（优先，最稳）
      '[data-test-pagination-next-btn]',
      '[data-ui-name="Pagination.NextPage"]',
      'button[aria-label*="next page" i]',
      'button[aria-label*="next" i]',
      'button[aria-label*="下一页"]',
      '[data-test*="paginat" i][data-test*="next" i]',
    ];
    for (const sel of selectors) {
      const hit = Array.from(doc.querySelectorAll(sel)).find(isBtnEnabled);
      if (hit) return hit;
    }
    const nav = doc.querySelector('[role="navigation"]');
    if (nav) {
      const btns = Array.from(nav.querySelectorAll('button')).filter(isBtnEnabled);
      if (btns.length) return btns[btns.length - 1];
    }
    return null;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // 点击下一页后，等表格真正加载完成。SPA 翻页会经过「骨架/部分渲染 → 满页」过程，
  // 若只在首行一变化就返回，会在表格没加载完时误判，抓到空/旧数据。
  // 因此：先等首行出现新 URL（新数据到达），再等连续 STABLE_POLLS 次轮询
  // 「行数+首行」都不变，才视为加载完成。
  async function waitForNextPage(prevFirstKey, timeoutMs, isCancelled) {
    const start = Date.now();
    const POLL_MS = 200;
    const STABLE_POLLS = 3;
    let seen = false;
    let stableCount = 0;
    let lastSig = '';
    while (Date.now() - start < timeoutMs) {
      if (isCancelled && isCancelled()) return false;
      await sleep(POLL_MS);
      const { rows } = extractPage();
      const first = rows.length ? rows[0].sourceUrl : '';
      const sig = rows.length + '|' + first;
      if (!seen) {
        if (rows.length && first && first !== prevFirstKey) { seen = true; lastSig = sig; stableCount = 0; }
      } else if (sig === lastSig) {
        if (++stableCount >= STABLE_POLLS) return true;
      } else {
        stableCount = 0;
        lastSig = sig;
      }
    }
    return false;
  }

  const BC = { COLUMNS, CSV_HEADERS, epochToDate, rowsToCsv, defaultFilename, sanitizeFilename, dedupe, extractRow, extractPage, findNextButton, waitForNextPage };

  if (typeof module !== 'undefined' && module.exports) module.exports = BC;
  root.BC = BC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
