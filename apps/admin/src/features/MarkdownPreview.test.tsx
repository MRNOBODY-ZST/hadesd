// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Markdown, MarkdownImage } from '@hadesd/markdown';
const { renderDiagram } = vi.hoisted(() => ({ renderDiagram: vi.fn() }));
vi.mock('../../../../packages/markdown/src/renderMermaid', () => ({ renderDiagram }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); renderDiagram.mockReset(); });
describe('interactive Markdown preview', () => {
  it('keeps a visible original link on image failure and retries or resets for another source', () => {
    const { rerender } = render(<MarkdownImage src='/api/v1/public/media/image-1' alt='电路图' title='实验记录' />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('status').textContent).toContain('电路图');
    expect(screen.getByRole('link', { name: '查看原图 ↗' }).getAttribute('href')).toBe('/api/v1/public/media/image-1');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(screen.getByRole('img').getAttribute('alt')).toBe('电路图');
    fireEvent.error(screen.getByRole('img'));
    rerender(<MarkdownImage src='/api/v1/public/media/image-2' alt='新图' />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/v1/public/media/image-2');
  });
  it('keeps diagrams inert until requested, handles syntax errors and revokes generated blobs', async () => {
    const create = vi.fn(() => 'blob:diagram-1'), revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    renderDiagram.mockRejectedValueOnce(new Error('parse error')).mockResolvedValueOnce('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const { unmount } = render(<Markdown source={'```mermaid\ngraph TD\nA-->B\n```'} />);
    expect(renderDiagram).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '渲染 Mermaid 图表' })));
    expect((await screen.findByRole('alert')).textContent).toContain('源代码已保留');
    expect(screen.getByText(/graph TD/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '渲染 Mermaid 图表' })));
    expect((await screen.findByRole('img')).getAttribute('src')).toBe('blob:diagram-1');
    unmount(); expect(revoke).toHaveBeenCalledWith('blob:diagram-1');
    vi.unstubAllGlobals();
  });
  it('rejects author security overrides without invoking the diagram renderer', async () => {
    render(<Markdown source={'```mermaid\n%%{init: {"securityLevel":"loose"}}%%\ngraph TD;A-->B\n```'} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '渲染 Mermaid 图表' })));
    expect(renderDiagram).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeTruthy();
  });
});
