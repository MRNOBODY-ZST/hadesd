import { lazy, Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "./api";
import { navigate, readRoute, useUi, type Route } from "./store";
import { Contents } from "./features/Contents";
import { JobStatus } from "./features/Publishing";
import { ErrorNotice, Loading } from "./components/Shared";
import styles from "./styles.module.css";
const Editor = lazy(() => import("./features/Editor"));
const MediaLibrary = lazy(() => import("./features/MediaLibrary"));
const Settings = lazy(() => import("./features/Settings"));
const Releases = lazy(() => import("./features/Releases"));
const Comments = lazy(() => import("./features/Comments"));
const links: { view: Route["view"]; label: string; icon: string }[] = [
  { view: "contents", label: "内容手记", icon: "▤" },
  { view: "media", label: "媒体资料", icon: "▧" },
  { view: "comments", label: "评论管理", icon: "≡" },
  { view: "releases", label: "发布记录", icon: "↗" },
  { view: "settings", label: "站点设置", icon: "⚙" },
];
function Login({
  onSuccess,
  expired,
}: {
  onSuccess: () => void;
  expired: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: () => {
      setPassword("");
      onSuccess();
    },
  });
  return (
    <main className={styles.loginLayout}>
      <section className={styles.loginStory}>
        <a href="/" className={styles.brand}>
          H<span>∆</span>DESD<span className={styles.brandDot}>.</span>
        </a>
        <div>
          <p className={styles.eyebrow}>A PERSONAL DAEMON</p>
          <h1>
            让好奇心，
            <br />
            持续运行。
          </h1>
          <p>
            研究、工程，还有未完成的想法。
            <br />
            从这里，写下下一行。
          </p>
        </div>
        <span className={styles.loginFooter}>PRIVATE WORKSPACE / 写作台</span>
      </section>
      <section className={styles.loginFormWrap}>
        <form
          className={styles.loginForm}
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <span className={styles.miniMark}>✳</span>
          <p className={styles.eyebrow}>WELCOME BACK</p>
          <h2>回到写作台</h2>
          <p className={styles.muted}>登录后，继续你的记录。</p>
          {expired && (
            <p className={styles.warning} role="status">
              会话已过期，请重新登录。未保存的文字仍保留在此页面。
            </p>
          )}
          <label>
            用户名
            <input
              autoComplete="username"
              name="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {login.error && (
            <ErrorNotice
              error={
                login.error instanceof ApiError && login.error.status === 401
                  ? new Error("用户名或密码不正确。")
                  : login.error
              }
            />
          )}
          <button
            type="submit"
            className={styles.primary}
            disabled={login.isPending}
          >
            {login.isPending ? "正在登录…" : "进入写作台 →"}
          </button>
          <a className={styles.backLink} href="/">
            ← 返回公开站点
          </a>
          <p className={styles.smallMuted}>
            仅供站点管理员使用 · Session 安全认证
          </p>
        </form>
      </section>
    </main>
  );
}
export function App() {
  const client = useQueryClient();
  const [expired, setExpired] = useState(false);
  const me = useQuery({ queryKey: ["auth"], queryFn: api.me, retry: false });
  const route = useUi((s) => s.route);
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      client.clear();
      useUi.getState().setDirty(false);
      setExpired(false);
      client.setQueryData(["auth"], null);
    },
  });
  useEffect(() => {
    const listener = () => setExpired(true);
    window.addEventListener("hadesd:session-expired", listener);
    return () => window.removeEventListener("hadesd:session-expired", listener);
  }, []);
  useEffect(() => {
    const onHash = () => {
      const next = readRoute();
      const state = useUi.getState();
      if (next.view === state.route.view && next.id === state.route.id) return;
      if (
        (state.dirty || state.pendingSave) &&
        !window.confirm("还有未保存或正在保存的修改。确定离开？")
      ) {
        history.replaceState(
          null,
          "",
          `#/${state.route.view}${state.route.id ? `/${encodeURIComponent(state.route.id)}` : ""}`,
        );
        return;
      }
      state.setDirty(false);
      state.setRoute(next);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (useUi.getState().dirty || useUi.getState().pendingSave) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
  if (me.isPending) return <Loading>正在确认安全会话…</Loading>;
  if (me.error && !(me.error instanceof ApiError && me.error.status === 401))
    return (
      <main className={styles.connectionError}>
        <h1>暂时无法打开写作台</h1>
        <ErrorNotice error={me.error} retry={() => void me.refetch()} />
        <a href="/">返回公开站点</a>
      </main>
    );
  if (!me.data)
    return (
      <Login
        expired={expired}
        onSuccess={() => {
          setExpired(false);
          void client.invalidateQueries({ queryKey: ["auth"] });
        }}
      />
    );
  if (me.data.role !== "ADMIN") return <main className={styles.connectionError}><h1>这里是管理员写作台</h1><p>你已以读者 {me.data.displayName} 登录，可以在公开站点评论和管理附件。</p><a href="/">返回博客</a><button disabled={logout.isPending} onClick={() => logout.mutate()}>退出读者账户</button>{logout.error && <ErrorNotice error={logout.error} />}</main>;
  return (
    <>
      <div className={styles.app} inert={expired ? true : undefined}>
        <aside className={styles.sidebar}>
          <a href="/" className={styles.brand} target="_blank" rel="noreferrer">
            H<span>∆</span>DESD<span className={styles.brandDot}>.</span>
          </a>
          <p className={styles.workspaceLabel}>
            PERSONAL WORKSPACE<span>写作台</span>
          </p>
          <nav aria-label="管理导航">
            {links.map((link) => (
              <button
                key={link.view}
                className={
                  route.view === link.view ||
                  (route.view === "editor" && link.view === "contents")
                    ? styles.navActive
                    : styles.navItem
                }
                onClick={() => navigate({ view: link.view })}
              >
                <span aria-hidden="true">{link.icon}</span>
                {link.label}
              </button>
            ))}
          </nav>
          <div className={styles.sidebarBottom}>
            <a href="/" target="_blank" rel="noreferrer">
              查看公开站点 <span>↗</span>
            </a>
            <div className={styles.account}>
              <span className={styles.avatar}>
                {me.data.username.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{me.data.username}</strong>
                <small>站点管理员</small>
              </div>
              <button
                aria-label="退出登录"
                title="退出登录"
                disabled={logout.isPending}
                onClick={() => {
                  if (
                    (!useUi.getState().dirty &&
                      !useUi.getState().pendingSave) ||
                    window.confirm("有未保存的修改，仍然退出登录？")
                  )
                    logout.mutate();
                }}
              >
                ↪
              </button>
            </div>
          </div>
        </aside>
        <div className={styles.workspace}>
          <div className={styles.topbar}>
            <span>
              HADESD <span className={styles.slash}>/</span>{" "}
              {links.find((l) => l.view === route.view)?.label || "编辑内容"}
            </span>
            <span className={styles.privateLabel}>
              <i /> 私有工作空间
            </span>
          </div>
          {logout.error && <ErrorNotice error={logout.error} />}
          <JobStatus />
          <main
            className={
              route.view === "editor" ? styles.editorMain : styles.main
            }
          >
            <Suspense fallback={<Loading />}>
              {route.view === "contents" && <Contents />}
              {route.view === "editor" && route.id && (
                <Editor key={route.id} contentId={route.id} />
              )}
              {route.view === "media" && <MediaLibrary />}
              {route.view === "settings" && <Settings />}
              {route.view === "releases" && <Releases />}
              {route.view === "comments" && <Comments />}
            </Suspense>
          </main>
          <footer className={styles.appFooter}>
            a personal daemon.<span>记录研究、工程与思考。</span>
          </footer>
        </div>
      </div>
      {expired && (
        <div
          className={styles.sessionOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="重新登录"
        >
          <Login
            expired
            onSuccess={() => {
              setExpired(false);
              void client.invalidateQueries({ queryKey: ["auth"] });
            }}
          />
          <p className={styles.srOnly}>
            {errorMessage(new Error("重新登录后可继续保存。"))}
          </p>
        </div>
      )}
    </>
  );
}
