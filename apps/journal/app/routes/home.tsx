import { Link, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import { snapshot, publicIndex, siteOrigin } from "../snapshot.server";
import { pageMeta } from "../meta";
import { PostList } from "../components/Content";
import campaign from "../assets/journal-campaign.jpg";
import "../home.css";
export function loader() { return { site: snapshot.site, siteOrigin, items: publicIndex.filter(c => c.type !== "PAGE").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) => data ? pageMeta("研究、工程与思考", data.site.homeText, "/", data.siteOrigin, data.site.title) : [];
function TerminalArtwork() {
  return <div className="showcase-terminal" aria-hidden="true"><div className="showcase-terminal-bar"><span /><span /><span /><i>hades@blog — terminal</i></div><div className="showcase-terminal-screen"><p><span>hades@blog</span> ~ % help</p><pre>{`H A D E S D\n\n一个可以探索的个人博客。\n\n  ls       浏览目录\n  open     阅读文章\n  search   寻找想法\n\n从一行命令，开始阅读。`}</pre><p><span>hades@blog</span> ~ % <b className="showcase-cursor" /></p></div></div>;
}
function ReleaseArtwork() {
  return <div className="release-art" aria-hidden="true"><div className="release-orbit" /><div className="release-layer layer-back"><span>01</span><strong>WRITE</strong></div><div className="release-layer layer-middle"><span>02</span><strong>BUILD</strong></div><div className="release-layer layer-front"><span>03</span><strong>LIVE<span className="release-light" /></strong></div></div>;
}
function HostingArtwork() {
  return <div className="hosting-art" aria-hidden="true"><div className="server-glow" /><div className="server-stack">{[0, 1, 2].map(n => <div className="server-unit" key={n}><span className="server-grille" /><i /><i /><b /></div>)}</div><div className="hosting-caption"><span className="status-dot" /> SYSTEM ONLINE</div></div>;
}
export default function Home() {
  const { items } = useLoaderData<typeof loader>();
  const architecture = items.find(item => item.slug.includes("architecture")) || items[0];
  const terminal = items.find(item => item.slug.includes("terminal")) || items.find(item => item.id !== architecture?.id);
  const others = items.filter(item => item.id !== architecture?.id && item.id !== terminal?.id);
  return <div className="campaign-home"><div className="campaign-announcement">从第一行代码，到正式上线。<Link to="/posts">博客研发手记，现已更新 <span>›</span></Link></div>
    <section className="campaign-feature" aria-labelledby="campaign-title"><div className="campaign-image"><img src={campaign} alt="银色笔记本、折叠纸张与代码屏幕组成的暖色拼贴" width={1920} height={819} fetchPriority="high" /></div><div className="campaign-copy"><p>HADES JOURNAL</p><h1 id="campaign-title">好想法，值得被实现。</h1><div className="campaign-subtitle">从一行代码，<wbr />到自己的数字世界。</div><div className="campaign-actions"><Link className="campaign-button" to={architecture?.route || "/posts"}>阅读研发手记</Link><Link className="campaign-text-link" to="/posts">浏览所有文章 <span>›</span></Link></div></div></section>
    {terminal && <section className="terminal-feature" data-reveal><header><p className="campaign-kicker">浏览器终端</p><h2>一块屏幕。<br className="mobile-break" />另一种可能。</h2><p className="feature-subtitle">熟悉的命令行，<wbr />不一样的阅读方式。</p><Link className="campaign-button" to={terminal.route}>探索它的实现</Link></header><TerminalArtwork /><p className="showcase-article-title"><Link to={terminal.route}>{terminal.title} <span>›</span></Link></p></section>}
    {others.length > 0 && <section className="campaign-grid" aria-label="更多研发手记">{others.slice(0, 2).map((item, index) => <article key={item.id} className={`campaign-card ${index === 0 ? "release-card" : "hosting-card"}`} data-reveal><header><p className="campaign-kicker">{index === 0 ? "从草稿到上线" : "让系统持续运行"}</p><h2>{index === 0 ? "每一次发布，\n都稳稳抵达。" : "属于自己的空间。\n自己掌控。"}</h2><p>{index === 0 ? "把构建、校验与切换，连成一条可靠的路。" : "从部署到验证，理解系统的每一个环节。"}</p><Link className="campaign-button" to={item.route}>阅读这篇手记</Link></header>{index === 0 ? <ReleaseArtwork /> : <HostingArtwork />}<p className="showcase-article-title"><Link to={item.route}>{item.title} <span>›</span></Link></p></article>)}</section>}
    {items.length > 4 && <section className="section-width campaign-more"><h2>还有更多，值得一读。</h2><PostList items={items.slice(4)} /></section>}
    <section className="campaign-closing"><h2>保持好奇。<br />下一步，继续创造。</h2><p>工程、研究，以及一路上的思考。</p><Link className="campaign-button" to="/about">认识一下</Link></section>
  </div>;
}
