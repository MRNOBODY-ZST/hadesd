import { expect, it, vi } from "vitest";
import type { BlogComment, UserAccount } from "@hadesd/contracts";
import { community, CommunityError } from "./api";
import { createTerminalAccount, type TerminalAccountLine, type TerminalAccountOptions } from "./terminalAccount";

const user: UserAccount = { id: "reader-1", username: "reader", displayName: "读者", role: "USER" };
const id = "6a4a975e-d160-4c04-b2c7-1726de90f12f";
const password = "long-test-password-42!";
const comment: BlogComment = { id, contentId: "post-1", parentId: null, body: "原有评论", author: user, attachments: [], createdAt: "2026-09-12T10:00:00Z", updatedAt: "2026-09-12T10:00:00Z" };
function setup(initialUser: UserAccount | null = null) {
  const writes: TerminalAccountLine[] = [];
  const api = { ...community, login: vi.fn(async () => user), register: vi.fn(async () => user), logout: vi.fn(async () => {}),
    profile: vi.fn(async (displayName: string) => ({ ...user, displayName })), password: vi.fn(async () => {}),
    files: vi.fn(async () => ({ items: [{ id, filename: "notes.md", mime: "text/markdown", size: 1024, createdAt: "2026-09-12" }], page: 0, size: 10, total: 1 })),
    deleteFile: vi.fn(async () => {}), upload: vi.fn(async (file: File) => ({ id, filename: file.name, mime: file.type, size: file.size, createdAt: "2026-09-12" })),
    comments: vi.fn(async () => ({ items: [comment], page: 0, size: 10, total: 1 })), myComments: vi.fn(async () => ({ items: [comment], page: 0, size: 10, total: 1 })),
    addComment: vi.fn(async () => comment), editComment: vi.fn(async () => comment), deleteComment: vi.fn(async () => {}),
  };
  const options: TerminalAccountOptions = { user: initialUser, write: lines => writes.push(...lines), setUser: value => { options.user = value; }, resolveContent: target => !target || target === "/posts/test" ? "post-1" : undefined };
  const download = vi.fn(), pickFile = vi.fn(async (_signal: AbortSignal): Promise<File | null> => null);
  const machine = createTerminalAccount(() => options, { api, download, pickFile });
  return { machine, options, writes, api, download, pickFile, text: () => writes.map(line => line.text).join("\n") };
}

it("registers line by line, logs in, and never exposes a password in observable state or transcript", async () => {
  const t = setup();
  expect(await t.machine.start("register")).toBe(true);
  await t.machine.submit("reader"); await t.machine.submit("读者");
  expect(t.machine.getSnapshot().prompt).toMatchObject({ secret: true, label: "Password: " });
  await t.machine.submit(password);
  expect(JSON.stringify(t.machine.getSnapshot())).not.toContain(password);
  expect(t.api.register).not.toHaveBeenCalled();
  await t.machine.submit(password);
  expect(t.api.register).toHaveBeenCalledExactlyOnceWith({ username: "reader", displayName: "读者", password });
  expect(t.api.login).toHaveBeenCalledExactlyOnceWith("reader", password);
  expect(t.options.user).toEqual(user);
  expect(t.machine.getSnapshot()).toEqual({ command: null, prompt: null, busy: false });
  expect(t.text()).toContain("注册并登录成功"); expect(t.text()).not.toContain(password);
});

it("validates UTF-8 byte limits and re-prompts after confirmation mismatch without submitting", async () => {
  const t = setup(); await t.machine.start("register");
  await t.machine.submit("Invalid Name"); expect(t.machine.getSnapshot().prompt?.label).toBe("Username: ");
  await t.machine.submit("reader"); await t.machine.submit("");
  await t.machine.submit("密".repeat(25)); expect(t.machine.getSnapshot().prompt?.label).toBe("Password: ");
  await t.machine.submit(password); await t.machine.submit("different-password");
  expect(t.api.register).not.toHaveBeenCalled(); expect(t.machine.getSnapshot().prompt?.label).toBe("Password: ");
  expect(t.text()).not.toContain(password); expect(t.text()).not.toContain("different-password");
});

it("cancels and forgets partially entered credentials; a new command starts from its first prompt", async () => {
  const t = setup(); await t.machine.start("register");
  await t.machine.submit("reader"); await t.machine.submit("name"); await t.machine.submit(password);
  t.machine.cancel(); expect(t.machine.getSnapshot().command).toBeNull();
  await t.machine.start("login"); expect(t.machine.getSnapshot().prompt?.label).toBe("Username: ");
  expect(t.api.register).not.toHaveBeenCalled(); expect(t.api.login).not.toHaveBeenCalled();
  expect(t.text()).not.toContain(password);
});

