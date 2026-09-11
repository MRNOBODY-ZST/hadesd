import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BlogComment, Media, UserAccount } from "@hadesd/contracts";
import { community, CommunityError, errorText, fileSize, fileUrl } from "./api";

export const TERMINAL_ACCOUNT_COMMANDS = ["login", "register", "logout", "profile", "passwd", "files", "upload", "download", "comments", "comment", "mycomments"] as const;
export type TerminalAccountLine = { type: "text" | "error"; text: string };
export type TerminalAccountContext = { comment?: BlogComment };
export type TerminalAccountPrompt = { label: string; secret: boolean };
export type TerminalAccountSnapshot = { command: string | null; prompt: TerminalAccountPrompt | null; busy: boolean };
export type TerminalAccountOptions = {
  user: UserAccount | null;
  setUser: (user: UserAccount | null) => void;
  write: (lines: TerminalAccountLine[]) => void;
  resolveContent?: (target?: string) => string | undefined;
};
type Dependencies = {
  api?: typeof community;
  pickFile?: (signal: AbortSignal) => Promise<File | null>;
  download?: (url: string, filename?: string) => void;
};
type Step = "username" | "display" | "password" | "confirm-password" | "current-password" | "comment-body" | "confirm-action";
const FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.zip,.txt,.md,.markdown,.json,.csv,.log,.yaml,.yml,.toml,.ini,.conf";
const passwordError = (value: string) => value.length < 12 || new TextEncoder().encode(value).length > 72
  ? "密码至少 12 个字符，且不超过 72 个 UTF-8 字节。" : null;
const nameError = (value: string) => !value.trim() || value.trim().length > 60 || /[\x00-\x1f\x7f-\x9f]/.test(value)
  ? "昵称应为 1–60 个字符，不能包含控制字符。" : null;

function pickLocalFile(signal: AbortSignal): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = FILE_ACCEPT;
    input.tabIndex = -1; input.setAttribute("aria-hidden", "true"); input.style.display = "none";
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true; input.remove(); signal.removeEventListener("abort", abort); resolve(file);
    };
    const abort = () => finish(null);
    input.addEventListener("change", () => finish(input.files?.[0] || null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    signal.addEventListener("abort", abort, { once: true });
    document.body.appendChild(input);
    if (signal.aborted) finish(null); else input.click();
  });
}
function downloadLocalFile(url: string, filename?: string) {
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename || "";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
}

