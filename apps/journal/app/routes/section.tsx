import { Link, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { Markdown } from "@hadesd/markdown";
import { snapshot, publicIndex, siteOrigin } from "../snapshot.server";
import { pageMeta } from "../meta";
import { Arrow, PostList } from "../components/Content";
const sections: Record<string, [string, string, string]> = {
  posts: ["文章", "记录想法，也记录把它实现的过程。", "WRITING"], projects: ["项目", "从一个想法开始，在构建中寻找答案。", "PROJECTS"], research: ["研究", "让问题保持开放，让探索留下痕迹。", "RESEARCH"],
  about: ["关于", "一个人，一些想法，以及正在发生的事情。", "ABOUT"], now: ["近况", "此刻正在关注、尝试和思考的事情。", "NOW"], links: ["友链", "值得再次抵达的地方。", "ELSEWHERE"], "404": ["这页，还没有写下。", "地址可能已更新，或文章尚未公开。", "404 / NOT FOUND"],
};
export function loader({ params }: LoaderFunctionArgs) {
  const section = params.section || "", page = snapshot.contents.find(c => c.type === "PAGE" && c.slug === section);
  if (!sections[section] && !page) throw new Response("Not found", { status: 404 });
  const fallback = sections[section] || [page!.title, page!.summary, "PAGE"];
  return { section, title: page?.title || fallback[0], description: page?.summary || fallback[1], label: fallback[2], page, siteOrigin, siteTitle: snapshot.site.title, links: snapshot.site.links,
    items: publicIndex.filter(c => c.type === ({ posts: "POST", projects: "PROJECT", research: "RESEARCH" } as Record<string, string>)[section]).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) => data ? pageMeta(data.title, data.description, `/${data.section}`, data.siteOrigin, data.siteTitle) : [];
export default function Section() {
  const { section, title, description, label, page, items, links } = useLoaderData<typeof loader>();
  return <div className={`section-width section-page${page ? " prose-page" : ""}`}><header className="page-heading"><p className="eyebrow">{label}</p><h1>{title}</h1><p>{description}</p></header>
    {["posts", "projects", "research"].includes(section) ? <PostList items={items} /> : page ? <div className="page-prose"><Markdown source={page.markdown} /></div> : section === "links" ? <div className="external-links">{links.filter(link => /^https?:\/\//i.test(link.url)).map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"><h2>{link.label}<Arrow diagonal /></h2><p>{link.description}</p><span>{new URL(link.url).hostname}</span></a>)}{!links.length && <p className="empty-state">正在收集值得分享的连接。</p>}</div> : <div className="empty-state"><p>{section === "404" ? "回到熟悉的地方，继续阅读。" : "这一页会在准备好后更新。"}</p><Link className="text-link" to="/">返回首页 <Arrow /></Link></div>}
  </div>;
}
