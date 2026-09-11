import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScreenPager } from "./ScreenPager";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("screen-viewport") ? 220 : 22;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("screen-content") ? 924 : 220;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("keeps a multiline form field reachable when it crosses a normal page boundary", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function(this: HTMLElement) { return this.id === "reply-body" ? 180 : 22; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { top: this.id === "reply-body" ? 180 : 0, left: 0, width: 600, height: this.id === "reply-body" ? 180 : 22, bottom: this.id === "reply-body" ? 360 : 22, right: 600, x: 0, y: 0, toJSON: () => ({}) };
  });
  render(<ScreenPager><textarea id="reply-body" aria-label="reply" /></ScreenPager>);
  fireEvent(window, new CustomEvent("hadesd:page", { detail: { anchor: "reply-body" } }));
  const field = screen.getByRole("textbox", { name: "reply" });
  expect(field.getAttribute("tabindex")).not.toBe("-1");
  const transform = document.querySelector<HTMLElement>(".screen-content")!.style.transform;
  const offset = Number(transform.match(/-([0-9.]+)px/u)?.[1] ?? 0);
  expect(180 - offset).toBeGreaterThanOrEqual(0);
  expect(180 - offset + 180).toBeLessThanOrEqual(220);
});
it("pages a bounded terminal with keys and buttons while the wheel never changes screens", () => {
  const { container } = render(
    <ScreenPager>
      <p>Long terminal content</p>
      <input aria-label="typing" />
    </ScreenPager>,
  );
  const pager = container.querySelector(".screen-pager")!;
  expect(pager.getAttribute("data-pages")).toBe("5");
  fireEvent.wheel(container.querySelector(".screen-viewport")!, {
    deltaY: 600,
  });
  expect(pager.getAttribute("data-page")).toBe("1");
  fireEvent.keyDown(window, { key: "PageDown" });
  expect(pager.getAttribute("data-page")).toBe("2");
  expect(
    (container.querySelector(".screen-content") as HTMLElement).style.transform,
  ).toContain("-198px");
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "j" });
  expect(pager.getAttribute("data-page")).toBe("2");
  fireEvent.keyDown(window, { key: "End" });
  expect(pager.getAttribute("data-page")).toBe("5");
  expect(
    (screen.getByRole("button", { name: "下一屏" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "上一屏" }));
  expect(pager.getAttribute("data-page")).toBe("4");
});
it("new routes reset the page and returning output follows its final screen", () => {
  const { container, rerender } = render(
    <ScreenPager resetKey="a">
      <p>Article A</p>
    </ScreenPager>,
  );
  fireEvent.keyDown(window, { key: "End" });
  expect(
    container.querySelector(".screen-pager")?.getAttribute("data-page"),
  ).toBe("5");
  rerender(
    <ScreenPager resetKey="b">
      <p>Article B</p>
    </ScreenPager>,
  );
  expect(
    container.querySelector(".screen-pager")?.getAttribute("data-page"),
  ).toBe("1");
  rerender(
    <ScreenPager resetKey="command" followEnd>
      <p>Output</p>
    </ScreenPager>,
  );
  expect(
    container.querySelector(".screen-pager")?.getAttribute("data-page"),
  ).toBe("5");
});

it("keeps button paging continuous and Space activates the focused button only once", async () => {
  const user = userEvent.setup();
  const { container } = render(<ScreenPager><p>Long file</p></ScreenPager>);
  const next = screen.getByRole("button", { name: "下一屏" });
  await user.click(next);
  expect(container.querySelector(".screen-pager")?.getAttribute("data-page")).toBe("2");
  await user.keyboard(" ");
  expect(container.querySelector(".screen-pager")?.getAttribute("data-page")).toBe("3");
  await user.keyboard("{PageDown}");
  expect(container.querySelector(".screen-pager")?.getAttribute("data-page")).toBe("4");
  act(() => { for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: "PageUp" }); });
  expect(container.querySelector(".screen-pager")?.getAttribute("data-page")).toBe("1");
});

