// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdminMedia } from "@hadesd/contracts";
import { api, ApiError } from "../api";
import { navigate, useUi } from "../store";
import MediaLibrary from "./MediaLibrary";

const file = (id: string, extra: Partial<AdminMedia> = {}): AdminMedia => ({ id, filename: `${id}.png`, mime: "image/png", size: 32, createdAt: "2026-09-12T00:00:00Z", referenceCount: 0, canDelete: true, canDeleteHistory: false, ...extra });
function mount(compact = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const insert = vi.fn();
  render(<QueryClientProvider client={client}><MediaLibrary compact={compact} onInsert={compact ? insert : undefined} /></QueryClientProvider>);
  return { client, insert, user: userEvent.setup({ applyAccept: false }) };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps compact results to six server-paged rows and searches the whole library from page one", async () => {
  const media = vi.spyOn(api, "media").mockImplementation(async (page = 0, filters = {}) => ({
    page, size: filters.size ?? 20, total: filters.q ? 1 : 18,
    items: filters.q ? [file("diagram-found")] : Array.from({ length: filters.size ?? 20 }, (_, index) => file(`page${page}-${index}`)),
  }));
  const { user, insert } = mount(true);
  await screen.findByRole("heading", { name: "page0-0.png" });
  expect(screen.getAllByRole("article")).toHaveLength(6);
  expect(media).toHaveBeenLastCalledWith(0, { size: 6, q: "", type: "all", referenced: "all" }, expect.any(AbortSignal));
  expect(screen.queryByRole("button", { name: "删除所选" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "下一页 →" }));
  await screen.findByRole("heading", { name: "page1-0.png" });
  await user.type(screen.getByRole("searchbox", { name: "搜索全部媒体" }), "diagram");
  await screen.findByRole("heading", { name: "diagram-found.png" });
  expect(media).toHaveBeenLastCalledWith(0, expect.objectContaining({ q: "diagram", size: 6 }), expect.any(AbortSignal));
  await user.click(screen.getByRole("button", { name: "插入正文" }));
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: "diagram-found" }));
});

it("selects the current page, confirms deletion and reports protected files individually", async () => {
  let items = [file("free"), file("published", { referenceCount: 2, canDelete: false })];
  vi.spyOn(api, "media").mockImplementation(async () => ({ items, page: 0, size: 20, total: items.length }));
  const remove = vi.spyOn(api, "deleteMediaBatch").mockImplementation(async () => {
    items = items.filter(item => item.id !== "free");
    return { results: [{ id: "free", status: "DELETED", message: "文件已删除" }, { id: "published", status: "REFERENCED", code: "MEDIA_REFERENCED", message: "当前线上版本引用此文件，不能删除" }] };
  });
  const { user } = mount();
  await screen.findByRole("heading", { name: "free.png" });
  await user.click(screen.getByRole("checkbox", { name: "全选当前页媒体" }));
  await user.click(screen.getByRole("button", { name: "删除所选" }));
  expect(remove).not.toHaveBeenCalled();
  const confirmation = screen.getByRole("region", { name: "确认删除媒体" });
  expect(document.activeElement).toBe(confirmation);
  expect(confirmation.textContent).toContain("free.png、published.png");
  await user.click(within(confirmation).getByRole("button", { name: "确认删除所选" }));
  await screen.findByText("published.png — 当前线上版本引用此文件，不能删除");
  expect(remove).toHaveBeenCalledExactlyOnceWith(["free", "published"], false);
  await waitFor(() => expect(screen.queryByRole("heading", { name: "free.png" })).toBeNull());
  expect((screen.getByRole("checkbox", { name: "选择 published.png" }) as HTMLInputElement).checked).toBe(true);
});

