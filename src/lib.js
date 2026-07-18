(function (root) {
  'use strict';

  const CSV_HEADERS = [
    '页面AS', '源页面标题', '源页面URL', '外部链接', '内部链接',
    '锚文本', '目标URL', '首次发现', '上次发现',
  ];

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

  function rowsToCsv(rows) {
    const lines = [CSV_HEADERS.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push([
        r.ascore, r.sourceTitle, r.sourceUrl, r.externalLinks,
        r.internalLinks, r.anchor, r.targetUrl, r.firstSeen, r.lastSeen,
      ].map(csvCell).join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
  }

  function dedupe(rows) {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const k = (r.sourceUrl || '') + '\n' + (r.targetUrl || '');
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

  const BC = { CSV_HEADERS, epochToDate, rowsToCsv, dedupe, extractRow, extractPage, findNextButton };

  if (typeof module !== 'undefined' && module.exports) module.exports = BC;
  root.BC = BC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
