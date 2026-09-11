// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Content } from "@hadesd/contracts";
import { api, ApiError } from "../api";
import { useUi } from "../store";
import { Contents } from "./Contents";
import Editor from "./Editor";

const content = (version = 1, deletedAt: string | null = null): Content => ({ id: "draft", type: "POST", version, deletedAt, createdAt: "2026-09-12T00:00:00Z", latestRevision: {
  id: `revision-${version}`, contentId: "draft", title: "一份笔记", slug: "one-note", summary: "", markdown: "## 保留的正文\n\n恢复之前只读。", tags: [], language: "zh-CN", coverMediaId: null, createdAt: "2026-09-12T00:00:00Z",
} });
function mount(editor = false, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  render(<QueryClientProvider client={client}>{editor ? <Editor contentId="draft" /> : <Contents />}</QueryClientProvider>);
  return userEvent.setup();
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); useUi.getState().setDirty(false); });

it("searches all manuscripts on the server and sends scope/type filters from page one", async () => {
  const list = vi.spyOn(api, "contents").mockResolvedValue({ items: [content()], total: 32, page: 0, size: 20 });
  const user = mount();
  await screen.findByRole("heading", { name: "一份笔记" });
  await user.click(screen.getByRole("button", { name: "下一页 →" }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(1, expect.anything(), expect.any(AbortSignal)));
  await user.type(screen.getByRole("searchbox", { name: "搜索全部文稿" }), "older & note");
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(0, { q: "older & note", type: "all", trash: false }, expect.any(AbortSignal)));
  // Server output is authoritative: it must not be re-filtered on this page.
  expect(screen.getByRole("heading", { name: "一份笔记" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "项目" }));
  await user.click(screen.getByRole("button", { name: "回收站" }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(0, { q: "older & note", type: "PROJECT", trash: true }, expect.any(AbortSignal)));
});

it("trashes and restores against the current version, with no automatic publication", async () => {
  let current = content(4);
  vi.spyOn(api, "contents").mockImplementation(async (_page, filters) => ({ items: Boolean(current.deletedAt) === Boolean(filters?.trash) ? [current] : [], page: 0, size: 20, total: Boolean(current.deletedAt) === Boolean(filters?.trash) ? 1 : 0 }));
  const trash = vi.spyOn(api, "trashContent").mockImplementation(async () => { current = content(5, "2026-09-12T01:00:00Z"); });
  const restore = vi.spyOn(api, "restoreContent").mockImplementation(async () => current = content(6));
  const publish = vi.spyOn(api, "publish");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = mount();
  await user.click(await screen.findByRole("button", { name: "移入回收站" }));
  expect(trash).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "移入回收站" }));
  await screen.findByText("「一份笔记」已移入回收站，可随时恢复。");
  expect(trash).toHaveBeenCalledExactlyOnceWith("draft", 4);
  await user.click(screen.getByRole("button", { name: "回收站" }));
  await user.click(await screen.findByRole("button", { name: "恢复文稿" }));
  await screen.findByText("「一份笔记」已恢复为私有草稿，尚未上线。");
  expect(restore).toHaveBeenCalledExactlyOnceWith("draft", 5);
  expect(publish).not.toHaveBeenCalled();
});

it("shows server publication/version protection and requires irreversible confirmation for purge", async () => {
  vi.spyOn(api, "contents").mockResolvedValue({ items: [content(8, "2026-09-12T01:00:00Z")], total: 1, page: 0, size: 20 });
  vi.spyOn(api, "trashContent").mockRejectedValue(new ApiError(409, { code: "CONTENT_PUBLISHED", detail: "请先撤稿" }));
  const purge = vi.spyOn(api, "purgeContent").mockRejectedValueOnce(new ApiError(409, { code: "CONTENT_HISTORY_PROTECTED", detail: "保留历史版本引用了此文稿" })).mockResolvedValueOnce();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = mount();
  await user.click(await screen.findByRole("button", { name: "移入回收站" }));
  await screen.findByText("请先撤稿");
  expect(screen.queryByText(/已移入回收站，可随时恢复/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "回收站" }));
  confirm.mockReturnValue(false);
  await user.click(await screen.findByRole("button", { name: "永久删除" }));
  expect(purge).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("文稿及全部历史修订将不可恢复。媒体文件仍保留在资料库"));
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "永久删除" }));
  await screen.findByText("保留历史版本引用了此文稿");
  expect(purge).toHaveBeenCalledWith("draft", 8);
  await user.click(screen.getByRole("button", { name: "永久删除" }));
  await screen.findByText("「一份笔记」及其修订已永久删除。媒体文件仍保留在资料库。");
});

