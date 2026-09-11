import { useSyncExternalStore } from "react";

export const ADMIN_THEME_KEY = "hadesd.admin.theme.v1";
export const ADMIN_THEMES = [
  { id: "paper", name: "纸张手记", detail: "暖白纸面 · 松绿墨色", colorScheme: "light", chrome: "#f5f4ee", swatches: ["#eaeee4", "#fffef9", "#244d38"] },
  { id: "graphite", name: "石墨夜间", detail: "深灰层次 · 柔和冷光", colorScheme: "dark", chrome: "#111419", swatches: ["#171b21", "#222932", "#b9cff7"] },
  { id: "glacier", name: "冰川工作台", detail: "清透蓝白 · 专注秩序", colorScheme: "light", chrome: "#eef3f8", swatches: ["#dce8f3", "#ffffff", "#1b5b83"] },
  { id: "amber", name: "琥珀终端", detail: "暖色磷光 · 等宽节奏", colorScheme: "dark", chrome: "#15130e", swatches: ["#19160f", "#272219", "#e6b25c"] },
] as const;
export type AdminTheme = typeof ADMIN_THEMES[number]["id"];
const CHANGE_EVENT = "hadesd:admin-theme";
export function isAdminTheme(value: unknown): value is AdminTheme { return ADMIN_THEMES.some(theme => theme.id === value); }
export function readAdminTheme(): AdminTheme {
  try { const value = localStorage.getItem(ADMIN_THEME_KEY); return isAdminTheme(value) ? value : "paper"; }
  catch { return "paper"; }
}
function applyAdminTheme(theme: AdminTheme) {
  const preset = ADMIN_THEMES.find(item => item.id === theme)!;
  document.documentElement.dataset.adminTheme = theme;
  document.documentElement.style.colorScheme = preset.colorScheme;
  document.documentElement.style.backgroundColor = preset.chrome;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", preset.chrome);
}
export function setAdminTheme(theme: AdminTheme) {
  if (!isAdminTheme(theme)) return;
  applyAdminTheme(theme);
  try { localStorage.setItem(ADMIN_THEME_KEY, theme); } catch { /* Keep this tab usable when browser storage is unavailable. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
const snapshot = (): AdminTheme => {
  const value = document.documentElement.dataset.adminTheme;
  return isAdminTheme(value) ? value : readAdminTheme();
};
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== ADMIN_THEME_KEY && event.key !== null) return;
    applyAdminTheme(readAdminTheme()); listener();
  };
  window.addEventListener(CHANGE_EVENT, listener); window.addEventListener("storage", storage);
  return () => { window.removeEventListener(CHANGE_EVENT, listener); window.removeEventListener("storage", storage); };
}
export function useAdminTheme() { return useSyncExternalStore(subscribe, snapshot, () => "paper" as const); }
