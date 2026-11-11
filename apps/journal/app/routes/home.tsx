import { Link, useLoaderData, type MetaFunction } from "react-router";
import { publicIndex, siteOrigin } from "../snapshot.server";
import { journalSite } from "../site";
import { pageMeta } from "../meta";
import { PostList } from "../components/Content";
import "../home.css";
export function loader() {
  return { site: journalSite, siteOrigin, items: publicIndex.filter(c => c.type !== "PAGE").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) => data ? pageMeta(data.site.name, data.site.description, "/", data.siteOrigin, data.site.name) : [];
export default function Home() {
  const { items, site } = useLoaderData<typeof loader>();
  return <><section className="journal-intro"><div className="section-width"><h1>{site.name}</h1><p>{site.description}</p><nav aria-label="首页入口"><Link className="pill-button" to="/posts">所有文章</Link><Link className="text-link" to="/about">关于这个博客</Link></nav></div></section>
    <section className="home-posts section-width" aria-labelledby="recent-posts"><header><h2 id="recent-posts">最近文章</h2><a href="/rss.xml">订阅 RSS</a></header><PostList items={items.slice(0, 6)} empty="还没有公开文章。" />{items.length > 6 && <Link className="text-link all-posts" to="/posts">所有文章 →</Link>}</section></>;
}
