import { afterEach, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { EMPTY_SNAPSHOT } from "@hadesd/contracts";
import type { FrozenSite } from "@hadesd/terminal-core";
import { Shell } from "./Shell";
import { usePreferences } from "./store";
vi.mock("../effects/TerminalStage", () => ({
  TerminalStage: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.reader;
});
it("hydrates a scrollable terminal on trailing-slash routes, then restores this-version preferences", async () => {
  const data: FrozenSite = {
    ...EMPTY_SNAPSHOT,
    contents: [
      {
        id: "article",
        revisionId: "revision",
        type: "POST",
        title: "Article",
        slug: "article",
        route: "/posts/article",
        summary: "",
        tags: [],
        language: "zh",
        publishedAt: "2026-09-09",
        updatedAt: "2026-09-09",
      },
    ],
  };
  usePreferences.setState({ theme: "amber", crt: "low", reader: false });
  const tree = (pathname: string) => (
    <MemoryRouter initialEntries={[pathname]}>
      <Shell data={data}>
        <article>
          <h1>Article</h1>
        </article>
      </Shell>
    </MemoryRouter>
  );
  const serverHtml = renderToString(tree("/posts/article/"));
  expect(serverHtml).toContain("TTY 01");
  expect(serverHtml).toContain("screen-viewport");
  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.append(container);
  expect(container.querySelector(".prompt")?.textContent).toContain("/posts");
  localStorage.setItem(
    "hadesd.display.v2",
    JSON.stringify({ theme: "paper", crt: "off", reader: false }),
  );
  const recoverable = vi.fn();
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, tree("/posts/article"), {
      onRecoverableError: recoverable,
    });
  });
  expect(recoverable).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.theme).toBe("paper");
  expect(container.querySelector(".prompt")?.textContent).toContain("/posts");
  await act(async () => {
    root!.unmount();
  });
  container.remove();
});
