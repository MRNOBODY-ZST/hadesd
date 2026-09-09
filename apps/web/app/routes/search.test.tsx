import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Outlet } from "react-router";
import { EMPTY_SNAPSHOT } from "@hadesd/contracts";
import Search from "./search";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("clearing a pending query cancels its request and cannot leave loading stuck or show stale results", async () => {
  let resolve!: (value: Response) => void;
  let signal: AbortSignal | undefined;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return pending;
    }),
  );
  const router = createMemoryRouter(
    [
      {
        id: "root",
        loader: () => EMPTY_SNAPSHOT,
        Component: Outlet,
        children: [{ path: "/search", Component: Search }],
      },
    ],
    { initialEntries: ["/search?q=pending"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByText("正在搜索…");
  const input = screen.getByRole("textbox", { name: "搜索关键词" });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(screen.queryByText("正在搜索…")).toBeNull());
  expect(signal?.aborted).toBe(true);
  expect(screen.getByText("输入一个词，开始探索。")).toBeTruthy();
  await act(async () => {
    resolve(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "old",
              title: "stale result",
              route: "/posts/stale",
              tags: [],
              publishedAt: "2026-09-09",
            },
          ],
          total: 1,
          page: 0,
          size: 20,
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    await pending;
  });
  expect(screen.queryByText("stale result")).toBeNull();
  expect(screen.queryByText("正在搜索…")).toBeNull();
});
