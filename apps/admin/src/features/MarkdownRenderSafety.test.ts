// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderDiagram } from '../../../../packages/markdown/src/renderMermaid';
afterEach(() => { vi.restoreAllMocks(); });
describe('actual Mermaid output isolation', () => {
  it('renders a real graph into sanitized SVG and removes its temporary host', async () => {
    // jsdom has no layout engine. These metrics only permit actual Mermaid parsing/rendering;
    // visual layout still needs the browser smoke check.
    Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value: () => ({ x: 0, y: 0, width: 100, height: 30 }) });
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value: () => 100 });
    const original = document.body.childElementCount;
    const svg = await renderDiagram('flowchart LR\n Start[开始] --> Done[完成]\n click Start "javascript:alert(1)"');
    expect(svg).toContain('<svg'); expect(svg).toContain('开始'); expect(svg).toContain('完成');
    expect(svg).not.toContain('<script'); expect(svg).not.toContain('<foreignObject'); expect(svg).not.toContain('javascript:');
    expect(svg).not.toMatch(/<a\s/); expect(document.body.childElementCount).toBe(original);
  });
});
