import type { CSSProperties } from "react";
export function JournalArt({ small = false }: { small?: boolean }) {
  return <div className={`journal-art${small ? " journal-art-small" : ""}`} aria-hidden="true">
    <div className="art-halo" /><div className="art-assembly">{Array.from({ length: 6 }, (_, i) => <div className="art-sheet" key={i} style={{ "--layer": i } as CSSProperties}><i /><b /></div>)}</div>
    {!small && <div className="art-caption"><span>IDEAS, IN LAYERS.</span><i />01 — ∞</div>}
  </div>;
}
