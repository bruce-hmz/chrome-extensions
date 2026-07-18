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
});

describe('dedupe', () => {
  it('按 sourceUrl+targetUrl 去重，保留首个', () => {
    const a = { sourceUrl: 'u1', targetUrl: 't1', sourceTitle: 'a' };
    const b = { sourceUrl: 'u1', targetUrl: 't1', sourceTitle: 'b' };
    const c = { sourceUrl: 'u2', targetUrl: 't1', sourceTitle: 'c' };
    expect(BC.dedupe([a, b, c])).toEqual([a, c]);
  });
});
