import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal as TerminalProgram } from "./Modal";
import { ScreenPager } from "./ScreenPager";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {};
  HTMLDialogElement.prototype.close = function () {};
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Harness() {
  const [open, setOpen] = useState(true);
  return <main>{open ? <TerminalProgram label="测试程序" onClose={() => setOpen(false)}><label>正文<textarea defaultValue="保留正文" /></label></TerminalProgram> : <p>返回终端</p>}</main>;
}

it("runs in the terminal document and exits with :q without native dialogs", () => {
  render(<Harness />);
  expect(screen.getByRole("region", { name: "测试程序" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  const command = screen.getByRole("textbox", { name: "程序命令" });
  fireEvent.change(command, { target: { value: ":q" } });
  fireEvent.keyDown(command, { key: "Enter" });
  expect(screen.getByText("返回终端")).toBeTruthy();
});

it.each([{ key: "Escape" }, { key: "c", ctrlKey: true }])("exits using $key without submitting the editor", keys => {
  render(<Harness />);
  fireEvent.keyDown(screen.getByLabelText("正文"), keys);
  expect(screen.getByText("返回终端")).toBeTruthy();
});

it("lets IME composition and ordinary :q text stay inside form fields", () => {
  render(<Harness />);
  const body = screen.getByLabelText("正文");
  fireEvent.change(body, { target: { value: ":q" } });
  fireEvent.keyDown(body, { key: "Enter" });
  fireEvent.keyDown(body, { key: "Escape", isComposing: true });
  expect((body as HTMLTextAreaElement).value).toBe(":q");
  expect(screen.queryByText("返回终端")).toBeNull();
});

it("reveals a newly opened program on a later terminal screen", async () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(220);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("screen-content") ? 900 : 220; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: this.hasAttribute("data-terminal-program") ? 600 : 0, left: 0, right: 700, bottom: 700, width: 700, height: 100, x: 0, y: 0, toJSON() {} };
  });
  function Page() {
    const [open, setOpen] = useState(false);
    return <ScreenPager><button onClick={() => setOpen(true)}>编辑末尾评论</button>{open && <TerminalProgram label="末尾评论" onClose={() => setOpen(false)}><textarea data-autofocus aria-label="末尾正文" /></TerminalProgram>}</ScreenPager>;
  }
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "编辑末尾评论" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "终端屏幕" }).getAttribute("data-page")).toBe("4"));
  expect(document.activeElement).toBe(screen.getByLabelText("末尾正文"));
});
