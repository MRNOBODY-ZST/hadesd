import { afterEach, it, expect } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ContentList } from "./ContentList";
import type { PublicIndex } from "@hadesd/terminal-core";
afterEach(() => cleanup());
it("reveals long lists in bounded batches", () => {
  const items: PublicIndex[] = Array.from({ length: 45 }, (_, i) => ({
    id: String(i),
    type: "POST",
    revisionId: "r",
    route: "/posts/post-" + i,
    slug: "post-" + i,
    title: "Article " + i,
    summary: "",
    tags: [],
    language: "zh",
    publishedAt: "2026-09-09",
    updatedAt: "2026-09-09",
  }));
  render(
    <MemoryRouter>
      <ContentList items={items} />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("link").length).toBe(20);
  fireEvent.click(screen.getByRole("button", { name: /继续浏览/ }));
  expect(screen.getAllByRole("link").length).toBe(40);
  fireEvent.click(screen.getByRole("button", { name: /继续浏览/ }));
  expect(screen.getAllByRole("link").length).toBe(45);
  expect(screen.queryByRole("button", { name: /继续浏览/ })).toBeNull();
});
