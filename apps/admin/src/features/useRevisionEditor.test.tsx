// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Content } from "@hadesd/contracts";
import { api, ApiError } from "../api";
import { useUi } from "../store";
import { inputFrom, useRevisionEditor } from "./useRevisionEditor";
function content(version = 1, markdown = "original"): Content {
  return {
    id: "content-1",
    type: "POST",
    version,
    createdAt: "2026-09-09T10:00:00Z",
    latestRevision: {
      id: `revision-${version}`,
      contentId: "content-1",
      createdAt: "2026-09-09T10:00:00Z",
      title: "真实笔记",
      slug: "real-note",
      summary: "",
      markdown,
      tags: [],
      language: "zh-CN",
      coverMediaId: null,
    },
  };
}
function mount(client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })) {
  return renderHook(() => useRevisionEditor(content()), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  useUi.getState().setDirty(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("revision editor autosave and conflict safety", () => {
  it("expires cached media counts and reference details after a saved revision changes attachments", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15000 }, mutations: { retry: false } } });
    client.setQueryData(["media", 0, 20, "", "all", "all"], { items: [{ id: "media-1", referenceCount: 0, canDelete: true }], total: 1 });
    client.setQueryData(["media-references", "media-1", 0], { items: [], total: 0 });
    vi.spyOn(api, "save").mockImplementation(async (_id, version, revision) => ({ ...content(version + 1), latestRevision: { ...content(version + 1).latestRevision, ...revision } }));
    const { result } = mount(client);
    act(() => result.current.change(current => ({ ...current, markdown: "![now referenced](/api/v1/public/media/media-1)" })));
    await act(() => vi.advanceTimersByTimeAsync(1200));
    expect(result.current.status).toBe("saved");
    expect(client.getQueryState(["media", 0, 20, "", "all", "all"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["media-references", "media-1", 0])?.isInvalidated).toBe(true);
  });
  it("debounces edits, saves the latest text, and clears the dirty guard only after confirmation", async () => {
    const save = vi
      .spyOn(api, "save")
      .mockImplementation(async (_id, version, revision) => ({
        ...content(version + 1),
        latestRevision: { ...content(version + 1).latestRevision, ...revision },
      }));
    const { result } = mount();
    act(() => result.current.change((d) => ({ ...d, markdown: "first" })));
    await act(() => vi.advanceTimersByTimeAsync(800));
    act(() => result.current.change((d) => ({ ...d, markdown: "latest" })));
    await act(() => vi.advanceTimersByTimeAsync(1199));
    expect(save).not.toHaveBeenCalled();
    expect(useUi.getState().dirty).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledWith(
      "content-1",
      1,
      expect.objectContaining({ markdown: "latest" }),
    );
    expect(result.current.status).toBe("saved");
    expect(result.current.dirty).toBe(false);
    expect(useUi.getState().dirty).toBe(false);
  });
  it("keeps typing during an in-flight save and saves it against the returned version", async () => {
    let finish!: (value: Content) => void;
    const save = vi
      .spyOn(api, "save")
      .mockImplementationOnce(
        () =>
          new Promise<Content>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(content(3, "typed during save"));
    const { result } = mount();
    act(() =>
      result.current.change((d) => ({ ...d, markdown: "first snapshot" })),
    );
    await act(() => vi.advanceTimersByTimeAsync(1200));
    expect(result.current.status).toBe("saving");
    act(() =>
      result.current.change((d) => ({ ...d, markdown: "typed during save" })),
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(save).toHaveBeenCalledTimes(1);
    expect(useUi.getState().pendingSave).toBe(true);
    await act(async () => finish(content(2, "first snapshot")));
    expect(result.current.draft.markdown).toBe("typed during save");
    expect(result.current.dirty).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1200));
    expect(save).toHaveBeenLastCalledWith(
      "content-1",
      2,
      expect.objectContaining({ markdown: "typed during save" }),
    );
    expect(result.current.status).toBe("saved");
  });
  it("preserves local text on 409 and only creates a merged revision after explicit action", async () => {
    const save = vi
      .spyOn(api, "save")
      .mockRejectedValueOnce(
        new ApiError(409, { code: "REVISION_CONFLICT", detail: "版本冲突" }),
      )
      .mockResolvedValueOnce(content(3, "my local words"));
    vi.spyOn(api, "content").mockResolvedValue(content(2, "other tab words"));
    const { result } = mount();
    act(() =>
      result.current.change((d) => ({ ...d, markdown: "my local words" })),
    );
    await act(() => vi.advanceTimersByTimeAsync(1200));
    expect(result.current.status).toBe("conflict");
    expect(result.current.draft.markdown).toBe("my local words");
    expect(result.current.remote?.latestRevision.markdown).toBe(
      "other tab words",
    );
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.mergeAsRevision();
    });
    expect(save).toHaveBeenLastCalledWith(
      "content-1",
      2,
      expect.objectContaining({ markdown: "my local words" }),
    );
    expect(result.current.status).toBe("saved");
  });
  it("restoring historical text writes a new revision, without mutating history", async () => {
    const save = vi
      .spyOn(api, "save")
      .mockResolvedValue(content(2, "historic text"));
    const old = inputFrom(content(1, "historic text").latestRevision);
    const { result } = mount();
    await act(async () => {
      await result.current.save(old);
    });
    expect(save).toHaveBeenCalledWith("content-1", 1, old);
    expect(result.current.content.latestRevision.id).toBe("revision-2");
    expect(result.current.draft.markdown).toBe("historic text");
    expect(result.current.dirty).toBe(false);
  });
  it("keeps failed edits dirty and does not silently retry writes until the user acts", async () => {
    const save = vi
      .spyOn(api, "save")
      .mockRejectedValue(new Error("数据库暂不可用"));
    const { result } = mount();
    act(() =>
      result.current.change((d) => ({ ...d, markdown: "must not lose this" })),
    );
    await act(() => vi.advanceTimersByTimeAsync(1200));
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(save).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("error");
    expect(result.current.dirty).toBe(true);
    expect(useUi.getState().dirty).toBe(true);
  });
});

describe("pending attachment autosave boundary", () => {
  it("does not persist upload placeholders, then resumes autosave with completed public references", async () => {
    const save = vi.spyOn(api, "save").mockImplementation(async (_id, version, revision) => ({ ...content(version + 1), latestRevision: { ...content(version + 1).latestRevision, ...revision } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result, rerender } = renderHook(({ pending }) => useRevisionEditor(content(), pending), {
      initialProps: { pending: 1 }, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    act(() => result.current.change(d => ({ ...d, markdown: '[正在上传：a.png · marker]()' })));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(async () => { await result.current.save(); });
    expect(save).not.toHaveBeenCalled(); expect(useUi.getState().dirty).toBe(true);
    act(() => result.current.change(d => ({ ...d, markdown: '![a.png](/api/v1/public/media/id)' })));
    rerender({ pending: 0 });
    await act(() => vi.advanceTimersByTimeAsync(1200));
    expect(save).toHaveBeenCalledWith('content-1', 1, expect.objectContaining({ markdown: '![a.png](/api/v1/public/media/id)' }));
  });
});
