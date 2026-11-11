import type { Config } from "@react-router/dev/config";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ReleaseSnapshot } from "@hadesd/contracts";
const file = process.env.HADESD_SNAPSHOT;
if (file && !isAbsolute(file)) throw new Error("HADESD_SNAPSHOT must be an absolute frozen snapshot path");
const snapshot: ReleaseSnapshot | null = file ? JSON.parse(readFileSync(file, "utf8")) : null;
export default {
  ssr: false,
  buildDirectory: process.env.HADESD_BUILD_DIR || "build",
  prerender: [...new Set(["/", "/posts", "/projects", "/research", "/about", "/now", "/links", "/search", "/404",
    ...snapshot?.contents.map(content => content.route) ?? [],
    ...snapshot?.contents.flatMap(content => content.tags.map(tag => `/tags/${tag}`)) ?? []])],
} satisfies Config;
