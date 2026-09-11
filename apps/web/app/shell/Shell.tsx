import { useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  createVfs,
  cwdForRoute,
  type FrozenSite,
  type Navigation,
} from "@hadesd/terminal-core";
import { usePreferences } from "./store";
import { ActionsContext } from "./actions";
import { Terminal } from "./Terminal";
import { TerminalStage } from "../effects/TerminalStage";
import styles from "./Shell.module.css";
import { AccountProvider, AccountBar } from "../community/Account";

export function Shell({
  data,
  children,
}: {
  data: FrozenSite;
  children: ReactNode;
}) {
  const location = useLocation(),
    navigate = useNavigate(),
    p = usePreferences();
  const nodes = useMemo(() => createVfs(data.contents), [data.contents]);
  const cwd = cwdForRoute(location.pathname, nodes);
  const dispatchRef = useRef<((command: string) => void) | null>(null);
  const open = useCallback(
    (target: Navigation) => {
      window.dispatchEvent(new Event("hadesd:navigate"));
      void navigate(target.route);
    },
    [navigate],
  );
  useEffect(() => {
    p.load();
  }, [p.load]);
  useEffect(() => {
    document.documentElement.dataset.theme = p.theme;
    document.documentElement.dataset.reader = String(p.reader);
    document.documentElement.dataset.crt = p.reader ? "off" : p.crt;
    document.documentElement.dataset.terminal = "true";
    return () => {
      delete document.documentElement.dataset.terminal;
      delete document.documentElement.dataset.crt;
    };
  }, [p.theme, p.reader, p.crt]);
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        usePreferences.getState().toggle("paletteOpen");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const shared = useMemo(
    () => ({ data, nodes, cwd, open }),
    [data, nodes, cwd, open],
  );
  useEffect(() => {
    let frame: number | undefined;
    const comments = () => { frame = requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("hadesd:page", { detail: { anchor: "comments" } }))); };
    window.addEventListener("hadesd:comments", comments);
    return () => { window.removeEventListener("hadesd:comments", comments); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, []);
  return (
    <AccountProvider><ActionsContext value={shared}>
      <TerminalStage theme={p.theme} level={p.reader ? "off" : p.crt}>
        <div className={styles.workstation + " terminal-shell"}>
          <a className="skip-link" href="#main-content">
            跳到正文
          </a>
          <AccountBar />
          <main id="main-content" className={styles.main} tabIndex={-1}>
            <Terminal dispatchRef={dispatchRef}>{children}</Terminal>
          </main>
          <noscript>
            <style>{`.terminal-shell{height:auto!important;overflow:visible!important;min-height:100vh!important}.terminal-shell main,.terminal,.screen-pager,.screen-viewport{display:block!important;height:auto!important;overflow:visible!important}.screen-content{transform:none!important}.terminal-input,.screen-paging,.terminal-actions,.terminal-output-return{display:none!important}`}</style>
          </noscript>
        </div>
      </TerminalStage>
    </ActionsContext></AccountProvider>
  );
}
