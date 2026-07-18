const fs = require('fs');
const path = require('path');
const BC = require('../src/lib.js');

describe('epochToDate', () => {
  it('Unix 秒转 UTC+8 YYYY-MM-DD', () => {
    expect(BC.epochToDate(1771250711)).toBe('2026-02-16');
    expect(BC.epochToDate(1775685412)).toBe('2026-04-09');
  });
  it('非法值返回空串', () => {
    expect(BC.epochToDate(0)).toBe('');
    expect(BC.epochToDate('')).toBe('');
    expect(BC.epochToDate(null)).toBe('');
    expect(BC.epochToDate(NaN)).toBe('');
  });
});

describe('rowsToCsv', () => {
  it('输出 BOM + 表头 + 引号包裹的行', () => {
    const row = {
      ascore: '32', sourceTitle: '标,题"', sourceUrl: 'http://x',
      externalLinks: '1', internalLinks: '2', anchor: 'a', targetUrl: 'http://y',
      firstSeen: '2026-02-16', lastSeen: '2026-04-09',
    };
    const csv = BC.rowsToCsv([row]);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('"页面AS","源页面标题","源页面URL","外部链接","内部链接","锚文本","目标URL","首次发现","上次发现"');
    expect(lines[1]).toBe('"32","标,题""","http://x","1","2","a","http://y","2026-02-16","2026-04-09"');
  });

  it('空数组只有 BOM + 表头一行', () => {
    const csv = BC.rowsToCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe('"页面AS","源页面标题","源页面URL","外部链接","内部链接","锚文本","目标URL","首次发现","上次发现"');
  });
});

describe('dedupe', () => {
  it('按 sourceUrl+targetUrl 去重，保留首个', () => {
    const a = { sourceUrl: 'u1', targetUrl: 't1', sourceTitle: 'a' };
    const b = { sourceUrl: 'u1', targetUrl: 't1', sourceTitle: 'b' };
    const c = { sourceUrl: 'u2', targetUrl: 't1', sourceTitle: 'c' };
    expect(BC.dedupe([a, b, c])).toEqual([a, c]);
  });

  it('空数组返回空数组', () => {
    expect(BC.dedupe([])).toEqual([]);
  });
});

function loadFixture() {
  document.body.innerHTML = fs.readFileSync(
    path.join(__dirname, 'fixtures/page.html'), 'utf8',
  );
}

describe('extractPage', () => {
  it('抓全字段并处理边界', () => {
    loadFixture();
    const { rows, total } = BC.extractPage(document);
    expect(total).toBe(200);
    expect(rows.length).toBe(3);

    expect(rows[0]).toEqual({
      ascore: '32',
      sourceTitle: 'お役立ちサイト一覧 - 何でも Wiki*',
      sourceUrl: 'https://wikiwiki.jp/anythingwiki/x',
      externalLinks: '619', internalLinks: '284',
      anchor: 'Image To Pixel Art', targetUrl: 'https://pixelartvillage.com/',
      firstSeen: '2026-02-16', lastSeen: '2026-04-09',
    });

    // 无标题重定向行
    expect(rows[1].sourceTitle).toBe('');
    expect(rows[1].sourceUrl).toBe('https://www.producthunt.com/r/ABC');
    expect(rows[1].targetUrl).toBe('https://pixelartvillage.com/?ref=producthunt');
    expect(rows[1].firstSeen).toBe('2026-04-01');

    // 优先 target-url
    expect(rows[2].targetUrl).toBe('https://pixelartvillage.com/');
    expect(rows[2].anchor).toBe('imagetopixelart');
  });

  it('找不到表格返回空', () => {
    document.body.innerHTML = '';
    const { rows, total } = BC.extractPage(document);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });
});

describe('findNextButton', () => {
  it('按 aria-label 命中 enabled 下一页按钮', () => {
    document.body.innerHTML = `
      <div role="navigation">
        <button aria-label="Previous page" disabled>‹</button>
        <button aria-label="Page 1">1</button>
        <button aria-label="Next page">›</button>
      </div>`;
    const btn = BC.findNextButton(document);
    expect(btn).toBeInstanceOf(HTMLButtonElement);
    expect(btn.getAttribute('aria-label')).toBe('Next page');
  });

  it('next 禁用时回退到 nav 内最后一个 enabled 按钮', () => {
    document.body.innerHTML = `
      <div role="navigation">
        <button aria-label="Page 1">1</button>
        <button aria-label="Page 2">2</button>
        <button aria-label="Next page" aria-disabled="true">›</button>
      </div>`;
    const btn = BC.findNextButton(document);
    expect(btn.textContent.trim()).toBe('2');
  });

  it('都没有返回 null', () => {
    document.body.innerHTML = '<div></div>';
    expect(BC.findNextButton(document)).toBeNull();
  });
});
