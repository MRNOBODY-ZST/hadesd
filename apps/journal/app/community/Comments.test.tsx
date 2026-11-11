import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Comments } from "./Comments";
const mocks = vi.hoisted(() => ({ identity: "A" as string | null, comments: vi.fn(), upload: vi.fn(), addComment: vi.fn(), open: vi.fn() }));
vi.mock("./Account", () => ({ useAccount: () => ({ user: mocks.identity ? { id: mocks.identity, displayName: mocks.identity, role: "READER" } : null, open: mocks.open }) }));
vi.mock("./api", () => ({ community: mocks, errorText: (error: Error) => error.message, fileSize: () => "1 KB", fileUrl: (id: string) => `/file/${id}` }));
vi.mock("@hadesd/markdown", () => ({ Markdown: ({ source }: { source: string }) => <div>{source}</div>, MarkdownImage: () => null }));
beforeEach(() => { mocks.identity = "A"; mocks.comments.mockResolvedValue({ items: [], total: 0, page: 0, size: 10 }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("opens login instead of creating an anonymous composer", async () => {
  mocks.identity = null; render(<Comments contentId="post" />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "登录后评论" })));
  expect(mocks.open).toHaveBeenCalledWith("login"); expect(screen.queryByRole("textbox")).toBeNull();
});
it("retains a draft on session expiry, then clears it if another account signs in", async () => {
  const view = render(<Comments contentId="post" />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "写评论" })));
  fireEvent.change(screen.getByRole("textbox", { name: "评论正文" }), { target: { value: "A的草稿" } });
  mocks.identity = null; view.rerender(<Comments contentId="post" />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A的草稿");
  mocks.identity = "B"; view.rerender(<Comments contentId="post" />);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "写评论" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
});
it("discards a late upload and stops the remaining batch after an account switch", async () => {
  let complete!: (value: unknown) => void;
  mocks.upload.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = render(<Comments contentId="post" />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "写评论" })));
  fireEvent.change(screen.getByLabelText("添加评论附件"), { target: { files: [new File(["a"], "private-a.txt"), new File(["b"], "private-b.txt")] } });
  mocks.identity = "B"; view.rerender(<Comments contentId="post" />);
  await act(async () => complete({ id: "a", filename: "private-a.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "写评论" }));
  expect(screen.queryByText("private-a.txt")).toBeNull(); expect(mocks.upload).toHaveBeenCalledTimes(1);
});
it("preserves the draft when publishing fails", async () => {
  mocks.addComment.mockRejectedValue(new Error("连接中断")); render(<Comments contentId="post" />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "写评论" })));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "稍后重新提交" } });
  fireEvent.submit(screen.getByRole("button", { name: "公开发表" }).closest("form")!);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("连接中断"));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("稍后重新提交");
});
