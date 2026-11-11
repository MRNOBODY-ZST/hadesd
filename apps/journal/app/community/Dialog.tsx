import { useEffect, useRef, type ReactNode } from "react";
export function AccountDialog({ onClose, children }: { label?: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current!;
    element.showModal();
    (element.querySelector<HTMLElement>("[data-autofocus]") || element.querySelector<HTMLElement>("button"))?.focus();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="account-dialog" aria-labelledby="account-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="account-dialog-inner"><header><div><p className="eyebrow">THE READER'S SPACE</p><h2 id="account-title">读者账户</h2></div><button className="icon-button close-dialog" onClick={onClose} aria-label="关闭账户">×</button></header>{children}</div>
  </dialog>;
}
