import type {
  CrtLevel,
  PublicContent,
  ReleaseSnapshot,
  Theme,
  VfsNode,
} from "@hadesd/contracts";
export type PublicIndex = Omit<PublicContent, "markdown">;
export interface Navigation {
  route: string;
  contentId?: string;
  cwd: string;
}
export type Output =
  | { type: "text" | "error"; text: string }
  | { type: "directory-list"; nodes: VfsNode[]; long: boolean }
  | { type: "help"; commands: Command[] }
  | { type: "navigation"; target: Navigation; text: string }
  | { type: "file"; node: VfsNode; text: string }
  | { type: "markdown"; node: VfsNode; text: string }
  | { type: "clear" };
export interface Command {
  name: string;
  usage: string;
  description: string;
  example: string;
}
export const commands: Command[] = [
  ["help", "[command]", "查看命令与使用示例", "help open"],
  ["ls", "[-la] [path]", "列出目录；-a 包含 . 与 ..", "ls -la /posts"],
  ["cd", "[path|-]", "切换目录；无参数回到家目录，- 回到上次目录", "cd .."],
  ["pwd", "", "显示当前路径", "pwd"],
  ["tree", "[path]", "查看目录树", "tree /"],
  ["cat", "<file> [...]", "输出完整文件原文", "cat /about.md"],
  ["open", "<file>", "在终端历史中阅读 Markdown", "open /posts/example.md"],
  ["vim", "<file>", "打开 Vim；:w 保存草稿，:wq 保存退出", "vim about.md"],
  ["less", "<file>", "滚动阅读文件；与 open 相同", "less /about.md"],
  ["md", "<file>", "渲染 Markdown、代码与图片", "md /about.md"],
  ["preview", "<file>", "Markdown 预览；与 md 相同", "preview /about.md"],
  ["head", "[-n count] <file>", "查看文件前几行，默认 10 行", "head -n 20 /about.md"],
  ["tail", "[-n count] <file>", "查看文件最后几行，默认 10 行", "tail -n 5 /about.md"],
  ["wc", "[-lwc] <file> [...]", "统计行数、词数与 UTF-8 字节数", "wc -l /about.md"],
  ["grep", "[-inv] <text> <file> [...]", "按字面文本查找行；支持忽略大小写、行号、反选", "grep -in terminal /about.md"],
  ["find", "[path] [-name pattern] [-type f|d]", "查找文件；文件名支持 * 和 ?", 'find / -name "*.md"'],
  ["stat", "<path>", "显示虚拟文件元数据", "stat /about.md"],
  ["file", "<path>", "显示文件类型", "file /about.md"],
  ["echo", "[-n] [text ...]", "输出文字；支持 $USER、$HOME、$PWD", 'echo "hello $USER"'],
  ["whoami", "", "显示当前会话用户名", "whoami"],
  ["hostname", "", "显示当前终端主机名", "hostname"],
  ["uname", "[-a]", "显示浏览器虚拟终端环境", "uname -a"],
  ["date", "[-u|--iso]", "显示当前时间", "date --iso"],
  ["uptime", "", "显示本次终端会话运行时间", "uptime"],
  ["env", "", "显示终端的公开环境变量", "env"],
  ["printenv", "[name]", "读取公开环境变量", "printenv HOME"],
  ["basename", "<path> [suffix]", "提取文件名", "basename /about.md .md"],
  ["dirname", "<path>", "提取父目录", "dirname /posts/example.md"],
  ["man", "<command>", "查看命令手册", "man grep"],
  ["search", "<query>", "搜索当前上线内容", 'search "C++ && Rust"'],
  ["tag", "<name>", "按标签浏览", "tag 网络"],
  ["about", "", "关于本站", "about"],
  ["projects", "", "浏览项目", "projects"],
  ["research", "", "浏览研究", "research"],
  ["now", "", "查看近况", "now"],
  ["history", "[--clear]", "查看或清理本会话输入历史", "history --clear"],
  ["clear", "", "仅清空终端输出", "clear"],
  ["theme", "amber|green|paper", "改变本地主题", "theme paper"],
  ["crt", "off|low|full", "改变本地 CRT 效果", "crt low"],
  ["reader", "on|off", "切换专注阅读模式", "reader on"],
  ["reboot", "", "重新播放终端启动", "reboot"],
  ["display", "", "打开显示设置", "display"],
  ["login", "[username]", "通过文字提示登录；密码在私密提示中输入", "login hades"],
  ["register", "", "进入终端注册程序", "register"],
  ["profile", "[edit]", "查看账号或修改昵称", "profile edit"],
  ["passwd", "", "通过私密文字提示修改密码", "passwd"],
  ["files", "[ls [page]|upload|download <id>|rm <id>]", "列出、上传、下载或删除自己的文件", "files ls"],
  ["upload", "", "选择文件并上传到自己的账号", "upload"],
  ["download", "<id|name>", "下载自己的文件", "download notes.pdf"],
  ["mycomments", "[page]", "查看和管理我的评论", "mycomments"],
  ["logout", "", "请求退出当前账号", "logout"],
  ["comments", "[article-path] [page]", "查看当前文章或指定文章评论", "comments /posts/example.md"],
  ["comment", "[article-path]|reply <id>|edit <id>|rm <id>", "逐行撰写评论；单独输入 . 结束并确认", "comment /posts/example.md"],
  [
    "hadesctl",
    "status|projects|now",
    "公开版本与本地显示设置",
    "hadesctl status",
  ],
].map(([name, usage, description, example]) => ({
  name: name!,
  usage: usage!,
  description: description!,
  example: example!,
}));
export function tokenize(input: string, variables?: Record<string, string>): string[] {
  const tokens: string[] = [];
  let word = "",
    quote = "",
    started = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === "\\") {
      if (i + 1 >= input.length)
        throw new Error("末尾的反斜杠需要一个被转义字符。");
      word += input[++i];
      started = true;
      continue;
    }
    if (c === "$" && quote !== "'" && variables) {
      const variable = /^(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/u.exec(input.slice(i + 1));
      if (variable) {
        word += variables[variable[1] ?? variable[2]!] ?? "";
        i += variable[0].length;
        started = true;
        continue;
      }
    }
    if (quote) {
      if (c === quote) quote = "";
      else word += c;
      started = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (/[|;&<>`]/u.test(c) || (c === "$" && input[i + 1] === "("))
      throw new Error(
        "这是浏览器虚拟终端。目前不支持管道、重定向、串联或命令替换；文字中的特殊符号请放在引号内。",
      );
    if (/\s/u.test(c)) {
      if (started) {
        tokens.push(word);
        word = "";
        started = false;
      }
    } else {
      word += c;
      started = true;
    }
  }
  if (quote) throw new Error("引号尚未闭合，请补全后再执行。");
  if (started) tokens.push(word);
  return tokens;
}
export function homeForUser(username = "guest"): string {
  const safeName = username.replace(/[\/\\\0]/gu, "_");
  return `/home/${!safeName || safeName === "." || safeName === ".." ? "guest" : safeName}`;
}
export function normalizePath(input: string, cwd = "/", home = "/"): string {
  const expanded = input.replace(/^~(?=\/|$)/u, home);
  const base = expanded.startsWith("/") ? "" : cwd;
  const stack: string[] = [];
  for (const part of `${base}/${expanded}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}
export function displayPath(path: string, home = "/") {
  if (path === home) return "~";
  return home === "/" ? `~${path}` : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
export function createVfs(contents: PublicIndex[], username = "guest"): VfsNode[] {
  const nodes: VfsNode[] = [
    {
      id: "root",
      kind: "directory",
      path: "/",
      route: "/",
      title: "首页",
      summary: "",
      tags: [],
    },
  ];
  for (const path of ["/home", homeForUser("guest"), homeForUser(username)]) {
    if (nodes.some(node => node.path === path)) continue;
    nodes.push({ id: `vfs:${path}`, kind: "directory", path, route: "/", title: path.split("/").at(-1)!, summary: "浏览器虚拟目录", tags: [] });
  }
  for (const [path, title] of [
    ["posts", "文章"],
    ["projects", "项目"],
    ["research", "研究"],
  ])
    nodes.push({
      id: path!,
      kind: "directory",
      path: `/${path}`,
      route: `/${path}`,
      title: title!,
      summary: "",
      tags: [],
    });
  for (const [path, route, title] of [
    ["about.md", "/about", "关于"],
    ["now.md", "/now", "近况"],
    ["links.json", "/links", "链接"],
  ])
    nodes.push({
      id: path!,
      kind: "file",
      path: `/${path}`,
      route: route!,
      title: title!,
      summary: "",
      tags: [],
    });
  for (const content of contents) {
    const path =
      content.type === "PAGE" ? `/${content.slug}.md` : `${content.route}.md`;
    const existing = nodes.findIndex((n) => n.path === path);
    const node: VfsNode = {
      id: content.id,
      kind: "file",
      path,
      route: content.route,
      title: content.title,
      summary: content.summary,
      tags: content.tags,
      updatedAt: content.updatedAt,
      contentId: content.id,
    };
    if (existing < 0) nodes.push(node);
    else nodes[existing] = node;
  }
  const publicNodes = nodes.filter(node => node.path !== "/" && node.path !== "/home" && !node.path.startsWith("/home/"));
  for (const home of new Set([homeForUser("guest"), homeForUser(username)])) {
    for (const node of publicNodes) nodes.push({ ...node, id: `home:${home}:${node.id}`, path: home + node.path });
  }
  return nodes;
}
export function cwdForRoute(route: string, nodes: VfsNode[]): string {
  // React Router prerender requests end in '/', while client navigation usually
  // omits it. Decode Unicode and normalize both sides so SSR and hydration agree.
  const canonical = (value: string) => {
    try {
      return normalizePath(decodeURI(value));
    } catch {
      return normalizePath(value);
    }
  };
  const pathname = canonical(route);
  const node = nodes.find((n) => canonical(n.route) === pathname);
  return node?.kind === "directory"
    ? node.path
    : node?.path.slice(0, node.path.lastIndexOf("/")) || "/";
}
export function navigationFor(node: VfsNode): Navigation {
  return {
    route: node.route,
    contentId: node.contentId,
    cwd:
      node.kind === "directory"
        ? node.path
        : node.path.slice(0, node.path.lastIndexOf("/")) || "/",
  };
}
export function resolveTarget(
  input: string,
  cwd: string,
  nodes: VfsNode[],
  home = "/",
): VfsNode | undefined {
  const normalized = normalizePath(input, cwd, home);
  return (
    nodes.find((n) => n.path === normalized) ||
    nodes.find((n) => n.route === normalized)
  );
}
export interface Completion {
  value: string;
  caret: number;
  label: string;
}
type CompletionToken = { start: number; end: number; value: string };
/** A tolerant lexer for editing; execution still uses the strict tokenizer. */
function completionTokens(input: string): CompletionToken[] {
  const tokens: CompletionToken[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/u.test(input[i]!)) { i++; continue; }
    const start = i;
    let value = "", quote = "";
    for (; i < input.length; i++) {
      const c = input[i]!;
      if (c === "\\") {
        if (i + 1 < input.length) value += input[++i];
      } else if (quote) {
        if (c === quote) quote = "";
        else value += c;
      } else if (c === "'" || c === '"') quote = c;
      else if (/\s/u.test(c)) break;
      else value += c;
    }
    tokens.push({ start, end: i, value });
  }
  return tokens;
}
function quoteCompletion(value: string, quote: string) {
  if (quote) return quote + value.replace(/\\/gu, "\\\\").replace(quote === "'" ? /'/gu : /"/gu, "\\$&") + quote;
  return value.replace(/[\s\\'"|;&<>`$]/gu, "\\$&");
}
/** Replace just the token under the caret, preserving all following arguments. */
export function completeAt(input: string, caret: number, cwd: string, nodes: VfsNode[], extraCommands: string[] = [], home = "/"): Completion[] {
  const position = Math.max(0, Math.min(caret, input.length));
  const tokens = completionTokens(input);
  const active = tokens.find(t => position >= t.start && position <= t.end);
  const start = active?.start ?? position, end = active?.end ?? position;
  const before = tokens.filter(t => t.end <= start);
  const typed = completionTokens(input.slice(start, position))[0]?.value ?? "";
  const quote = ['"', "'"].includes(input[start] ?? "") ? input[start]! : "";
  const names = [...new Set([...commands.map(c => c.name), ...extraCommands])];
  let values: { text: string; directory?: boolean }[] = [];
  if (!before.length) values = names.map(text => ({ text }));
  else {
    const command = before[0]!.value, args = before.slice(1).map(t => t.value);
    const parameters: Record<string, string[]> = {
      help: names, man: names, theme: ["amber", "green", "paper"], crt: ["off", "low", "full"],
      reader: ["on", "off"], history: ["--clear"], hadesctl: ["status", "projects", "now"],
      profile: ["edit"], files: ["ls", "upload", "download", "rm"], comment: ["reply", "edit", "rm"],
      printenv: ["USER", "HOME", "PWD", "OLDPWD", "HOSTNAME", "SHELL", "TERM", "LANG"],
      tag: [...new Set(nodes.flatMap(n => n.tags))],
    };
    if (parameters[command] && !args.length) values = parameters[command]!.map(text => ({ text }));
    const pathArgs = args.filter((arg, index) => !arg.startsWith("-") && !(index && ["-n", "-name", "-type"].includes(args[index - 1]!)));
    const acceptsPath = ["cd", "ls", "tree", "open", "vim", "less", "md", "preview", "cat", "head", "tail", "wc", "grep", "find", "stat", "file", "comments"].includes(command)
      && (["cat", "wc"].includes(command) || (command === "grep" ? pathArgs.length >= 1 : !pathArgs.length));
    if (acceptsPath) {
      if (["~", ".", ".."].includes(typed)) values.push({ text: typed + "/", directory: true });
      const slash = typed.lastIndexOf("/");
      const parent = slash < 0 ? "" : typed.slice(0, slash + 1);
      const partialName = typed.slice(slash + 1);
      const absoluteParent = normalizePath(parent || ".", cwd, home);
      values.push(...nodes.filter(n => n.path !== "/"
        && (n.path.slice(0, n.path.lastIndexOf("/")) || "/") === absoluteParent
        && n.path.split("/").at(-1)!.startsWith(partialName)
        && (command !== "cd" || n.kind === "directory"))
        .sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.path.localeCompare(b.path))
        .map(n => ({ text: parent + n.path.split("/").at(-1)! + (n.kind === "directory" ? "/" : ""), directory: n.kind === "directory" })));
      if (command === "ls" && !args.some(arg => arg.startsWith("-") && arg.includes("l"))) values.unshift({ text: "-l" });
    }
  }
  const suffix = input.slice(end), result: Completion[] = [];
  const seen = new Set<string>();
  for (const candidate of values) {
    if (!candidate.text.startsWith(typed) || seen.has(candidate.text)) continue;
    seen.add(candidate.text);
    const replacement = quoteCompletion(candidate.text, quote);
    const separator = !candidate.directory && !/^\s/u.test(suffix) ? " " : "";
    const value = input.slice(0, start) + replacement + separator + suffix;
    const nextCaret = start + replacement.length + (candidate.directory && quote ? -1 : separator.length);
    result.push({ value, caret: nextCaret, label: candidate.text });
  }
  return result.slice(0, 100);
}
export function complete(input: string, cwd: string, nodes: VfsNode[], home = "/"): string[] {
  return completeAt(input, input.length, cwd, nodes, [], home).map(candidate => candidate.value);
}
export type InteractionCommand = "reboot" | "display" | "login" | "register" | "profile" | "passwd" | "files" | "upload" | "download" | "mycomments" | "logout" | "comments" | "comment";
/** Secret-bearing commands must never echo or recall accidentally supplied credentials. */
export function redactAccountArguments(command: string): string {
  const name = completionTokens(command)[0]?.value;
  return name && ["login", "register", "passwd", "password", "profile", "logout"].includes(name)
    ? name
    : command;
}
export class CommandHistory {
  entries: string[] = [];
  private cursor = 0;
  private draft = "";
  add(command: string) {
    if (command.trim()) {
      this.entries.push(redactAccountArguments(command));
      this.entries = this.entries.slice(-100);
    }
    this.cursor = this.entries.length;
    this.draft = "";
  }
  previous(current: string) {
    if (this.cursor === this.entries.length) this.draft = current;
    this.cursor = Math.max(0, this.cursor - 1);
    return this.entries[this.cursor] ?? current;
  }
  next() {
    this.cursor = Math.min(this.entries.length, this.cursor + 1);
    return this.entries[this.cursor] ?? this.draft;
  }
  clear() {
    this.entries = [];
    this.cursor = 0;
    this.draft = "";
  }
}
export interface Context {
  cwd: string;
  user?: string;
  home?: string;
  hostname?: string;
  previousCwd?: string;
  startedAt?: number;
  now?: () => Date;
  changeDirectory?: (path: string) => void;
  nodes: VfsNode[];
  history: CommandHistory;
  releaseId: string;
  theme: Theme;
  crt: CrtLevel;
  reader: boolean;
  navigate: (target: Navigation) => void;
  setTheme: (theme: Theme) => void;
  setCrt: (crt: CrtLevel) => void;
  setReader: (on: boolean) => void;
  readFile: (node: VfsNode, signal: AbortSignal) => Promise<string>;
  interact?: (command: InteractionCommand, args?: string[]) => void;
}
export async function execute(
  input: string,
  context: Context,
  signal = new AbortController().signal,
): Promise<Output[]> {
  if (signal.aborted) return [];
  const user = context.user || "guest", home = context.home ?? homeForUser(user);
  const hostname = context.hostname || "hadesd";
  const environment: Record<string, string> = {
    USER: user, HOME: home, PWD: context.cwd, OLDPWD: context.previousCwd ?? "", HOSTNAME: hostname,
    SHELL: "/bin/hades-shell", TERM: "xterm-256color", LANG: "zh_CN.UTF-8",
  };
  let tokens: string[];
  try {
    tokens = tokenize(input, environment);
  } catch (error) {
    return [{ type: "error", text: (error as Error).message }];
  }
  const [name, ...args] = tokens;
  if (!name) return [];
  const fail = (text: string): Output[] => [{ type: "error", text }];
  const out = (text: string): Output[] => [{ type: "text", text }];
  if (!commands.some((c) => c.name === name)) {
    const similar = commands
      .filter((c) => c.name.startsWith(name[0] ?? ""))
      .slice(0, 3)
      .map((c) => c.name)
      .join("、");
    return fail(
      `未知命令：${name}。${similar ? `也许是 ${similar}。` : ""}输入 help 查看可用命令。`,
    );
  }
  const nav = (node: VfsNode): Output[] => {
    if (signal.aborted) return [];
    const target = navigationFor(node);
    context.navigate(target);
    return [{ type: "navigation", target, text: `已打开 ${node.title}` }];
  };
  const fixed = async (path: string): Promise<Output[]> => {
    const node = resolveTarget(path, "/", context.nodes);
    if (!node) return fail("这个公开页面不存在。");
    if (!context.changeDirectory) return nav(node);
    if (node.kind === "directory") return directoryList(node);
    return [{ type: "markdown", node, text: (await read(node.path)).text }];
  };
  const target = (path: string) => resolveTarget(path, context.cwd, context.nodes, home);
  const read = async (path: string) => {
    const node = target(path);
    if (!node) throw new Error(`${path}: 没有这个文件或目录。`);
    if (node.kind !== "file") throw new Error(`${path}: 是一个目录；使用 ls 查看。`);
    const text = await context.readFile(node, signal);
    if (signal.aborted) throw new Error("读取已取消。");
    return { node, text };
  };
  const directoryList = (node: VfsNode, long = false, all = false): Output[] => {
    const children = node.kind === "file" ? [node] : context.nodes.filter(n =>
      n.path !== node.path && (n.path.slice(0, n.path.lastIndexOf("/")) || "/") === node.path
      && (all || !n.path.split("/").at(-1)!.startsWith(".")));
    if (all && node.kind === "directory") {
      const parent = target(normalizePath("..", node.path, home));
      children.unshift({ ...node, id: `dot:${node.path}`, path: `${node.path === "/" ? "" : node.path}/.`, title: "." },
        { ...(parent ?? node), id: `dotdot:${node.path}`, path: `${node.path === "/" ? "" : node.path}/..`, title: ".." });
    }
    return [{ type: "directory-list", long, nodes: children }];
  };
  try {
  switch (name) {
    case "reboot": case "display": case "login": case "register": case "profile": case "passwd": case "files": case "upload": case "download": case "mycomments": case "logout": case "comments": case "comment":
      if (["reboot", "display", "register", "passwd", "upload", "logout"].includes(name) && args.length)
        return fail(`${name} 不接受参数；请在终端的后续提示中输入。`);
      if (name === "login" && args.length > 1) return fail("login 仅接受用户名；密码请在后续的私密提示中输入。");
      if (!context.interact) return fail("该操作需要在网页终端中打开。");
      if (args.length) context.interact(name, args);
      else context.interact(name);
      return [];
    case "man":
    case "help": {
      if (args.length > 1 || (name === "man" && !args[0])) return fail(`${name} ${name === "man" ? "<command>" : "[command]"}`);
      const selected = args[0]
        ? commands.filter((c) => c.name === args[0])
        : commands;
      return selected.length
        ? [{ type: "help", commands: selected }]
        : fail("没有该命令的帮助。");
    }
    case "pwd":
      if (args.length) return fail("pwd 不接受参数。");
      return out(context.cwd);
    case "clear":
      return [{ type: "clear" }];
    case "history":
      if (args.length > 1 || (args[0] && args[0] !== "--clear")) return fail("history [--clear]");
      if (args[0] === "--clear") {
        context.history.clear();
        return out("本会话输入历史已清理。");
      }
      return out(
        context.history.entries.map((e, i) => `${i + 1}  ${e}`).join("\n") ||
          "尚无输入历史。",
      );
    case "cd": {
      if (args.length > 1) return fail("cd: 参数过多。");
      if (args[0] === "-" && !context.previousCwd) return fail("cd: 尚未设置上次目录（OLDPWD）。");
      const raw = args[0] === "-" ? context.previousCwd! : args[0] ?? home;
      const node = target(raw);
      if (!node) return fail(`cd: ${raw}: 没有这个文件或目录。`);
      if (node.kind !== "directory") return fail(`cd: ${raw}: 不是目录；使用 open 阅读文件。`);
      if (!context.changeDirectory) return nav(node);
      context.changeDirectory(node.path);
      return args[0] === "-" ? out(node.path) : [];
    }
    case "ls":
    case "tree": {
      let flags = "", paths: string[] = [], options = true;
      for (const arg of args) {
        if (options && arg === "--") { options = false; continue; }
        if (options && arg.startsWith("-") && name === "ls") {
          if (!/^-[la]+$/u.test(arg)) return fail(`ls: 不支持的选项 ${arg}；可用 -l、-a。`);
          flags += arg.slice(1);
        } else paths.push(arg);
      }
      if (paths.length > 1) return fail(`${name}: 每次接受一个目录路径。`);
      const raw = paths[0] ?? context.cwd;
      const node = target(raw);
      if (!node) return fail(`找不到公开路径：${raw}`);
      if (name === "ls")
        return directoryList(node, flags.includes("l"), flags.includes("a"));
      const lines = [node.path];
      const walk = (parent: VfsNode, prefix: string) => {
        const children = context.nodes.filter(n => n.path !== parent.path && (n.path.slice(0, n.path.lastIndexOf("/")) || "/") === parent.path)
          .sort((a, b) => a.path.localeCompare(b.path));
        children.forEach((child, index) => {
          const last = index === children.length - 1;
          lines.push(`${prefix}${last ? "└── " : "├── "}${child.path.split("/").at(-1)}${child.kind === "directory" ? "/" : ""}`);
          if (child.kind === "directory") walk(child, prefix + (last ? "    " : "│   "));
        });
      };
      if (node.kind === "directory") walk(node, "");
      return out(lines.join("\n"));
    }
    case "open":
    case "vim":
    case "less":
    case "md":
    case "preview":
    case "cat": {
      if (!args[0]) return fail(`${name} 需要一个公开路径。`);
      if (name === "cat") {
        const texts: string[] = [];
        for (const path of args) texts.push((await read(path)).text);
        return out(texts.join(""));
      }
      if (args.length !== 1) return fail(`${name} 只接受一个公开路径。`);
      const node = target(args[0]);
      if (!node)
        return fail("找不到该公开文件。open 仅接受本站公开目录或文件。");
      if (node.kind === "directory") return name === "vim" ? fail("这是目录，请使用 ls。") : directoryList(node);
      const content = (await read(args[0])).text;
      return [{ type: name === "vim" ? "file" : "markdown", node, text: content }];
    }
    case "head":
    case "tail": {
      let count = 10, path: string | undefined;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "-n" || /^-\d+$/u.test(arg)) {
          const rawCount = arg === "-n" ? args[++i] : arg.slice(1);
          if (!rawCount || !/^\d+$/u.test(rawCount) || !Number.isSafeInteger(Number(rawCount)))
            return fail(`${name}: 行数必须是非负整数。`);
          count = Number(rawCount);
        } else if (arg.startsWith("-")) return fail(`${name}: 不支持的选项 ${arg}。`);
        else if (path) return fail(`${name} [-n count] <file>`);
        else path = arg;
      }
      if (!path) return fail(`${name} [-n count] <file>`);
      const { text } = await read(path);
      const lines = text.split("\n");
      if (text.endsWith("\n")) lines.pop();
      const selected = count === 0 ? [] : name === "head" ? lines.slice(0, count) : lines.slice(-count);
      return out(selected.join("\n"));
    }
    case "wc": {
      let flags = "", options = true;
      const paths: string[] = [];
      for (const arg of args) {
        if (options && arg === "--") { options = false; continue; }
        if (options && arg.startsWith("-")) {
          if (!/^-[lwc]+$/u.test(arg)) return fail(`wc: 不支持的选项 ${arg}；可用 -l、-w、-c。`);
          flags += arg.slice(1);
        } else paths.push(arg);
      }
      if (!paths.length) return fail("wc [-lwc] <file> [...]");
      if (!flags) flags = "lwc";
      const total = [0, 0, 0], lines: string[] = [];
      const format = (counts: number[], path: string) => counts.filter((_, i) => flags.includes("lwc"[i]!)).join("  ") + `  ${path}`;
      for (const path of paths) {
        const { text } = await read(path);
        const counts = [text.split("\n").length - 1, text.match(/\S+/gu)?.length ?? 0, new TextEncoder().encode(text).byteLength];
        counts.forEach((value, i) => { total[i]! += value; });
        lines.push(format(counts, path));
      }
      if (paths.length > 1) lines.push(format(total, "total"));
      return out(lines.join("\n"));
    }
    case "grep": {
      let flags = "", cursor = 0;
      for (; cursor < args.length; cursor++) {
        const arg = args[cursor]!;
        if (arg === "--") { cursor++; break; }
        if (!arg.startsWith("-")) break;
        if (!/^-[invF]+$/u.test(arg)) return fail(`grep: 不支持的选项 ${arg}；可用 -i、-n、-v、-F。`);
        flags += arg.slice(1);
      }
      const needle = args[cursor++], paths = args.slice(cursor);
      if (needle === undefined || !paths.length) return fail("grep [-inv] <text> <file> [...]");
      const search = flags.includes("i") ? needle.toLocaleLowerCase() : needle;
      const matches: string[] = [];
      for (const path of paths) {
        const { text } = await read(path);
        const lines = text === "" ? [] : text.split("\n");
        if (text.endsWith("\n")) lines.pop();
        lines.forEach((line, index) => {
          const found = (flags.includes("i") ? line.toLocaleLowerCase() : line).includes(search);
          if (found !== flags.includes("v"))
            matches.push(`${paths.length > 1 ? path + ":" : ""}${flags.includes("n") ? index + 1 + ":" : ""}${line}`);
        });
      }
      return out(matches.join("\n"));
    }
    case "find": {
      let path = ".", pattern: string | undefined, kind: string | undefined, cursor = 0;
      if (args[0] && !args[0].startsWith("-")) path = args[cursor++]!;
      while (cursor < args.length) {
        const option = args[cursor++], value = args[cursor++];
        if (!value || !["-name", "-type"].includes(option!)) return fail('find [path] [-name "pattern"] [-type f|d]');
        if (option === "-name") pattern = value;
        else if (["f", "d"].includes(value)) kind = value;
        else return fail("find: -type 仅支持 f（文件）或 d（目录）。");
      }
      const node = target(path);
      if (!node) return fail(`find: ${path}: 没有这个文件或目录。`);
      if (pattern && pattern.length > 200) return fail("find: 文件名模式最长 200 个字符。");
      // A bounded wildcard matcher avoids executing user input as a regular expression.
      const matchesName = (value: string) => {
        if (pattern === undefined) return true;
        const chars = [...value], mask = [...pattern];
        let index = 0, cursor = 0, star = -1, retry = 0;
        while (index < chars.length) {
          if (mask[cursor] === "?" || mask[cursor] === chars[index]) { index++; cursor++; }
          else if (mask[cursor] === "*") { star = cursor++; retry = index; }
          else if (star >= 0) { cursor = star + 1; index = ++retry; }
          else return false;
        }
        while (mask[cursor] === "*") cursor++;
        return cursor === mask.length;
      };
      return out(context.nodes.filter(candidate => (candidate.path === node.path || candidate.path.startsWith(node.path === "/" ? "/" : node.path + "/"))
        && (!kind || candidate.kind === (kind === "d" ? "directory" : "file"))
        && matchesName(candidate.path.split("/").at(-1) || "/"))
        .map(candidate => candidate.path).sort().join("\n"));
    }
    case "stat":
    case "file": {
      if (args.length !== 1) return fail(`${name} <path>`);
      const node = target(args[0]!);
      if (!node) return fail(`${name}: ${args[0]}: 没有这个文件或目录。`);
      const description = node.kind === "directory" ? "directory" : node.path.endsWith(".md") ? "Markdown document, UTF-8 text" : node.path.endsWith(".json") ? "JSON data, UTF-8 text" : "UTF-8 text";
      if (name === "file") return out(`${node.path}: ${description}`);
      const bytes = node.kind === "file" ? new TextEncoder().encode((await read(node.path)).text).byteLength : 0;
      return out(`  File: ${node.path}\n  Size: ${bytes} bytes\n  Type: ${description}\nAccess: ${node.kind === "directory" ? "dr-xr-xr-x" : "-r--r--r--"} (公开虚拟文件，只读)\nModify: ${node.updatedAt ?? "—"}\n Route: ${node.route}`);
    }
    case "echo": {
      const newline = args[0] !== "-n";
      return out((newline ? args : args.slice(1)).join(" ") + (newline ? "\n" : ""));
    }
    case "whoami":
    case "hostname":
    case "uptime":
    case "env": {
      if (args.length) return fail(`${name} 不接受参数。`);
      if (name === "whoami") return out(user);
      if (name === "hostname") return out(hostname);
      if (name === "env") return out(Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n"));
      const now = (context.now?.() ?? new Date()).getTime();
      const seconds = Math.max(0, Math.floor((now - (context.startedAt ?? now)) / 1000));
      return out(`up ${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s · 本次浏览器终端会话`);
    }
    case "printenv": {
      if (args.length > 1) return fail("printenv [name]");
      return out(args[0] ? environment[args[0]] ?? "" : Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n"));
    }
    case "uname":
      if (args.length > 1 || (args[0] && args[0] !== "-a")) return fail("uname [-a]");
      return out(args[0] === "-a" ? `HadesShell ${hostname} 1.0 browser virtual-terminal WebAssembly/JavaScript` : "HadesShell");
    case "date": {
      if (args.length > 1 || (args[0] && !["-u", "--iso"].includes(args[0]))) return fail("date [-u|--iso]");
      const date = context.now?.() ?? new Date();
      return out(args[0] === "--iso" ? date.toISOString() : args[0] === "-u" ? date.toUTCString() : date.toString());
    }
    case "basename": {
      if (!args[0] || args.length > 2) return fail("basename <path> [suffix]");
      let base = args[0].replace(/\/+$/u, "").split("/").at(-1) || "/";
      if (args[1] && base !== args[1] && base.endsWith(args[1])) base = base.slice(0, -args[1].length);
      return out(base);
    }
    case "dirname": {
      if (!args[0] || args.length !== 1) return fail("dirname <path>");
      const path = args[0].replace(/\/+$/u, "");
      if (!path) return out("/");
      const slash = path.lastIndexOf("/");
      return out(slash < 0 ? "." : path.slice(0, slash).replace(/\/+$/u, "") || "/");
    }
    case "search":
    case "tag": {
      const query = args.join(" ").trim();
      if (!query)
        return fail(`请输入${name === "search" ? "搜索词" : "标签"}。`);
      if (query.length > 200) return fail("查询最长 200 个字符。");
      if (context.changeDirectory) {
        const words = query.normalize("NFKC").toLocaleLowerCase().split(/\s+/u);
        const matches = context.nodes.filter(node => node.kind === "file" && !node.path.startsWith("/home/")
          && (name === "tag" ? node.tags.includes(query) : words.every(word =>
            `${node.title} ${node.summary} ${node.tags.join(" ")} ${node.path}`.normalize("NFKC").toLocaleLowerCase().includes(word))));
        return matches.length ? [{ type: "directory-list", nodes: matches, long: true }] : out(`没有找到${name === "tag" ? "带此标签的内容" : "匹配的公开内容"}：${query}`);
      }
      const target = {
        route:
          name === "search"
            ? `/search?q=${encodeURIComponent(query)}`
            : `/tags/${encodeURIComponent(query)}`,
        cwd: "/",
      };
      context.navigate(target);
      return [
        {
          type: "navigation",
          target,
          text: name === "search" ? `搜索 ${query}` : `标签 ${query}`,
        },
      ];
    }
    case "about":
    case "projects":
    case "research":
    case "now":
      return await fixed("/" + name);
    case "theme":
      if (args.length !== 1 || !["amber", "green", "paper"].includes(args[0] ?? ""))
        return fail("主题可选 amber、green、paper。");
      context.setTheme(args[0] as Theme);
      return out(`主题已设为 ${args[0]}。`);
    case "crt":
      if (args.length !== 1 || !["off", "low", "full"].includes(args[0] ?? ""))
        return fail("CRT 可选 off、low、full。");
      context.setCrt(args[0] as CrtLevel);
      return out(`CRT 已设为 ${args[0]}。`);
    case "reader":
      if (args.length !== 1 || !["on", "off"].includes(args[0] ?? ""))
        return fail("用 reader on 或 reader off 设置阅读模式。");
      context.setReader(args[0] === "on");
      return out(`阅读模式 ${args[0]}。`);
    case "hadesctl":
      if (args[0] === "projects" || args[0] === "now")
        return await fixed("/" + args[0]);
      if (args[0] === "status")
        return out(
          `公开版本：${context.releaseId}\n当前目录：${context.cwd}\n家目录：${home}\n会话用户：${user}\n主题：${context.theme} · CRT：${context.crt} · 阅读模式：${context.reader ? "on" : "off"}\n浏览器虚拟终端：上下滚动查看输出，md/open 阅读 Markdown，vim 编辑，login/register 通过文字提示登录注册。公开文件只读；管理员可保存服务器草稿，读者可保存浏览器本地副本。`,
        );
      return fail("可用子命令：status、projects、now。");
    default:
      return fail("命令不可用。");
  }
  } catch (error) {
    if (signal.aborted) return [];
    return fail(error instanceof Error ? error.message : "读取失败，请稍后重试。");
  }
}
export type FrozenSite = Pick<
  ReleaseSnapshot,
  "releaseId" | "createdAt" | "site"
> & { contents: PublicIndex[] };
