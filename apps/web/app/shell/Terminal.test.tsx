import { afterEach, describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  createMemoryRouter,
  RouterProvider,
  Outlet,
  useLocation,
} from "react-router";
import { createVfs, type FrozenSite } from "@hadesd/terminal-core";
import { EMPTY_SNAPSHOT } from "@hadesd/contracts";
import { ActionsContext } from "./actions";
import { Terminal } from "./Terminal";
import { usePreferences } from "./store";
afterEach(() => { cleanup(); usePreferences.setState({ settingsOpen: false, paletteOpen: false }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const data: FrozenSite = EMPTY_SNAPSHOT;
function setup(children?: ReactNode) {
  const open = vi.fn();
  const dispatchRef = { current: null };
  render(
    <MemoryRouter>
      <ActionsContext value={{ data, nodes: createVfs([]), cwd: "/", open }}>
        <Terminal dispatchRef={dispatchRef}>{children}</Terminal>
        <button>下一个焦点</button>
      </ActionsContext>
    </MemoryRouter>,
  );
  return { field: screen.getByRole("textbox", { name: "博客命令" }), open };
}
describe("terminal interaction", () => {
  it("clicking article text returns arrow navigation to the screen", () => {
    const { field } = setup(<p>Click this article</p>);
    field.focus();
    fireEvent.click(screen.getByText("Click this article"));
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "终端历史记录" }));
  });
  it("keeps command focus and recalls history immediately after output", async () => {
    const { field } = setup(); field.focus();
    fireEvent.change(field, { target: { value: "help" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("查看命令与使用示例")).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect((field as HTMLTextAreaElement).value).toBe("help");
    expect(document.querySelector(".screen-pager")).toBeNull();
  });
  it("opens a Vim buffer and :q returns command focus without navigating", async () => {
    const { field, open } = setup(<p>Current page</p>);
    fireEvent.change(field, { target: { value: "vim about.md" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const buffer = await screen.findByRole("region", { name: "Vim 编辑器" });
    expect(buffer.textContent).toContain("NORMAL");
    expect(buffer.textContent).toContain("READ ONLY");
    expect(open).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "z" });
    expect((field as HTMLTextAreaElement).value).toBe("");
    fireEvent.keyDown(buffer, { key: ":" });
    const command = screen.getByRole("textbox", { name: "Vim 命令" });
    fireEvent.change(command, { target: { value: "q" } });
    fireEvent.keyDown(command, { key: "Enter" });
    expect(screen.queryByRole("region", { name: "Vim 编辑器" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(field));
  });
  it("returns focus to the active Vim insert field after an inline program closes", async () => {
    const { field } = setup();
    fireEvent.change(field, { target: { value: "vim about.md" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const buffer = await screen.findByRole("region", { name: "Vim 编辑器" });
    fireEvent.keyDown(buffer, { key: "i" });
    const editor = await screen.findByRole("textbox", { name: "Vim 文本" });
    act(() => usePreferences.getState().toggle("settingsOpen", true));
    expect(screen.queryByRole("textbox", { name: "Vim 文本" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("region", { name: "DISPLAY / 显示设置" }), { key: "Escape" });
    await act(async () => { await new Promise(requestAnimationFrame); });
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });
  it("IME Enter never submits or navigates", async () => {
    const { field, open } = setup();
    fireEvent.change(field, { target: { value: "projects" } });
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    expect(open).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(screen.getByText("这个目录目前为空。")).toBeTruthy());
    expect(open).not.toHaveBeenCalled();
  });
  it("Tab completes immediately, cycles both ways, and Escape releases native focus navigation", async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.type(field, "c");
    await user.tab();
    expect((field as HTMLTextAreaElement).value).toBe("cd ");
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole("listbox", { name: "命令补全" })).toBeTruthy();
    await user.tab();
    expect((field as HTMLTextAreaElement).value).toBe("cat ");
    await user.tab({ shift: true });
    expect((field as HTMLTextAreaElement).value).toBe("cd ");
    await user.tab({ shift: true });
    expect((field as HTMLTextAreaElement).value).toBe("comment ");
    await user.tab();
    expect((field as HTMLTextAreaElement).value).toBe("cd ");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.tab();
    expect(document.activeElement).not.toBe(field);
  });
  it("completes parameters at the insertion point without replacing later arguments", async () => {
    const user = userEvent.setup();
    const { field } = setup();
    const input = field as HTMLTextAreaElement;
    await user.type(input, "theme gr paper");
    input.setSelectionRange(8, 8);
    fireEvent.select(input);
    await user.tab();
    expect(input.value).toBe("theme green paper");
    expect(input.selectionStart).toBe(11);
    expect(document.querySelector("[data-terminal-prefix]")?.textContent).toBe("theme green");
  });
  it("keeps the candidate cycle when the browser reports the old selection before completion commits", () => {
    const { field } = setup();
    const input = field as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "crt " } });
    input.focus();
    input.setSelectionRange(4, 4);
    act(() => {
      fireEvent.keyDown(input, { key: "Tab" });
      fireEvent.select(input);
    });
    expect(input.value).toBe("crt off ");
    expect(screen.getByRole("listbox", { name: "命令补全" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("crt low ");
    // A subsequent real caret movement still starts a fresh completion request.
    input.setSelectionRange(0, 0);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("completes public paths and restarts the candidate set after editing", async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.type(field, "open po");
    await user.tab();
    expect((field as HTMLTextAreaElement).value).toBe("open posts/");
    await user.clear(field);
    await user.type(field, "crt ");
    await user.tab({ shift: true });
    expect((field as HTMLTextAreaElement).value).toBe("crt full ");
    await user.tab();
    expect((field as HTMLTextAreaElement).value).toBe("crt off ");
    await user.clear(field);
    await user.type(field, "theme gr");
    await user.tab();
    expect((field as HTMLTextAreaElement).value).toBe("theme green ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("Ctrl+Space lists candidates and pointer selection keeps the command focus", async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.type(field, "he");
    fireEvent.keyDown(field, { key: " ", code: "Space", ctrlKey: true });
    await user.click(screen.getByRole("option", { name: "help" }));
    expect((field as HTMLTextAreaElement).value).toBe("help ");
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("multiline pasted text remains editable until explicit submit", () => {
    const { field, open } = setup();
    fireEvent.change(field, { target: { value: 'search "C++\nRust"' } });
    expect((field as HTMLTextAreaElement).value).toContain("\n");
    expect(open).not.toHaveBeenCalled();
  });
});

it("a delayed route commit cannot hide a newer terminal command", async () => {
  let finishHome!: () => void;
  const homeData = new Promise<null>((resolve) => {
    finishHome = () => resolve(null);
  });
  function PersistentTerminal() {
    const location = useLocation();
    return (
      <ActionsContext
        value={{
          data,
          nodes: createVfs([]),
          cwd: location.pathname === "/posts" ? "/posts" : "/",
          open: vi.fn(),
        }}
      >
        <Terminal dispatchRef={{ current: null }}>
          <Outlet />
        </Terminal>
      </ActionsContext>
    );
  }
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <PersistentTerminal />,
        children: [
          { index: true, loader: () => homeData, element: <p>Home file</p> },
          { path: "posts", element: <p>Posts file</p> },
        ],
      },
    ],
    { initialEntries: ["/posts"] },
  );
  render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByRole("link", { name: `${data.site.title} 首页` }));
  await waitFor(() => expect(router.state.navigation.state).toBe("loading"));
  const field = screen.getByRole("textbox", { name: "博客命令" });
  fireEvent.change(field, { target: { value: "help" } });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(screen.getByText("查看命令与使用示例")).toBeTruthy(),
  );
  finishHome();
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  await waitFor(() =>
    expect(screen.getByText("查看命令与使用示例")).toBeTruthy(),
  );
  expect(screen.getByText("Home file").closest("[hidden]")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: `${data.site.title} 首页` }));
  await waitFor(() => expect(screen.getByText("Home file")).toBeTruthy());
  router.dispose();
});

it("keeps a mirrored block cursor at Home, Left and mouse insertion points without changing the command", async () => {
  const user = userEvent.setup();
  const { field } = setup();
  const textarea = field as HTMLTextAreaElement;
  await user.type(field, "search alpha");
  const prefix = () =>
    document.querySelector("[data-terminal-prefix]")?.textContent;
  const cursor = () => document.querySelector("[data-terminal-cursor]");
  expect(prefix()).toBe("search alpha");
  await user.keyboard("{Home}");
  expect(textarea.selectionStart).toBe(0);
  expect(prefix()).toBe("");
  expect(cursor()).not.toBeNull();
  await user.keyboard("{End}{ArrowLeft}{ArrowLeft}");
  expect(textarea.selectionStart).toBe(10);
  expect(prefix()).toBe("search alp");
  expect(cursor()).not.toBeNull();
  textarea.setSelectionRange(7, 7);
  fireEvent.select(textarea);
  expect(prefix()).toBe("search ");
  expect(textarea.value).toBe("search alpha");
  await user.keyboard("X");
  expect(textarea.value).toBe("search Xalpha");
  expect(prefix()).toBe("search X");
  expect(cursor()).not.toBeNull();
});

it("mirrors a selected range and preserves native selection for replacement", async () => {
  const user = userEvent.setup();
  const { field } = setup();
  const textarea = field as HTMLTextAreaElement;
  await user.type(field, "search alpha");
  textarea.setSelectionRange(7, 12, "backward");
  fireEvent.select(textarea);
  expect(document.querySelector("[data-terminal-prefix]")?.textContent).toBe(
    "search ",
  );
  expect(document.querySelector("[data-terminal-selection]")?.textContent).toBe(
    "alpha",
  );
  expect(document.querySelector("[data-terminal-cursor]")).toBeNull();
  expect(textarea.value).toBe("search alpha");
  expect([
    textarea.selectionStart,
    textarea.selectionEnd,
    textarea.selectionDirection,
  ]).toEqual([7, 12, "backward"]);
  await user.keyboard("beta");
  expect(textarea.value).toBe("search beta");
  expect(document.querySelector("[data-terminal-selection]")).toBeNull();
  expect(document.querySelector("[data-terminal-prefix]")?.textContent).toBe(
    "search beta",
  );
  expect(document.querySelector("[data-terminal-cursor]")).not.toBeNull();
});

it("shows the IME composition range, does not submit it, and restores the block cursor on commit", async () => {
  const { field, open } = setup();
  const textarea = field as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: "search " } });
  textarea.setSelectionRange(7, 7);
  fireEvent.compositionStart(textarea);
  fireEvent.change(textarea, {
    target: { value: "search 中文", selectionStart: 9, selectionEnd: 9 },
  });
  fireEvent.compositionUpdate(textarea, { data: "中文" });
  expect(
    document.querySelector("[data-terminal-composition]")?.textContent,
  ).toBe("中文");
  fireEvent.keyDown(textarea, {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  expect(open).not.toHaveBeenCalled();
  expect(textarea.value).toBe("search 中文");
  fireEvent.compositionEnd(textarea, { data: "中文" });
  expect(document.querySelector("[data-terminal-composition]")).toBeNull();
  expect(document.querySelector("[data-terminal-prefix]")?.textContent).toBe(
    "search 中文",
  );
  expect(document.querySelector("[data-terminal-cursor]")).not.toBeNull();
  expect(textarea.value).toBe("search 中文");
});

it("does not complete during IME composition or steal Escape from another editor", () => {
  const { field } = setup(<textarea aria-label="评论草稿" />);
  fireEvent.change(field, { target: { value: "he" } });
  fireEvent.compositionStart(field);
  expect(fireEvent.keyDown(field, { key: "Tab", isComposing: true })).toBe(true);
  expect((field as HTMLTextAreaElement).value).toBe("he");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.compositionEnd(field);
  const comment = screen.getByRole("textbox", { name: "评论草稿" });
  comment.focus();
  fireEvent.keyDown(comment, { key: "Escape" });
  expect(document.activeElement).toBe(comment);
});

it("scrolls repeatedly while editing without switching focus", () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(220);
  const { field } = setup(<p>Long article</p>);
  const transcript = screen.getByRole("region", { name: "终端历史记录" });
  fireEvent.change(field, { target: { value: "unsubmitted draft" } }); field.focus();
  act(() => { for (let i = 0; i < 3; i++) fireEvent.keyDown(field, { key: "PageDown" }); });
  expect(transcript.scrollTop).toBe(528);
  fireEvent.keyDown(field, { key: "PageUp" });
  expect(transcript.scrollTop).toBe(352);
  expect((field as HTMLTextAreaElement).value).toBe("unsubmitted draft");
  expect(document.activeElement).toBe(field);
});

it("starts account questions directly in the command line without an account UI", async () => {
  const { field } = setup();
  fireEvent.change(field, { target: { value: "register" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByRole("textbox", { name: "Username:" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("region", { name: "账户" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Username:" }), { key: "c", ctrlKey: true });
  await screen.findByRole("textbox", { name: "博客命令" });
});

it("never echoes or recalls accidentally supplied account arguments", async () => {
  const { field } = setup();
  for (const command of ['login user private-password-1', '"register" private-password-2', 'passwd private-password-3', 'logout private-password-4']) {
    fireEvent.change(field, { target: { value: command } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(document.body.textContent).not.toContain("private-password");
  }
  fireEvent.keyDown(field, { key: "ArrowUp" });
  expect((field as HTMLTextAreaElement).value).toBe("logout");
  fireEvent.change(field, { target: { value: "history" } });
  await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
  expect(document.body.textContent).not.toContain("private-password");
});

it("Tab with no candidates stays in the terminal until Escape releases focus", async () => {
  const user = userEvent.setup();
  const { field } = setup();
  await user.type(field, "no_such_command");
  await user.tab();
  expect(document.activeElement).toBe(field);
  expect((field as HTMLTextAreaElement).value).toBe("no_such_command");
  await user.keyboard("{Escape}"); await user.tab();
  expect(document.activeElement).not.toBe(field);
});

it("uses the site's name and deployment hostname in the terminal and command output", async () => {
  const custom: FrozenSite = { ...EMPTY_SNAPSHOT, site: { ...EMPTY_SNAPSHOT.site, title: "林间笔记" }, siteOrigin: "https://notes.example.org" };
  render(<MemoryRouter><ActionsContext value={{ data: custom, nodes: createVfs([]), cwd: "/", open: vi.fn() }}><Terminal dispatchRef={{ current: null }} /></ActionsContext></MemoryRouter>);
  expect(screen.getByRole("link", { name: "林间笔记 首页" })).toBeTruthy();
  const field = screen.getByRole("textbox", { name: "博客命令" });
  fireEvent.change(field, { target: { value: "hostname" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(screen.getByRole("log").textContent).toContain("notes.example.org"));
  expect(document.querySelector(".prompt")?.textContent).toContain("guest@notes.example.org");
});
