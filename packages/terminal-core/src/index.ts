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
  | { type: "clear" };
export interface Command {
  name: string;
  usage: string;
  description: string;
  example: string;
}
export const commands: Command[] = [
  ["help", "[command]", "查看命令与使用示例", "help open"],
  ["ls", "[-l] [path]", "列出公开目录", "ls -l posts"],
  ["cd", "[path]", "切换目录；无参数回到根目录", "cd ../projects"],
  ["pwd", "", "显示当前路径", "pwd"],
  ["tree", "[path]", "查看公开目录树", "tree ~"],
  ["cat", "<file>", "预览短文本，长文提供阅读入口", "cat about.md"],
  ["open", "<file>", "打开完整阅读器", "open posts/example.md"],
  ["less", "<file>", "open 的阅读器别名", "less about.md"],
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
  ["login", "", "打开登录窗口", "login"],
  ["register", "", "打开注册窗口", "register"],
  ["profile", "", "打开账号与我的文件", "profile"],
  ["logout", "", "请求退出当前账号", "logout"],
  ["comments", "", "查看当前文章评论", "comments"],
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
export function tokenize(input: string): string[] {
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
        "只支持单条博客命令；不支持管道、重定向、串联或命令替换。将搜索文本放在引号内。",
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
export function normalizePath(input: string, cwd = "/"): string {
  const base = input.startsWith("/") || input.startsWith("~") ? "" : cwd;
  const stack: string[] = [];
  for (const part of `${base}/${input.replace(/^~(?=\/|$)/, "")}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}
export function displayPath(path: string) {
  return path === "/" ? "~" : `~${path}`;
}
export function createVfs(contents: PublicIndex[]): VfsNode[] {
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
): VfsNode | undefined {
  const normalized = normalizePath(input, cwd);
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
export function completeAt(input: string, caret: number, cwd: string, nodes: VfsNode[], extraCommands: string[] = []): Completion[] {
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
      help: names, theme: ["amber", "green", "paper"], crt: ["off", "low", "full"],
      reader: ["on", "off"], history: ["--clear"], hadesctl: ["status", "projects", "now"],
      tag: [...new Set(nodes.flatMap(n => n.tags))],
    };
    if (parameters[command] && !args.length) values = parameters[command]!.map(text => ({ text }));
    const acceptsPath = ["cd", "ls", "tree", "open", "less", "cat"].includes(command)
      && !(command === "ls" ? args.filter(a => a !== "-l") : args).length;
    if (acceptsPath) {
      if (["~", ".", ".."].includes(typed)) values.push({ text: typed + "/", directory: true });
      const slash = typed.lastIndexOf("/");
      const parent = slash < 0 ? "" : typed.slice(0, slash + 1);
      const partialName = typed.slice(slash + 1);
      const absoluteParent = normalizePath(parent || ".", cwd);
      values.push(...nodes.filter(n => n.path !== "/"
        && (n.path.slice(0, n.path.lastIndexOf("/")) || "/") === absoluteParent
        && n.path.split("/").at(-1)!.startsWith(partialName)
        && (command !== "cd" || n.kind === "directory"))
        .sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.path.localeCompare(b.path))
        .map(n => ({ text: parent + n.path.split("/").at(-1)! + (n.kind === "directory" ? "/" : ""), directory: n.kind === "directory" })));
      if (command === "ls" && !args.includes("-l")) values.unshift({ text: "-l" });
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
export function complete(input: string, cwd: string, nodes: VfsNode[]): string[] {
  return completeAt(input, input.length, cwd, nodes).map(candidate => candidate.value);
}
export type InteractionCommand = "reboot" | "display" | "login" | "register" | "profile" | "logout" | "comments";
/** Account commands open forms; their accidentally supplied arguments are never echoed or recalled. */
export function redactAccountArguments(command: string): string {
  const name = completionTokens(command)[0]?.value;
  return name && ["login", "register", "profile", "logout"].includes(name)
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
  interact?: (command: InteractionCommand) => void;
}
export async function execute(
  input: string,
  context: Context,
  signal = new AbortController().signal,
): Promise<Output[]> {
  let tokens: string[];
  try {
    tokens = tokenize(input);
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
  const fixed = (path: string) => {
    const node = resolveTarget(path, "/", context.nodes);
    return node ? nav(node) : fail("这个公开页面不存在。");
  };
  switch (name) {
    case "reboot": case "display": case "login": case "register": case "profile": case "logout": case "comments":
      if (args.length) return fail(`${name} 不接受参数，请在对应界面操作。`);
      if (!context.interact) return fail("该操作需要在网页终端中打开。");
      context.interact(name);
      return [];
    case "help": {
      const selected = args[0]
        ? commands.filter((c) => c.name === args[0])
        : commands;
      return selected.length
        ? [{ type: "help", commands: selected }]
        : fail("没有该命令的帮助。");
    }
    case "pwd":
      return out(context.cwd);
    case "clear":
      return [{ type: "clear" }];
    case "history":
      if (args[0] === "--clear") {
        context.history.clear();
        return out("本会话输入历史已清理。");
      }
      return out(
        context.history.entries.map((e, i) => `${i + 1}  ${e}`).join("\n") ||
          "尚无输入历史。",
      );
    case "cd":
    case "ls":
    case "tree": {
      const raw =
        args.filter((a) => a !== "-l")[0] ??
        (name === "cd" ? "/" : context.cwd);
      const node = resolveTarget(raw, context.cwd, context.nodes);
      if (!node) return fail(`找不到公开路径：${raw}`);
      if (name === "cd")
        return node.kind === "directory"
          ? nav(node)
          : fail("cd 只能进入目录，请使用 open 阅读文件。");
      if (name === "ls")
        return [
          {
            type: "directory-list",
            long: args.includes("-l"),
            nodes:
              node.kind === "file"
                ? [node]
                : context.nodes.filter(
                    (n) =>
                      n.path !== node.path &&
                      n.path.slice(0, n.path.lastIndexOf("/")) ===
                        (node.path === "/" ? "" : node.path),
                  ),
          },
        ];
      return out(
        context.nodes
          .filter(
            (n) =>
              n.path === node.path ||
              n.path.startsWith(node.path === "/" ? "/" : node.path + "/"),
          )
          .map(
            (n) =>
              `${"  ".repeat(n.path.split("/").length - 2)}${n.kind === "directory" ? "▾" : "·"} ${n.path === "/" ? "~" : n.path.split("/").at(-1)}${n.kind === "directory" && n.path !== "/" ? "/" : ""}`,
          )
          .join("\n"),
      );
    }
    case "open":
    case "less":
    case "cat": {
      if (!args[0]) return fail(`${name} 需要一个公开路径。`);
      const node = resolveTarget(args[0], context.cwd, context.nodes);
      if (!node)
        return fail("找不到该公开文件。open 仅接受本站公开目录或文件。");
      if (name !== "cat") return nav(node);
      if (node.kind === "directory") return fail("这是目录，请使用 ls。");
      try {
        const content = await context.readFile(node, signal);
        if (signal.aborted) return [];
        const preview = content
          .split("\n")
          .slice(0, 200)
          .join("\n")
          .slice(0, 10000);
        return [
          ...out(
            preview +
              (preview.length < content.length
                ? "\n… 已截断，请打开全文。"
                : ""),
          ),
          { type: "navigation", target: navigationFor(node), text: "打开全文" },
        ];
      } catch (error) {
        if (signal.aborted) return [];
        return fail((error as Error).message || "读取失败，请稍后重试。");
      }
    }
    case "search":
    case "tag": {
      const query = args.join(" ").trim();
      if (!query)
        return fail(`请输入${name === "search" ? "搜索词" : "标签"}。`);
      if (query.length > 200) return fail("查询最长 200 个字符。");
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
      return fixed("/" + name);
    case "theme":
      if (!["amber", "green", "paper"].includes(args[0] ?? ""))
        return fail("主题可选 amber、green、paper。");
      context.setTheme(args[0] as Theme);
      return out(`主题已设为 ${args[0]}。`);
    case "crt":
      if (!["off", "low", "full"].includes(args[0] ?? ""))
        return fail("CRT 可选 off、low、full。");
      context.setCrt(args[0] as CrtLevel);
      return out(`CRT 已设为 ${args[0]}。`);
    case "reader":
      if (!["on", "off"].includes(args[0] ?? ""))
        return fail("用 reader on 或 reader off 设置阅读模式。");
      context.setReader(args[0] === "on");
      return out(`阅读模式 ${args[0]}。`);
    case "hadesctl":
      if (args[0] === "projects" || args[0] === "now")
        return fixed("/" + args[0]);
      if (args[0] === "status")
        return out(
          `公开版本：${context.releaseId}\n当前目录：${context.cwd}\n主题：${context.theme} · CRT：${context.crt} · 阅读模式：${context.reader ? "on" : "off"}\n这是只读博客终端，不连接服务器 Shell。`,
        );
      return fail("可用子命令：status、projects、now。");
    default:
      return fail("命令不可用。");
  }
}
export type FrozenSite = Pick<
  ReleaseSnapshot,
  "releaseId" | "createdAt" | "site"
> & { contents: PublicIndex[] };