it("keeps a failed login on a hidden password prompt and allows an explicit retry", async () => {
  const t = setup(); t.api.login.mockRejectedValueOnce(new CommunityError(401, "INVALID_CREDENTIALS", "用户名或密码错误"));
  await t.machine.start("login", ["reader"]); await t.machine.submit("wrong-password");
  expect(t.machine.getSnapshot().prompt).toEqual({ label: "Password: ", secret: true });
  expect(t.api.login).toHaveBeenCalledTimes(1);
  await t.machine.submit(password); expect(t.options.user).toEqual(user);
  expect(t.text()).not.toContain("wrong-password"); expect(t.text()).not.toContain(password);
});

it("does not register twice when registration succeeds but the following login fails", async () => {
  const t = setup(); t.api.login.mockRejectedValueOnce(new CommunityError(401, "INVALID_CREDENTIALS", "登录未完成"));
  await t.machine.start("register"); await t.machine.submit("reader"); await t.machine.submit("");
  await t.machine.submit(password); await t.machine.submit(password);
  expect(t.machine.getSnapshot().command).toBe("login");
  await t.machine.submit(password);
  expect(t.api.register).toHaveBeenCalledTimes(1); expect(t.api.login).toHaveBeenCalledTimes(2);
});

it("rejects passwords passed as command arguments without copying them into error output", async () => {
  const t = setup();
  await t.machine.start("register", ["reader", password]); await t.machine.start("login", ["reader", password]);
  t.options.user = user; await t.machine.start("passwd", [password]);
  expect(t.text()).not.toContain(password); expect(t.api.register).not.toHaveBeenCalled(); expect(t.api.login).not.toHaveBeenCalled();
});

it("changes a password with three hidden prompts and returns the client to guest", async () => {
  const t = setup(user); await t.machine.start("passwd");
  await t.machine.submit("old-long-password"); await t.machine.submit(password); await t.machine.submit(password);
  expect(t.api.password).toHaveBeenCalledExactlyOnceWith("old-long-password", password);
  expect(t.options.user).toBeNull(); expect(t.text()).not.toContain("old-long-password"); expect(t.text()).not.toContain(password);
});

it("does not dispatch another mutation while one is pending, and truthfully reports an accepted cancellation", async () => {
  const t = setup(); let resolve!: (value: UserAccount) => void;
  t.api.login.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await t.machine.start("login", ["reader"]); const pending = t.machine.submit(password);
  expect(t.machine.getSnapshot().busy).toBe(true); t.machine.cancel();
  await t.machine.submit(password); expect(t.api.login).toHaveBeenCalledTimes(1);
  resolve(user); await pending;
  expect(t.options.user).toEqual(user); expect(t.text()).toContain("请求已经提交"); expect(t.text()).toContain("登录成功");
});

it("requires confirmation before deleting a file and supports filename downloads", async () => {
  const t = setup(user); await t.machine.start("files"); await t.machine.start("download", ["notes.md"]);
  expect(t.download).toHaveBeenCalledExactlyOnceWith(`/api/v1/account/files/${id}/content?download=true`, "notes.md");
  await t.machine.start("files", ["rm", "notes.md"]); expect(t.api.deleteFile).not.toHaveBeenCalled();
  await t.machine.submit(""); expect(t.api.deleteFile).not.toHaveBeenCalled();
  await t.machine.start("files", ["rm", id]); await t.machine.submit("y");
  expect(t.api.deleteFile).toHaveBeenCalledExactlyOnceWith(id);
});

it("uses the actual selected file and emits the returned storage ID", async () => {
  const t = setup(user), file = new File(["# File"], "notes.md", { type: "text/markdown" });
  t.pickFile.mockResolvedValueOnce(file); await t.machine.start("upload");
  expect(t.api.upload).toHaveBeenCalledExactlyOnceWith(file); expect(t.text()).toContain(id);
  await t.machine.start("upload"); expect(t.api.upload).toHaveBeenCalledTimes(1); expect(t.text()).toContain("已取消上传");
});

it("collects multiline Markdown and attachment IDs, then posts only after explicit confirmation", async () => {
  const t = setup(user); await t.machine.start("comment");
  await t.machine.submit("## Hello"); await t.machine.submit(""); await t.machine.submit("A second paragraph."); await t.machine.submit(`.attach ${id}`);
  await t.machine.submit("."); expect(t.api.addComment).not.toHaveBeenCalled();
  await t.machine.submit("y");
  expect(t.api.addComment).toHaveBeenCalledExactlyOnceWith("post-1", { body: "## Hello\n\nA second paragraph.", attachmentIds: [id] });
});