it("requires a separate explicit acknowledgement before removing old unpublished-history attachments", async () => {
  vi.spyOn(api, "media").mockResolvedValue({ items: [file("old-draft", { referenceCount: 1, canDelete: false, canDeleteHistory: true })], page: 0, size: 20, total: 1 });
  const remove = vi.spyOn(api, "deleteMediaBatch").mockResolvedValue({ results: [{ id: "old-draft", status: "DELETED", message: "旧修订附件已清理" }] });
  const { user } = mount();
  await user.click(await screen.findByRole("button", { name: "清理后删除" }));
  const button = screen.getByRole("button", { name: "确认删除所选" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true); expect(remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox", { name: /同时清理从未发布的旧修订/ }));
  await user.click(button);
  await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith(["old-draft"], true));
});

it("uploads valid files in a batch, reports invalid files, and does not announce a rejected upload as success", async () => {
  vi.spyOn(api, "media").mockResolvedValue({ items: [], page: 0, size: 20, total: 0 });
  const upload = vi.spyOn(api, "upload").mockImplementation(async selected => {
    if (selected.name === "failed.png") throw new Error("配额不足");
    return file("uploaded", { filename: selected.name });
  });
  const { user } = mount();
  const files = [new File(["image"], "good.png", { type: "image/png" }), new File(["image"], "failed.png", { type: "image/png" }), new File(["<svg/>"], "invalid.svg", { type: "image/svg+xml" })];
  await user.upload(screen.getByLabelText("上传媒体文件"), files);
  await screen.findByText("上传完成：成功 1 个，失败 2 个。");
  expect(upload).toHaveBeenCalledTimes(2);
  expect(screen.getByText("failed.png — 配额不足")).toBeTruthy();
  expect(screen.getByText(/invalid.svg — 仅支持/)).toBeTruthy();
});

it("clears selection immediately when a filter changes and keeps failed deletions selected", async () => {
  vi.spyOn(api, "media").mockResolvedValue({ items: [file("selected")], page: 0, size: 20, total: 1 });
  const remove = vi.spyOn(api, "deleteMediaBatch").mockRejectedValue(new ApiError(503, { detail: "数据库暂时不可用" }));
  const { user } = mount();
  await user.click(await screen.findByRole("checkbox", { name: "选择 selected.png" }));
  await user.click(screen.getByRole("button", { name: "删除所选" }));
  await user.click(screen.getByRole("button", { name: "确认删除所选" }));
  await screen.findByText("数据库暂时不可用");
  expect(remove).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("checkbox", { name: "选择 selected.png" }) as HTMLInputElement).checked).toBe(true);
  await user.selectOptions(screen.getByRole("combobox", { name: "媒体类型" }), "image");
  await waitFor(() => expect((screen.getByRole("checkbox", { name: "选择 selected.png" }) as HTMLInputElement).checked).toBe(false));
  expect(screen.queryByRole("region", { name: "确认删除媒体" })).toBeNull();
});

it("explains latest-draft and retained-release references without pretending that used files are unreferenced", async () => {
  vi.spyOn(api, "media").mockResolvedValue({ items: [file("protected", { referenceCount: 2, canDelete: false })], page: 0, size: 20, total: 1 });
  const references = vi.spyOn(api, "mediaReferences").mockResolvedValue({ items: [
    { kind: "DRAFT", contentId: "draft-1", revisionId: "revision-1", releaseId: null, title: "回收站里的笔记", deleted: true, current: true, protected: true },
    { kind: "RELEASE", contentId: "draft-1", revisionId: "revision-1", releaseId: "release-1", title: "保留线上版本", deleted: false, current: true, protected: true },
  ], page: 0, size: 10, total: 2 });
  const { user } = mount();
  await user.click(await screen.findByRole("button", { name: "引用详情" }));
  await screen.findByText("回收站里的笔记");
  expect(references).toHaveBeenCalledWith("protected", 0, expect.any(AbortSignal));
  expect(screen.getByRole("region", { name: "引用详情 protected.png" }).textContent).toContain("当前线上");
  expect(document.activeElement).toBe(screen.getByRole("region", { name: "引用详情 protected.png" }));
  expect(screen.getAllByText("受保护，不能删除附件")).toHaveLength(2);
  expect(screen.getByText("回收站里的笔记").closest("li")?.textContent).not.toContain("当前线上");
});

it("guards application navigation throughout an upload batch and releases the guard after results are saved", async () => {
  vi.spyOn(api, "media").mockResolvedValue({ items: [], page: 0, size: 20, total: 0 });
  let finish!: () => void;
  vi.spyOn(api, "upload").mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); return file("uploaded"); });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { user } = mount();
  await user.upload(screen.getByLabelText("上传媒体文件"), new File(["image"], "pending.png", { type: "image/png" }));
  expect(useUi.getState().pendingSave).toBe(true);
  expect(navigate({ view: "contents" })).toBe(false);
  expect(confirm).toHaveBeenCalledOnce();
  finish();
  await screen.findByText("上传完成：成功 1 个，失败 0 个。");
  expect(useUi.getState().pendingSave).toBe(false);
  expect(navigate({ view: "contents" })).toBe(true);
});

it("clears a selection made while debounced search still showed old results", async () => {
  vi.spyOn(api, "media").mockResolvedValue({ items: [file("selected")], page: 0, size: 20, total: 1 });
  const { user } = mount();
  await screen.findByRole("checkbox", { name: "选择 selected.png" });
  await user.type(screen.getByRole("searchbox", { name: "搜索全部媒体" }), "new");
  await user.click(screen.getByRole("checkbox", { name: "选择 selected.png" }));
  expect((screen.getByRole("checkbox", { name: "选择 selected.png" }) as HTMLInputElement).checked).toBe(true);
  await waitFor(() => expect((screen.getByRole("checkbox", { name: "选择 selected.png" }) as HTMLInputElement).checked).toBe(false));
});
