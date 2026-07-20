'use strict';

const el = (id) => document.getElementById(id);
const BC = globalThis.BC;
const COLUMNS = (BC && BC.COLUMNS) || [];
const VALID_KEYS = COLUMNS.map((c) => c.key);

const ui = {
  idle: el('idle'), running: el('running'), results: el('results'),
  err: el('err'), start: el('start'), cancel: el('cancel'),
  progBar: el('prog-bar'), progText: el('prog-text'),
  truncated: el('truncated'), selectAll: el('select-all'),
  count: el('count'), exportBtn: el('export'), tbody: el('rows-body'),
  thead: el('rows-head'), seg: el('scope-seg'),
};

let rowsState = [];
let tabId = null;
let injected = false;
let colOrder = COLUMNS.map((c) => c.key);
let scope = 'all';
if (ui.seg) {
  ui.seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scope]');
    if (!b) return;
    scope = b.dataset.scope;
    ui.seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
}

function show(name) {
  ['idle', 'running', 'results'].forEach((n) => ui[n].classList.toggle('hidden', n !== name));
}
function setError(msg) {
  ui.err.textContent = msg || '';
  ui.err.classList.toggle('hidden', !msg);
}

function orderedColumns() {
  return colOrder.map((k) => COLUMNS.find((c) => c.key === k)).filter(Boolean);
}

async function loadColumnOrder() {
  try {
    const { columnOrder } = await chrome.storage.local.get('columnOrder');
    if (Array.isArray(columnOrder) && columnOrder.length === VALID_KEYS.length
        && VALID_KEYS.every((k) => columnOrder.includes(k))) {
      colOrder = columnOrder.slice();
    }
  } catch (e) { /* storage 不可用则用默认顺序 */ }
}
function saveColumnOrder() {
  try { chrome.storage.local.set({ columnOrder: colOrder }); } catch (e) {}
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

// 抓取当前勾选状态(按行 idx)，重渲染表格后恢复，避免拖拽重排丢勾选。
function captureSelection() {
  const map = new Map();
  ui.tbody.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    map.set(cb.dataset.idx, cb.checked);
  });
  return map;
}

function renderTable() {
  const cols = orderedColumns();
  // 表头：固定复选框列 + 可拖拽的各数据列
  const htr = document.createElement('tr');
  htr.appendChild(document.createElement('th'));
  cols.forEach((c) => {
    const th = document.createElement('th');
    th.className = 'col-' + c.key;
    th.draggable = true;
    th.dataset.key = c.key;
    th.title = '拖拽以重排列顺序';
    th.textContent = c.label;
    htr.appendChild(th);
  });
  ui.thead.replaceChildren(htr);

  // 行：复选框 + 按当前列顺序的各字段
  const prevSel = captureSelection();
  const frag = document.createDocumentFragment();
  rowsState.forEach((r, i) => {
    const tr = document.createElement('tr');
    const tdC = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = prevSel.has(String(i)) ? prevSel.get(String(i)) : true;
    cb.dataset.idx = String(i);
    tdC.appendChild(cb);
    tr.appendChild(tdC);
    cols.forEach((c) => {
      const td = document.createElement('td');
      td.className = 'col-' + c.key;
      if (c.key === 'ascore') {
        const b = document.createElement('span');
        b.className = 'as';
        b.textContent = r[c.key] == null ? '' : String(r[c.key]);
        td.appendChild(b);
      } else {
        td.textContent = r[c.key] == null ? '' : String(r[c.key]);
      }
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  ui.tbody.replaceChildren(frag);
  refreshCount();
}

function renderResults(rows, truncated, reason) {
  setError('');
  rowsState = rows;
  ui.truncated.classList.toggle('hidden', !truncated);
  if (truncated) ui.truncated.textContent = '（提前结束：' + (reason || '未知原因') + '，未到最后一页）';
  ui.selectAll.checked = true;
  renderTable();
  show('results');
}

function refreshCount() {
  const boxes = ui.tbody.querySelectorAll('input[type=checkbox]');
  const checked = ui.tbody.querySelectorAll('input[type=checkbox]:checked');
  ui.count.textContent = '已选 ' + checked.length + ' / 共 ' + boxes.length + ' 条';
  ui.selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
  ui.selectAll.indeterminate = checked.length > 0 && checked.length < boxes.length;
}

// ---- 列拖拽重排（事件委托在 thead）----
let dragKey = null;
ui.thead.addEventListener('dragstart', (e) => {
  const th = e.target.closest('th[data-key]');
  if (!th) return;
  dragKey = th.dataset.key;
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragKey); } catch (x) {}
});
ui.thead.addEventListener('dragover', (e) => {
  if (!dragKey) return;
  if (e.target.closest('th[data-key]')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
});
ui.thead.addEventListener('drop', (e) => {
  const th = e.target.closest('th[data-key]');
  if (!th || !dragKey || dragKey === th.dataset.key) { dragKey = null; return; }
  e.preventDefault();
  const from = colOrder.indexOf(dragKey);
  const to = colOrder.indexOf(th.dataset.key);
  if (from < 0 || to < 0) { dragKey = null; return; }
  colOrder.splice(from, 1);
  colOrder.splice(to, 0, dragKey);
  dragKey = null;
  saveColumnOrder();
  renderTable();
});
ui.thead.addEventListener('dragend', () => { dragKey = null; });

ui.start.addEventListener('click', async () => {
  setError('');
  try {
    await ensureInjected();
    show('running');
    updateProgress(0, 1, 0);
    await postToTab({ action: 'start', scope });
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
  postToTab({ action: 'export', rows: picked, columns: orderedColumns() });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.action) return;
  if (msg.action === 'progress') updateProgress(msg.page, msg.totalPages, msg.accumulated);
  else if (msg.action === 'done') renderResults(msg.rows || [], !!msg.truncated, msg.reason);
  else if (msg.action === 'error') setError(msg.message);
});

loadColumnOrder();
