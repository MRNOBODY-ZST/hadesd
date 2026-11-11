import { Link, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { Markdown } from "@hadesd/markdown";
import { snapshot, publicIndex, siteOrigin } from "../snapshot.server";
import { pageMeta } from "../meta";
import { Arrow, PostList } from "../components/Content";
const sections: Record<string, [string, string, string]> = {
  posts: ["文章", "已发布的文章，按时间倒序排列。", "WRITING"], projects: ["项目", "已公开的项目记录。", "PROJECTS"], research: ["研究", "已公开的研究记录。", "RESEARCH"],
  about: ["关于", "博客的内容与使用方式。", "ABOUT"], now: ["近况", "当前内容整理范围。", "NOW"], links: ["友链", "项目源码与相关网站。", "ELSEWHERE"], "404": ["页面不存在", "地址可能已更新，或文章尚未公开。", "404 / NOT FOUND"],
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
  const { section, title, description, page, items, links } = useLoaderData<typeof loader>();
  return <div className={`section-width section-page${page ? " prose-page" : ""}`}><header className="page-heading"><h1>{title}</h1><p>{description}</p></header>
    {["posts", "projects", "research"].includes(section) ? <PostList items={items} /> : page ? <div className="page-prose"><Markdown source={page.markdown} /></div> : section === "links" ? <div className="external-links">{links.filter(link => /^https?:\/\//i.test(link.url)).map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"><h2>{link.label}<Arrow diagonal /></h2><p>{link.description}</p><span>{new URL(link.url).hostname}</span></a>)}{!links.length && <p className="empty-state">暂无链接。</p>}</div> : <div className="empty-state"><p>{section === "404" ? "地址可能已更新。" : "这一页尚未发布内容。"}</p><Link className="text-link" to="/">返回首页 <Arrow /></Link></div>}
  </div>;
}
