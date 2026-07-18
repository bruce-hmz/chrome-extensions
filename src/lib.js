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

  const BC = { CSV_HEADERS, epochToDate, rowsToCsv, dedupe, extractRow, extractPage, findNextButton, waitForNextPage };

  if (typeof module !== 'undefined' && module.exports) module.exports = BC;
  root.BC = BC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
