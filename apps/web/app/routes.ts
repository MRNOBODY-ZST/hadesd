import { index, route, type RouteConfig } from "@react-router/dev/routes";
import { readFileSync } from "node:fs";
import type { ReleaseSnapshot } from "@hadesd/contracts";
const snapshot: ReleaseSnapshot | null = process.env.HADESD_SNAPSHOT
  ? (JSON.parse(
      readFileSync(process.env.HADESD_SNAPSHOT, "utf8"),
    ) as ReleaseSnapshot)
  : null;
export default [
  index("routes/home.tsx"),
  route("search", "routes/search.tsx"),
  ...(snapshot?.contents.some((c) => c.tags.length)
    ? [route("tags/:tag", "routes/tags.tsx")]
    : []),
  ...(snapshot?.contents.some((c) => c.type !== "PAGE")
    ? [route(":section/:slug", "routes/reader.tsx")]
    : []),
  route(":section", "routes/section.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
