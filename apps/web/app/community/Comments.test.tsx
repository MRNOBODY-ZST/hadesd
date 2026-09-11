import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountProvider } from "./Account";
import { Comments } from "./Comments";
import type { BlogComment, UserAccount } from "@hadesd/contracts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const reader: UserAccount = { id: "reader-1", username: "reader", displayName: "读者", role: "USER" };
const item: BlogComment = { id: "comment-1", contentId: "article", body: "**这是一条评论**", parentId: null, attachments: [], author: reader, createdAt: "2026-09-12T12:00:00Z", updatedAt: "2026-09-12T12:00:00Z" };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
function serve(user: UserAccount | null, comments = [item]) {
  const fetch = vi.fn(async (path: string) => {
    if (path.endsWith("/auth/session")) return response({ user });
    if (path.includes("/contents/article/comments")) return response({ items: comments, page: 0, size: 10, total: comments.length });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetch); return fetch;
}

it("routes publish, reply, edit, and delete buttons into text commands without creating a composer form", async () => {
  const fetch = serve(reader), actions: unknown[] = [];
  const onCommand = (event: Event) => actions.push((event as CustomEvent).detail);
  window.addEventListener("hadesd:terminal-command", onCommand);
  try {
    render(<AccountProvider><article aria-label="文章"><Comments contentId="article" /></article></AccountProvider>);
    await screen.findByRole("button", { name: "发表评论" });
    await screen.findByText("这是一条评论");
    fireEvent.click(screen.getByRole("button", { name: "发表评论" }));
    fireEvent.click(screen.getByRole("button", { name: "回复" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑评论" }));
    fireEvent.click(screen.getByRole("button", { name: "删除评论" }));
    expect(actions).toEqual([{ command: "comment article", comment: undefined }, { command: "comment reply comment-1", comment: item }, { command: "comment edit comment-1", comment: item }, { command: "comment delete comment-1", comment: item }]);
    expect(document.querySelector("form, dialog, textarea")).toBeNull();
    expect(fetch.mock.calls.every(([path]) => !path.includes("/account/comments"))).toBe(true);
    expect(screen.getByText("这是一条评论").tagName).toBe("STRONG");
  } finally { window.removeEventListener("hadesd:terminal-command", onCommand); }
});

it("asks guests to log in through a terminal command and only exposes edit actions to the owner", async () => {
  serve(null); const listener = vi.fn(); window.addEventListener("hadesd:terminal-command", listener);
  try {
    render(<AccountProvider><Comments contentId="article" /></AccountProvider>);
    await screen.findByText("这是一条评论");
    fireEvent.click(screen.getByRole("button", { name: "登录后评论" }));
    expect(listener.mock.calls[0][0].detail).toMatchObject({ command: "login" });
    expect(screen.queryByRole("button", { name: "编辑评论" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除评论" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally { window.removeEventListener("hadesd:terminal-command", listener); }
});

it("refreshes the displayed thread after a terminal mutation, but ignores another article's update", async () => {
  let comments = [item];
  const fetch = vi.fn(async (path: string) => path.endsWith("/auth/session") ? response({ user: reader }) : response({ items: comments, page: 0, size: 10, total: comments.length }));
  vi.stubGlobal("fetch", fetch);
  render(<AccountProvider><Comments contentId="article" /></AccountProvider>); await screen.findByText("这是一条评论");
  const reads = fetch.mock.calls.length;
  act(() => window.dispatchEvent(new CustomEvent("hadesd:comments-updated", { detail: { contentId: "other" } })));
  expect(fetch).toHaveBeenCalledTimes(reads);
  comments = [{ ...item, body: "文字终端修改后的评论" }];
  act(() => window.dispatchEvent(new CustomEvent("hadesd:comments-updated", { detail: { contentId: "article", operation: "updated" } })));
  await screen.findByText("文字终端修改后的评论"); expect(screen.queryByText("这是一条评论")).toBeNull();
});

it("changes comment pages without opening another section and preserves public attachments", async () => {
  const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
  vi.stubGlobal("fetch", async (path: string) => {
    if (path.endsWith("/auth/session")) return response({ user: reader });
    const page = Number(new URL(path, "https://example.test").searchParams.get("page"));
    return response({ items: [{ ...item, id: `comment-${page}`, body: `第${page + 1}页`, attachments: [{ id: "file-1", filename: "readme.md", mime: "text/markdown", size: 1200, createdAt: "2026-09-12" }] }], page, size: 1, total: 2 });
  });
  render(<AccountProvider><Comments contentId="article" /></AccountProvider>);
  await screen.findByText("第1页");
  const pagination = screen.getByRole("navigation", { name: "评论分页" });
  fireEvent.click(within(pagination).getByRole("button", { name: "下一页" }));
  await screen.findByText("第2页");
  await waitFor(() => expect(scroll).toHaveBeenCalled());
  expect(screen.getByRole("link", { name: /readme.md/ }).getAttribute("href")).toBe("/api/v1/public/comment-files/file-1?download=true");
  expect(screen.queryByText("第1页")).toBeNull();
});
