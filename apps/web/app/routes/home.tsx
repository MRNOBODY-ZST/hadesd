import type { MetaFunction } from "react-router";
import { Link, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "../root";
import { pageMeta } from "../meta";
import { snapshot, siteOrigin } from "../snapshot.server";
export function loader() {
  return {
    siteTitle: snapshot.site.title,
    siteOrigin,
    description: snapshot.site.homeText,
  };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) =>
  pageMeta(
    data?.siteTitle ?? "HADESD",
    data?.description ?? "记录研究、工程与思考。",
    "/",
    data?.siteTitle ?? "HADESD",
    data?.siteOrigin,
  );
const banner = `██╗  ██╗ █████╗ ██████╗ ███████╗███████╗██████╗
██║  ██║██╔══██╗██╔══██╗██╔════╝██╔════╝██╔══██╗
███████║███████║██║  ██║█████╗  ███████╗██║  ██║
██╔══██║██╔══██║██║  ██║██╔══╝  ╚════██║██║  ██║
██║  ██║██║  ██║██████╔╝███████╗███████║██████╔╝
╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝╚═════╝`;
export default function Home() {
  const data = useRouteLoaderData<typeof rootLoader>("root")!;
  const folders = ([
    ["posts", "文章", "POST"],
    ["projects", "项目", "PROJECT"],
    ["research", "研究", "RESEARCH"],
  ] as const).filter(([, , type]) => type === "POST" || data.contents.some(content => content.type === type));
  const latest = data.contents.filter(content => content.type !== "PAGE")
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 2);
  return (
    <div className="home-page">
      <h1 className="sr-only">{data.site.title}</h1>
      <pre className={`terminal-banner${data.site.title === "HADESD" ? "" : " terminal-site-title"}`} aria-hidden="true">
        {data.site.title === "HADESD" ? banner : data.site.title}
      </pre>
      <p className="terminal-identity">
        {data.site.introduction}{" "}
        <span>
          {data.site.tagline && `/ ${data.site.tagline}`}
        </span>
      </p>
      {data.site.homeText && <p className="terminal-home-text" data-terminal-reveal="2">{data.site.homeText}</p>}
      <p className="terminal-boot-line">
        <span>[ OK ]</span> hadesd.service online{" "}
        <span className="muted">· RELEASE {data.releaseId.slice(0, 8)}</span>
      </p>
      <p className="terminal-echo home-ls">
        <span>guest@{new URL(data.siteOrigin).hostname}:~ $</span> ls -la
      </p>
      <div className="terminal-files" aria-label="公开文件目录">
        {folders.map(([path, title, type]) => (
          <Link key={path} to={`/${path}`}>
            <span className="file-mode">dr-xr-xr-x</span>
            <span className="file-name">{path}/</span>
            <span className="file-description">
              {title}{" "}
              <small>
                ({data.contents.filter((c) => c.type === type).length})
              </small>
            </span>
          </Link>
        ))}
        {[
          ["about.md", "about", "关于"],
          ["now.md", "now", "近况"],
          ["links.json", "links", "链接"],
        ].map(([file, path, title]) => (
          <Link key={file} to={`/${path}`}>
            <span className="file-mode">-r--r--r--</span>
            <span className="file-name">{file}</span>
            <span className="file-description">{title}</span>
          </Link>
        ))}
      </div>
      {latest.length > 0 && (
        <div className="terminal-recent">
          <p className="muted">LAST MODIFIED / 最近公开</p>
          {latest.map((item) => (
            <Link key={item.id} to={item.route}>
              <span>↳</span> {item.title}
            </Link>
          ))}
        </div>
      )}
      <p className="terminal-welcome-hint">
        输入命令开始探索。文字与文件均可点击。
        <br />
        <span className="muted">
          help · ls · open &lt;file&gt; · search &lt;keyword&gt;
        </span>
      </p>
    </div>
  );
}