it("accepts inline comment context, preserves reply threading, and enforces edit ownership", async () => {
  const t = setup(user);
  await t.machine.start("comment", ["reply", id], { comment: { ...comment, parentId: "parent-1" } });
  await t.machine.submit("回复内容"); await t.machine.submit("."); await t.machine.submit("yes");
  expect(t.api.addComment).toHaveBeenCalledExactlyOnceWith("post-1", { body: "回复内容", attachmentIds: [], parentId: "parent-1" });
  await t.machine.start("comment", ["edit", id], { comment }); await t.machine.submit(".clear"); await t.machine.submit("修改后的正文");
  await t.machine.submit("."); await t.machine.submit("y");
  expect(t.api.editComment).toHaveBeenCalledExactlyOnceWith(id, { body: "修改后的正文", attachmentIds: [] });
  await t.machine.start("comment", ["edit", id], { comment: { ...comment, author: { ...user, id: "somebody-else" } } });
  expect(t.text()).toContain("只能编辑自己的评论"); expect(t.machine.getSnapshot().command).toBeNull();
});

it("maps human page numbers to API pages and forgets private caches when the account changes", async () => {
  const t = setup(user); await t.machine.start("files", ["2"]); expect(t.api.files).toHaveBeenCalledExactlyOnceWith(1);
  await t.machine.start("comments", ["2"]); expect(t.api.comments).toHaveBeenCalledExactlyOnceWith("post-1", 1);
  t.options.user = { ...user, id: "other-user", username: "other" }; t.machine.syncIdentity();
  await t.machine.start("download", ["notes.md"]); expect(t.download).not.toHaveBeenCalled();
});

it("stops an in-progress private composer when another account replaces the session", async () => {
  const t = setup(user); await t.machine.start("comment"); await t.machine.submit("未提交的私人草稿");
  t.options.user = null; t.machine.syncIdentity();
  expect(t.machine.getSnapshot().command).toBeNull(); expect(t.api.addComment).not.toHaveBeenCalled();
  await t.machine.start("files"); expect(t.api.files).not.toHaveBeenCalled(); expect(t.text()).toContain("请先执行 login");
});

it("does not expose a late private file response or its cached names after an account switch", async () => {
  const t = setup(user); let resolve!: (value: Awaited<ReturnType<typeof community.files>>) => void;
  t.api.files.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = t.machine.start("files");
  t.options.user = { ...user, id: "new-owner", username: "new_owner" }; t.machine.syncIdentity();
  resolve({ items: [{ id, filename: "private-old-user.md", size: 100, mime: "text/markdown", createdAt: "2026-09-12" }], page: 0, size: 10, total: 1 });
  await pending;
  expect(t.text()).not.toContain("private-old-user.md");
  await t.machine.start("download", ["private-old-user.md"]); expect(t.download).not.toHaveBeenCalled();
});

it("does not replace a new session with a late profile mutation response", async () => {
  const t = setup(user); let resolve!: (value: UserAccount) => void;
  t.api.profile.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await t.machine.start("profile", ["edit"]); const pending = t.machine.submit("新昵称");
  const nextUser = { ...user, id: "new-owner", username: "new_owner" }; t.options.user = nextUser; t.machine.syncIdentity();
  resolve({ ...user, displayName: "新昵称" }); await pending;
  expect(t.options.user).toEqual(nextUser); expect(t.text()).not.toContain("昵称已更新");
});

it("notifies article readers only after a confirmed comment mutation succeeds", async () => {
  const t = setup(user), listener = vi.fn();
  window.addEventListener("hadesd:comments-updated", listener);
  try {
    await t.machine.start("comment"); await t.machine.submit("新评论"); await t.machine.submit(".");
    expect(listener).not.toHaveBeenCalled(); await t.machine.submit("y");
    expect(listener.mock.calls[0][0].detail).toEqual({ contentId: "post-1", operation: "created" });
    await t.machine.start("comment", ["delete", id], { comment }); await t.machine.submit("n");
    expect(listener).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener("hadesd:comments-updated", listener); }
});

it("replies to the cached comment's article even when another article is open", async () => {
  const t = setup(user);
  await t.machine.start("comment", ["reply", id], { comment: { ...comment, contentId: "different-article" } });
  await t.machine.submit("跨文章回复"); await t.machine.submit("."); await t.machine.submit("y");
  expect(t.api.addComment).toHaveBeenCalledExactlyOnceWith("different-article", { body: "跨文章回复", attachmentIds: [], parentId: id });
});
