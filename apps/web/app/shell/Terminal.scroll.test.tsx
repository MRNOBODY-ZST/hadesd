import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { EMPTY_SNAPSHOT, type UserAccount } from "@hadesd/contracts";
import { createVfs } from "@hadesd/terminal-core";
import { AccountProvider } from "../community/Account";
import { community } from "../community/api";
import { ActionsContext } from "./actions";
import { usePreferences } from "./store";
import { Terminal } from "./Terminal";

const markdown = "# Readable terminal\n\n**Rich Markdown** stays in command history.\n\n![Hardware board](/board.png)\n\n```sh\nprintf hello\n```";
const data = { ...EMPTY_SNAPSHOT, site: { ...EMPTY_SNAPSHOT.site, homeText: markdown } };
const reader: UserAccount = { id: "reader-id", username: "reader", displayName: "Reader", role: "USER" };
beforeEach(() => {
  vi.spyOn(community, "session").mockResolvedValue({ user: null });
  vi.spyOn(community, "register").mockResolvedValue(reader);
  vi.spyOn(community, "login").mockResolvedValue(reader);
  vi.spyOn(community, "logout").mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(() => {
  cleanup(); usePreferences.setState({ settingsOpen: false, paletteOpen: false });
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
});
async function setup() {
  const open = vi.fn();
  render(<MemoryRouter><AccountProvider><ActionsContext value={{ data, cwd: "/", nodes: createVfs([]), open }}>
    <Terminal dispatchRef={{ current: null }}><p>Boot session is ready.</p></Terminal>
  </ActionsContext></AccountProvider></MemoryRouter>);
  await act(async () => {});
  return { open, transcript: screen.getByRole("region", { name: "终端历史记录" }) as HTMLDivElement,
    log: screen.getByRole("log", { name: "命令输出" }) };
}
async function answer(value: string, label = "博客命令") {
  const field = screen.getByLabelText(label) as HTMLTextAreaElement | HTMLInputElement;
  await act(async () => {
    fireEvent.change(field, { target: { value } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  });
}
const lastRecord = () => document.querySelector(".terminal-record:last-child")!;
const prompt = () => document.querySelector(".terminal-input .prompt")!.textContent;

it("keeps command output in order and traverses the guest home, its parent and root without route navigation", async () => {
  const { open, log } = await setup();
  await answer("echo first-command"); await answer("echo second-command");
  expect([...log.querySelectorAll("pre")].map(item => item.textContent)).toEqual(["first-command\n", "second-command\n"]);
  await answer("pwd"); expect(lastRecord().querySelector("pre")?.textContent).toBe("/home/guest");
  await answer("cd .."); expect(prompt()).toBe("guest@hadesd:/home$");
  await answer("pwd"); expect(lastRecord().querySelector("pre")?.textContent).toBe("/home");
  await answer("cd .."); expect(prompt()).toBe("guest@hadesd:/$");
  await answer("cd .."); expect(prompt()).toBe("guest@hadesd:/$");
  await answer("cd ~"); expect(prompt()).toBe("guest@hadesd:~$");
  await answer("cd -"); expect(prompt()).toBe("guest@hadesd:/$");
  await answer("cd"); expect(prompt()).toBe("guest@hadesd:~$");
  expect(open).not.toHaveBeenCalled();
  expect(within(log).getByText("first-command")).toBeTruthy();
  expect(within(log).getByText("second-command")).toBeTruthy();
  expect(document.querySelector(".screen-pager")).toBeNull();
});

it("renders Markdown and pictures in retained history while vim explicitly opens a separate editor", async () => {
  await setup();
  await answer("md /about.md");
  expect(await screen.findByRole("heading", { name: "Readable terminal" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Hardware board" }).getAttribute("src")).toBe("/board.png");
  expect(screen.queryByRole("region", { name: "Vim 编辑器" })).toBeNull();
  await answer("echo after-reading");
  expect(screen.getByRole("heading", { name: "Readable terminal" })).toBeTruthy();
  expect(within(lastRecord() as HTMLElement).getByText("after-reading")).toBeTruthy();
  await answer("cat /about.md");
  expect(lastRecord().querySelector("pre")?.textContent).toBe(markdown);
  await answer("vim /about.md");
  const editor = await screen.findByRole("region", { name: "Vim 编辑器" });
  expect(editor.textContent).toContain("READ ONLY");
  fireEvent.keyDown(editor, { key: ":" });
  await answer("q", "Vim 命令");
  expect(screen.queryByRole("region", { name: "Vim 编辑器" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Readable terminal" })).toBeTruthy();
  await answer("open /about.md");
  expect(screen.getAllByRole("heading", { name: "Readable terminal" })).toHaveLength(2);
  expect(screen.queryByRole("region", { name: "Vim 编辑器" })).toBeNull();
});

it("pages native history from the prompt without moving focus or replacing command recall", async () => {
  const { transcript, log } = await setup();
  await answer("echo retained-line");
  Object.defineProperties(transcript, { clientHeight: { configurable: true, value: 240 }, scrollHeight: { configurable: true, value: 2400 } });
  const field = screen.getByRole("textbox", { name: "博客命令" }) as HTMLTextAreaElement;
  field.focus(); transcript.scrollTop = 600;
  fireEvent.keyDown(field, { key: "PageUp" });
  expect(transcript.scrollTop).toBe(404); expect(document.activeElement).toBe(field);
  fireEvent.keyDown(field, { key: "PageDown" });
  expect(transcript.scrollTop).toBe(600); expect(document.activeElement).toBe(field);
  fireEvent.keyDown(field, { key: "ArrowUp" }); expect(field.value).toBe("echo retained-line");
  fireEvent.keyDown(field, { key: "ArrowDown" }); expect(field.value).toBe("");
  expect(fireEvent.wheel(transcript, { deltaY: 160, cancelable: true })).toBe(true);
  transcript.scrollTop = 1400; fireEvent.scroll(transcript);
  expect(within(log).getByText("retained-line")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "[ ↓ 最新 ]" }));
  expect(transcript.scrollTop).toBe(2400); expect(document.activeElement).toBe(field);
});

it("registers through text prompts, keeps passwords out of transcript and recall, and follows the logged-in home", async () => {
  const { log } = await setup();
  const password = "A-Private-Password-123";
  await answer("register");
  expect(screen.queryByRole("dialog")).toBeNull();
  await answer("reader", "Username:");
  await answer("Reader", "Display name [reader]:");
  const secret = screen.getByLabelText("Password:") as HTMLInputElement;
  expect(secret.type).toBe("password");
  fireEvent.change(secret, { target: { value: password } });
  expect(log.textContent).not.toContain(password);
  expect(document.querySelector("[data-terminal-prefix]")).toBeNull();
  await answer(password, "Password:"); await answer(password, "Confirm password:");
  await waitFor(() => expect(prompt()).toBe("reader@hadesd:~$"));
  expect(community.register).toHaveBeenCalledWith({ username: "reader", displayName: "Reader", password });
  expect(community.login).toHaveBeenCalledWith("reader", password);
  await answer("pwd"); expect(lastRecord().querySelector("pre")?.textContent).toBe("/home/reader");
  await answer("history");
  expect(lastRecord().textContent).not.toContain(password);
  expect(lastRecord().textContent).not.toContain("Reader");
  expect(log.textContent).not.toContain(password);
  expect(JSON.stringify(localStorage)).not.toContain(password);
  const field = screen.getByRole("textbox", { name: "博客命令" }) as HTMLTextAreaElement;
  fireEvent.keyDown(field, { key: "ArrowUp" }); fireEvent.keyDown(field, { key: "ArrowUp" }); fireEvent.keyDown(field, { key: "ArrowUp" });
  expect(field.value).toBe("register");
});

it("cancels a secret prompt with Ctrl+C and resumes command input without submitting or recalling the password", async () => {
  const { log } = await setup();
  await answer("login reader");
  const secret = screen.getByLabelText("Password:") as HTMLInputElement;
  fireEvent.change(secret, { target: { value: "Never-submit-this-password" } });
  fireEvent.keyDown(secret, { key: "c", ctrlKey: true });
  const field = await screen.findByRole("textbox", { name: "博客命令" }) as HTMLTextAreaElement;
  expect(field.value).toBe(""); expect(community.login).not.toHaveBeenCalled();
  expect(log.textContent).not.toContain("Never-submit-this-password");
  await answer("echo resumed"); expect(lastRecord().querySelector("pre")?.textContent).toBe("resumed\n");
  await answer("history");
  expect(lastRecord().textContent).not.toContain("Never-submit-this-password");
});
