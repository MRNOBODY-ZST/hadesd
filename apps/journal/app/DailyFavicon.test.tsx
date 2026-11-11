import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { DailyFavicon, ghostDay, ghostIcons, nextGhostChange } from "@hadesd/ui/daily-favicon";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const icon = () => document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')!;

describe("daily ghost favicon", () => {
  it("uses all seven assets in Monday-to-Sunday order, independent of the visitor's zone", () => {
    expect(new Set(ghostIcons).size).toBe(7);
    for (let day = 0; day < 7; day++) {
      expect(ghostDay(new Date(Date.UTC(2026, 10, 9 + day, 4)))).toBe(day);
    }
    expect(ghostDay(new Date("2026-11-15T15:59:59.999Z"))).toBe(6);
    expect(ghostDay(new Date("2026-11-15T16:00:00Z"))).toBe(0);
    expect(ghostDay(new Date("2026-11-12T01:00:00-08:00"))).toBe(3);
  });
  it("computes the next Shanghai midnight across month/year boundaries", () => {
    expect(nextGhostChange(new Date("2026-12-31T15:59:59Z"))).toBe(1010);
    expect(nextGhostChange(new Date("2026-12-31T16:00:00Z"))).toBe(86_400_010);
    expect(ghostDay(new Date("2026-12-31T16:00:00Z"))).toBe(4);
  });
  it("keeps prerendering deterministic and selects today on mount", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T04:00:00Z"));
    expect(renderToString(<DailyFavicon />)).toContain('data-ghost-day="1"');
    render(<DailyFavicon />);
    expect(icon().getAttribute("href")).toBe(ghostIcons[3]);
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });
  it("changes the existing link at midnight, then cleans up its timer", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-15T15:59:59Z"));
    const { unmount } = render(<DailyFavicon />);
    expect(icon().getAttribute("href")).toBe(ghostIcons[6]);
    act(() => { vi.advanceTimersByTime(1020); });
    expect(icon().getAttribute("href")).toBe(ghostIcons[0]);
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it("catches up after sleep or returning from the browser's page cache", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T04:00:00Z"));
    render(<DailyFavicon />);
    act(() => { vi.setSystemTime(new Date("2026-11-11T04:00:00Z")); window.dispatchEvent(new Event("pageshow")); });
    expect(icon().getAttribute("href")).toBe(ghostIcons[2]);
    act(() => { vi.setSystemTime(new Date("2026-11-13T04:00:00Z")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(icon().getAttribute("href")).toBe(ghostIcons[4]);
    expect(vi.getTimerCount()).toBe(1);
  });
});
