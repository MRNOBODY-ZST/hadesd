import { Link, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { Markdown, MarkdownImage, extractHeadings } from "@hadesd/markdown";
import { snapshot, siteOrigin } from "../snapshot.server";
import { pageMeta } from "../meta";
import { Arrow, dateLabel, typeLabel } from "../components/Content";
import { Comments } from "../community/Comments";
export function loader({ params }: LoaderFunctionArgs) {
  const content = snapshot.contents.find(c => c.route === `/${params.section}/${params.slug}`);
  if (!content) throw new Response("Not found", { status: 404 });
  const siblings = snapshot.contents.filter(c => c.type === content.type).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const next = siblings[siblings.findIndex(c => c.id === content.id) + 1] || siblings.find(c => c.id !== content.id);
  return { content, siteOrigin, siteTitle: snapshot.site.title, next: next ? { title: next.title, route: next.route, summary: next.summary } : null };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) => data ? pageMeta(data.content.title, data.content.summary, data.content.route, data.siteOrigin, data.siteTitle) : [];
export default function Reader() {
  const { content, next } = useLoaderData<typeof loader>(), headings = extractHeadings(content.markdown);
  return <div className="article-page"><header className="article-heading section-width"><Link className="back-link" to={`/${content.route.split("/")[1]}`}>← {typeLabel[content.type]}</Link><div className="post-meta"><span>{content.tags[0] || "手记"}</span><time dateTime={content.publishedAt}>{dateLabel(content.publishedAt)}</time></div><h1>{content.title}</h1><p className="article-summary">{content.summary}</p><div className="article-byline"><span className="author-mark">H</span><span>HADES<span className="reading-time">{Math.max(1, Math.ceil(content.markdown.length / 600))} 分钟阅读</span></span><div className="article-tags">{content.tags.map(tag => <Link key={tag} to={`/tags/${encodeURIComponent(tag)}`}>#{tag}</Link>)}</div></div></header>
    {content.coverMediaId && <div className="article-cover section-width"><MarkdownImage src={`/api/v1/public/media/${encodeURIComponent(content.coverMediaId)}`} alt={`${content.title}封面`} /></div>}
    <div className="article-body section-width"><aside className="article-toc"><span>本页内容</span><nav aria-label="文章目录">{headings.map(heading => <a key={heading.id} href={`#${heading.id}`} className={heading.depth > 2 ? "nested" : undefined}>{heading.text}</a>)}</nav></aside><div className="article-prose"><Markdown source={content.markdown} /><div className="article-end"><span>感谢阅读。</span><span>{content.updatedAt !== content.publishedAt ? `更新于 ${dateLabel(content.updatedAt)}` : "KEEP EXPLORING."}</span></div><Comments key={content.id} contentId={content.id} /></div></div>
    {next && <section className="next-post section-width" data-reveal><p className="eyebrow">KEEP READING</p><Link to={next.route}><h2>{next.title}</h2><Arrow /></Link><p>{next.summary}</p></section>}
  </div>;
}
