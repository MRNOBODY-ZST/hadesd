import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** A terminal screen: page the DOM with discrete line-aligned offsets, never scroll it. */
export function ScreenPager({
  children,
  resetKey = "",
  followEnd = false,
}: {
  children: ReactNode;
  resetKey?: string | number;
  followEnd?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [metrics, setMetrics] = useState({ step: 440, pages: 1 });
  const currentPage = useRef(page);
  currentPage.current = page;
  const pendingAnchor = useRef<string | null>(null);
  const measureNow = useRef<(() => void) | null>(null);
  const updateFocus = useRef<((page: number, step: number) => void) | null>(null);
  const jump = useCallback(
    (next: number) => { pendingAnchor.current = null; setPage(Math.max(0, Math.min(next, metrics.pages - 1))); },
    [metrics.pages],
  );
  const turn = useCallback((direction: "next" | "previous" | "first" | "last") => {
    pendingAnchor.current = null;
    setPage(current => Math.max(0, Math.min(
      direction === "first" ? 0 : direction === "last" ? metrics.pages - 1
        : current + (direction === "next" ? 1 : -1), metrics.pages - 1)));
  }, [metrics.pages]);
  useEffect(() => {
    const frame = viewport.current,
      body = content.current;
    if (!frame || !body) return;
    let scheduled: number | null = null;
    let mutations: MutationObserver | null = null;
    const watchMutations = () => mutations?.observe(body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"],
    });
    const focus = (nextPage: number, step: number) => {
      const top = nextPage * step, bottom = top + frame.clientHeight;
      const bodyTop = body.getBoundingClientRect().top;
      body.querySelectorAll<HTMLElement>("a[href],button,input,textarea,select,summary,[tabindex]").forEach(element => {
        if (!element.hasAttribute("data-pager-tabindex")) element.dataset.pagerTabindex = element.getAttribute("tabindex") ?? "native";
        const y = element.getBoundingClientRect().top - bodyTop;
        const visible = y >= top - 1 && y + element.offsetHeight <= bottom + 1;
        if (!visible) element.tabIndex = -1;
        else if (element.dataset.pagerTabindex === "native") element.removeAttribute("tabindex");
        else element.setAttribute("tabindex", element.dataset.pagerTabindex!);
      });
      frame.scrollTop = 0;
      frame.scrollLeft = 0;
    };
    updateFocus.current = focus;
    const measure = () => {
      // Rescaling a wide formula writes style attributes; those writes are part of this measurement.
      mutations?.disconnect();
      body.querySelectorAll<HTMLElement>(".katex-display").forEach((math) => {
        math.style.fontSize = "";
        const available = math.clientWidth;
        if (available > 0 && math.scrollWidth > available) {
          math.style.fontSize = `${available / math.scrollWidth}em`;
        }
      });
      const line = parseFloat(getComputedStyle(body).lineHeight) || 22;
      // One line overlaps at page boundaries, so a wrapped line/image never disappears in a crop.
      const step = Math.max(
        line,
        Math.floor((frame.clientHeight - line) / line) * line,
      );
      const pages = Math.max(
        1,
        Math.ceil((body.scrollHeight - frame.clientHeight) / step) + 1,
      );
      setMetrics((old) =>
        old.step === step && old.pages === pages ? old : { step, pages },
      );
      let nextPage = Math.min(currentPage.current, pages - 1);
      if (pendingAnchor.current) {
        const target = document.getElementById(pendingAnchor.current);
        if (target && body.contains(target)) {
          const y = target.getBoundingClientRect().top - body.getBoundingClientRect().top;
          nextPage = Math.max(0, Math.min(Math.floor(y / step), pages - 1));
          pendingAnchor.current = null;
        }
      }
      setPage(nextPage);
      // Child components can add controls without changing this component's props or page count.
      focus(nextPage, step);
      watchMutations();
    };
    measureNow.current = measure;
    const schedule = () => {
      if (scheduled !== null) return;
      scheduled = requestAnimationFrame(() => { scheduled = null; measure(); });
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(frame);
    observer?.observe(body);
    mutations = new MutationObserver(schedule);
    // Ignore tabindex attributes written above, avoiding a self-triggering observer loop.
    watchMutations();
    const stopWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) event.preventDefault();
    };
    frame.addEventListener("wheel", stopWheel, { passive: false });
    body.addEventListener("load", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      if (scheduled !== null) cancelAnimationFrame(scheduled);
      measureNow.current = null;
      updateFocus.current = null;
      frame.removeEventListener("wheel", stopWheel);
      body.removeEventListener("load", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  useEffect(() => {
    setPage(followEnd ? metrics.pages - 1 : 0);
  }, [resetKey, followEnd]);
  useEffect(() => {
    if (followEnd) setPage(metrics.pages - 1);
  }, [resetKey, metrics.pages, followEnd]);
  useEffect(() => {
    const available = (target: EventTarget | null) => {
      const frame = viewport.current;
      if (!frame || frame.closest("[inert]") || document.querySelector("dialog[open]")) return false;
      const owner = frame.closest(".terminal");
      const source = target instanceof Element ? target.closest(".terminal") : null;
      return !source || !owner || owner === source;
    };
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        event.ctrlKey || event.metaKey || event.altKey || !available(event.target)) return;
      const target = event.target;
      const control = target instanceof HTMLElement ? target : null;
      const editing = !!control && (control.isContentEditable || control.matches("input,textarea,select"));
      // Account, comment and other form fields retain their own editing keys.
      if (editing && !control?.matches("#terminal-command")) return;
      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        turn(event.key === "PageDown" ? "next" : "previous");
      } else if (!editing && ["j", "k", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        // Space on a real button activates that button exactly once.
        if (event.key === " " && control?.closest("button,a,summary")) return;
        event.preventDefault();
        turn(event.key === "Home" ? "first" : event.key === "End" ? "last"
          : ["k", "ArrowUp"].includes(event.key) || (event.key === " " && event.shiftKey) ? "previous" : "next");
      }
    };
    const requested = (event: Event) => {
      if (!available(event.target)) return;
      const detail = (event as CustomEvent<{ direction?: string; anchor?: string }>).detail;
      if (detail?.anchor) revealHash("#" + encodeURIComponent(detail.anchor));
      else if (["next", "previous", "first", "last"].includes(detail?.direction ?? ""))
        turn(detail!.direction as "next" | "previous" | "first" | "last");
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("hadesd:page", requested);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("hadesd:page", requested);
    };
  }, [turn, metrics.step, jump]);
  useEffect(() => {
    updateFocus.current?.(page, metrics.step);
  }, [page, metrics, children]);
  function revealHash(hash: string) {
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    pendingAnchor.current = id;
    // Measure synchronously, not from old React metrics; retry on DOM mount if the file is still hidden by output.
    measureNow.current?.();
  }
  useEffect(() => {
    if (location.hash) revealHash(location.hash);
  }, [resetKey, metrics.step]);
  return (
    <div
      className="screen-pager"
      data-page={page + 1}
      data-pages={metrics.pages}
    >
      <div
        className="screen-viewport"
        ref={viewport}
        onScroll={(e) => {
          e.currentTarget.scrollTop = 0;
          e.currentTarget.scrollLeft = 0;
        }}
        onClick={(e) => {
          const link = (e.target as Element).closest<HTMLAnchorElement>(
            'a[href^="#"]',
          );
          if (link) {
            e.preventDefault();
            const hash = link.getAttribute("href")!;
            revealHash(hash);
            history.replaceState(history.state, "", hash);
          }
        }}
      >
        <div
          className="screen-content"
          ref={content}
          style={{ transform: `translate3d(0, -${page * metrics.step}px, 0)` }}
        >
          {children}
        </div>
      </div>
      <nav className="screen-paging" aria-label="终端屏幕分页">
        <span className="paging-hint">
          {metrics.pages > 1 ? "PgUp / PgDn · j / k" : "UTF-8 · READ ONLY"}
        </span>
        <span className="screen-page-number" aria-live="polite">
          SCREEN {String(page + 1).padStart(2, "0")} /{" "}
          {String(metrics.pages).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => turn("previous")}
          disabled={page === 0}
          aria-label="上一屏"
        >
          [ ↑ ]
        </button>
        <button
          type="button"
          onClick={() => turn("next")}
          disabled={page === metrics.pages - 1}
          aria-label="下一屏"
        >
          [ ↓ ]
        </button>
      </nav>
    </div>
  );
}