/** Answers, especially passwords, never enter the shell's parser or command history. */
export function createTerminalAccount(getOptions: () => TerminalAccountOptions, dependencies: Dependencies = {}) {
  const api = dependencies.api || community, pickFile = dependencies.pickFile || pickLocalFile;
  const download = dependencies.download || downloadLocalFile;
  let snapshot: TerminalAccountSnapshot = { command: null, prompt: null, busy: false };
  let step: Step | null = null, username = "", displayName = "", password = "", currentPassword = "";
  let commentLines: string[] = [], attachmentIds: string[] = [], commentContent = "", parentId = "", editId = "";
  let confirmation: (() => Promise<void>) | null = null, cancelRequested = false, disposed = false;
  let identity = getOptions().user?.id, operationIdentity = identity, fileCache: Media[] = [], commentCache: BlogComment[] = [];
  let picker: AbortController | null = null;
  const listeners = new Set<() => void>();
  const update = (next: Partial<TerminalAccountSnapshot>) => {
    snapshot = { ...snapshot, ...next }; if (!disposed) listeners.forEach(listener => listener());
  };
  const sameIdentity = () => operationIdentity === getOptions().user?.id;
  const write = (text: string, type: TerminalAccountLine["type"] = "text") => {
    if (!disposed && (!snapshot.command || ["login", "register", "logout", "passwd"].includes(snapshot.command) || sameIdentity())) getOptions().write([{ type, text }]);
  };
  const fail = (text: string) => write(text, "error");
  const ask = (next: Step, label: string, secret = false) => { step = next; update({ prompt: { label, secret }, busy: false }); };
  const clearSecrets = () => { password = ""; currentPassword = ""; };
  const finish = () => {
    clearSecrets(); step = null; username = ""; displayName = ""; confirmation = null;
    commentLines = []; attachmentIds = []; commentContent = ""; parentId = ""; editId = ""; cancelRequested = false;
    update({ command: null, prompt: null, busy: false });
  };
  const requireUser = () => {
    const user = getOptions().user;
    if (!user) { fail("请先执行 login 登录，或执行 register 创建账号。"); finish(); }
    return user;
  };
  const mutation = async (action: () => Promise<void>, retry?: () => void) => {
    update({ busy: true, prompt: null });
    try { await action(); finish(); }
    catch (error) {
      fail(errorText(error)); clearSecrets();
      if (!disposed && !cancelRequested && retry && !(error instanceof CommunityError && error.status === 401 && !["login", "register"].includes(snapshot.command || ""))) retry();
      else finish();
    }
  };
  const confirm = (label: string, action: () => Promise<void>) => { confirmation = action; ask("confirm-action", `${label} [y/N]: `); };
  function pageNumber(value?: string) {
    if (!value) return 0;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 100000) throw new Error("页码从 1 开始，例如 files 2。");
    return Number(value) - 1;
  }
  function fileReference(value?: string) {
    if (!value) throw new Error("请提供 files 列出的文件 ID 或完整文件名。");
    const matches = fileCache.filter(file => file.id === value || file.filename === value);
    if (matches.length > 1) throw new Error("存在同名文件，请使用完整文件 ID。");
    if (matches[0]) return matches[0];
    if (/^[a-f0-9-]{36}$/i.test(value)) return { id: value, filename: "" };
    throw new Error("未找到该文件。先执行 files，再使用文件 ID 或完整文件名。");
  }
  function printComment(comment: BlogComment) {
    return `${comment.id}  @${comment.author.username}  ${comment.createdAt.slice(0, 16).replace("T", " ")}${comment.parentId ? `  ↳ ${comment.parentId}` : ""}\n${comment.body}${comment.attachments.length ? `\n附件：${comment.attachments.map(file => `${file.filename} (${file.id})`).join(" · ")}` : ""}`;
  }
  async function listComments(own: boolean, args: string[]) {
    const numberOnly = !own && args.length === 1 && /^\d+$/.test(args[0]);
    const target = own || numberOnly ? undefined : args[0], page = pageNumber(own || numberOnly ? args[0] : args[1]);
    const content = own ? "" : getOptions().resolveContent?.(target);
    if (!own && !content) throw new Error("请先 open 一篇文章，或使用 comments /posts/文章名。");
    const result = own ? await api.myComments(page) : await api.comments(content!, page);
    if (!sameIdentity()) return;
    commentCache = result.items;
    write(`${own ? "MY COMMENTS" : "COMMENTS"}  第 ${page + 1} / ${Math.max(1, Math.ceil(result.total / result.size))} 页 · 共 ${result.total} 条\n${result.items.map(printComment).join("\n\n") || "暂无评论。"}\n${own ? "mycomments" : `comments ${target || ""}`} ${page + 2} 查看下一页 · comment 发表评论`);
  }
  async function upload() {
    write("选择本地文件；上传进度与结果将在终端中显示。Ctrl+C 可取消选择。");
    picker = new AbortController();
    const file = await pickFile(picker.signal); picker = null;
    if (!file || cancelRequested || !sameIdentity()) { write("已取消上传。"); return; }
    write(`正在上传 ${file.name} (${fileSize(file.size)})…`);
    const media = await api.upload(file); if (!sameIdentity()) return;
    fileCache = [media, ...fileCache.filter(item => item.id !== media.id)];
    write(`上传完成：${media.filename}\nID  ${media.id}\n下载：download ${media.id}\n评论附件：在 comment 输入 .attach ${media.id}`);
  }
  function startComposer(content: string, reply = "", edit?: BlogComment) {
    commentContent = content; parentId = reply; editId = edit?.id || "";
    commentLines = edit ? edit.body.split("\n") : []; attachmentIds = edit?.attachments.map(file => file.id) || [];
    if (edit) write(`原评论：\n${edit.body}\n输入 .clear 清空原文后重写。`);
    write("逐行输入 Markdown。单独一行 . 结束并确认发布；.preview 预览原文；.clear 清空；.attach ID 附件；Ctrl+C 取消。最多 4000 字、4 个附件。");
    ask("comment-body", "comment> ");
  }
  async function handleComment(args: string[]) {
    if (!requireUser()) return;
    const [action, reference, target] = args;
    if (action === "rm" || action === "delete") {
      if (!reference || args.length !== 2) throw new Error("用法：comment rm <评论 ID>");
      const cached = commentCache.find(item => item.id === reference);
      confirm(`删除评论 ${reference}`, async () => {
        await api.deleteComment(reference, !!cached && cached.author.id !== getOptions().user?.id && getOptions().user?.role === "ADMIN");
        write("评论已删除。");
        window.dispatchEvent(new CustomEvent("hadesd:comments-updated", { detail: { contentId: cached?.contentId, operation: "deleted" } }));
      });
    } else if (action === "edit") {
      if (!reference || args.length !== 2) throw new Error("用法：comment edit <评论 ID>");
      const cached = commentCache.find(item => item.id === reference);
      if (!cached) throw new Error("请先用 comments 或 mycomments 列出这条评论，再执行编辑。");
      if (cached.author.id !== getOptions().user?.id) throw new Error("只能编辑自己的评论。");
      startComposer(cached.contentId, "", cached);
    } else {
      if (action === "reply" && !reference) throw new Error("用法：comment reply <评论 ID> [文章路径]");
      if (args.length > (action === "reply" ? 3 : 1)) throw new Error("用法：comment [文章路径]，然后逐行输入正文。");
      const cached = action === "reply" ? commentCache.find(item => item.id === reference) : undefined;
      const content = action === "reply"
        ? target ? getOptions().resolveContent?.(target) : cached?.contentId || getOptions().resolveContent?.()
        : getOptions().resolveContent?.(action);
      if (!content) throw new Error("请先 open 一篇文章，或使用 comment /posts/文章名。");
      startComposer(content, action === "reply" ? cached?.parentId || reference : "");
    }
  }
  function syncIdentity() {
    const next = getOptions().user?.id;
    if (identity === next) return;
    identity = next; fileCache = []; commentCache = [];
    if (snapshot.command && !["login", "register", "logout", "passwd"].includes(snapshot.command)) {
      clearSecrets();
      if (snapshot.busy) { cancelRequested = true; picker?.abort(); }
      else { finish(); write("账号已变化，已取消当前交互。"); }
    }
  }
  async function start(command: string, args: string[] = [], context: TerminalAccountContext = {}): Promise<boolean> {
    if (!(TERMINAL_ACCOUNT_COMMANDS as readonly string[]).includes(command)) return false;
    syncIdentity();
    if (snapshot.command) { fail("当前交互尚未结束。请回答提示，或按 Ctrl+C 取消。"); return true; }
    operationIdentity = getOptions().user?.id;
    if (context.comment) commentCache = [context.comment, ...commentCache.filter(item => item.id !== context.comment!.id)];
    update({ command, prompt: null, busy: false });
    try {
      if (command === "login" || command === "register") {
        if (args.length > (command === "login" ? 1 : 0)) throw new Error(`请执行 ${command}${command === "login" ? " [用户名]" : ""}，随后在密码提示中输入密码。不要把密码写进命令。`);
        if (getOptions().user) { write(`当前已登录 @${getOptions().user!.username}，如需切换账号请先 logout。`); finish(); return true; }
        write(`${command === "register" ? "CREATE ACCOUNT" : "SIGN IN"} · Ctrl+C 取消 · 密码输入不回显`);
        username = args[0] || "";
        if (username) ask("password", "Password: ", true); else ask("username", "Username: ");
      } else if (command === "logout") {
        if (args.length) throw new Error("用法：logout");
        if (!requireUser()) return true;
        await mutation(async () => { await api.logout(); getOptions().setUser(null); fileCache = []; commentCache = []; write("已退出。当前为 guest 会话。"); });
      } else if (command === "profile") {
        const user = requireUser(); if (!user) return true;
        if (args.length > 1 || args[0] && args[0] !== "edit") throw new Error("用法：profile 或 profile edit");
        write(`USERNAME  ${user.username}\nNAME      ${user.displayName}\nROLE      ${user.role}\nID        ${user.id}`);
        if (args[0] === "edit") ask("display", "New display name: "); else { write("修改昵称：profile edit · 修改密码：passwd · 文件：files · 我的评论：mycomments"); finish(); }
      } else if (command === "passwd") {
        if (args.length) throw new Error("用法：passwd。密码只能在接下来的隐藏提示中输入。");
        if (!requireUser()) return true;
        write("CHANGE PASSWORD · 密码至少 12 个字符，最多 72 个 UTF-8 字节。Ctrl+C 取消。"); ask("current-password", "Current password: ", true);
      } else if (command === "files" || command === "upload" || command === "download") {
        if (!requireUser()) return true;
        const action = command === "files" ? args[0] || "ls" : command;
        const rest = command === "files" ? args.slice(1) : args;
        if (action === "upload") {
          if (rest.length) throw new Error("用法：upload 或 files upload");
          await mutation(upload);
        } else if (action === "download" || action === "rm" || action === "delete") {
          if (rest.length !== 1) throw new Error(`用法：${action === "download" ? "download" : "files rm"} <文件 ID 或文件名>`);
          const file = fileReference(rest[0]);
          if (action === "download") { download(fileUrl(file.id, false, true), file.filename); write(`已请求下载：${file.filename || file.id}`); finish(); }
          else confirm(`永久删除文件 ${file.filename || file.id}`, async () => { await api.deleteFile(file.id); fileCache = fileCache.filter(item => item.id !== file.id); write("文件已删除。"); });
        } else {
          if (action !== "ls" && !/^\d+$/.test(action)) throw new Error("用法：files [页码] | files upload | files download <ID> | files rm <ID>");
          if (rest.length > (action === "ls" ? 1 : 0)) throw new Error("用法：files [页码] 或 files ls [页码]");
          const page = pageNumber(action === "ls" ? rest[0] : action);
          await mutation(async () => {
            const result = await api.files(page); if (!sameIdentity()) return;
            fileCache = result.items;
            write(`MY FILES  第 ${page + 1} / ${Math.max(1, Math.ceil(result.total / result.size))} 页 · 共 ${result.total} 个\n${result.items.map(file => `${file.id}  ${fileSize(file.size).padStart(8)}  ${file.filename}`).join("\n") || "暂无文件。"}\n上传：upload · 下载：download <ID> · 删除：files rm <ID> · 下一页：files ${page + 2}`);
          });
        }
      } else if (command === "comments" || command === "mycomments") {
        const own = command === "mycomments";
        if (own && !requireUser()) return true;
        if (args.length > (own ? 1 : 2)) throw new Error(`用法：${own ? "mycomments [页码]" : "comments [文章路径] [页码]"}`);
        await mutation(() => listComments(own, args));
      } else if (command === "comment") await handleComment(args);
    } catch (error) { fail(errorText(error)); finish(); }
    return true;
  }
  async function submit(text: string) {
    syncIdentity();
    if (snapshot.busy || !snapshot.prompt || !step) return;
    // Never pass secret answers to transcript callbacks, React state, or localStorage.
    if (!snapshot.prompt.secret) write(`${snapshot.prompt.label}${text}`);
    const command = snapshot.command;
    if (step === "username") {
      const value = text.trim();
      if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(value)) { fail("用户名应为 3–32 位小写字母、数字、点、横线或下划线。"); return; }
      username = value;
      if (command === "register") ask("display", `Display name [${username}]: `); else ask("password", "Password: ", true);
    } else if (step === "display") {
      const value = text.trim() || (command === "register" ? username : "");
      const error = nameError(value); if (error) { fail(error); return; }
      displayName = value;
      if (command === "profile") await mutation(async () => { const user = await api.profile(value); if (!sameIdentity()) return; getOptions().setUser(user); write(`昵称已更新：${user.displayName}`); }, () => ask("display", "New display name: "));
      else { write("密码至少 12 个字符，最多 72 个 UTF-8 字节。"); ask("password", "Password: ", true); }
    } else if (step === "current-password") {
      if (!text || new TextEncoder().encode(text).length > 72) { fail("请输入有效的当前密码。"); return; }
      currentPassword = text; ask("password", "New password: ", true);
    } else if (step === "password") {
      if (command === "login") {
        if (!text || new TextEncoder().encode(text).length > 72) { fail("请输入有效的密码。"); return; }
        const name = username;
        await mutation(async () => { const user = await api.login(name, text); getOptions().setUser(user); write(`登录成功。欢迎回来，${user.displayName} (@${user.username})。`); }, () => ask("password", "Password: ", true));
      } else {
        const error = passwordError(text); if (error) { fail(error); return; }
        password = text; ask("confirm-password", "Confirm password: ", true);
      }
    } else if (step === "confirm-password") {
      if (text !== password) { password = ""; fail("两次密码不一致，请重新输入新密码。"); ask("password", command === "passwd" ? "New password: " : "Password: ", true); return; }
      const nextPassword = password, previousPassword = currentPassword, name = username, display = displayName;
      clearSecrets();
      if (command === "register") {
        let created = false;
        await mutation(async () => {
          await api.register({ username: name, displayName: display, password: nextPassword }); created = true;
          write(`账号 @${name} 已创建，正在登录…`);
          const user = await api.login(name, nextPassword); getOptions().setUser(user); write(`注册并登录成功。欢迎，${user.displayName}。`);
        }, () => {
          if (created) { update({ command: "login" }); username = name; write("账号已经创建，请重新输入密码登录。"); ask("password", "Password: ", true); }
          else { write("注册尚未完成，请重新选择用户名。Ctrl+C 取消。"); ask("username", "Username: "); }
        });
      } else await mutation(async () => { await api.password(previousPassword, nextPassword); getOptions().setUser(null); write("密码已更新，会话已注销。请执行 login 重新登录。"); }, () => ask("current-password", "Current password: ", true));
    } else if (step === "comment-body") {
      if (text === ".preview") { write(`${commentLines.join("\n") || "(空正文)"}${attachmentIds.length ? `\n附件 ID：${attachmentIds.join(", ")}` : ""}`); return; }
      if (text === ".clear") { commentLines = []; attachmentIds = []; write("正文和附件已清空。"); return; }
      if (text.startsWith(".attach ")) {
        const id = text.slice(8).trim();
        if (!/^[a-f0-9-]{36}$/i.test(id)) { fail("请输入 upload 或 files 返回的完整文件 ID。"); return; }
        if (attachmentIds.includes(id)) { fail("该附件已添加。"); return; }
        if (attachmentIds.length >= 4) { fail("每条评论最多 4 个附件。"); return; }
        attachmentIds.push(id); write(`已添加附件 ${id}（发布后可公开访问）。`); return;
      }
      if (text === ".") {
        const body = commentLines.join("\n").trim();
        if (!body) { fail("评论内容不能为空。"); return; }
        const content = commentContent, editing = editId, input = { body, attachmentIds: [...attachmentIds], ...(parentId ? { parentId } : {}) };
        write(`即将${editing ? "更新" : "发布"}：\n${body}${attachmentIds.length ? `\n包含 ${attachmentIds.length} 个公开附件。` : ""}`);
        confirm(editing ? "保存评论修改" : "公开发布评论", async () => {
          const comment = editing ? await api.editComment(editing, input) : await api.addComment(content, input);
          write(`评论已${editing ? "更新" : "发布"}。\nID  ${comment.id}`);
          window.dispatchEvent(new CustomEvent("hadesd:comments-updated", { detail: { contentId: content, operation: editing ? "updated" : "created" } }));
        });
      } else {
        const next = [...commentLines, text];
        if (next.join("\n").length > 4000) { fail("评论不能超过 4000 个字符。这一行尚未加入。"); return; }
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) { fail("评论不能包含控制字符。"); return; }
        commentLines = next;
      }
    } else if (step === "confirm-action") {
      if (/^(y|yes)$/i.test(text.trim())) {
        const action = confirmation;
        if (action) await mutation(action, () => ask("confirm-action", "操作未成功，是否重试 [y/N]: "));
      } else if (!text.trim() || /^(n|no)$/i.test(text.trim())) { write("已取消。"); finish(); }
      else fail("请输入 y 确认，或 n / 回车取消。");
    }
  }
  function cancel() {
    if (!snapshot.command) return;
    clearSecrets();
    if (snapshot.busy) {
      if (!cancelRequested) write(picker ? "^C 正在取消文件选择…" : "^C 请求已经提交，等待服务器确认后结束交互。");
      cancelRequested = true; picker?.abort();
    } else { write("^C 已取消。"); finish(); }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start, submit, cancel, syncIdentity,
    activate: () => { disposed = false; },
    dispose: () => { disposed = true; picker?.abort(); finish(); fileCache = []; commentCache = []; listeners.clear(); },
  };
}

export function useTerminalAccount(options: TerminalAccountOptions) {
  const latest = useRef(options); latest.current = options;
  const [machine] = useState(() => createTerminalAccount(() => latest.current));
  const snapshot = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot);
  useEffect(() => { machine.syncIdentity(); }, [machine, options.user?.id]);
  useEffect(() => { machine.activate(); return () => machine.dispose(); }, [machine]);
  return { ...snapshot, start: machine.start, submit: machine.submit, cancel: machine.cancel };
}
