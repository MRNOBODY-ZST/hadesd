import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UserAccount } from "@hadesd/contracts";
import { community, errorText } from "./api";
export type AccountView = "login" | "register" | "profile" | "files" | "comments";
type AccountState = { user: UserAccount | null; view: AccountView | null; open: (view?: AccountView) => void; close: () => void; setUser: (user: UserAccount | null) => void; logout: () => Promise<void>; notice: string };
const Context = createContext<AccountState | null>(null);
const AccountPanel = lazy(() => import("./AccountPanel"));
export function useAccount() { const state = useContext(Context); if (!state) throw new Error("AccountProvider missing"); return state; }
export function AccountProvider({ children }: { children: ReactNode }) {
  const [user, updateUser] = useState<UserAccount | null>(null), [view, setView] = useState<AccountView | null>(null), [notice, setNotice] = useState("");
  const generation = useRef(0);
  const setUser = useCallback((value: UserAccount | null) => { generation.current++; updateUser(value); setNotice(""); }, []);
  const open = useCallback((next: AccountView = "profile") => setView(next), []), close = useCallback(() => setView(null), []);
  const logout = useCallback(async () => { await community.logout(); setUser(null); close(); }, [setUser, close]);
  useEffect(() => {
    const controller = new AbortController();
    const sync = () => { const revision = ++generation.current; void community.session(controller.signal).then(data => { if (generation.current === revision) updateUser(data.user); }).catch(() => {}); };
    const expired = () => { setUser(null); setNotice("会话已过期，请重新登录。未提交的文字仍保留。"); };
    sync(); window.addEventListener("focus", sync); window.addEventListener("hadesd:account-expired", expired);
    return () => { controller.abort(); window.removeEventListener("focus", sync); window.removeEventListener("hadesd:account-expired", expired); };
  }, [setUser]);
  const value = useMemo(() => ({ user, view, open, close, setUser, logout, notice }), [user, view, open, close, setUser, logout, notice]);
  return <Context value={value}>{children}</Context>;
}
export function AccountWorkspace() {
  const { view, close, notice, open } = useAccount();
  return <>{notice && <div className="account-notice" role="status">{notice}<button onClick={() => open("login")}>重新登录</button></div>}{view && <Suspense fallback={<p className="account-notice" role="status">正在打开账户…</p>}><AccountPanel initialView={view} onClose={close} /></Suspense>}</>;
}
