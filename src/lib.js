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
    return '﻿' + lines.join('\r\n');
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

  const BC = { CSV_HEADERS, epochToDate, rowsToCsv, dedupe };

  if (typeof module !== 'undefined' && module.exports) module.exports = BC;
  root.BC = BC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
