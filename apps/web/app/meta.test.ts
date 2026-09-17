import { expect, it } from "vitest";
import { pageMeta } from "./meta";

it("uses the deployment origin for canonical and social URLs, including after navigation", () => {
  const result = pageMeta("一篇文章", "描述", "/posts/hello", "林间笔记", "https://notes.example.org");
  expect(result).toContainEqual({ title: "一篇文章 — 林间笔记" });
  expect(result).toContainEqual({ tagName: "link", rel: "canonical", href: "https://notes.example.org/posts/hello" });
  expect(result).toContainEqual({ property: "og:url", content: "https://notes.example.org/posts/hello" });
  expect(JSON.stringify(result)).not.toContain("hadesd.sh");
});

it("uses a local address when no deployment origin is supplied", () => {
  expect(pageMeta("My blog", "", "/", "My blog")).toContainEqual({ tagName: "link", rel: "canonical", href: "http://localhost:18088/" });
});
