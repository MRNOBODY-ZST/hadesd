import { describe, it, expect, vi } from "vitest";
import {
  tokenize,
  normalizePath,
  displayPath,
  homeForUser,
  createVfs,
  resolveTarget,
  navigationFor,
  cwdForRoute,
  complete,
  completeAt,
  CommandHistory,
  redactAccountArguments,
  execute,
  type Context,
} from "./index";
const nodes = createVfs([
  {
    id: "1",
    revisionId: "r",
    type: "POST",
    slug: "你好",
    route: "/posts/你好",
    title: "你好",
    summary: "摘要",
    tags: ["中文"],
    language: "zh",
    publishedAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
]);
function context(): Context {
  return {
    cwd: "/",
    nodes,
    history: new CommandHistory(),
    releaseId: "r",
    theme: "amber",
    crt: "low",
    reader: false,
    navigate: vi.fn(),
    setTheme: vi.fn(),
    setCrt: vi.fn(),
    setReader: vi.fn(),
    readFile: async () => "test",
  };
}
describe("safe terminal", () => {
  it("tokenizes quotes unicode escapes and literal shell syntax in strings", () =>
    expect(tokenize("search \"C++ && Rust\" '你好 世界' a\\ b")).toEqual([
      "search",
      "C++ && Rust",
      "你好 世界",
      "a b",
    ]));
  it.each([
    "ls; rm -rf /",
    "cat x | sh",
    "ls > x",
    "ls && pwd",
    "search $(whoami)",
    "search `pwd`",
    'search "unfinished',
  ])("rejects %s", (s) => expect(() => tokenize(s)).toThrow());
  it("normalizes paths without escaping root", () => {
    expect(normalizePath("../../../../posts//./你好.md/", "/research")).toBe(
      "/posts/你好.md",
    );
    expect(normalizePath("~/posts")).toBe("/posts");
  });
  it("open returns inline Markdown while links retain the public route", async () => {
    const c = context();
    const file = resolveTarget("posts/你好.md", "/", nodes)!;
    const mouse = navigationFor(file);
    const palette = navigationFor(nodes.find((n) => n.id === "1")!);
    expect(await execute("open posts/你好.md", c)).toEqual([{ type: "markdown", node: file, text: "test" }]);
    expect(c.navigate).not.toHaveBeenCalled();
    expect(mouse).toEqual(palette);
    expect(mouse).toEqual({
      route: "/posts/你好",
      contentId: "1",
      cwd: "/posts",
    });
    expect(cwdForRoute(mouse.route, nodes)).toBe("/posts");
  });
  it("vim explicitly enters editing while cancelled previews emit nothing", async () => {
    const c = context();
    expect((await execute("vim posts/你好.md", c))[0]?.type).toBe("file");
    const controller = new AbortController();
    c.readFile = async () => { controller.abort(); return "stale"; };
    expect(await execute("open posts/你好.md", c, controller.signal)).toEqual([]);
    expect((await execute("open about.md extra", context()))[0]?.type).toBe("error");
  });
  it("opens personal files and comments through direct terminal commands", async () => {
    const c = context(); c.interact = vi.fn();
    expect(await execute("files", c)).toEqual([]);
    expect(await execute("mycomments", c)).toEqual([]);
    expect(c.interact).toHaveBeenNthCalledWith(1, "files");
    expect(c.interact).toHaveBeenNthCalledWith(2, "mycomments");
    expect(await execute("files download notes.pdf", c)).toEqual([]);
    expect(c.interact).toHaveBeenLastCalledWith("files", ["download", "notes.pdf"]);
  });
  it("completes commands and paths", () => {
    expect(complete("he", "/", nodes)).toContain("help ");
    expect(complete("open po", "/", nodes)).toEqual(["open posts/"]);
    expect(complete("open posts/", "/", nodes)).toContain("open posts/你好.md ");
  });
  it("restores unsubmitted history and limits memory", () => {
    const h = new CommandHistory();
    for (let i = 0; i < 102; i++) h.add("ls " + i);
    expect(h.entries.length).toBe(100);
    expect(h.previous("draft")).toBe("ls 101");
    expect(h.next()).toBe("draft");
  });
  it("clear preserves input history", async () => {
    const c = context();
    c.history.add("ls");
    expect(await execute("clear", c)).toEqual([{ type: "clear" }]);
    expect(c.history.entries).toEqual(["ls"]);
  });
  it("cat retains the entire file in scrollback without opening a second viewer", async () => {
    const c = context();
    c.readFile = async () => "line\n".repeat(3000);
    const result = await execute("cat posts/你好.md", c);
    expect(result).toEqual([{ type: "text", text: "line\n".repeat(3000) }]);
    expect(c.navigate).not.toHaveBeenCalled();
  });
  it("aborted async read cannot emit output", async () => {
    const c = context();
    const controller = new AbortController();
    c.readFile = async () => {
      controller.abort();
      return "stale";
    };
    expect(await execute("cat posts/你好.md", c, controller.signal)).toEqual(
      [],
    );
  });
  it("unknown or external commands never navigate", async () => {
    const c = context();
    expect((await execute("curl https://x", c))[0]?.type).toBe("error");
    expect((await execute("open https://x", c))[0]?.type).toBe("error");
    expect(c.navigate).not.toHaveBeenCalled();
  });
});

describe("Linux-style home directory and scrollback commands", () => {
  function shell(): Context {
    const c = context();
    c.user = "guest";
    c.home = "/home/guest";
    c.cwd = c.home;
    c.changeDirectory = vi.fn((next: string) => { c.previousCwd = c.cwd; c.cwd = next; });
    c.readFile = async node => node.route === "/about" ? "Hello world\n你好 terminal\nHELLO [x]\nlast" : "alpha\nbeta\n";
    c.now = () => new Date("2026-09-12T00:00:00.000Z");
    c.startedAt = c.now().getTime() - 3_661_000;
    return c;
  }
  it("walks from the displayed guest home through both real parents without route changes", async () => {
    const c = shell();
    expect(await execute("pwd", c)).toEqual([{ type: "text", text: "/home/guest" }]);
    expect(await execute("cd ..", c)).toEqual([]);
    expect(c.cwd).toBe("/home");
    await execute("cd ..", c);
    expect(c.cwd).toBe("/");
    await execute("cd ../../..", c);
    expect(c.cwd).toBe("/");
    expect(c.navigate).not.toHaveBeenCalled();
    expect(c.changeDirectory).toHaveBeenCalledTimes(3);
  });
  it("implements home, previous-directory and absolute paths independently of article routes", async () => {
    const c = shell();
    await execute("cd /posts", c);
    expect(c.cwd).toBe("/posts");
    expect(await execute("cd -", c)).toEqual([{ type: "text", text: "/home/guest" }]);
    expect(c.cwd).toBe("/home/guest");
    await execute("cd ~/projects", c);
    expect(c.cwd).toBe("/home/guest/projects");
    await execute("cd", c);
    expect(c.cwd).toBe("/home/guest");
    expect(displayPath(c.cwd, c.home)).toBe("~");
    expect(displayPath("/home", c.home)).toBe("/home");
    expect(displayPath("/", c.home)).toBe("/");
    expect(displayPath("/home/guesty", c.home)).toBe("/home/guesty");
  });
  it("keeps the working directory intact after errors", async () => {
    const c = shell();
    for (const input of ["cd -", "cd missing", "cd /about.md", "cd /posts /research"]) {
      expect((await execute(input, c))[0]?.type).toBe("error");
      expect(c.cwd).toBe("/home/guest");
    }
    expect(c.changeDirectory).not.toHaveBeenCalled();
  });
  it("lists useful home entries and resolves aliases to the same frozen public content", async () => {
    const c = shell();
    const result = await execute("ls", c);
    expect(result[0]?.type).toBe("directory-list");
    if (result[0]?.type !== "directory-list") throw new Error("Expected directory list");
    expect(result[0].nodes.map(node => node.path)).toEqual(expect.arrayContaining([
      "/home/guest/posts", "/home/guest/about.md", "/home/guest/links.json",
    ]));
    const alias = resolveTarget("~/posts/你好.md", "/research", c.nodes, c.home)!;
    expect(alias.path).toBe("/home/guest/posts/你好.md");
    expect(alias.contentId).toBe("1");
    expect(alias.route).toBe("/posts/你好");
    expect(alias.id).not.toBe("1");
    expect(cwdForRoute("/posts/你好", c.nodes)).toBe("/posts");
    expect(new Set(c.nodes.map(node => node.id)).size).toBe(c.nodes.length);
  });
  it("creates account homes without losing root or exposing an invented server filesystem", () => {
    const accountNodes = createVfs([], "hades");
    expect(homeForUser("hades")).toBe("/home/hades");
    expect(resolveTarget("~", "/", accountNodes, "/home/hades")?.path).toBe("/home/hades");
    expect(resolveTarget("/etc/passwd", "/", accountNodes)).toBeUndefined();
    expect(normalizePath("~someone", "/home/guest", "/home/guest")).toBe("/home/guest/~someone");
  });
  it("renders Markdown inline with explicit aliases and keeps Vim separate", async () => {
    const c = shell();
    for (const command of ["open", "less", "md", "preview"]) {
      const result = await execute(`${command} about.md`, c);
      expect(result[0]).toMatchObject({ type: "markdown", text: "Hello world\n你好 terminal\nHELLO [x]\nlast", node: { path: "/home/guest/about.md" } });
    }
    expect((await execute("vim about.md", c))[0]?.type).toBe("file");
    expect(c.cwd).toBe("/home/guest");
    expect(c.navigate).not.toHaveBeenCalled();
    expect((await execute("open posts", c))[0]?.type).toBe("directory-list");
  });
  it("appends shortcut pages and search results to the scrollback without replacing its route", async () => {
    const c = shell();
    for (const command of ["about", "now", "hadesctl now"])
      expect((await execute(command, c))[0]?.type).toBe("markdown");
    for (const command of ["projects", "research", "hadesctl projects"])
      expect((await execute(command, c))[0]?.type).toBe("directory-list");
    for (const command of ["search 你好", "tag 中文"]) {
      const result = (await execute(command, c))[0];
      expect(result?.type).toBe("directory-list");
      if (result?.type !== "directory-list") throw new Error("Expected search results");
      expect(result.nodes.map(node => node.path)).toEqual(["/posts/你好.md"]);
    }
    expect(c.navigate).not.toHaveBeenCalled();
    expect(c.cwd).toBe("/home/guest");
    c.readFile = async () => { throw new Error("offline"); };
    expect(await execute("about", c)).toEqual([{ type: "error", text: "offline" }]);
  });
  it("lists dot entries and produces a hierarchy relative to the requested tree root", async () => {
    const c = shell();
    const list = (await execute("ls -la", c))[0];
    expect(list).toMatchObject({ type: "directory-list", long: true });
    if (list?.type !== "directory-list") throw new Error("Expected directory list");
    expect(list.nodes.slice(0, 2).map(node => node.title)).toEqual([".", ".."]);
    expect(await execute("tree posts", c)).toEqual([{ type: "text", text: "/home/guest/posts\n└── 你好.md" }]);
  });
  it("extracts first and last lines without treating a final newline as another line", async () => {
    const c = shell();
    expect(await execute("head -n 2 about.md", c)).toEqual([{ type: "text", text: "Hello world\n你好 terminal" }]);
    expect(await execute("tail -n 1 about.md", c)).toEqual([{ type: "text", text: "last" }]);
    expect(await execute("tail -1 now.md", c)).toEqual([{ type: "text", text: "beta" }]);
    expect(await execute("tail -n 0 about.md", c)).toEqual([{ type: "text", text: "" }]);
    expect((await execute("head -n -1 about.md", c))[0]?.type).toBe("error");
    expect((await execute("tail -f about.md", c))[0]?.type).toBe("error");
  });
  it("counts newlines and actual UTF-8 bytes, and adds totals for multiple files", async () => {
    const c = shell();
    c.readFile = async () => "你好 world\nlast";
    expect(await execute("wc about.md now.md", c)).toEqual([{ type: "text", text: "1  3  17  about.md\n1  3  17  now.md\n2  6  34  total" }]);
    expect(await execute("wc -l about.md", c)).toEqual([{ type: "text", text: "1  about.md" }]);
  });
  it("searches literal lines with case folding, numbering and inversion", async () => {
    const c = shell();
    expect(await execute("grep -in hello about.md", c)).toEqual([{ type: "text", text: "1:Hello world\n3:HELLO [x]" }]);
    expect(await execute('grep "[x]" about.md', c)).toEqual([{ type: "text", text: "HELLO [x]" }]);
    expect(await execute("grep -iv hello about.md", c)).toEqual([{ type: "text", text: "你好 terminal\nlast" }]);
    expect(await execute("grep absent about.md", c)).toEqual([{ type: "text", text: "" }]);
  });
  it("find matches filenames inside the chosen subtree without turning patterns into regex", async () => {
    const c = shell();
    expect(await execute('find ~/posts -name "*.md" -type f', c)).toEqual([{ type: "text", text: "/home/guest/posts/你好.md" }]);
    expect(await execute('find /posts -name "你?.md"', c)).toEqual([{ type: "text", text: "/posts/你好.md" }]);
    expect(await execute('find /posts -name "[你好].md"', c)).toEqual([{ type: "text", text: "" }]);
    expect((await execute("find /missing", c))[0]?.type).toBe("error");
  });
  it("expands only public shell variables and preserves quoted literals without executing their contents", async () => {
    const c = shell();
    expect(await execute('echo "$USER ${HOME}"', c)).toEqual([{ type: "text", text: "guest /home/guest\n" }]);
    expect(await execute("echo '$USER' \\$HOME", c)).toEqual([{ type: "text", text: "$USER $HOME\n" }]);
    expect(await execute("echo $UNSET", c)).toEqual([{ type: "text", text: "\n" }]);
    await execute("cd $HOME/posts", c);
    expect(c.cwd).toBe("/home/guest/posts");
    const env = await execute("env", c);
    expect(JSON.stringify(env)).toContain("SHELL=/bin/hades-shell");
    expect(JSON.stringify(env)).not.toMatch(/password|secret|token/iu);
  });
  it("reports session identity and browser uptime, never pretends to expose the server kernel", async () => {
    const c = shell();
    expect(await execute("whoami", c)).toEqual([{ type: "text", text: "guest" }]);
    expect(await execute("hostname", c)).toEqual([{ type: "text", text: "hadesd" }]);
    expect(await execute("uptime", c)).toEqual([{ type: "text", text: "up 1h 1m 1s · 本次浏览器终端会话" }]);
    expect(await execute("date --iso", c)).toEqual([{ type: "text", text: "2026-09-12T00:00:00.000Z" }]);
    expect(JSON.stringify(await execute("uname -a", c))).toContain("browser virtual-terminal");
    expect(await execute("printenv ADMIN_PASSWORD", c)).toEqual([{ type: "text", text: "" }]);
  });
  it("reads file metadata and applies path utilities without navigating", async () => {
    const c = shell();
    expect(await execute("file about.md", c)).toEqual([{ type: "text", text: "/home/guest/about.md: Markdown document, UTF-8 text" }]);
    expect(JSON.stringify(await execute("stat posts", c))).toContain("dr-xr-xr-x");
    expect(await execute("basename /posts/你好.md .md", c)).toEqual([{ type: "text", text: "你好" }]);
    expect(await execute("dirname ~/posts/你好.md", c)).toEqual([{ type: "text", text: "~/posts" }]);
    expect(c.navigate).not.toHaveBeenCalled();
  });
  it("returns errors from failed reads and discards cancelled multi-file commands", async () => {
    const c = shell();
    c.readFile = async () => { throw new Error("offline"); };
    expect(await execute("head about.md", c)).toEqual([{ type: "error", text: "offline" }]);
    const controller = new AbortController();
    c.readFile = async () => { controller.abort(); return "old"; };
    expect(await execute("wc about.md now.md", c, controller.signal)).toEqual([]);
  });
  it("keeps credentials out of transcript and history while retaining useful nonsecret account commands", async () => {
    const history = new CommandHistory();
    for (const command of ["login user secret", "register user secret", "passwd old new", "password secret", "profile secret", "logout secret"]) {
      history.add(command);
      expect(redactAccountArguments(command)).not.toContain("secret");
    }
    expect(history.entries).toEqual(["login", "register", "passwd", "password", "profile", "logout"]);
    expect(redactAccountArguments("files download notes.pdf")).toBe("files download notes.pdf");
    const c = shell(); c.interact = vi.fn();
    expect(await execute("login hades", c)).toEqual([]);
    expect(c.interact).toHaveBeenCalledWith("login", ["hades"]);
    expect((await execute("passwd old new", c))[0]?.type).toBe("error");
  });
  it("completes home aliases and additional file arguments under the actual home", () => {
    expect(complete("md ~/po", "/research", nodes, "/home/guest")).toEqual(["md ~/posts/"]);
    expect(complete("cat /about.md ~/no", "/", nodes, "/home/guest")).toEqual(["cat /about.md ~/now.md "]);
    expect(complete("grep -i hello ~/ab", "/", nodes, "/home/guest")).toEqual(["grep -i hello ~/about.md "]);
    expect(complete("head -n 2 ~/ab", "/", nodes, "/home/guest")).toEqual(["head -n 2 ~/about.md "]);
    expect(complete("man gre", "/", nodes)).toEqual(["man grep "]);
    expect(complete("files d", "/", nodes)).toEqual(["files download "]);
  });
});

it.each([
  "/posts",
  "/posts/",
  "/posts/你好",
  "/posts/你好/",
  "/posts/%E4%BD%A0%E5%A5%BD/",
])("SSR and client directory state agree for %s", (path) => {
  expect(cwdForRoute(path, nodes)).toBe("/posts");
});

describe("caret-aware completion", () => {
  const spaced = [...nodes, { ...nodes.find(n => n.contentId)!, id: "spaced", path: "/posts/two words.md", tags: ["设计 笔记"] }];
  it("completes command parameters and flags without suggesting files", () => {
    expect(complete("theme gr", "/", nodes)).toEqual(["theme green "]);
    expect(complete("crt ", "/", nodes)).toEqual(["crt off ", "crt low ", "crt full "]);
    expect(complete("reader o", "/", nodes)).toEqual(["reader on ", "reader off "]);
    expect(complete("hadesctl st", "/", nodes)).toEqual(["hadesctl status "]);
    expect(complete("history --", "/", nodes)).toEqual(["history --clear "]);
    expect(complete("help lo", "/", nodes)).toEqual(["help login ", "help logout "]);
    expect(complete("ls -", "/", nodes)).toEqual(["ls -l "]);
    expect(complete("ls -l po", "/", nodes)).toEqual(["ls -l posts/"]);
    expect(complete("search po", "/", nodes)).toEqual([]);
  });
  it("lists immediate children, respects directory commands and keeps relative spelling", () => {
    expect(complete("open ", "/posts", nodes)).toEqual(["open 你好.md "]);
    expect(complete("cd ", "/posts", nodes)).toEqual([]);
    expect(complete("open ../pro", "/posts", nodes)).toEqual(["open ../projects/"]);
    expect(complete("open ~/po", "/research", nodes)).toEqual(["open ~/posts/"]);
    expect(complete("cd ..", "/posts", nodes)).toEqual(["cd ../"]);
  });
  it("closes incomplete quotes and escapes spaces into executable single arguments", () => {
    for (const input of ['open "posts/two', "open 'posts/two", "open posts/two"]) {
      const item = completeAt(input, input.length, "/", spaced)[0]!;
      expect(tokenize(item.value)).toEqual(["open", "posts/two words.md"]);
      expect(item.caret).toBe(item.value.length);
    }
    const tag = complete("tag 设", "/", spaced)[0]!;
    expect(tokenize(tag)).toEqual(["tag", "设计 笔记"]);
  });
  it("keeps following arguments and puts the caret inside a quoted directory", () => {
    const middle = completeAt("theme gr paper", 8, "/", nodes)[0]!;
    expect(middle.value).toBe("theme green paper");
    expect(middle.value.slice(0, middle.caret)).toBe("theme green");
    const folder = completeAt('open "po" trailing', 8, "/", nodes)[0]!;
    expect(folder.value).toBe('open "posts/" trailing');
    expect(folder.value[folder.caret]).toBe('"');
    expect(completeAt(folder.value, folder.caret, "/", nodes)[0]?.value).toBe('open "posts/你好.md" trailing');
  });
  it("deduplicates extension commands and offers account commands without credentials", async () => {
    expect(completeAt("log", 3, "/", nodes, ["login"]).map(item => item.label)).toEqual(["login", "logout"]);
    const c = context(); c.interact = vi.fn();
    expect(await execute("login", c)).toEqual([]);
    expect(c.interact).toHaveBeenCalledWith("login");
    expect((await execute("login user secret", c))[0]?.type).toBe("error");
    expect(c.interact).toHaveBeenCalledTimes(1);
  });
});
