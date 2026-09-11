import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ADMIN_THEMES, setAdminTheme, useAdminTheme } from "../theme";
import styles from "../styles.module.css";

export function ThemePicker() {
  const theme = useAdminTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = ADMIN_THEMES.find(item => item.id === theme)!;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className={styles.themePicker} ref={root}>
    <button className={styles.themeTrigger} ref={trigger} type="button" aria-label={`切换写作台外观，当前${current.name}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <span className={styles.themeTriggerIcon} aria-hidden="true">◐</span><span>外观<span className={styles.themeCurrent}> / {current.name}</span></span><span aria-hidden="true">⌄</span>
    </button>
    {open && <section className={styles.themePanel} id={id} aria-label="外观预设">
      <header><span>MAKE IT YOURS</span><strong>你的写作空间</strong><p>即时切换，并记住这台浏览器的偏好。</p></header>
      <fieldset className={styles.themeOptions}>
        <legend className={styles.srOnly}>选择外观预设</legend>
        {ADMIN_THEMES.map(preset => <label className={styles.themeOption} key={preset.id} data-selected={theme === preset.id}>
          <input type="radio" name={id} value={preset.id} checked={theme === preset.id} aria-label={preset.name} onChange={() => setAdminTheme(preset.id)} />
          <span className={styles.themePreview} aria-hidden="true" style={{ "--preview-sidebar": preset.swatches[0], "--preview-surface": preset.swatches[1], "--preview-accent": preset.swatches[2] } as CSSProperties}>
            <i /><span><b /><b /><b /></span>
          </span>
          <span className={styles.themeOptionTitle}>{preset.name}<span aria-hidden="true">{theme === preset.id ? "✓" : ""}</span></span>
          <small>{preset.detail}</small>
        </label>)}
      </fieldset>
    </section>}
  </div>;
}
