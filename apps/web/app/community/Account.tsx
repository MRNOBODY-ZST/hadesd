import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UserAccount } from "@hadesd/contracts";
import { community, errorText } from "./api";
import "./community.css";

export type AccountView = "login" | "register" | "profile" | "files" | "comments";
type AccountState = { user: UserAccount | null; setUser: (user: UserAccount | null) => void; open: (view?: AccountView) => void; logout: () => Promise<void> };
const Context = createContext<AccountState | null>(null);
const AccountPanel = lazy(() => import("./AccountPanel"));
export function useAccount() { const value = useContext(Context); if (!value) throw new Error("AccountProvider missing"); return value; }
export function AccountProvider({ children }: { children: ReactNode }) {
  const [user, updateUser] = useState<UserAccount | null>(null), [view, setView] = useState<AccountView | null>(null);
  const generation = useRef(0);
  const setUser = useCallback((value: UserAccount | null) => { generation.current++; updateUser(value); }, []);
  const [notice, setNotice] = useState("");
  const open = useCallback((next: AccountView = "profile") => { setNotice(""); setView(next); }, []);
  const logout = useCallback(async () => { await community.logout(); setUser(null); setView(null); }, [setUser]);
  useEffect(() => {
    const controller = new AbortController();
    const synchronize = () => {
      const revision = ++generation.current;
      void community.session(controller.signal).then(s => { if (generation.current === revision) updateUser(s.user); }).catch(() => {});
    };
    synchronize();
    const expired = () => { setUser(null); setNotice("会话已过期，请重新登录。未提交的评论仍保留。"); };
    const action = (event: Event) => {
      const value = (event as CustomEvent<{ action: string }>).detail?.action;
      if (value === "logout") void logout().catch(error => setNotice(errorText(error)));
      else if (["login", "register", "profile"].includes(value)) open(value as AccountView);
    };
    const focus = synchronize;
    window.addEventListener("hadesd:account", action); window.addEventListener("hadesd:account-expired", expired);
    window.addEventListener("focus", focus);
    return () => { controller.abort(); window.removeEventListener("hadesd:account", action); window.removeEventListener("hadesd:account-expired", expired); window.removeEventListener("focus", focus); };
  }, [open, logout, setUser]);
  const value = useMemo(() => ({ user, setUser, open, logout }), [user, open, logout, setUser]);
  return <Context value={value}>{children}
    {notice && <div className="community-toast" role="status">{notice}<button onClick={() => { setNotice(""); open("login"); }}>登录</button><button aria-label="关闭通知" onClick={() => setNotice("")}>×</button></div>}
    {view && <Suspense fallback={<div className="community-toast" role="status">正在打开账户…</div>}><AccountPanel initialView={view} onClose={() => setView(null)} /></Suspense>}
  </Context>;
}
export function AccountBar() {
  const { user, open, logout } = useAccount();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  return <div className="community-bar" data-terminal-reveal="1">
    <span>{user ? `@${user.username}` : "GUEST SESSION"}</span>
    <nav aria-label="读者账户">
      {user ? <><button aria-label="账户" onClick={() => open("profile")}>[ {user.displayName} ]</button><button onClick={() => open("files")}>我的文件</button>{user.role === "ADMIN" && <a href="/admin/">写作台 ↗</a>}<button disabled={busy} onClick={() => { setBusy(true); void logout().catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}>退出</button></>
        : <><button aria-label="账户" onClick={() => open("login")}>登录</button><button onClick={() => open("register")}>注册</button></>}
    </nav>{error && <span role="alert">{error}</span>}
  </div>;
}
