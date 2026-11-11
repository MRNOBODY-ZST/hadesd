import { Link } from "react-router";
export default function NotFound() { return <section className="section-width section-page"><header className="page-heading"><p className="eyebrow">404 / NOT FOUND</p><h1>这页，还没有写下。</h1><p>地址可能已更新，或文章尚未公开。</p></header><Link className="pill-button" to="/">返回首页 →</Link></section>; }
