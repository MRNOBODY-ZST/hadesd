import { Link } from "react-router";
import type { PublicContent } from "@hadesd/contracts";
export type ContentIndex = Omit<PublicContent, "markdown">;
export const typeLabel = { POST: "文章", PROJECT: "项目", RESEARCH: "研究", PAGE: "随记" };
export const dateLabel = (date: string) => date.slice(0, 10).replaceAll("-", ".");
export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg className="arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function PostList({ items, empty = "暂无公开内容。" }: { items: ContentIndex[]; empty?: string }) {
  return items.length ? <div className="post-list">{items.map((item) => <article className="post-row" key={item.id} data-reveal>
    <div><div className="post-meta"><span>{item.tags[0] || typeLabel[item.type]}</span><time dateTime={item.publishedAt}>{dateLabel(item.publishedAt)}</time></div>
      <h2><Link to={item.route}>{item.title}<span className="row-arrow"><Arrow diagonal /></span></Link></h2><p>{item.summary}</p></div>
  </article>)}</div> : <div className="empty-state"><p>{empty}</p><Link to="/">回到首页 <Arrow /></Link></div>;
}
