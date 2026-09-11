import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VimBuffer } from "./VimBuffer";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
function setup(loadDraft?: React.ComponentProps<typeof VimBuffer>["loadDraft"]) {
  const close = vi.fn();
  render(<VimBuffer path="/about.md" markdown="published text" loadDraft={loadDraft} onClose={close} />);
  return { close, buffer: screen.getByRole("region", { name: "Vim 编辑器" }) };
}
function ex(command: string) {
  fireEvent.keyDown(screen.getByRole("region", { name: "Vim 编辑器" }), { key: ":" });
  const input = screen.getByRole("textbox", { name: "Vim 命令" });
  fireEvent.change(input, { target: { value: command } });
  fireEvent.keyDown(input, { key: "Enter" });
}
async function insert(value: string) {
  fireEvent.keyDown(screen.getByRole("region", { name: "Vim 编辑器" }), { key: "i" });
  const input = await screen.findByRole("textbox", { name: "Vim 文本" });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Escape" });
}
it("refuses to write public source until editing a clearly identified local copy", async () => {
  const { buffer, close } = setup();
  ex("w");
  expect(screen.getByRole("status").textContent).toContain("E45");
  await insert("my local text");
  expect(buffer.textContent).toContain("LOCAL COPY");
  ex("q");
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("E37");
  ex("w");
  await waitFor(() => expect(localStorage.getItem("hadesd.vim.local.v1:/about.md")).toContain("my local text"));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("浏览器");
  ex("q");
  expect(close).toHaveBeenCalledTimes(1);
});
it(":q! discards changes and :wq closes only after a successful local save", async () => {
  const { close } = setup();
  await insert("discard me");
  ex("q!");
  expect(close).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0);
  cleanup();
  const next = setup();
  await insert("keep me");
  ex("wq");
  await waitFor(() => expect(next.close).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem("hadesd.vim.local.v1:/about.md")).toContain("keep me");
});
it("keeps dirty text and refuses to quit when saving fails", async () => {
  const { close } = setup();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  await insert("precious draft");
  ex("wq");
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Storage unavailable"));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("文件源码").textContent).toContain("precious draft");
});
it("loads the admin draft on i and waits for the real server save before quitting", async () => {
  let saved = "", finish!: () => void;
  const loadDraft = vi.fn(async () => ({ markdown: "private latest draft", save: async (value: string) => { await new Promise<void>(resolve => { finish = resolve; }); saved = value; } }));
  const { close, buffer } = setup(loadDraft);
  expect(loadDraft).not.toHaveBeenCalled();
  fireEvent.keyDown(buffer, { key: "i" });
  const input = await screen.findByRole("textbox", { name: "Vim 文本" });
  expect((input as HTMLTextAreaElement).value).toBe("private latest draft");
  fireEvent.change(input, { target: { value: "saved server draft" } });
  fireEvent.keyDown(input, { key: "Escape" });
  ex("wq");
  expect(close).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(saved).toBe("saved server draft");
  expect(localStorage.length).toBe(0);
});
it("keeps IME Enter and Escape inside insert mode until composition ends", async () => {
  const { buffer } = setup();
  fireEvent.keyDown(buffer, { key: "i" });
  const input = await screen.findByRole("textbox", { name: "Vim 文本" });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "中文" } });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(buffer.getAttribute("data-vim-mode")).toBe("INSERT");
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(buffer.getAttribute("data-vim-mode")).toBe("NORMAL");
  expect(buffer.textContent).toContain("中文");
});
it("ignores a cancelled admin draft load even when the response arrives late", async () => {
  let finish!: (value: { markdown: string; save: () => Promise<void> }) => void;
  const { buffer } = setup(async () => await new Promise(resolve => { finish = resolve; }));
  fireEvent.keyDown(buffer, { key: "i" });
  fireEvent.keyDown(buffer, { key: "c", ctrlKey: true });
  finish({ markdown: "stale private text", save: async () => {} });
  await waitFor(() => expect(buffer.getAttribute("data-vim-mode")).toBe("NORMAL"));
  expect(screen.queryByRole("textbox", { name: "Vim 文本" })).toBeNull();
  expect(buffer.textContent).not.toContain("stale private text");
});
it("pages long source with arrows and restores a saved local copy only on edit intent", async () => {
  localStorage.setItem("hadesd.vim.local.v1:/about.md", JSON.stringify({ markdown: "saved browser text" }));
  const { buffer } = setup();
  expect(buffer.textContent).toContain("published text");
  fireEvent.keyDown(buffer, { key: "i" });
  const input = await screen.findByRole("textbox", { name: "Vim 文本" });
  expect((input as HTMLTextAreaElement).value).toBe("saved browser text");
  fireEvent.change(input, { target: { value: Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n") } });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.keyDown(buffer, { key: "g" });
  fireEvent.keyDown(buffer, { key: "g" });
  expect(document.querySelector("[data-vim-line]")?.getAttribute("data-vim-line")).toBe("1");
  fireEvent.keyDown(buffer, { key: "PageDown" });
  expect(Number(document.querySelector("[data-vim-line]")?.getAttribute("data-vim-line"))).toBeGreaterThan(1);
  fireEvent.keyDown(buffer, { key: "ArrowDown" });
  expect(buffer.getAttribute("data-vim-mode")).toBe("NORMAL");
});
it("locks private text after logout or account switch and restores unsaved work only to its owner", async () => {
  let saved = "";
  const loadDraft = async () => ({ markdown: "private source", save: async (value: string) => { saved = value; } });
  const close = vi.fn();
  const props = { path: "/private.md", markdown: "public source", loadDraft, onClose: close };
  const { rerender } = render(<VimBuffer {...props} identity="admin-a" />);
  await insert("private unsaved edits");
  rerender(<VimBuffer {...props} identity={undefined} />);
  expect(screen.getByRole("region", { name: "Vim 编辑器" }).textContent).not.toContain("private unsaved edits");
  expect(screen.queryByLabelText("文件源码")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("已锁定");
  ex("wq");
  expect(saved).toBe("");
  expect(close).not.toHaveBeenCalled();
  rerender(<VimBuffer {...props} identity="admin-b" />);
  expect(screen.queryByLabelText("文件源码")).toBeNull();
  ex("w");
  expect(saved).toBe("");
  rerender(<VimBuffer {...props} identity="admin-a" />);
  expect(screen.getByLabelText("文件源码").textContent).toContain("private unsaved edits");
  ex("wq");
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(saved).toBe("private unsaved edits");
});
