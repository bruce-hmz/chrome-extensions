'use strict';

const el = (id) => document.getElementById(id);
const ui = {
  idle: el('idle'), running: el('running'), results: el('results'),
  err: el('err'), scope: el('scope'), start: el('start'), cancel: el('cancel'),
  progBar: el('prog-bar'), progText: el('prog-text'),
  truncated: el('truncated'), selectAll: el('select-all'),
  count: el('count'), exportBtn: el('export'), tbody: el('rows-body'),
};

let rowsState = [];
let tabId = null;
let injected = false;

function show(name) {
  ['idle', 'running', 'results'].forEach((n) => ui[n].classList.toggle('hidden', n !== name));
}
function setError(msg) {
  ui.err.textContent = msg || '';
  ui.err.classList.toggle('hidden', !msg);
}

async function ensureInjected() {
  if (injected) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('没有活动标签页');
  tabId = tab.id;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/lib.js', 'src/content.js'],
  });
  injected = true;
}

function postToTab(msg) {
  if (tabId == null) return Promise.resolve();
  return chrome.tabs.sendMessage(tabId, msg);
}

function updateProgress(page, totalPages, accumulated) {
  const pct = totalPages ? Math.min(100, Math.round((page / totalPages) * 100)) : 0;
  ui.progBar.style.width = pct + '%';
  ui.progText.textContent = '第 ' + page + ' / ' + totalPages + ' 页，已抓 ' + accumulated + ' 条';
}

function renderResults(rows, truncated, reason) {
  rowsState = rows;
  ui.truncated.classList.toggle('hidden', !truncated);
  if (truncated) ui.truncated.textContent = '（提前结束：' + (reason || '未知原因') + '，未到最后一页）';

  const frag = document.createDocumentFragment();
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const tdC = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.dataset.idx = String(i);
    tdC.appendChild(cb);
    tr.appendChild(tdC);
    [r.ascore, r.sourceTitle, r.sourceUrl, r.anchor, r.targetUrl, r.firstSeen, r.lastSeen]
      .forEach((v) => {
        const td = document.createElement('td');
        td.textContent = v == null ? '' : String(v);
        tr.appendChild(td);
      });
    frag.appendChild(tr);
  });
  ui.tbody.replaceChildren(frag);
  ui.selectAll.checked = true;
  refreshCount();
  show('results');
}

function refreshCount() {
  const boxes = ui.tbody.querySelectorAll('input[type=checkbox]');
  const checked = ui.tbody.querySelectorAll('input[type=checkbox]:checked');
  ui.count.textContent = '已选 ' + checked.length + ' / 共 ' + boxes.length + ' 条';
}

ui.start.addEventListener('click', async () => {
  setError('');
  try {
    await ensureInjected();
    show('running');
    updateProgress(0, 1, 0);
    await postToTab({ action: 'start', scope: ui.scope.value });
  } catch (e) {
    setError('启动失败：' + ((e && e.message) || e));
    show('idle');
  }
});

ui.cancel.addEventListener('click', () => postToTab({ action: 'cancel' }));

ui.selectAll.addEventListener('change', () => {
  ui.tbody.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = ui.selectAll.checked; });
  refreshCount();
});
ui.tbody.addEventListener('change', refreshCount);

ui.exportBtn.addEventListener('click', () => {
  const picked = Array.from(ui.tbody.querySelectorAll('input[type=checkbox]:checked'))
    .map((cb) => rowsState[Number(cb.dataset.idx)])
    .filter(Boolean);
  if (!picked.length) { setError('未选择任何行'); return; }
  postToTab({ action: 'export', rows: picked });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.action) return;
  if (msg.action === 'progress') updateProgress(msg.page, msg.totalPages, msg.accumulated);
  else if (msg.action === 'done') renderResults(msg.rows || [], !!msg.truncated, msg.reason);
  else if (msg.action === 'error') setError(msg.message);
});
