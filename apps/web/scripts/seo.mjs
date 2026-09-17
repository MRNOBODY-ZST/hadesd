import { readFile, mkdir, writeFile, readdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeSiteOrigin } from "../../../packages/contracts/src/site-origin.mjs";
const origin = normalizeSiteOrigin(process.env.SITE_ORIGIN);
const dir = resolve(process.env.HADESD_BUILD_DIR || "build", "client");
const file = process.env.HADESD_SNAPSHOT;
const snapshot = file
  ? JSON.parse(await readFile(file, "utf8"))
  : {
      releaseId: "empty",
      createdAt: "",
      site: { title: "我的博客", tagline: "记录与分享" },
      contents: [],
    };
const esc = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const paths = [
  "/",
  "/posts",
  "/projects",
  "/research",
  "/about",
  "/now",
  "/links",
  ...snapshot.contents.map((c) => c.route),
  ...new Set(
    snapshot.contents
      .flatMap((c) => c.tags)
      .map((t) => "/tags/" + encodeURIComponent(t)),
  ),
];
await mkdir(dir, { recursive: true });
await writeFile(
  resolve(dir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(paths)].map((path) => `<url><loc>${esc(origin + path)}</loc></url>`).join("")}</urlset>`,
);
await writeFile(
  resolve(dir, "rss.xml"),
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(snapshot.site.title)}</title><link>${esc(origin)}</link><description>${esc(snapshot.site.tagline)}</description>${snapshot.contents
    .filter((c) => c.type === "POST")
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 30)
    .map(
      (c) =>
        `<item><title>${esc(c.title)}</title><link>${esc(origin + c.route)}</link><guid isPermaLink="true">${esc(origin + c.route)}</guid><pubDate>${new Date(c.publishedAt).toUTCString()}</pubDate><description>${esc(c.summary)}</description></item>`,
    )
    .join("")}</channel></rss>`,
);
await writeFile(
  resolve(dir, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`,
);
async function normalizeNames(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const old = resolve(folder, entry.name);
    if (entry.isDirectory()) await normalizeNames(old);
    let decoded;
    try {
      decoded = decodeURIComponent(entry.name);
    } catch {
      continue;
    }
    if (
      decoded !== entry.name &&
      !decoded.includes("/") &&
      !decoded.includes("\\") &&
      decoded !== "." &&
      decoded !== ".."
    )
      await rename(old, resolve(folder, decoded));
  }
}
await normalizeNames(dir);
console.log(
  `SEO: ${new Set(paths).size} frozen public paths, release ${snapshot.releaseId}`,
);
