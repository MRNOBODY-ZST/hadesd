import { Link } from "react-router";
export default function NotFound() {
  return (
    <main className="standard-page">
      <p className="eyebrow">404 / PATH NOT FOUND</p>
      <h1>此路径还没有被记录。</h1>
      <Link to="/">返回首页 ↗</Link>
    </main>
  );
}
