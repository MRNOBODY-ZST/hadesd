import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import type { loader } from "../root";
import { AccountWorkspace, useAccount } from "../community/Account";
import { journalSite } from "../site";
import { Arrow } from "./Content";
export function SiteShell({ children, data }: { children: ReactNode; data: ReturnType<typeof loader> }) {
  const { user, open } = useAccount(), [menu, setMenu] = useState(false), location = useLocation();
  useEffect(() => { setMenu(false); }, [location.pathname]);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
    }), { threshold: .07 });
    document.querySelectorAll("[data-reveal]").forEach(element => { element.classList.add("will-reveal"); observer.observe(element); });
    return () => { observer.disconnect(); document.querySelectorAll(".will-reveal").forEach(element => element.classList.remove("will-reveal")); };
  }, [location.pathname, location.search]);
  const navigation = [{ label: "文章", href: "/posts" },
    ...data.contents.some(c => c.type === "PROJECT") ? [{ label: "项目", href: "/projects" }] : [],
    ...data.contents.some(c => c.type === "RESEARCH") ? [{ label: "研究", href: "/research" }] : [],
    { label: "关于", href: "/about" }, { label: "近况", href: "/now" }, { label: "友链", href: "/links" }];
  return <><a className="skip-link" href="#main">跳到正文</a><header className="site-header"><div className="nav-inner">
    <Link className="wordmark" to="/" aria-label={`${journalSite.name} 首页`}>{journalSite.name}</Link>
    <nav className={`main-nav${menu ? " is-open" : ""}`} id="main-navigation" aria-label="主导航">{navigation.map(item => <NavLink to={item.href} key={item.href}>{item.label}</NavLink>)}</nav>
    <div className="nav-actions"><Link className="icon-button" to="/search" aria-label="搜索文章"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.5" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.5" /></svg></Link><button className="account-button" onClick={() => open(user ? "profile" : "login")}>{user ? user.displayName : "登录"}</button><button className="menu-button icon-button" aria-label={menu ? "关闭导航" : "打开导航"} aria-expanded={menu} aria-controls="main-navigation" onClick={() => setMenu(!menu)}><span /><span /></button></div>
  </div></header><main id="main">{children}</main><footer className="site-footer"><div className="footer-top"><div><Link className="wordmark" to="/">{journalSite.name}</Link></div><nav aria-label="页脚导航"><Link to="/about">关于 <Arrow diagonal /></Link><Link to="/links">友链 <Arrow diagonal /></Link><a href="/rss.xml">订阅 RSS <Arrow diagonal /></a><button onClick={() => open(user ? "profile" : "register")}>{user ? "读者账户" : "注册账户"} <Arrow diagonal /></button></nav></div><div className="footer-bottom"><span>© {new Date().getFullYear()} {journalSite.name}</span></div></footer><AccountWorkspace /></>;
}
