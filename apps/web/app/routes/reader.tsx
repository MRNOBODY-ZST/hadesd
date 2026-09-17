import type { MetaFunction } from "react-router";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Markdown, MarkdownImage, extractHeadings } from "@hadesd/markdown";
import { Comments } from "../community/Comments";
import { snapshot, siteOrigin } from "../snapshot.server";
import { pageMeta } from "../meta";
import { usePreferences } from "../shell/store";
export function loader({ params }: LoaderFunctionArgs) {
  const route = `/${params.section}/${params.slug}`;
  const content = snapshot.contents.find((c) => c.route === route);
  if (!content) throw new Response("Not found", { status: 404 });
  const siblings = snapshot.contents
    .filter((c) => c.type === content.type)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const i = siblings.findIndex((c) => c.id === content.id);
  const adjacent = (n: typeof content | undefined) =>
    n ? { title: n.title, route: n.route } : null;
  return {
    content,
    previous: adjacent(siblings[i - 1]),
    next: adjacent(siblings[i + 1]),
    siteTitle: snapshot.site.title,
    siteOrigin,
  };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) =>
  data
    ? pageMeta(
        data.content.title,
        data.content.summary,
        data.content.route,
        data.siteTitle,
        data.siteOrigin,
      )
    : [];
export default function Reader() {
  const { content, previous, next } = useLoaderData<typeof loader>();
  const headings = extractHeadings(content.markdown);
  const reader = usePreferences((s) => s.reader);
  const setReader = usePreferences((s) => s.setReader);
  return (
    <div className="article-layout">
      <article className="reader-article">
        <div className="article-breadcrumb">
          <Link to="/">~</Link>
          <span>/</span>
          <Link to={"/" + content.route.split("/")[1]}>
            {content.route.split("/")[1]}
          </Link>
          <span>/</span>
          <span>{content.slug}.md</span>
        </div>
        <header className="article-header">
          <p className="eyebrow">
            {content.type} / {content.language}
          </p>
          <h1>{content.title}</h1>
          <div className="article-meta">
            <time dateTime={content.publishedAt}>
              发布于 {content.publishedAt.slice(0, 10)}
            </time>
            {content.updatedAt !== content.publishedAt && (
              <time dateTime={content.updatedAt}>
                更新于 {content.updatedAt.slice(0, 10)}
              </time>
            )}
            <button onClick={() => setReader(!reader)}>
              {reader ? "退出阅读模式" : "专注阅读 ↗"}
            </button>
          </div>
          {content.summary && (
            <p className="article-summary">{content.summary}</p>
          )}
          <div className="row-tags">
            {content.tags.map((tag) => (
              <Link key={tag} to={`/tags/${encodeURIComponent(tag)}`}>
                #{tag}
              </Link>
            ))}
          </div>
        </header>
        {headings.length > 1 && (
          <aside className="article-toc">
            <p className="eyebrow">ON THIS PAGE</p>
            <nav aria-label="文章目录">
              {headings.map((h) => (
                <a
                  key={h.id}
                  href={"#" + h.id}
                  style={{ paddingLeft: (Math.min(h.depth, 4) - 1) * 10 }}
                >
                  {h.text}
                </a>
              ))}
            </nav>
          </aside>
        )}
        {content.coverMediaId && <MarkdownImage src={`/api/v1/public/media/${encodeURIComponent(content.coverMediaId)}`} alt={`${content.title} · 封面`} />}
        <Markdown source={content.markdown} />
        <footer className="article-footer">
          <span className="mono muted">END OF FILE</span>
          <a href={content.route}>永久链接 ↗</a>
        </footer>
        <nav className="adjacent" aria-label="相邻内容">
          {previous ? (
            <Link to={previous.route}>
              <span>← 上一篇</span>
              <strong>{previous.title}</strong>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link to={next.route}>
              <span>下一篇 →</span>
              <strong>{next.title}</strong>
            </Link>
          )}
        </nav>
        <Comments key={content.id} contentId={content.id} />
      </article>
    </div>
  );
}
