import type { ButtonHTMLAttributes, ReactNode } from "react";
export function Button({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props}>
      {children}
    </button>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      style={{ padding: "36px 0", color: "var(--text-secondary)" }}
    >
      <p style={{ color: "var(--text-primary)" }}>{title}</p>
      <p>{children}</p>
    </div>
  );
}
