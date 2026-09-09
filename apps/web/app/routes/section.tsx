import type { MetaFunction } from "react-router";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { snapshot, publicIndex } from "../snapshot.server";
import { ContentList } from "../reader/ContentList";
import { Markdown } from "@hadesd/markdown";
import { pageMeta } from "../meta";
const labels: Record<string, [string, string]> = {
  posts: ["文章", "思考的切片，问题的线索。"],
  projects: ["项目", "从想法出发，在构建中寻找答案。"],
  research: ["研究", "让问题保持开放，让探索留下痕迹。"],
  about: ["关于", "关于这台个人工作站。"],
  now: ["近况", "此刻正在关注的事情。"],
  links: ["链接", "值得再次抵达的地方。"],
  "404": ["路径未找到", "这个地址可能已经更新，或内容已撤下。"],
};
export function loader({ params }: LoaderFunctionArgs) {
  const section = params.section ?? "";
  const page = snapshot.contents.find(
    (c) => c.type === "PAGE" && c.slug === section,
  );
  if (!labels[section] && !page)
    throw new Response("Not found", { status: 404 });
  return {
    section,
    title: page?.title ?? labels[section]?.[0] ?? "",
    description: page?.summary ?? labels[section]?.[1] ?? "",
    page,
    items: publicIndex.filter(
      (c) =>
        c.type ===
        { posts: "POST", projects: "PROJECT", research: "RESEARCH" }[section],
    ),
    links: snapshot.site.links,
    siteTitle: snapshot.site.title,
  };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) =>
  data
    ? pageMeta(data.title, data.description, "/" + data.section, data.siteTitle)
    : [];
export default function Section() {
  const { section, title, description, page, items, links } =
    useLoaderData<typeof loader>();
  return (
    <div className="standard-page">
      <div className="page-heading">
        <p className="eyebrow">
          {section === "404"
            ? "404 / PATH NOT FOUND"
            : `DIRECTORY / ${section.toUpperCase()}`}
        </p>
        <h1>
          {title}
          <span className="accent">.</span>
        </h1>
        <p>{description}</p>
      </div>
      {["posts", "projects", "research"].includes(section) ? (
        <ContentList
          items={items.sort((a, b) =>
            b.publishedAt.localeCompare(a.publishedAt),
          )}
        />
      ) : page ? (
        <article className="prose-width">
          <Markdown source={page.markdown} />
          <div className="permalink">
            <a href={page.route}>永久链接 ↗</a>
          </div>
        </article>
      ) : section === "links" ? (
        links.length ? (
          <ul className="external-links">
            {links
              .filter((l) => /^https?:\/\//i.test(l.url))
              .map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    <span>{link.label}</span> ↗
                  </a>
                  {link.description && <p>{link.description}</p>}
                </li>
              ))}
          </ul>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">↗</span>
            <div>
              <p>还没有公开的外部链接。</p>
              <span>新的发现，等待下一次更新。</span>
            </div>
          </div>
        )
      ) : (
        <div className="text-empty">
          <span className="mono muted">
            {section === "404" ? "ENOENT" : `~/${section}.md`}
          </span>
          <p>
            {section === "about"
              ? "这是一处记录研究、工程与思考的空间。更多介绍将在准备好后发布。"
              : section === "now"
                ? "近况尚未更新。保留一点空白，给正在发生的事情。"
                : "回到已知的路径，继续探索。"}
          </p>
          <Link to="/">返回首页 ↗</Link>
        </div>
      )}
    </div>
  );
}
