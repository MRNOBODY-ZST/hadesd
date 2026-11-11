import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData, isRouteErrorResponse, type LinksFunction } from "react-router";
import type { ReactNode } from "react";
import { DailyFavicon } from "@hadesd/ui/daily-favicon";
import { snapshot, publicIndex, siteOrigin } from "./snapshot.server";
import { SiteShell } from "./components/SiteShell";
import { AccountProvider } from "./community/Account";
import "./journal.css";
export function loader() { return { site: snapshot.site, contents: publicIndex, releaseId: snapshot.releaseId, siteOrigin }; }
export const links: LinksFunction = () => [{ rel: "alternate", type: "application/rss+xml", title: "HADES Journal RSS", href: "/rss.xml" }];
export function Layout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="theme-color" content="#fafafc" /><Meta /><DailyFavicon /><Links /></head>
    <body>{children}<ScrollRestoration /><Scripts /></body></html>;
}
export default function Root() { const data = useLoaderData<typeof loader>(); return <AccountProvider><SiteShell data={data}><Outlet /></SiteShell></AccountProvider>; }
export function ErrorBoundary({ error }: { error: unknown }) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return <main className="standalone-error"><a className="wordmark" href="/">HADES <span>/ JOURNAL</span></a><p className="eyebrow">{notFound ? "404 / NOT FOUND" : "加载失败"}</p><h1>{notFound ? "页面不存在" : "页面暂时无法打开"}</h1><p>{notFound ? "地址可能已更新，或文章尚未公开。" : "页面暂时无法打开，请重新加载后再试。"}</p><a className="pill-button" href="/">返回首页 →</a></main>;
}
