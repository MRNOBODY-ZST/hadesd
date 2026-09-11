import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { CommandHistory, completeAt, createVfs, homeForUser, resolveTarget, tokenize, type Completion, displayPath, execute, redactAccountArguments, type Output } from "@hadesd/terminal-core";
import { Markdown } from "@hadesd/markdown";
import type { PublicContent, BlogComment } from "@hadesd/contracts";
import { useActions } from "./actions";
import { usePreferences } from "./store";
import { VimBuffer } from "./VimBuffer";
import { loadBlogDraft } from "./blogEditor";
import { Settings } from "./Settings";
import { Palette } from "./Palette";
import { useOptionalAccount } from "../community/Account";
import { useTerminalAccount } from "../community/terminalAccount";
import "./Terminal.css";

type RecordEntry = { id: number; input?: string; prompt?: string; outputs: Output[]; private?: boolean };
const ACCOUNT_COMMANDS = new Set(["login", "register", "logout", "profile", "passwd", "files", "upload", "download", "comments", "comment", "mycomments"]);
export function Terminal({ dispatchRef, children }: { children?: ReactNode; dispatchRef: React.MutableRefObject<((command: string) => void) | null> }) {
  const { cwd: routeCwd, open, data } = useActions();
  const location = useLocation();
  const preferences = usePreferences();
  const account = useOptionalAccount();
  const username = account?.user?.username ?? "guest";
  const home = homeForUser(username);
  const nodes = useMemo(() => createVfs(data.contents, username), [data.contents, username]);
  const [cwd, setCwd] = useState(() => routeCwd === "/" ? home : routeCwd);
  const previousCwd = useRef<string | undefined>(undefined);
  const oldHome = useRef(home);
  const startedAt = useRef(Date.now());
  const program = preferences.settingsOpen ? "settings" : preferences.paletteOpen ? "palette" : "";
  const [input, setInput] = useState("");
  const [records, setRecords] = useState<RecordEntry[]>([]);
  const [showWelcome, setShowWelcome] = useState(true);
  const [routeAfter, setRouteAfter] = useState(0);
  const [busy, setBusy] = useState(false);
  const [buffer, setBuffer] = useState<Extract<Output, { type: "file" }> | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(() => nodes.find(node => node.route.replace(/\/$/u, "") === location.pathname.replace(/\/$/u, ""))?.contentId ?? null);
  const screenRef = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const secretField = useRef<HTMLInputElement>(null);
  const followTail = useRef(false);
  const scrollRequest = useRef<{ id: number } | "end" | "route" | null>(null);
  const seq = useRef(0);
  const generation = useRef(0);
  const history = useRef(new CommandHistory());
  const task = useRef<AbortController | null>(null);
  const active = useRef(false);
  const composing = useRef(false);
  const previousProgram = useRef(program);
  const [selection, setSelection] = useState({ start: 0, end: 0, direction: "none" });
  const [compositionStart, setCompositionStart] = useState<number | null>(null);
  const [inputScroll, setInputScroll] = useState({ top: 0, left: 0 });
  const pendingCaret = useRef<number | null>(null);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [completionIndex, setCompletionIndex] = useState(-1);
  const completionSession = useRef<{ items: Completion[]; index: number } | null>(null);
  const tabExit = useRef(false);
  const replaceInput = useCallback((value: string, caret = value.length) => {
    pendingCaret.current = caret; setInput(value); setSelection({ start: caret, end: caret, direction: "none" }); setInputScroll({ top: 0, left: 0 });
  }, []);
  const readSelection = useCallback((control: HTMLTextAreaElement) => {
    setSelection({ start: control.selectionStart, end: control.selectionEnd, direction: control.selectionDirection });
    setInputScroll({ top: control.scrollTop, left: control.scrollLeft });
  }, []);
  const append = useCallback((entry: Omit<RecordEntry, "id">) => {
    const id = ++seq.current;
    scrollRequest.current = { id };
    setRecords(old => [...old, { ...entry, id }].slice(-250));
    return id;
  }, []);
  const cli = useTerminalAccount({ user: account?.user ?? null,
    setUser: user => account?.setUser(user),
    write: lines => { append({ outputs: lines, private: true }); },
    resolveContent: target => target ? nodes.find(n => n.contentId === target)?.contentId ?? resolveTarget(target, cwd, nodes, home)?.contentId : currentFile ?? undefined,
  });
  const focusInput = () => (secretField.current ?? field.current)?.focus({ preventScroll: true });
  const closeCompletions = () => { completionSession.current = null; setCompletions([]); setCompletionIndex(-1); };
  const clear = () => { setRecords([]); setShowWelcome(false); scrollRequest.current = "end"; };
  function cancel() {
    task.current?.abort(); task.current = null; generation.current++; active.current = false;
    setBusy(false); cli.cancel(); replaceInput(""); closeCompletions();
    append({ outputs: [{ type: "text", text: "^C" }] });
  }
  function scrollTranscript(direction: number) {
    const el = screenRef.current;
    if (!el) return;
    el.scrollTop += direction * Math.max(22, el.clientHeight - 44);
    followTail.current = el.scrollHeight - el.clientHeight - el.scrollTop < 32;
  }
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !field.current) return;
    field.current.setSelectionRange(pendingCaret.current, pendingCaret.current); pendingCaret.current = null;
  }, [input, selection.start, selection.end]);
  useLayoutEffect(() => {
    const el = screenRef.current, pending = scrollRequest.current;
    if (!el || !pending) return;
    scrollRequest.current = null;
    if (pending === "end") el.scrollTop = el.scrollHeight;
    else {
      const entry = pending === "route" ? el.querySelector<HTMLElement>(".terminal-route-content") : el.querySelector<HTMLElement>(`[data-record-id="${pending.id}"]`);
      if (entry) {
        const top = entry.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
        // Short output follows the tail; long Markdown starts at its first line.
        el.scrollTop = Math.min(top, Math.max(0, el.scrollHeight - el.clientHeight));
      }
    }
    followTail.current = el.scrollHeight - el.clientHeight - el.scrollTop < 32;
  }, [records, routeAfter, showWelcome]);
  const routeIdentity = location.pathname.replace(/\/$/u, "") + location.search;
  const previousRoute = useRef(routeIdentity);
  const pendingNavigation = useRef<number | null>(null);
  useEffect(() => {
    const navigate = () => { pendingNavigation.current = seq.current; };
    window.addEventListener("hadesd:navigate", navigate);
    return () => window.removeEventListener("hadesd:navigate", navigate);
  }, []);
  useLayoutEffect(() => {
    if (previousRoute.current === routeIdentity) return;
    previousRoute.current = routeIdentity;
    const after = pendingNavigation.current ?? seq.current;
    pendingNavigation.current = null;
    setRouteAfter(after); setShowWelcome(true);
    setCurrentFile(nodes.find(node => node.route.replace(/\/$/u, "") === location.pathname.replace(/\/$/u, ""))?.contentId ?? null);
    if (seq.current === after) scrollRequest.current = "route";
  }, [routeIdentity, nodes, location.pathname]);
  useEffect(() => {
    const el = screenRef.current, content = el?.firstElementChild;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { if (followTail.current) el.scrollTop = el.scrollHeight; });
    observer.observe(content); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (oldHome.current !== home) {
      const previous = oldHome.current; oldHome.current = home;
      setCwd(value => value === previous || value.startsWith(previous + "/") ? home + value.slice(previous.length) : value);
      previousCwd.current = undefined;
    }
  }, [home]);
  const oldIdentity = useRef(account?.user?.id);
  useEffect(() => {
    if (oldIdentity.current && oldIdentity.current !== account?.user?.id) {
      setRecords(old => old.filter(record => !record.private));
      history.current.clear(); replaceInput("");
    }
    oldIdentity.current = account?.user?.id;
  }, [account?.user?.id, replaceInput]);
  useEffect(() => {
    if (previousProgram.current && !program) requestAnimationFrame(() => {
      if (buffer) { const vim = document.querySelector<HTMLElement>('[data-terminal-program="vim"]'); (vim?.querySelector<HTMLElement>("textarea,input") ?? vim)?.focus({ preventScroll: true }); }
      else focusInput();
    });
    previousProgram.current = program;
  }, [program, buffer]);
  useEffect(() => { if (cli.prompt) requestAnimationFrame(focusInput); }, [cli.prompt?.label, cli.prompt?.secret]);
  const changeDirectory = (path: string) => { previousCwd.current = cwd; setCwd(path); };
  async function run(command: string, context?: {comment?: BlogComment}) {
    if (!command.trim() || buffer || active.current || cli.busy || cli.prompt) return;
    preferences.toggle("settingsOpen", false); preferences.toggle("paletteOpen", false);
    const controller = new AbortController(); task.current = controller;
    const request = ++generation.current;
    const visibleCommand = redactAccountArguments(command);
    history.current.add(command); replaceInput(""); closeCompletions();
    active.current = true; setBusy(true);
    let tokens: string[] = [];
    try { tokens = tokenize(command); } catch { /* execute renders syntax errors. */ }
    const isAccount = ACCOUNT_COMMANDS.has(tokens[0] ?? "");
    const id = append({ input: visibleCommand, prompt: `${username}@hadesd:${displayPath(cwd, home)} $`, outputs: [], private: isAccount });
    try {
      if (isAccount && await cli.start(tokens[0]!, tokens.slice(1), context)) return;
      const result = await execute(command, {
        cwd, home, user: username, nodes, previousCwd: previousCwd.current, startedAt: startedAt.current,
        history: history.current, releaseId: data.releaseId, theme: preferences.theme, crt: preferences.crt, reader: preferences.reader,
        changeDirectory,
        navigate: target => { open(target); },
        setTheme: preferences.setTheme, setCrt: preferences.setCrt, setReader: preferences.setReader,
        interact: name => {
          if (name === "reboot") window.dispatchEvent(new CustomEvent("hadesd:reboot"));
          else if (name === "display") preferences.toggle("settingsOpen", true);
        },
        readFile: async (node, signal) => {
          if (!node.contentId) return node.route === "/links" ? JSON.stringify(data.site.links, null, 2)
            : node.route === "/about" ? data.site.homeText : "此页面尚无已发布内容。";
          const response = await fetch(`/api/v1/public/contents/${encodeURIComponent(node.contentId)}`, { signal, headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error("内容暂时无法读取，可通过公开链接打开静态正文。");
          const content = await response.json() as PublicContent;
          if (content.revisionId !== data.contents.find(c => c.id === node.contentId)?.revisionId) throw new Error("公开版本已更新，请刷新页面后重试。");
          return content.markdown;
        },
      }, controller.signal);
      if (request !== generation.current || controller.signal.aborted) return;
      if (result.some(r => r.type === "clear")) clear();
      else {
        const file = result.find((r): r is Extract<Output, {type:"file"}> => r.type === "file");
        if (file) setBuffer(file);
        const document = result.find(r => r.type === "file" || r.type === "markdown");
        if (document && "node" in document) setCurrentFile(document.node.contentId ?? null);
        scrollRequest.current = { id };
        setRecords(old => old.map(record => record.id === id ? { ...record, outputs: result.filter(r => r.type !== "file") } : record));
      }
    } catch (error) {
      if (!controller.signal.aborted) append({ outputs: [{ type: "error", text: error instanceof Error ? error.message : "命令执行失败，请重试。" }] });
    } finally {
      if (request === generation.current) { active.current = false; setBusy(false); task.current = null; requestAnimationFrame(focusInput); }
    }
  }
  async function submit() {
    if (composing.current || busy || cli.busy) return;
    if (cli.prompt) { const answer = input; replaceInput(""); closeCompletions(); await cli.submit(answer); requestAnimationFrame(focusInput); }
    else await run(input);
  }
  const runRef = useRef(run); runRef.current = run;
  useEffect(() => {
    dispatchRef.current = command => { void runRef.current(command); };
    const command = (event: Event) => { const detail = (event as CustomEvent<{command:string;comment?:BlogComment}>).detail; if (detail?.command) void runRef.current(detail.command, detail); };
    window.addEventListener("hadesd:terminal-command", command);
    return () => { dispatchRef.current = null; task.current?.abort(); window.removeEventListener("hadesd:terminal-command", command); };
  }, [dispatchRef]);
  useEffect(() => {
    if (!account?.view) return;
    const name = account.view === "comments" ? "mycomments" : account.view;
    account.close(); void runRef.current(name);
  }, [account?.view]);
  useEffect(() => {
    const focus = () => { if (!buffer && !program && matchMedia("(pointer: fine)").matches) focusInput(); };
    const type = (event: globalThis.KeyboardEvent) => {
      if (buffer || program || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input,textarea,select,button,a,[data-terminal-program]"))) return;
      if (event.key.length === 1) { focusInput(); replaceInput((field.current?.value ?? "") + event.key); event.preventDefault(); }
      else if (event.key === "Escape") { focusInput(); event.preventDefault(); }
    };
    window.addEventListener("hadesd:boot-ready", focus); window.addEventListener("keydown", type);
    return () => { window.removeEventListener("hadesd:boot-ready", focus); window.removeEventListener("keydown", type); };
  }, [buffer, program, replaceInput]);
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229)
      return;
    if (cli.prompt) {
      if (e.ctrlKey && e.key.toLowerCase() === "c") { e.preventDefault(); cancel(); }
      else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
      else if (e.key === "PageUp" || e.key === "PageDown") { e.preventDefault(); scrollTranscript(e.key === "PageDown" ? 1 : -1); }
      return;
    }
    // Modifier keydown precedes Shift+Tab and must preserve its candidate cycle.
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    const requestCompletion = (reverse: boolean, listOnly = false) => {
      let session = completionSession.current;
      if (!session) {
        const items = completeAt(input, e.currentTarget.selectionStart, cwd, nodes, [], home);
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

      closeCompletions();
      // Explicit escape hatch: Escape then Tab/Shift+Tab uses native focus order.
      tabExit.current = true;
      return;
    }
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (tabExit.current) { tabExit.current = false; closeCompletions(); return; }
      e.preventDefault();
      requestCompletion(e.shiftKey);
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
      scrollTranscript(e.key === "PageDown" ? 1 : -1);
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString() && e.currentTarget.selectionStart === e.currentTarget.selectionEnd) {
      e.preventDefault(); cancel(); return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); clear(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === "u") { e.preventDefault(); replaceInput(input.slice(e.currentTarget.selectionStart)); return; }
    if (e.ctrlKey && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); replaceInput(input.slice(0, e.currentTarget.selectionStart)); return; }
    if (e.ctrlKey && e.key.toLowerCase() === "w") { e.preventDefault(); const caret = e.currentTarget.selectionStart; const left = input.slice(0, caret).replace(/\S+\s*$/u, ""); replaceInput(left + input.slice(caret), left.length); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowUp" && !input.includes("\n")) {
      e.preventDefault();
      replaceInput(history.current.previous(input));
    } else if (e.key === "ArrowDown" && !input.includes("\n")) {
      e.preventDefault();
      replaceInput(history.current.next());
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }
  const renderRecord = (record: RecordEntry) => <div className="terminal-record" data-terminal-record data-record-id={record.id} key={record.id}>
    {record.input && <p className="terminal-echo"><span>{record.prompt}</span> {record.input}</p>}
    {record.outputs.map((output, i) => <OutputView key={i} output={output} onHelp={() => void run("help")} />)}
  </div>;
  const selectionStart = Math.min(selection.start, input.length);
  const selectionFinish = Math.min(selection.end, input.length);
  const hasSelection = selectionStart !== selectionFinish && compositionStart === null;
  const caretOffset = hasSelection ? selectionStart : selectionFinish;
  const markedCompositionStart = compositionStart === null ? null : Math.min(compositionStart, caretOffset);
  return <section className="terminal" aria-label="博客终端" onClickCapture={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || buffer || program) return;
    const target = event.target;
    const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const url = new URL(link.href);
    if (url.hash && url.pathname === location.pathname) {
      const scope = link.closest(".terminal-document,.terminal-route-content");
      let id: string; try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
      const heading = Array.from(scope?.querySelectorAll<HTMLElement>("[id]") ?? []).find(el => el.id === id);
      if (heading && screenRef.current) { event.preventDefault(); heading.scrollIntoView({ block: "start" }); } return;
    }
    if (url.origin !== window.location.origin) return;
    pendingNavigation.current = seq.current;
    let pathname: string; try { pathname = decodeURI(url.pathname); } catch { return; }
    const explicitPath = link.dataset.vfsPath;
    const node = explicitPath ? nodes.find(n => n.path === explicitPath) : nodes.find(n => n.route.replace(/\/$/u, "") === pathname.replace(/\/$/u, ""));
    if (node && link.closest(".terminal-transcript") && !link.hasAttribute("data-permalink")) {
      event.preventDefault(); event.stopPropagation(); void run(`${node.kind === "directory" ? "ls" : "open"} ${JSON.stringify(node.path)}`);
    }
  }}>
    <div className="terminal-session" aria-label="终端状态"><Link to="/" aria-label="HADESD 首页">HADESD / TTY 01</Link><span>SESSION: {account?.user ? "@" + username : "GUEST"}</span><span className="session-connected">● CONNECTED</span></div>
    <div ref={screenRef} className="terminal-transcript screen-viewport" role="region" aria-label="终端历史记录" tabIndex={0} hidden={!!buffer || !!program}
      onScroll={event => { const el = event.currentTarget; followTail.current = el.scrollHeight - el.clientHeight - el.scrollTop < 32; }}
      onClick={event => { if (event.target instanceof Element && !event.target.closest("a,button,input,textarea,select,summary") && !window.getSelection()?.toString()) screenRef.current?.focus({preventScroll:true}); }}>
      <div className="terminal-scroll-content">
        <div className="terminal-output" role="log" aria-label="命令输出" aria-live="polite" aria-relevant="additions">
          {records.filter(record => record.id <= routeAfter).map(renderRecord)}
          {showWelcome && <div className="terminal-route-content" data-terminal-record>{children}</div>}
          {records.filter(record => record.id > routeAfter).map(renderRecord)}
        </div>
      </div>
    </div>
    {program && <div className="terminal-program-scroll">{program === "settings" ? <Settings /> : <Palette onCommand={command => void run(command)} />}</div>}
    {buffer && <div className="terminal-vim-screen" hidden={!!program}><VimBuffer key={buffer.node.path} path={buffer.node.path} markdown={buffer.text} identity={account?.user?.role === "ADMIN" ? account.user.id : undefined} loadDraft={account?.user?.role === "ADMIN" && buffer.node.contentId ? signal => loadBlogDraft(buffer.node.contentId!, signal) : undefined} onClose={() => { setBuffer(null); requestAnimationFrame(focusInput); }} /></div>}
    <div className="terminal-command-area" hidden={!!buffer || !!program}>
      <form className="terminal-input" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label htmlFor={cli.prompt?.secret ? "terminal-secret" : "terminal-command"} className="prompt">{cli.prompt ? cli.prompt.label : <><span>{username}@hadesd</span>:{displayPath(cwd, home)}<b>$</b></>}</label>
        <div className="terminal-field" data-block-cursor={!hasSelection && !cli.prompt?.secret}>
            {cli.prompt?.secret ? <input id="terminal-secret" ref={secretField} type="password" aria-label={cli.prompt.label} autoComplete="off" autoCapitalize="off" spellCheck={false} value={input} onChange={e => setInput(e.currentTarget.value)} onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") { e.preventDefault(); void submit(); }
              else if (e.ctrlKey && e.key.toLowerCase() === "c") { e.preventDefault(); cancel(); }
            }} /> : <><textarea
              id="terminal-command"
              ref={field}
              value={input}
              rows={Math.min(3, input.split("\n").length)}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-label={cli.prompt?.label ?? "博客命令"}
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
            </>}
            {completions.length > 0 && !cli.prompt && (
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
        </div><button type="submit" className="terminal-submit" disabled={busy || cli.busy || (!cli.prompt && !input.trim())} aria-label="执行命令">{busy || cli.busy ? "…" : "↵"}</button>
      </form>
      <div className="terminal-actions">
        <button onClick={() => void run("help")}>[ help ]</button><button onClick={() => void run("ls")}>[ ls ]</button><button onClick={() => void run("history")}>[ history ]</button>
        <button aria-label="显示设置" onClick={() => preferences.toggle("settingsOpen")}>[ display ]</button>
        <button onClick={() => { scrollRequest.current = "end"; if (screenRef.current) screenRef.current.scrollTop = screenRef.current.scrollHeight; followTail.current = true; focusInput(); }}>[ ↓ 最新 ]</button>
        <span className="terminal-key-hint">{cli.prompt ? "ENTER 确认 · CTRL+C 取消" : "TAB 补全 · ↑↓ 历史 · PgUp/PgDn 滚动"}</span>
      </div>
    </div>
  </section>;
}
function OutputView({
  output,
  onHelp,
}: {
  output: Output;
  onHelp: () => void;
}) {
  if (output.type === "clear") return null;
  if (output.type === "markdown") return <article className="terminal-document" aria-label={output.node.title}>
    <header><span>{output.node.path}</span><a href={output.node.route} data-permalink>永久链接 ↗</a></header>
    <Markdown source={output.text} />
    <footer>END OF FILE · {output.node.path} · comments 查看评论 · comment 发表评论</footer>
  </article>;
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
            <Link key={n.id} to={n.route} data-vfs-path={n.path}>
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
        HADESD COMMAND REFERENCE / 滚动查看完整帮助
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
        ↑ / ↓ 召回命令；PgUp / PgDn 滚动历史；Ctrl+L 清屏；Ctrl+C 取消。
      </p>
    </div>
  );
}
