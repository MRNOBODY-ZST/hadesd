import type { ForegroundMode } from "./three/foreground/shared";
import { useState } from "react";
import { PORTAL_SHAPES, type PortalShape } from "./three/foreground/portalShapes";
import "./ForegroundPreview.css";

export type PreviewMode = Exclude<ForegroundMode, "binary">;
const choices: { id: PreviewMode; title: string; detail: string }[] = [
  { id: "assembly", title: "芯片装配", detail: "MCU、电容与电阻依次归位，组成一块电路板。" },
  { id: "circuit", title: "信号穿屏", detail: "沿弧线入场，逆时针旋转、纵向翻转各 180°，穿过镂空入口进入终端。" },
  { id: "paper", title: "打印纸带", detail: "连续纸送出启动记录，向上滚动即可倒带。" },
  { id: "macos", title: "Mac 窗口", detail: "Finder、SimpleText 与关于这台 Macintosh 依次展开。" },
];
export function previewModeFromSearch(search: string): PreviewMode | null {
  const value = new URLSearchParams(search).get("effects");
  if (value === null) return null;
  return choices.find(choice => choice.id === value)?.id ?? "macos";
}

const shapeIcons: Record<PortalShape, string> = {
  star: "M0 -1 .27 -.37 .95 -.31 .44 .14 .59 .81 0 .46 -.59 .81 -.44 .14 -.95 -.31 -.27 -.37Z",
  spark: "M0 -1 .24 -.24 1 0 .24 .24 0 1 -.24 .24 -1 0 -.24 -.24Z",
  diamond: "M0 -1 .78 0 0 1 -.78 0Z",
  hexagon: "M0 -1 .866 -.5 .866 .5 0 1 -.866 .5 -.866 -.5Z",
  ring: "M1 0A1 1 0 1 0 -1 0A1 1 0 1 0 1 0Z",
};
export function ForegroundPreview({ mode, shape, percent, available, onMode, onShape, onSeek, onReplay }: {
  mode: PreviewMode;
  shape: PortalShape;
  percent: number;
  available: boolean;
  onMode: (mode: PreviewMode) => void;
  onShape: (shape: PortalShape) => void;
  onSeek: (progress: number) => void;
  onReplay: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return <aside className="foreground-preview" data-foreground-preview="" data-collapsed={collapsed} aria-label="滚筒效果本地预览">
    <div className="foreground-preview-heading">
      <span><i /> LOCAL PREVIEW <b>01—04</b></span>
      <button type="button" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-controls="foreground-preview-body">{collapsed ? "展开" : "收起"}</button>
    </div>
    {!collapsed && <div id="foreground-preview-body">
      <div className="foreground-preview-choices" aria-label="效果方案">
        {choices.map((choice, index) => <button key={choice.id} type="button" aria-pressed={mode === choice.id} onClick={() => onMode(choice.id)}>
          <span>0{index + 1}</span>{choice.title}
        </button>)}
      </div>
      <p>{choices.find(choice => choice.id === mode)!.detail}</p>
      {mode === "circuit" && <fieldset className="foreground-preview-shapes">
        <legend>入口造型</legend>
        <div>{PORTAL_SHAPES.map(option => <button type="button" key={option.id} aria-pressed={shape === option.id} onClick={() => onShape(option.id)}>
          <svg aria-hidden="true" viewBox="-1.2 -1.2 2.4 2.4"><path d={shapeIcons[option.id]} /></svg>
          {option.label}
        </button>)}</div>
      </fieldset>}
      <label className="foreground-preview-position">
        <span>滚动位置 <output>{String(percent).padStart(2, "0")}%</output></span>
        <input aria-label="滚动位置" type="range" min="0" max={mode === "circuit" ? "100" : "98"} step={mode === "circuit" ? "0.1" : "1"} value={percent} disabled={!available} onChange={event => onSeek(Number(event.target.value) / 100)} />
      </label>
      <div className="foreground-preview-actions">
        <button type="button" disabled={!available} onClick={() => onSeek(mode === "circuit" ? .55 : .36)}>{mode === "circuit" ? "弧线" : "引入"}</button>
        <button type="button" disabled={!available} onClick={() => onSeek(mode === "circuit" ? .84 : .55)}>{mode === "circuit" ? "靠近" : "展开"}</button>
        <button type="button" disabled={!available} onClick={() => onSeek(mode === "circuit" ? .97 : .77)}>{mode === "circuit" ? "穿屏" : "收束"}</button>
        <button type="button" disabled={!available} onClick={onReplay}>重播开场 ↗</button>
      </div>
    </div>}
  </aside>;
}
