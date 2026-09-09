import type { Config } from "@react-router/dev/config";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ReleaseSnapshot } from "@hadesd/contracts";
const filename = process.env.HADESD_SNAPSHOT;
if (filename && !isAbsolute(filename))
  throw new Error("HADESD_SNAPSHOT must be an absolute frozen snapshot path");
const snapshot = filename
  ? (JSON.parse(readFileSync(filename, "utf8")) as ReleaseSnapshot)
  : null;
const paths = [
  "/",
  "/posts",
  "/projects",
  "/research",
  "/about",
  "/now",
  "/links",
  "/search",
  "/404",
  ...(snapshot?.contents.map((c) => c.route) ?? []),
  ...Array.from(new Set(snapshot?.contents.flatMap((c) => c.tags) ?? [])).map(
    (tag) => `/tags/${tag}`,
  ),
];
export default {
  ssr: false,
  buildDirectory: process.env.HADESD_BUILD_DIR || "build",
  prerender: Array.from(new Set(paths)),
} satisfies Config;