it("cannot reset an in-flight deletion by switching manuscript scope", async () => {
  vi.spyOn(api, "contents").mockResolvedValue({ items: [content()], total: 1, page: 0, size: 20 });
  let finish!: () => void;
  const trash = vi.spyOn(api, "trashContent").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = mount();
  await user.click(await screen.findByRole("button", { name: "移入回收站" }));
  expect((screen.getByRole("button", { name: "回收站" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "移入回收站" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "回收站" }));
  expect(trash).toHaveBeenCalledOnce();
  finish();
  await screen.findByText("「一份笔记」已移入回收站，可随时恢复。");
  expect((screen.getByRole("button", { name: "回收站" }) as HTMLButtonElement).disabled).toBe(false);
});

it("blocks restore and permanent deletion of a cached trash row until its current version is fetched", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15000 }, mutations: { retry: false } } });
  const trashKey = ["contents", 0, "", "ALL", true];
  client.setQueryData(trashKey, { items: [content(4, "2026-09-12T01:00:00Z")], total: 1, page: 0, size: 20 });
  await client.invalidateQueries({ queryKey: trashKey });
  let finish!: () => void, pending = true;
  vi.spyOn(api, "contents").mockImplementation(async (_page, filters) => {
    if (filters?.trash && pending) await new Promise<void>(resolve => { finish = () => { pending = false; resolve(); }; });
    return { items: [content(filters?.trash ? 6 : 5, filters?.trash ? "2026-09-12T01:00:00Z" : null)], total: 1, page: 0, size: 20 };
  });
  const purge = vi.spyOn(api, "purgeContent").mockResolvedValue();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = mount(false, client);
  await screen.findByRole("heading", { name: "一份笔记" });
  await user.click(screen.getByRole("button", { name: "回收站" }));
  expect((screen.getByRole("button", { name: "恢复文稿" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "永久删除" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "永久删除" }));
  expect(purge).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect((screen.getByRole("button", { name: "永久删除" }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole("button", { name: "永久删除" }));
  await waitFor(() => expect(purge).toHaveBeenCalledExactlyOnceWith("draft", 6));
});

it("opens a trashed manuscript read-only and only mounts the writer after a successful restore", async () => {
  vi.spyOn(api, "content").mockResolvedValue(content(3, "2026-09-12T01:00:00Z"));
  const restore = vi.spyOn(api, "restoreContent").mockRejectedValueOnce(new ApiError(409, { code: "REVISION_CONFLICT", detail: "文稿已被其他标签页更新" })).mockResolvedValueOnce(content(4));
  vi.spyOn(api, "revisions").mockResolvedValue({ items: [content(4).latestRevision], total: 1, page: 0, size: 20 });
  const save = vi.spyOn(api, "save");
  const user = mount(true);
  await screen.findByRole("region", { name: "回收站文稿" });
  expect(screen.getByRole("heading", { name: "保留的正文" })).toBeTruthy();
  expect(screen.queryByLabelText("MARKDOWN")).toBeNull();
  await user.click(screen.getByRole("button", { name: "恢复并继续编辑" }));
  await screen.findByText("文稿已被其他标签页更新");
  expect(screen.queryByLabelText("MARKDOWN")).toBeNull();
  await user.click(screen.getByRole("button", { name: "恢复并继续编辑" }));
  await screen.findByLabelText("MARKDOWN");
  expect(restore).toHaveBeenCalledWith("draft", 3);
  expect(save).not.toHaveBeenCalled();
});
