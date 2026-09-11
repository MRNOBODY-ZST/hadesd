// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemePicker } from "./components/ThemePicker";
import { ADMIN_THEME_KEY, ADMIN_THEMES, readAdminTheme, setAdminTheme } from "./theme";

beforeEach(() => { localStorage.clear(); document.documentElement.dataset.adminTheme = "paper"; document.documentElement.removeAttribute("style"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.adminTheme; document.documentElement.removeAttribute("style"); });

it("switches the complete workspace from accessible preset cards and remembers the choice", () => {
  render(<ThemePicker />);
  const trigger = screen.getByRole("button", { name: "切换写作台外观，当前纸张手记" });
  fireEvent.click(trigger);
  expect(screen.getByRole("group", { name: "选择外观预设" })).toBeTruthy();
  const radio = screen.getByRole("radio", { name: "石墨夜间" }) as HTMLInputElement;
  fireEvent.click(radio);
  expect(radio.checked).toBe(true);
  expect(document.documentElement.dataset.adminTheme).toBe("graphite");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(localStorage.getItem(ADMIN_THEME_KEY)).toBe("graphite");
  expect(screen.getByRole("button", { name: "切换写作台外观，当前石墨夜间" })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("radio")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("updates open pickers across tabs and remains usable when preference storage is blocked", () => {
  render(<ThemePicker />);
  localStorage.setItem(ADMIN_THEME_KEY, "amber");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: ADMIN_THEME_KEY, newValue: "amber" })));
  expect(screen.getByRole("button", { name: "切换写作台外观，当前琥珀终端" })).toBeTruthy();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage disabled"); });
  act(() => setAdminTheme("glacier"));
  expect(screen.getByRole("button", { name: "切换写作台外观，当前冰川工作台" })).toBeTruthy();
  expect(document.documentElement.style.colorScheme).toBe("light");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage disabled"); });
  expect(readAdminTheme()).toBe("paper");
});

it("restores every preset before React loads using a CSP-compatible external bootstrap", () => {
  const html = readFileSync("index.html", "utf8");
  const bootstrap = readFileSync("public/theme-init.js", "utf8");
  expect(html.indexOf('src="/theme-init.js"')).toBeLessThan(html.indexOf('type="module"'));
  expect(html).not.toMatch(/<script>(?:.|\n)*?<\/script>/);
  for (const preset of ADMIN_THEMES) {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    const meta = { setAttribute: vi.fn() };
    runInNewContext(bootstrap, { localStorage: { getItem: () => preset.id }, document: { documentElement: root, querySelector: () => meta } });
    expect(root.dataset.adminTheme).toBe(preset.id);
    expect(root.style.colorScheme).toBe(preset.colorScheme);
    expect(root.style.backgroundColor).toBe(preset.chrome);
    expect(meta.setAttribute).toHaveBeenCalledWith("content", preset.chrome);
  }
  const root = { dataset: {} as Record<string, string>, style: {} };
  runInNewContext(bootstrap, { localStorage: { getItem: () => "unknown-theme" }, document: { documentElement: root, querySelector: () => null } });
  expect(root.dataset.adminTheme).toBe("paper");
});

it("keeps body, secondary, action and status text readable on every light and dark surface", () => {
  const css = readFileSync("src/global.css", "utf8");
  const blocks = [...css.matchAll(/:root(?:\[data-admin-theme="([a-z]+)"\])?\s*\{([^}]+)\}/g)];
  const luminance = (hex: string) => {
    const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
  };
  const contrast = (first: string, second: string) => { const a = luminance(first), b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  expect(blocks).toHaveLength(4);
  for (const [, name = "paper", block] of blocks) {
    const tokens = Object.fromEntries([...block!.matchAll(/--([a-z-]+):\s*(#[a-f0-9]{6});/g)].map(match => [match[1], match[2]]));
    for (const background of ["paper", "surface", "panel", "sidebar"]) {
      for (const foreground of ["ink", "secondary", "muted", "accent"]) expect(contrast(tokens[foreground]!, tokens[background]!), `${name}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const [foreground, background] of [["danger", "danger-soft"], ["warning", "warning-soft"], ["success", "success-soft"], ["on-accent", "green"], ["story-muted", "story"]]) {
      expect(contrast(tokens[foreground!]!, tokens[background!]!), `${name}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(tokens.focus!, tokens.surface!), `${name}: visible focus`).toBeGreaterThanOrEqual(3);
  }
});
