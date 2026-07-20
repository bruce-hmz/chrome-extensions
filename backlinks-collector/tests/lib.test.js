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
  it('按 sourceUrl 去重（同源不同目标也折叠），保留首个', () => {
    const a = { sourceUrl: 'u1', targetUrl: 't1', sourceTitle: 'a' };
    const b = { sourceUrl: 'u1', targetUrl: 't2', sourceTitle: 'b' }; // 同源、不同目标
    const c = { sourceUrl: 'u2', targetUrl: 't1', sourceTitle: 'c' };
    expect(BC.dedupe([a, b, c])).toEqual([a, c]);
  });

  it('空数组返回空数组', () => {
    expect(BC.dedupe([])).toEqual([]);
  });
});

describe('defaultFilename', () => {
  it('格式为 backlinks_YYYYMMDD-HHMM', () => {
    expect(BC.defaultFilename()).toMatch(/^backlinks_\d{8}-\d{4}$/);
  });
});

describe('sanitizeFilename', () => {
  it('删 Windows 非法字符', () => {
    expect(BC.sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });
  it('去掉用户误输的尾部 .csv', () => {
    expect(BC.sanitizeFilename('report.csv')).toBe('report');
  });
  it('保留正常名与空格', () => {
    expect(BC.sanitizeFilename('my report')).toBe('my report');
  });
  it('空串/空白回退默认名', () => {
    expect(BC.sanitizeFilename('')).toMatch(/^backlinks_\d{8}-\d{4}$/);
    expect(BC.sanitizeFilename('   ')).toMatch(/^backlinks_\d{8}-\d{4}$/);
  });
  it('清理后为空(只剩非法字符)回退默认名', () => {
    expect(BC.sanitizeFilename('///')).toMatch(/^backlinks_\d{8}-\d{4}$/);
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

  // 真实站点(Semrush 系)的 Next 按钮用「命名属性」data-test-pagination-next-btn，
  // 而非 data-test="..."；旧的 [data-test*="paginat"] 选不到，会漏。
  it('命中 Semrush data-test-pagination-next-btn 命名属性按钮', () => {
    document.body.innerHTML = `
      <button data-test-pagination-next-btn="" data-ui-name="Pagination.NextPage" type="button">
        <span data-ui-name="Button.Text">Next</span>
      </button>`;
    const btn = BC.findNextButton(document);
    expect(btn).toBeInstanceOf(HTMLButtonElement);
    expect(btn.hasAttribute('data-test-pagination-next-btn')).toBe(true);
  });

  it('data-test-pagination-next-btn 为 aria-disabled 时不命中', () => {
    document.body.innerHTML = `
      <button data-test-pagination-next-btn="" aria-disabled="true">Next</button>`;
    expect(BC.findNextButton(document)).toBeNull();
  });
});

// waitForNextPage：点击下一页后等表格真正加载完成。
// 真实 SPA 点击后会经过「骨架/部分渲染 → 满页」过程；只在首行变化时立刻返回
// 会在表格还没加载完就误判，导致抓到空/旧数据。必须等「连续稳定」才返回。
describe('waitForNextPage', () => {
  function setTable(firstUrl, rowCount) {
    let html = '<div data-test-table="backlinks"><span data-test-report-title-total="">900</span>';
    for (let i = 0; i < rowCount; i++) {
      const url = i === 0 ? firstUrl : 'row-' + i;
      html += '<div data-test-tbody-tr="" role="row"><div name="source"><a data-test-source-url="' + url + '">x</a></div></div>';
    }
    html += '</div>';
    document.body.innerHTML = html;
  }
  const firstUrl = () => {
    const el = document.querySelector('[data-test-source-url]');
    return el ? el.getAttribute('data-test-source-url') : '';
  };
  const rowCount = () => document.querySelectorAll('[data-test-tbody-tr]').length;

  it('骨架/部分渲染阶段不返回，等满页稳定后才返回', async () => {
    setTable('p1', 100);
    const p = BC.waitForNextPage('p1', 4000, () => false);
    setTimeout(() => setTable('', 1), 100);            // 骨架（首行空）
    setTimeout(() => setTable('p2', 40), 300);          // 部分渲染
    setTimeout(() => setTable('p2-final', 100), 600);   // 满页
    const t0 = Date.now();
    const ok = await p;
    const elapsed = Date.now() - t0;
    expect(ok).toBe(true);
    expect(elapsed).toBeGreaterThan(1000);              // 不能在 100ms 骨架出现即返回
    expect(firstUrl()).toBe('p2-final');
    expect(rowCount()).toBe(100);
  });

  it('超时未稳定返回 false', async () => {
    setTable('p1', 100);
    // 表格恒不变（永远停在 page1）
    const ok = await BC.waitForNextPage('p1', 500, () => false);
    expect(ok).toBe(false);
  });

  it('isCancelled 为真时中止', async () => {
    setTable('p1', 100);
    let cancelled = false;
    setTimeout(() => { cancelled = true; }, 150);
    const ok = await BC.waitForNextPage('p1', 4000, () => cancelled);
    expect(ok).toBe(false);
  });
});

describe('rowsToCsv 列顺序', () => {
  const row = { ascore: '1', sourceTitle: 't', sourceUrl: 'u', externalLinks: '2', internalLinks: '3', anchor: 'a', targetUrl: 'v', firstSeen: '2026-01-01', lastSeen: '2026-01-02' };

  it('COLUMNS 暴露 9 个 key（默认顺序）', () => {
    expect(BC.COLUMNS.map((c) => c.key)).toEqual(
      ['ascore', 'sourceTitle', 'sourceUrl', 'externalLinks', 'internalLinks', 'anchor', 'targetUrl', 'firstSeen', 'lastSeen'],
    );
  });

  it('不传 columns 时按默认 9 列顺序输出', () => {
    const lines = BC.rowsToCsv([row]).slice(1).split('\r\n');
    expect(lines[0]).toBe('"页面AS","源页面标题","源页面URL","外部链接","内部链接","锚文本","目标URL","首次发现","上次发现"');
  });

  it('按给定 columns 子集+顺序输出表头与字段', () => {
    // 显式构造「非默认顺序」(sourceUrl 在前, ascore 在后)，证明顺序被尊重
    const find = (k) => BC.COLUMNS.find((c) => c.key === k);
    const cols = [find('sourceUrl'), find('ascore')];
    const lines = BC.rowsToCsv([row], cols).slice(1).split('\r\n');
    expect(lines[0]).toBe('"源页面URL","页面AS"');
    expect(lines[1]).toBe('"u","1"');
  });
});
