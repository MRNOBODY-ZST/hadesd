// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import type { Media } from "@hadesd/contracts";
import { api } from "../api";
import { useMediaInsertion } from "./useMediaInsertion";
import { escapeMediaLabel, insertAtSelection, mediaMarkdown, validateUpload } from "./mediaInsertion";

const media = (id: string, filename = 'screenshot.png', mime = 'image/png'): Media => ({ id, filename, mime, size: 8, createdAt: '2026-09-10T00:00:00Z' });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => {
    const [text, setText] = useState('before AFTER');
    const latest = useRef(text); latest.current = text;
    const textarea = useRef<HTMLTextAreaElement | null>(null);
    if (!textarea.current) { textarea.current = document.createElement('textarea'); textarea.current.value = text; textarea.current.setSelectionRange(7, 12); }
    const update = (fn: (value: string) => string) => { latest.current = fn(latest.current); setText(latest.current); };
    return { text, update, ...useMediaInsertion({ textarea, update }) };
  }, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('author attachment insertion', () => {
  it('keeps new typing and chosen position while the upload is pending', async () => {
    let finish!: (file: Media) => void;
    vi.spyOn(api, 'upload').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = mount();
    let upload!: Promise<void>;
    act(() => { upload = result.current.uploadFiles([new File(['image'], 'screen.png', { type: 'image/png' })]); });
    expect(result.current.pending).toBe(1);
    act(() => result.current.update(text => text + '\nnew words typed during upload'));
    await act(async () => { finish(media('image-1')); await upload; });
    expect(result.current.text).toContain('before \n![screenshot.png](/api/v1/public/media/image-1)');
    expect(result.current.text).toContain('new words typed during upload');
    expect(result.current.text).not.toContain('AFTER'); expect(result.current.text).not.toContain('正在上传');
    expect(result.current.pending).toBe(0);
  });
  it('does not reinsert an upload marker the author intentionally deleted', async () => {
    let finish!: (file: Media) => void;
    vi.spyOn(api, 'upload').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = mount(); let upload!: Promise<void>;
    act(() => { upload = result.current.uploadFiles([new File(['x'], 'a.png', { type: 'image/png' })]); });
    act(() => result.current.update(() => 'author replaced the document'));
    await act(async () => { finish(media('image-2')); await upload; });
    expect(result.current.text).toBe('author replaced the document');
  });
  it('removes only failed placeholders and processes following files in order', async () => {
    const upload = vi.spyOn(api, 'upload').mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(media('zip-1', '资料.zip', 'application/zip'));
    const { result } = mount();
    await act(() => result.current.uploadFiles([new File(['x'], 'a.png', { type: 'image/png' }), new File(['zip'], '资料.zip')]));
    expect(upload).toHaveBeenCalledTimes(2); expect(result.current.error).toContain('network unavailable');
    expect(result.current.text).toContain('[资料.zip](/api/v1/public/media/zip-1?download=true)');
    expect(result.current.text).not.toContain('正在上传'); expect(result.current.pending).toBe(0);
  });
  it('validates before any insertion or network request', async () => {
    const upload = vi.spyOn(api, 'upload'); const { result } = mount();
    await act(() => result.current.uploadFiles([new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })]));
    expect(upload).not.toHaveBeenCalled(); expect(result.current.text).toBe('before AFTER');
    expect(result.current.error).toContain('仅支持');
  });
  it('escapes filename Markdown metacharacters and respects selection boundaries', () => {
    const label = escapeMediaLabel('file [a](b)\n<img>.txt');
    expect(label).toBe('file \\[a\\]\\(b\\) \\<img\\>.txt');
    expect(mediaMarkdown(media('file-1', 'file [a](b)\n.txt', 'text/plain'))).toBe('[file \\[a\\]\\(b\\) .txt](/api/v1/public/media/file-1?download=true)');
    expect(insertAtSelection('abcdef', 'X', 2, 4)).toEqual({ markdown: 'ab\nX\nef', caret: 5 });
  });
  it('uses the shared ZIP and UTF-8 text limits, including browsers without a MIME hint', () => {
    expect(validateUpload(new File(['text'], 'note.md'))).toBeNull();
    expect(validateUpload(new File(['PK'], 'archive.zip'))).toBeNull();
    expect(validateUpload(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'note.yaml'))).toContain('2 MB');
    expect(validateUpload(new File(['svg'], 'active.svg', { type: 'image/png' }))).toContain('仅支持');
  });
});
