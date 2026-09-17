import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  isRouteErrorResponse,
  type LinksFunction,
} from "react-router";
import type { ReactNode } from "react";
import { snapshot, publicIndex, siteOrigin } from "./snapshot.server";
import { Shell } from "./shell/Shell";
import "@hadesd/ui/tokens.css";
import "@hadesd/ui/crt.css";
import "./global.css";
export function loader() {
  return {
    releaseId: snapshot.releaseId,
    createdAt: snapshot.createdAt,
    site: snapshot.site,
    siteOrigin,
    contents: publicIndex,
  };
}
export const links: LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  {
    rel: "alternate",
    type: "application/rss+xml",
    title: "RSS",
    href: "/rss.xml",
  },
];
export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#11130f" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <div className="system-crt-glass" aria-hidden="true" />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
export default function Root() {
  const data = useLoaderData<typeof loader>();
  return (
    <Shell data={data}>
      <Outlet />
    </Shell>
  );
}
export function ErrorBoundary({ error }: { error: unknown }) {
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="route-error">
      <p className="eyebrow">HADESD / {is404 ? "404" : "ERROR"}</p>
      <h1>{is404 ? "此路径还没有被记录。" : "页面暂时无法打开。"}</h1>
      <p>
        {is404
          ? "链接可能已更新，或内容已撤下。"
          : "可以重新加载，或返回目录继续浏览。"}
      </p>
      <a href="/">返回首页 →</a>
    </main>
  );
}
