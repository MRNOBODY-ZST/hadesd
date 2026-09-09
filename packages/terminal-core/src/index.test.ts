import { describe, it, expect, vi } from "vitest";
import {
  tokenize,
  normalizePath,
  createVfs,
  resolveTarget,
  navigationFor,
  cwdForRoute,
  complete,
  completeAt,
  CommandHistory,
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
  it("mouse, terminal, and palette resolve the same content action", async () => {
    const c = context();
    const file = resolveTarget("posts/你好.md", "/", nodes)!;
    const mouse = navigationFor(file);
    const palette = navigationFor(nodes.find((n) => n.id === "1")!);
    await execute("open posts/你好.md", c);
    expect(c.navigate).toHaveBeenCalledWith(mouse);
    expect(mouse).toEqual(palette);
    expect(mouse).toEqual({
      route: "/posts/你好",
      contentId: "1",
      cwd: "/posts",
    });
    expect(cwdForRoute(mouse.route, nodes)).toBe("/posts");
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
  it("truncates cat and exposes full reader link", async () => {
    const c = context();
    c.readFile = async () => "line\n".repeat(3000);
    const result = await execute("cat posts/你好.md", c);
    expect(result[0]?.type).toBe("text");
    expect(JSON.stringify(result[0]).length).toBeLessThan(11000);
    expect(result[1]?.type).toBe("navigation");
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
