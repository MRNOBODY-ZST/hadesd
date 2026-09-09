import type { KeyboardEvent, ReactNode } from "react";
import { errorMessage } from "../api";
import styles from "../styles.module.css";
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className={styles.error} role="alert">
      <span>{errorMessage(error)}</span>
      {retry && <button onClick={retry}>重试</button>}
    </div>
  );
}
export function Loading({ children = "正在读取…" }: { children?: ReactNode }) {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.spinner} />
      {children}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark}>✳</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Pagination({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (page: number) => void;
}) {
  if (total <= size) return null;
  return (
    <nav className={styles.pagination} aria-label="分页">
      <button disabled={page === 0} onClick={() => onChange(page - 1)}>
        ← 上一页
      </button>
      <span>
        第 {page + 1} / {Math.ceil(total / size)} 页
      </span>
      <button
        disabled={(page + 1) * size >= total}
        onClick={() => onChange(page + 1)}
      >
        下一页 →
      </button>
    </nav>
  );
}
export const dateTime = (date: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
export const typeNames = {
  POST: "文章",
  PROJECT: "项目",
  RESEARCH: "研究",
  PAGE: "页面",
} as const;
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.pageHeading}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.muted}>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function trapDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const elements = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0);
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (!first || !last) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === event.currentTarget)
  ) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
