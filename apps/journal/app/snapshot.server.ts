import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { EMPTY_SNAPSHOT, type ReleaseSnapshot } from "@hadesd/contracts";
import { normalizeSiteOrigin } from "@hadesd/contracts/site-origin";
export const siteOrigin = normalizeSiteOrigin(process.env.SITE_ORIGIN || "https://itshades.dev");
const file = process.env.HADESD_SNAPSHOT;
if (file && !isAbsolute(file)) throw new Error("HADESD_SNAPSHOT must be absolute");
export const snapshot: ReleaseSnapshot = file ? JSON.parse(readFileSync(file, "utf8")) : EMPTY_SNAPSHOT;
export const publicIndex = snapshot.contents.map(({ markdown: _markdown, ...content }) => content);
