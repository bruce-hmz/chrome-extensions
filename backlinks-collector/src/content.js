(function () {
  'use strict';
  const BC = globalThis.BC;
  if (!BC) {
    // lib.js 未先注入，忽略
    return;
  }

  let cancelled = false;
  let running = false;
  // 常驻 content script：用户可能在上一次抓取未干净结束（导航中断/异常）时再次点"开始抓取"。
  // 用 token 让新 run() 作废旧 run()，避免旧的异步循环仍在跑导致结果串扰/running 死锁。
  let runToken = 0;

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

  // 从翻页控件提取站点自己渲染的总页数（比 total/rows.length 算术可靠得多）。
  // 该站翻页按钮文本用 <span data-ui-name="ButtonLink.Text">N</span> 渲染页码，
  // 取其中最大数字即总页数。抓不到时回退到 aria-label/"1 / 20" 文本，再抓不到返回 0。
  function detectTotalPages() {
    // 1) 优先：翻页按钮组里的页码（ButtonLink.Text），取最大值
    const nums = Array.from(document.querySelectorAll('[data-ui-name="ButtonLink.Text"]'))
      .map((el) => parseInt(el.textContent.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length) return Math.max(...nums);

    // 2) 兜底：aria-label="Page X of Y" / "第 X 页，共 Y 页"
    const labeled = Array.from(document.querySelectorAll('[aria-label]')).find((el) => {
      const s = el.getAttribute('aria-label') || '';
      return /\b(of|\/|共|，)\s*\d+\b/i.test(s) || /页.*共.*\d+/i.test(s);
    });
    if (labeled) {
      const m = labeled.getAttribute('aria-label').match(/(\d+)\s*(?:of|\/|共)\s*(\d+)/i)
        || labeled.getAttribute('aria-label').match(/共\s*(\d+)\s*页/i);
      if (m) return Number(m[2]);
    }

    // 3) 兜底：翻页区形如 "1 / 20" 的文本
    const nav = document.querySelector('[role="navigation"]')
      || document.querySelector('[class*="agination" i]');
    if (nav) {
      const text = nav.textContent.replace(/\s+/g, ' ').trim();
      const m = text.match(/(?:^|[^\d])(\d{1,4})\s*\/\s*(\d{1,4})(?![\d])/);
      if (m) return Number(m[2]);
    }
    return 0;
  }

  async function run(scope, token) {
    cancelled = false;
    const all = [];
    let page = 0;
    let totalPages = 0; // 0 = 未知（站点未渲染总页数时用，仅影响进度展示，不影响翻页）
    let pageSize = 0;  // 首页行数，用于 total→页数 的兜底换算
    let truncated = false;
    let reason = '';

    while (true) {
      // token 不匹配说明有更新的 run() 接管，本循环作废、静默退出（不发 done）
      if (token !== runToken) { console.log('[BC] run 退出(被取代) token', token); return; }
      if (cancelled) { truncated = true; reason = '用户取消'; break; }

      const { rows, total } = BC.extractPage(document);
      page += 1;
      if (page === 1) pageSize = rows.length;
      // 总页数：优先用站点翻页控件渲染的值（最准），抓不到再用 total/pageSize 兜底。
      // 每页都尝试更新（SPA 翻页后控件才出现/更新）。
      const detected = detectTotalPages();
      if (detected) totalPages = detected;
      else if (pageSize && total > pageSize) totalPages = Math.ceil(total / pageSize);

      for (const r of rows) all.push(r);
      send({ action: 'progress', page, totalPages, accumulated: all.length });
      console.log('[BC] page', page, '抓到', rows.length, '条, total', total, '检测总页数', totalPages, '累计', all.length);

      if (scope !== 'all') break;
      // 是否继续翻页：只认「下一页按钮可用」。不再用 page>=totalPages 提前 break，
      // 因为某些页面 total 显示异常（如"显示 X 个"含文字、或 total<首页行数）会把
      // totalPages 算成 1 导致第一页就停。改成靠按钮是否禁用/存在来驱动，最稳。
      const btn = nextButtonEnabled();
      console.log('[BC] 下一页按钮', btn ? '找到' : '未找到/已禁用');
      if (!btn) break;

      const prevFirstKey = rows.length ? rows[0].sourceUrl : '';
      btn.click();
      const advanced = await BC.waitForNextPage(prevFirstKey, 20000, () => cancelled || token !== runToken);
      if (token !== runToken) { console.log('[BC] run 退出(等待中被取代) token', token); return; }
      if (!advanced) {
        truncated = true;
        reason = cancelled ? '用户取消' : '翻页超时';
        break;
      }
    }

    const finalRows = BC.dedupe(all);
    console.log('[BC] done 发送', finalRows.length, '条, token', token, '当前', runToken);
    // 只有当前 token 的 run() 才能发 done 并复位 running，避免幽灵进程污染新结果
    if (token === runToken) {
      send({ action: 'done', rows: finalRows, total: finalRows.length, truncated, reason });
      running = false;
    } else {
      console.log('[BC] 跳过 done 发送(已被取代)');
    }
  }

  function downloadCsv(rows, columns, filename) {
    const csv = BC.rowsToCsv(rows, columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || (BC.defaultFilename() + '.csv');
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
        // 用户再次点"开始抓取"视为明确覆盖：先硬重置（作废旧 token、清状态），
        // 再启动新 run()。旧 run() 在下次循环检查 token 时自行作废退出，绝不发 done。
        runToken += 1;
        cancelled = false;
        running = true;
        const myToken = runToken;
        console.log('[BC] start 收到, scope', msg.scope, '新 token', myToken);
        run(msg.scope === 'page' ? 'page' : 'all', myToken).catch((e) => {
          if (runToken === myToken) running = false;
          send({ action: 'error', message: String((e && e.message) || e) });
        });
        reply({ ok: true });
      } else if (msg.action === 'reset') {
        // 硬重置：作废所有进行中的 run()（token 失配后它们不发 done）、清状态
        runToken += 1;
        cancelled = false;
        running = false;
        console.log('[BC] reset, 新 token', runToken);
        reply({ ok: true });
      } else if (msg.action === 'cancel') {
        cancelled = true;
        reply({ ok: true });
      } else if (msg.action === 'export') {
        downloadCsv(Array.isArray(msg.rows) ? msg.rows : [], msg.columns, msg.filename);
        reply({ ok: true });
      }
      return false;
    });
  }
})();
