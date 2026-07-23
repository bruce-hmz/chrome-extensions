'use strict';

// 让工具栏图标点击直接开关侧边面板（而不是弹 popup）。
// 配合 popup.html 内的 × 关闭按钮（window.close()）实现：
// 点图标 → 打开；点页面空白处 → 面板常驻不消失；点 × → 关闭。
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.error('[Backlinks Collector] setPanelBehavior failed:', e));
});
