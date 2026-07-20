describe('sanity', () => {
  it('vitest + jsdom 可用', () => {
    expect(1 + 1).toBe(2);
    expect(document.createElement('div')).toBeInstanceOf(HTMLElement);
  });
});
