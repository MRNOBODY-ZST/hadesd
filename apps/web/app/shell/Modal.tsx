import { useEffect, useRef, type ReactNode } from "react";
export function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const active = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog?.close();
      if (active instanceof HTMLElement) active.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-label={label}
      className="modal"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <span className="eyebrow">{label}</span>
        <button onClick={onClose} aria-label="关闭">
          ESC ×
        </button>
      </div>
      {children}
      <div className="system-crt-glass modal-crt-glass" aria-hidden="true" />
    </dialog>
  );
}