it("ignores editing, IME, browser shortcuts and keys already consumed by the intro", () => {
  const { container } = render(<ScreenPager><textarea aria-label="comment" /></ScreenPager>);
  const editor = screen.getByRole("textbox");
  fireEvent.keyDown(editor, { key: "PageDown" });
  fireEvent.keyDown(window, { key: "PageDown", isComposing: true });
  fireEvent.keyDown(window, { key: "PageDown", ctrlKey: true });
  const consumed = new KeyboardEvent("keydown", { key: "PageDown", cancelable: true });
  consumed.preventDefault();
  fireEvent(window, consumed);
  expect(container.querySelector(".screen-pager")?.getAttribute("data-page")).toBe("1");
  container.querySelector(".screen-pager")!.setAttribute("inert", "");
  fireEvent.keyDown(window, { key: "PageDown" });
  expect(container.querySelector(".screen-pager")?.getAttribute("data-page")).toBe("1");
});

it("reveals an article anchor on request while preserving command focus", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { top: this.id === "comments" ? 420 : 0, left: 0, width: 600, height: 22,
      right: 600, bottom: this.id === "comments" ? 442 : 22, x: 0, y: this.id === "comments" ? 420 : 0,
      toJSON() { return {}; } };
  });
  const { container } = render(<div className="terminal">
    <ScreenPager><h2 id="comments">文章评论</h2></ScreenPager>
    <textarea id="terminal-command" aria-label="command" />
  </div>);
  const command = screen.getByRole("textbox");
  command.focus();
  act(() => { window.dispatchEvent(new CustomEvent("hadesd:page", { detail: { anchor: "comments" } })); });
  expect(container.querySelector(".screen-pager")?.getAttribute("data-page")).toBe("3");
  expect(document.activeElement).toBe(command);
  expect(container.querySelector(".screen-viewport")?.scrollTop).toBe(0);
});

it("waits for an anchor to mount and uses the new article height instead of the preceding output metrics", async () => {
  let bodyHeight = 220;
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function(this: HTMLElement) {
    return this.classList.contains("screen-content") ? bodyHeight : 220;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { top: this.id === "late-comments" ? 650 : 0, left: 0, width: 600, height: 22,
      right: 600, bottom: 22, x: 0, y: 0, toJSON() { return {}; } };
  });
  const { container, rerender } = render(<ScreenPager resetKey="output"><p>Short output</p></ScreenPager>);
  expect(container.querySelector(".screen-pager")?.getAttribute("data-pages")).toBe("1");
  act(() => { window.dispatchEvent(new CustomEvent("hadesd:page", { detail: { anchor: "late-comments" } })); });
  bodyHeight = 1100;
  rerender(<ScreenPager resetKey="article"><h2 id="late-comments">Late comments</h2></ScreenPager>);
  await waitFor(() => expect(container.querySelector(".screen-pager")?.getAttribute("data-page")).toBe("4"));
  expect(container.querySelector(".screen-pager")?.getAttribute("data-pages")).toBe("6");
});

it("keeps asynchronously added off-screen controls out of Tab order even when page count is unchanged", async () => {
  function AsyncComments() {
    const [loaded, setLoaded] = useState(false);
    return <><button onClick={() => setLoaded(true)}>加载评论</button>{loaded && <button data-offscreen>编辑评论</button>}</>;
  }
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { top: this.hasAttribute("data-offscreen") ? 420 : 0, left: 0, width: 100, height: 22,
      right: 100, bottom: 22, x: 0, y: 0, toJSON() { return {}; } };
  });
  render(<ScreenPager><AsyncComments /></ScreenPager>);
  fireEvent.click(screen.getByRole("button", { name: "加载评论" }));
  const late = screen.getByRole("button", { name: "编辑评论" });
  await waitFor(() => expect(late.tabIndex).toBe(-1));
  fireEvent.keyDown(window, { key: "PageDown" });
  fireEvent.keyDown(window, { key: "PageDown" });
  expect(late.hasAttribute("tabindex")).toBe(false);
});
