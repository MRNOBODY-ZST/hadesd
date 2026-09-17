import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { DEFAULT_SITE } from "@hadesd/contracts";
import Home from "./home";

const data = { releaseId: 'example-release', siteOrigin: 'https://notes.example.org', site: { ...DEFAULT_SITE, title: '林间笔记', introduction: '一个热爱写作的人', tagline: '慢慢记录', homeText: '在这里留下自己的故事。' }, contents: [] };
vi.mock("react-router", async () => ({ ...await vi.importActual("react-router"), useRouteLoaderData: () => data }));
afterEach(cleanup);
it("renders the publisher's identity and home copy instead of the original author's banner", () => {
  render(<MemoryRouter><Home /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "林间笔记" })).toBeTruthy();
  expect(document.querySelector(".terminal-banner")?.textContent).toBe("林间笔记");
  expect(screen.getByText("在这里留下自己的故事。")).toBeTruthy();
  expect(document.querySelector(".terminal-identity")?.textContent).toContain("一个热爱写作的人");
  expect(document.querySelector(".home-ls")?.textContent).toContain("guest@notes.example.org");
});
