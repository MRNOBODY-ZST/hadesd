import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import AccountPanel, { MyFiles } from "./AccountPanel";
const mocks = vi.hoisted(() => ({ files: vi.fn(), myComments: vi.fn(), upload: vi.fn(), identity: "A" }));
vi.mock("./api", () => ({ community: mocks, errorText: (e: Error) => e.message, fileSize: (n: number) => `${n} B`, fileUrl: (id: string) => `/file/${id}` }));
vi.mock("./Account", () => ({ useAccount: () => ({ user: { id: mocks.identity, displayName: mocks.identity, username: mocks.identity, role: "READER" }, setUser: vi.fn(), logout: vi.fn(), open: vi.fn() }) }));
vi.mock("./Dialog", () => ({ AccountDialog: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
const page = (items: unknown[]) => ({ items, page: 0, size: 10, total: items.length });
const file = { id: "private-A", filename: "private-A.txt", mime: "text/plain", size: 40, createdAt: "2026-11-11" };
beforeEach(() => { mocks.identity = "A"; });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("unmounts private file data immediately when the signed-in identity changes", async () => {
  let resolveOld!: (data: unknown) => void;
  mocks.files.mockImplementationOnce(() => Promise.resolve(page([file]))).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const view = render(<AccountPanel initialView="files" onClose={() => {}} />);
  await screen.findByText("private-A.txt");
  mocks.identity = "B"; view.rerender(<AccountPanel initialView="files" onClose={() => {}} />);
  expect(screen.queryByText("private-A.txt")).toBeNull();
  await act(async () => resolveOld(page([])));
  expect(mocks.files).toHaveBeenCalledTimes(2);
});
it("ignores an old private-list response after account replacement", async () => {
  let resolveOld!: (data: unknown) => void;
  mocks.files.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(page([]));
  const view = render(<AccountPanel initialView="files" onClose={() => {}} />);
  mocks.identity = "B"; view.rerender(<AccountPanel initialView="files" onClose={() => {}} />);
  await act(async () => resolveOld(page([file])));
  expect(screen.queryByText("private-A.txt")).toBeNull();
  expect(mocks.files.mock.calls[0][1].aborted).toBe(true);
});
it("remounts private comments when the signed-in identity changes", async () => {
  mocks.myComments.mockResolvedValueOnce(page([{ id: "a", body: "A的私有评论", createdAt: "2026-11-11", attachments: [] }])).mockResolvedValue(page([]));
  const view = render(<AccountPanel initialView="comments" onClose={() => {}} />);
  await screen.findByText("A的私有评论");
  mocks.identity = "B"; view.rerender(<AccountPanel initialView="comments" onClose={() => {}} />);
  expect(screen.queryByText("A的私有评论")).toBeNull();
  await waitFor(() => expect(mocks.myComments).toHaveBeenCalledTimes(2));
});
it("stops an upload batch after its account panel is unmounted", async () => {
  let complete!: (data: unknown) => void;
  mocks.files.mockResolvedValue(page([])); mocks.upload.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = render(<MyFiles />);
  await act(async () => fireEvent.change(screen.getByLabelText("上传文件"), { target: { files: [new File(["A"], "a.txt"), new File(["B"], "b.txt")] } }));
  view.unmount(); await act(async () => complete(file));
  expect(mocks.upload).toHaveBeenCalledTimes(1);
});
it("keeps upload errors visible after refreshing previously uploaded files", async () => {
  mocks.files.mockResolvedValue(page([])); mocks.upload.mockRejectedValue(new Error("文件超过大小限制"));
  render(<MyFiles />);
  await act(async () => fireEvent.change(screen.getByLabelText("上传文件"), { target: { files: [new File(["A"], "a.txt")] } }));
  await waitFor(() => expect(mocks.files).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("alert").textContent).toContain("文件超过大小限制");
});
