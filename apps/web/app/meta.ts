import { normalizeSiteOrigin } from "@hadesd/contracts/site-origin";

export function pageMeta(
  title: string,
  description: string,
  path: string,
  siteTitle = "HADESD",
  siteOrigin?: string,
) {
  const full = title === siteTitle ? title : `${title} — ${siteTitle}`;
  const url = normalizeSiteOrigin(siteOrigin) + path;
  return [
    { title: full },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:title", content: full },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    {
      property: "og:type",
      content: path.split("/").length > 2 ? "article" : "website",
    },
    { property: "og:site_name", content: siteTitle },
    { name: "twitter:card", content: "summary" },
  ];
}
