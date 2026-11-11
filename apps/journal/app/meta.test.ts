import { describe, expect, it } from "vitest";
import { pageMeta } from "./meta";
describe("independent site metadata", () => {
  it.each(["/", "/search", "/404", "/posts/building", "/tags/%E7%A0%94%E7%A9%B6"])("keeps %s on the configured journal origin", path => {
    const meta = pageMeta("研发记录", "摘要", path, "https://itshades.dev/", "我的记录");
    expect(meta).toContainEqual({ tagName: "link", rel: "canonical", href: `https://itshades.dev${path}` });
    expect(meta).toContainEqual({ property: "og:url", content: `https://itshades.dev${path}` });
    expect(meta).toContainEqual({ property: "og:site_name", content: "我的记录" });
    expect(meta).toContainEqual({ title: "研发记录 — 我的记录" });
  });
  it("rejects a configured origin containing a path", () => expect(() => pageMeta("x", "x", "/", "https://example.com/subsite")).toThrow());
});
