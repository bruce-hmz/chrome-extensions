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
  thead: el('rows-head'), seg: el('scope-seg'), filename: el('filename'),
  closePanel: el('close-panel'), newTask: el('new-task'),
};

let rowsState = [];
let tabId = null;
let injected = false;
let scraping = false; // 是否正在抓取（running 面板期间），用于阻止导航事件误重置翻页
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

// side panel 常驻：切到别的标签或当前标签导航到新地址时，旧抓取结果已失效，
// 把面板重置回 idle 并清空旧 tab 注入缓存，避免误展示上一个地址的结果。
// scraping=true 期间不重置（翻页会触发虚假导航/URL 变化，不能打断正在进行的抓取）。
function resetToIdle() {
  if (scraping) return;
  rowsState = [];
  injected = false;
  tabId = null;
  setError('');
  show('idle');
}

async function syncActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id !== tabId) resetToIdle();
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
  // 常驻面板里 tabId/injected 会被旧值污染，每次都重新确认当前活动标签。
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('没有活动标签页');
  if (tab.id !== tabId) {
    tabId = tab.id;
    injected = false; // 新标签，重新注入 content script
  }
  if (injected) return;

  // side panel 常驻后 activeTab 不再生效（点工具栏图标打开的是面板，
  // 不是针对标签页的手势）。改用 optional_host_permissions：首次"开始抓取"时，
  // 在点击手势内请求一次"所有站点"权限，授权后任意页面都可注入，不再重复弹窗。
  // 注意：不能读 tab.url 来按站点授权——没 host 权限时 tab.url 是 undefined，
  // 且读 URL 本身就需要权限，形成死结。故直接请求 <all_urls>，最稳。
  const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (!granted) {
    const ok = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!ok) throw new Error('未授权访问该页面');
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/lib.js', 'src/content.js'],
  });
  injected = true;
}

function postToTab(msg) {
  if (tabId == null) return Promise.resolve(null);
  return chrome.tabs.sendMessage(tabId, msg);
}

function updateProgress(page, totalPages, accumulated) {
  const pct = totalPages ? Math.min(100, Math.round((page / totalPages) * 100)) : 0;
  ui.progBar.style.width = pct + '%';
  const pageStr = totalPages ? ('第 ' + page + ' / ' + totalPages + ' 页') : ('第 ' + page + ' 页');
  ui.progText.textContent = pageStr + '，已抓 ' + accumulated + ' 条';
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
  if (ui.filename) ui.filename.value = BC.defaultFilename();
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
    // 先硬重置 content script，确保无幽灵进程把旧 done 发回来覆盖新结果
    await postToTab({ action: 'reset' });
    scraping = true;
    show('running');
    updateProgress(0, 1, 0);
    console.log('[BC-popup] 发送 start, scope', scope, 'tabId', tabId);
    const res = await postToTab({ action: 'start', scope });
    if (res && res.ok === false) throw new Error(res.error || '启动被拒');
  } catch (e) {
    scraping = false;
    setError('启动失败：' + ((e && e.message) || e));
    show('idle');
  }
});

ui.cancel.addEventListener('click', () => postToTab({ action: 'cancel' }));

// 新任务：放弃当前结果，回 idle 准备抓另一个地址。
// SPA 切换报告不一定触发导航事件，results 面板会卡住，故提供这个显式入口。
if (ui.newTask) {
  ui.newTask.addEventListener('click', () => {
    // 若上一轮抓取还在后台跑，先取消，避免它的 done/error 之后再覆盖新任务界面
    postToTab({ action: 'cancel' });
    scraping = false;
    resetToIdle();
  });
}

// 关闭侧边面板：side panel API 无 close() 方法，window.close() 是官方认可方式。
// 关闭后下次点工具栏图标可重新打开（background.js 配置了 openPanelOnActionClick）。
if (ui.closePanel) {
  ui.closePanel.addEventListener('click', () => window.close());
}

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
  const filename = BC.sanitizeFilename(ui.filename ? ui.filename.value : '') + '.csv';
  postToTab({ action: 'export', rows: picked, columns: orderedColumns(), filename });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.action) return;
  // 仅接受当前关联标签的消息，防止旧标签后台抓取结果串扰新标签显示
  if (sender.tab && sender.tab.id !== tabId) return;
  if (msg.action === 'progress') {
    updateProgress(msg.page, msg.totalPages, msg.accumulated);
  } else if (msg.action === 'done') {
    scraping = false;
    renderResults(msg.rows || [], !!msg.truncated, msg.reason);
  } else if (msg.action === 'error') {
    scraping = false;
    setError(msg.message);
  }
});

// 监听标签切换 / 当前标签真实导航：旧结果失效则重置回 idle。
// resetToIdle 内部会在 scraping=true 时跳过，故 SPA 翻页/客户端路由不会被误打断。
chrome.tabs.onActivated.addListener(() => syncActiveTab());
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab && tab.active && (info.status === 'loading' || info.url)) resetToIdle();
});

loadColumnOrder();
