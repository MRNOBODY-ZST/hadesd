import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router";
import {
  CommandHistory,
  completeAt,
  type Completion,
  displayPath,
  execute,
  redactAccountArguments,
  type Output,
} from "@hadesd/terminal-core";
import { useActions } from "./actions";
import { usePreferences } from "./store";
import type { PublicContent } from "@hadesd/contracts";
import { ScreenPager } from "./ScreenPager";
import "./Terminal.css";
export function Terminal({
  dispatchRef,
  children,
}: {
  children?: ReactNode;
  dispatchRef: React.MutableRefObject<((command: string) => void) | null>;
}) {
  const { cwd, nodes, open, data } = useActions();
  const location = useLocation();
  const preferences = usePreferences();
  const [input, setInput] = useState("");
  const [records, setRecords] = useState<
    { id: number; input: string; outputs: Output[] }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"route" | "output">("route");
  const [selection, setSelection] = useState({
    start: 0,
    end: 0,
    direction: "none",
  });
  const [compositionStart, setCompositionStart] = useState<number | null>(null);
  const [inputScroll, setInputScroll] = useState({ top: 0, left: 0 });
  const pendingCaret = useRef<number | null>(null);
  const replaceInput = useCallback((value: string, caret = value.length) => {
    pendingCaret.current = caret;
    setInput(value);
    setSelection({ start: caret, end: caret, direction: "none" });
    setInputScroll({ top: 0, left: 0 });
  }, []);
  const readSelection = useCallback((control: HTMLTextAreaElement) => {
    setSelection({
      start: control.selectionStart,
      end: control.selectionEnd,
      direction: control.selectionDirection,
    });
    setInputScroll({ top: control.scrollTop, left: control.scrollLeft });
  }, []);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [completionIndex, setCompletionIndex] = useState(-1);
  const completionSession = useRef<{ items: Completion[]; index: number } | null>(null);
  const tabExit = useRef(false);
  const history = useRef(new CommandHistory());
  const task = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const composing = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !field.current) return;
    field.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [input, selection.start, selection.end]);
  const closeCompletions = () => {
    completionSession.current = null;
    setCompletions([]);
    setCompletionIndex(-1);
  };
  const run = useCallback(
    async (command: string) => {
      if (!command.trim()) return;
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      const request = ++seq.current;
      const visibleCommand = redactAccountArguments(command);
      history.current.add(command);
      replaceInput("");
      setCompletions([]);
      completionSession.current = null;
      setBusy(true);
      let navigated = false;
      if (command.trim() === "reboot") {
        setBusy(false);
        setView("route");
        window.dispatchEvent(new CustomEvent("hadesd:reboot"));
        return;
      }
      if (command.trim() === "display") {
        setBusy(false);
        preferences.toggle("settingsOpen", true);
        return;
      }
      const result = await execute(
        command,
        {
          cwd,
          nodes,
          history: history.current,
          releaseId: data.releaseId,
          theme: preferences.theme,
          crt: preferences.crt,
          reader: preferences.reader,
          navigate: (target) => {
            navigated = true;
            open(target);
          },
          setTheme: preferences.setTheme,
          setCrt: preferences.setCrt,
          setReader: preferences.setReader,
          interact: (command) => {
            navigated = true;
            if (command === "reboot") window.dispatchEvent(new CustomEvent("hadesd:reboot"));
            else if (command === "display") preferences.toggle("settingsOpen", true);
            else if (command === "comments") window.dispatchEvent(new CustomEvent("hadesd:comments"));
            else window.dispatchEvent(new CustomEvent("hadesd:account", { detail: { action: command } }));
          },
          readFile: async (node, signal) => {
            if (!node.contentId)
              return node.path === "/links.json"
                ? JSON.stringify(data.site.links, null, 2)
                : node.path === "/about.md"
                  ? data.site.homeText
                  : "此页面尚无已发布内容。";
            const response = await fetch(
              `/api/v1/public/contents/${encodeURIComponent(node.contentId)}`,
              { signal, headers: { Accept: "application/json" } },
            );
            if (!response.ok)
              throw new Error("内容暂时无法读取，可通过公开链接打开静态正文。");
            const content = (await response.json()) as PublicContent;
            const known = data.contents.find((c) => c.id === node.contentId);
            if (content.revisionId !== known?.revisionId)
              throw new Error("公开版本已更新，请刷新页面后重试。");
            return content.markdown;
          },
        },
        controller.signal,
      );
      if (request !== seq.current || controller.signal.aborted) return;
      setBusy(false);
      task.current = null;
      if (result.some((r) => r.type === "clear")) {
        setRecords([]);
        setView("output");
      } else {
        setView(navigated ? "route" : "output");
        setRecords((old) =>
          [...old, { id: request, input: visibleCommand, outputs: result }].slice(
            -100,
          ),
        );
      }
    },
    [
      cwd,
      nodes,
      data,
      open,
      preferences.theme,
      preferences.crt,
      preferences.reader,
      preferences.setTheme,
      preferences.setCrt,
      preferences.setReader,
      replaceInput,
    ],
  );
  useEffect(() => {
    dispatchRef.current = (command) => {
      void run(command);
    };
    return () => {
      dispatchRef.current = null;
    };
  }, [dispatchRef, run]);
  useEffect(
    () => () => {
      task.current?.abort();
    },
    [],
  );
  useEffect(() => {
    // A navigation intent shows its file immediately. Its eventual loader commit
    // must not replace a newer command typed while that navigation was pending.
    const showRoute = () => setView("route");
    window.addEventListener("hadesd:navigate", showRoute);
    window.addEventListener("popstate", showRoute);
    return () => {
      window.removeEventListener("hadesd:navigate", showRoute);
      window.removeEventListener("popstate", showRoute);
    };
  }, []);
  useEffect(() => {
    const focus = () => {
      const active = document.activeElement;
      const otherEditor = active instanceof HTMLElement && active !== field.current &&
        (active.isContentEditable || active.matches("input,textarea,select"));
      if (
        matchMedia("(pointer: fine)").matches && !otherEditor &&
        !document.querySelector("dialog[open]")
      )
        field.current?.focus({ preventScroll: true });
    };
    window.addEventListener("hadesd:boot-ready", focus);
    const type = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || document.querySelector("dialog[open]"))
        return;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(
            target.tagName,
          ))
      )
        return;
      if (event.key === "Escape" && !event.isComposing) {
        setView("route");
        field.current?.focus({ preventScroll: true });
        event.preventDefault();
        return;
      }
      if (
        document.querySelector("dialog[open]") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing
      )
        return;
      if (event.key.length === 1 && ![" ", "j", "k"].includes(event.key)) {
        field.current?.focus({ preventScroll: true });
        replaceInput((field.current?.value ?? "") + event.key);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", type);
    return () => {
      window.removeEventListener("hadesd:boot-ready", focus);
      window.removeEventListener("keydown", type);
    };
  }, [replaceInput]);
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229)
      return;
    // Modifier keydown precedes Shift+Tab and must preserve its candidate cycle.
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    const requestCompletion = (reverse: boolean, listOnly = false) => {
      let session = completionSession.current;
      if (!session) {
        const items = completeAt(input, e.currentTarget.selectionStart, cwd, nodes);
        if (!items.length) return false;
        session = { items, index: -1 };
        completionSession.current = session;
      }
      setCompletions(session.items);
      if (listOnly) { setCompletionIndex(session.index); return true; }
      session.index = session.index < 0 ? (reverse ? session.items.length - 1 : 0)
        : (session.index + (reverse ? -1 : 1) + session.items.length) % session.items.length;
      const candidate = session.items[session.index]!;
      replaceInput(candidate.value, candidate.caret);
      setCompletionIndex(session.index);
      if (session.items.length === 1) closeCompletions();
      return true;
    };
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      tabExit.current = false;
      requestCompletion(false, true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (!completions.length) setView("route");
      closeCompletions();
      // Explicit escape hatch: Escape then Tab/Shift+Tab uses native focus order.
      tabExit.current = true;
      return;
    }
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (tabExit.current) { tabExit.current = false; closeCompletions(); return; }
      if (requestCompletion(e.shiftKey)) e.preventDefault();
      return;
    }
    tabExit.current = false;
    if (completions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      requestCompletion(e.key === "ArrowUp");
      return;
    }
    closeCompletions();
    if ((e.key === "PageDown" || e.key === "PageUp") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.currentTarget.dispatchEvent(new CustomEvent("hadesd:page", {
        bubbles: true, detail: { direction: e.key === "PageDown" ? "next" : "previous" },
      }));
      return;
    }
    if (
      e.ctrlKey &&
      e.key === "c" &&
      busy &&
      field.current?.selectionStart === field.current?.selectionEnd &&
      !window.getSelection()?.toString()
    ) {
      e.preventDefault();
      task.current?.abort();
      seq.current++;
      setBusy(false);
      setRecords((old) =>
        [
          ...old,
          {
            id: seq.current,
            input: "",
            outputs: [{ type: "text", text: "已取消。" } as Output],
          },
        ].slice(-100),
      );
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowUp" && !input.includes("\n")) {
      e.preventDefault();
      replaceInput(history.current.previous(input));
    } else if (e.key === "ArrowDown" && !input.includes("\n")) {
      e.preventDefault();
      replaceInput(history.current.next());
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void run(input);
    }
  }
  const selectionStart = Math.min(selection.start, input.length);
  const selectionFinish = Math.min(selection.end, input.length);
  const hasSelection =
    selectionStart !== selectionFinish && compositionStart === null;
  const caretOffset = hasSelection ? selectionStart : selectionFinish;
  const markedCompositionStart =
    compositionStart === null ? null : Math.min(compositionStart, caretOffset);
  return (
    <section
      className="terminal"
      aria-label="只读博客终端"
      onClickCapture={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const target = event.target;
        const link =
          target instanceof Element
            ? target.closest<HTMLAnchorElement>("a[href]")
            : null;
        if (
          !link ||
          link.target === "_blank" ||
          link.hasAttribute("download") ||
          link.getAttribute("href")?.startsWith("#")
        )
          return;
        if (new URL(link.href).origin === window.location.origin)
          setView("route");
      }}
    >
      <div className="terminal-session" aria-label="终端状态">
        <Link to="/" aria-label="HADESD 首页">
          HADESD / TTY 01
        </Link>
        <span>SESSION: GUEST</span>
        <span className="session-connected">● CONNECTED</span>
      </div>
      <ScreenPager
        resetKey={
          view === "output"
            ? (records.at(-1)?.id ?? "clear")
            : location.pathname + location.search
        }
        followEnd={view === "output"}
      >
        {view === "route" ? (
          children
        ) : (
          <div className="terminal-output" role="log" aria-live="polite">
            {records.length ? (
              records.map((r) => (
                <div className="terminal-record" key={r.id}>
                  {r.input && (
                    <p className="terminal-echo">
                      <span>guest@hadesd:{displayPath(cwd)} $</span> {r.input}
                    </p>
                  )}
                  {r.outputs.map((output, i) => (
                    <OutputView
                      key={i}
                      output={output}
                      onHelp={() => void run("help")}
                    />
                  ))}
                </div>
              ))
            ) : (
              <p className="muted">
                SCREEN CLEARED. 输入 ls、help 或 open &lt;file&gt;。
              </p>
            )}
          </div>
        )}
      </ScreenPager>
      <div className="terminal-command-area">
        {view === "output" && (
          <button
            className="terminal-output-return"
            onClick={() => setView("route")}
          >
            [ esc : 返回当前文件 ]
          </button>
        )}
        <form
          className="terminal-input"
          onSubmit={(e) => {
            e.preventDefault();
            if (!composing.current) void run(input);
          }}
        >
          <label htmlFor="terminal-command" className="prompt">
            <span>guest@hadesd</span>:{displayPath(cwd)}
            <b>$</b>
          </label>
          <div className="terminal-field" data-block-cursor={!hasSelection}>
            <textarea
              id="terminal-command"
              ref={field}
              value={input}
              rows={Math.min(3, input.split("\n").length)}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-label="博客命令"
              aria-autocomplete="list"
              aria-controls={completions.length ? "terminal-completions" : undefined}
              aria-activedescendant={completions.length && completionIndex >= 0 ? `terminal-completion-${completionIndex}` : undefined}
              onBlur={() => { closeCompletions(); tabExit.current = false; }}
              onChange={(e) => {
                setInput(e.target.value);
                closeCompletions();
                tabExit.current = false;
                readSelection(e.currentTarget);
              }}
              onSelect={(e) => {
                // React can deliver the old textarea selection after keydown but before
                // the completed value/caret commits. It is not a user caret movement.
                if (pendingCaret.current !== null) return;
                readSelection(e.currentTarget);
                const selected = completionSession.current?.items[completionSession.current.index];
                if (selected && (e.currentTarget.selectionStart !== selected.caret || e.currentTarget.selectionEnd !== selected.caret)) closeCompletions();
              }}
              onKeyUp={(e) => readSelection(e.currentTarget)}
              onPointerUp={(e) => readSelection(e.currentTarget)}
              onScroll={(e) =>
                setInputScroll({
                  top: e.currentTarget.scrollTop,
                  left: e.currentTarget.scrollLeft,
                })
              }
              onKeyDown={keyDown}
              onCompositionStart={(e) => {
                closeCompletions();
                composing.current = true;
                setCompositionStart(e.currentTarget.selectionStart);
                readSelection(e.currentTarget);
              }}
              onCompositionEnd={(e) => {
                composing.current = false;
                setCompositionStart(null);
                setInput(e.currentTarget.value);
                readSelection(e.currentTarget);
              }}
            />
            <span
              className="terminal-cursor-mirror"
              aria-hidden="true"
              data-terminal-caret-offset={
                hasSelection ? undefined : caretOffset
              }
              data-terminal-selection-direction={
                hasSelection ? selection.direction : undefined
              }
            >
              <span
                className="terminal-mirror-line"
                style={{
                  transform: `translate(${-inputScroll.left}px, ${-inputScroll.top}px)`,
                }}
              >
                <span data-terminal-prefix>
                  {markedCompositionStart === null ? (
                    input.slice(0, caretOffset)
                  ) : (
                    <>
                      {input.slice(0, markedCompositionStart)}
                      <span data-terminal-composition>
                        {input.slice(markedCompositionStart, caretOffset)}
                      </span>
                    </>
                  )}
                </span>
                {hasSelection ? (
                  <span data-terminal-selection>
                    {input.slice(selectionStart, selectionFinish)}
                  </span>
                ) : (
                  <span className="terminal-cursor" data-terminal-cursor>
                    █
                  </span>
                )}
              </span>
            </span>
            {completions.length > 0 && (
              <div className="terminal-completions">
                <p className="completion-caption" role="status">
                  {completions.length} 个候选 · Tab / Shift+Tab · Esc 关闭
                </p>
                <ul id="terminal-completions" className="completion-menu" role="listbox" aria-label="命令补全">
                  {completions.slice(Math.max(0, completionIndex - 5), Math.max(6, completionIndex + 1)).map((candidate, offset) => {
                    const i = Math.max(0, completionIndex - 5) + offset;
                    return <li key={candidate.value} role="presentation">
                      <button type="button" role="option" id={`terminal-completion-${i}`} tabIndex={-1}
                        aria-selected={i === completionIndex} aria-current={i === completionIndex}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          replaceInput(candidate.value, candidate.caret);
                          closeCompletions();
                          field.current?.focus({ preventScroll: true });
                        }}>
                        {candidate.label}
                      </button>
                    </li>;
                  })}
                </ul>
              </div>
            )}
          </div>
          <button
            type="submit"
            className="terminal-submit"
            disabled={busy || !input.trim()}
            aria-label="执行命令"
          >
            {busy ? "…" : "↵"}
          </button>
        </form>
        <div className="terminal-actions">
          <button onClick={() => void run("help")}>[ help ]</button>
          <button onClick={() => void run("ls ~")}>[ ls ]</button>
          <button
            aria-label="搜索与命令面板"
            onClick={() => preferences.toggle("paletteOpen")}
          >
            [ search ]
          </button>
          <button
            aria-label="显示设置"
            onClick={() => preferences.toggle("settingsOpen")}
          >
            [ display ]
          </button>
          <button onClick={() => void run("reboot")}>[ reboot ]</button>
          <span className="terminal-key-hint">
            TAB COMPLETE · PgUp/PgDn PAGE
          </span>
        </div>
      </div>
    </section>
  );
}

