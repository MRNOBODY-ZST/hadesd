import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountProvider } from "./Account";
import { Comments } from "./Comments";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reader = { id: "reader-1", username: "reader", displayName: "读者", role: "USER" };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

it("edits and publishes a comment inside its article without a portal", async () => {
  let saved: { body: string; attachmentIds: string[] } | undefined;
  vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
    if (path.endsWith("/auth/session")) return response({ user: reader });
    if (path.endsWith("/auth/csrf")) return response({ token: "test", headerName: "X-CSRF-TOKEN" });
    if (path.includes("/contents/article/comments")) {
      if (options?.method === "POST") {
        saved = JSON.parse(options.body as string);
        return response({ id: "comment-1" });
      }
      return response({ items: saved ? [{ id: "comment-1", contentId: "article", body: saved.body, parentId: null, attachments: [], author: reader, createdAt: "2026-09-10T12:00:00Z", updatedAt: "2026-09-10T12:00:00Z" }] : [], page: 0, size: 20, total: saved ? 1 : 0 });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  HTMLDialogElement.prototype.showModal = function () {};
  HTMLDialogElement.prototype.close = function () {};
  render(<AccountProvider><article aria-label="文章"><Comments contentId="article" /></article></AccountProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "发表评论" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "发表评论" }));
  const article = screen.getByRole("article", { name: "文章" });
  const editor = within(article).getByRole("region", { name: "发表评论" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.change(within(editor).getByLabelText("评论内容"), { target: { value: "这条评论来自终端" } });
  const command = within(editor).getByLabelText("程序命令");
  fireEvent.change(command, { target: { value: ":wq" } });
  await act(async () => fireEvent.keyDown(command, { key: "Enter" }));
  await waitFor(() => expect(within(article).queryByRole("region", { name: "发表评论" })).toBeNull());
  await within(article).findByText("这条评论来自终端");
  expect(saved).toEqual({ body: "这条评论来自终端", attachmentIds: [] });
  expect(within(article).queryByRole("region", { name: "发表评论" })).toBeNull();
});
