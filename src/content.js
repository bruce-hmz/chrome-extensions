(function () {
  'use strict';
  const BC = globalThis.BC;
  if (!BC) {
    // lib.js 未先注入，忽略
    return;
  }

  let cancelled = false;
  let running = false;

  function send(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch (e) { /* popup 可能已关闭，忽略 */ }
  }

  function nextButtonEnabled() {
    const btn = BC.findNextButton(document);
    return (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') ? btn : null;
  }

  async function run(scope) {
    cancelled = false;
    const all = [];
    let page = 0;
    let totalPages = 1;
    let truncated = false;
    let reason = '';

    while (true) {
      if (cancelled) { truncated = true; reason = '用户取消'; break; }

      const { rows, total } = BC.extractPage(document);
      page += 1;
      if (page === 1 && rows.length) {
        totalPages = Math.max(1, Math.ceil(total / rows.length));
      } else if (page === 1) {
        totalPages = 1;
      }
      for (const r of rows) all.push(r);
      send({ action: 'progress', page, totalPages, accumulated: all.length });

      if (scope !== 'all') break;
      const btn = nextButtonEnabled();
      if (!btn) break;
      if (totalPages && page >= totalPages) break;

      const prevFirstKey = rows.length ? rows[0].sourceUrl : '';
      btn.click();
      const advanced = await BC.waitForNextPage(prevFirstKey, 20000, () => cancelled);
      if (!advanced) {
        truncated = true;
        reason = cancelled ? '用户取消' : '翻页超时';
        break;
      }
    }

    const finalRows = BC.dedupe(all);
    send({ action: 'done', rows: finalRows, total: finalRows.length, truncated, reason });
    running = false;
  }

  function downloadCsv(rows) {
    const csv = BC.rowsToCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
      + '-' + pad(d.getHours()) + pad(d.getMinutes());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backlinks_' + stamp + '.csv';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // 只注册一次监听，避免重复注入
  if (!globalThis.__bcListenerAdded) {
    globalThis.__bcListenerAdded = true;
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
      if (!msg || !msg.action) return false;
      if (msg.action === 'start') {
        if (running) { reply({ ok: false, error: 'already running' }); return false; }
        running = true;
        run(msg.scope === 'page' ? 'page' : 'all').catch((e) => {
          running = false;
          send({ action: 'error', message: String((e && e.message) || e) });
        });
        reply({ ok: true });
      } else if (msg.action === 'cancel') {
        cancelled = true;
        reply({ ok: true });
      } else if (msg.action === 'export') {
        downloadCsv(Array.isArray(msg.rows) ? msg.rows : []);
        reply({ ok: true });
      }
      return false;
    });
  }
})();