function OutputView({
  output,
  onHelp,
}: {
  output: Output;
  onHelp: () => void;
}) {
  if (output.type === "clear") return null;
  if (output.type === "text" || output.type === "error")
    return (
      <div>
        <pre className={output.type === "error" ? "terminal-error" : ""}>
          {output.text}
        </pre>
        {output.type === "error" && (
          <button type="button" className="terminal-help-link" onClick={onHelp}>
            查看命令帮助 →
          </button>
        )}
      </div>
    );
  if (output.type === "navigation")
    return (
      <p>
        <Link to={output.target.route}>{output.text} ↗</Link>
      </p>
    );
  if (output.type === "directory-list")
    return (
      <div className="terminal-list">
        {output.nodes.length ? (
          output.nodes.map((n) => (
            <Link key={n.id} to={n.route}>
              <span>
                {n.kind === "directory" ? "▱" : "·"} {n.path.split("/").at(-1)}
                {n.kind === "directory" ? "/" : ""}
              </span>
              {output.long && (
                <small>
                  {n.kind} {n.updatedAt?.slice(0, 10) ?? ""}
                </small>
              )}
              <span>{n.title}</span>
            </Link>
          ))
        ) : (
          <p className="muted">这个目录目前为空。</p>
        )}
      </div>
    );
  if (output.type !== "help") return null;
  return (
    <div className="command-help">
      <p className="terminal-help-caption">
        HADESD COMMAND REFERENCE / 使用 PgDn 或 [ ↓ ] 翻屏
      </p>
      {output.commands.map((c) => (
        <div key={c.name}>
          <code>
            {c.name} {c.usage}
          </code>
          <span>{c.description}</span>
          <small>例：{c.example}</small>
        </div>
      ))}
      <p className="muted">
        reboot 重新播放启动序列 · display 打开显示设置。
        单引号、双引号支持文本；反斜杠转义下一个字符。Tab 补全并循环候选，
        Shift+Tab 反向选择，Ctrl+Space 查看候选；Esc 关闭，再按 Tab 可移出命令框。
        PgUp / PgDn 在输入命令时也可翻屏。
      </p>
    </div>
  );
}
