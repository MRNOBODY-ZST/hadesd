import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry, CanvasTexture, DoubleSide, Group, MathUtils, MeshBasicNodeMaterial,
  NearestFilter, PlaneGeometry, SRGBColorSpace,
} from "three/webgpu";
import { useForegroundFrame, type ForegroundProps } from "./shared";

const INK = "#171916", PAPER = "#e8e9df", WHITE = "#f3f4ea";
type WindowKind = "finder" | "simpletext" | "about";

function line(c: CanvasRenderingContext2D, x: number, y: number, x2: number, y2: number) {
  c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke();
}

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, size = 12, bold = false) {
  c.fillStyle = INK;
  c.font = `${bold ? "bold " : ""}${size}px Geneva, Arial, sans-serif`;
  c.fillText(text, x, y);
}

function checker(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step = 2) {
  c.fillStyle = "#94988f";
  for (let row = 0; row < h; row += step) {
    for (let col = (row / step % 2) * step; col < w; col += step * 2) {
      c.fillRect(x + col, y + row, Math.min(step, w - col), Math.min(step, h - row));
    }
  }
}

function triangle(c: CanvasRenderingContext2D, x: number, y: number, direction: number) {
  c.save(); c.translate(x, y); c.rotate(direction);
  c.fillStyle = INK; c.beginPath(); c.moveTo(-4, 3); c.lineTo(0, -3); c.lineTo(4, 3); c.closePath(); c.fill();
  c.restore();
}

function finderFace(c: CanvasRenderingContext2D, x: number, y: number) {
  c.save(); c.translate(x, y);
  c.fillStyle = PAPER; c.strokeStyle = INK; c.lineWidth = 1;
  c.fillRect(0, 0, 20, 20); c.strokeRect(.5, .5, 19, 19);
  c.fillStyle = WHITE; c.fillRect(11, 1, 8, 18);
  c.beginPath(); c.moveTo(11.5, 1); c.lineTo(9.5, 11.5); c.lineTo(12.5, 11.5); c.lineTo(12.5, 19); c.stroke();
  c.fillStyle = INK; c.fillRect(5, 5, 2, 4); c.fillRect(15, 5, 2, 4);
  c.beginPath(); c.moveTo(4.5, 12.5); c.lineTo(7.5, 15.5); c.lineTo(14.5, 15.5); c.lineTo(17.5, 12.5); c.stroke();
  c.restore();
}

function chrome(c: CanvasRenderingContext2D, w: number, h: number, title: string, scrollbars: boolean) {
  c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
  c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2);
  c.fillStyle = WHITE; c.fillRect(3, 3, w - 6, 24);
  c.lineWidth = 1;
  for (let y = 6; y <= 24; y += 3) line(c, 7, y + .5, w - 7, y + .5);
  c.font = "bold 18px Geneva, Arial, sans-serif";
  const titleWidth = c.measureText(title).width;
  const finderInset = title === "Finder" ? 14 : 0;
  c.fillStyle = WHITE; c.fillRect((w - titleWidth) / 2 - 12 - finderInset, 3, titleWidth + 24 + finderInset * 2, 25);
  c.textAlign = "center"; label(c, title, w / 2 + finderInset, 22, 18, true); c.textAlign = "left";
  if (finderInset) finderFace(c, (w - titleWidth) / 2 - 19, 5);
  c.fillStyle = WHITE; c.fillRect(9, 5, 20, 21); c.fillRect(w - 29, 5, 20, 21);
  c.strokeStyle = INK; c.strokeRect(12.5, 8.5, 12, 12); c.strokeRect(w - 25.5, 8.5, 12, 12);
  c.strokeRect(w - 22.5, 8.5, 9, 8);
  line(c, 2, 28.5, w - 2, 28.5);
  if (!scrollbars) return;
  const gutter = w - 18;
  c.fillStyle = WHITE; c.fillRect(3, 30, w - 22, h - 49);
  c.strokeStyle = INK;
  line(c, gutter + .5, 28, gutter + .5, h - 2);
  line(c, 2, h - 18.5, w - 2, h - 18.5);
  line(c, gutter, 45.5, w - 2, 45.5); line(c, gutter, h - 35.5, w - 2, h - 35.5);
  checker(c, gutter + 2, 47, 14, h - 84);
  c.fillStyle = WHITE; c.fillRect(gutter + 2, 48, 14, 88); c.strokeRect(gutter + 1.5, 47.5, 15, 89);
  triangle(c, w - 9, 37, 0); triangle(c, w - 9, h - 27, Math.PI);
  triangle(c, 10, h - 10, -Math.PI / 2); triangle(c, gutter - 8, h - 10, Math.PI / 2);
  line(c, 18.5, h - 18, 18.5, h - 2); line(c, gutter - 17.5, h - 18, gutter - 17.5, h - 2);
  checker(c, 20, h - 16, gutter - 39, 13);
  c.fillStyle = WHITE; c.fillRect(21, h - 16, 150, 13); c.strokeRect(20.5, h - 16.5, 151, 14);
  for (let i = 0; i < 3; i++) line(c, w - 12 + i * 4, h - 4, w - 4, h - 12 + i * 4);
}

function folder(c: CanvasRenderingContext2D, x: number, y: number, system = false) {
  c.fillStyle = PAPER; c.strokeStyle = INK; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x - 24, y - 14); c.lineTo(x - 24, y - 22); c.lineTo(x - 7, y - 22);
  c.lineTo(x - 1, y - 16); c.lineTo(x + 24, y - 16); c.lineTo(x + 24, y + 17);
  c.lineTo(x - 24, y + 17); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = WHITE; c.fillRect(x - 21, y - 11, 42, 25); line(c, x - 23, y - 12, x + 23, y - 12);
  if (system) {
    c.fillStyle = INK; c.fillRect(x - 6, y - 4, 12, 13);
    c.fillStyle = WHITE; c.fillRect(x - 4, y - 2, 8, 6); c.fillStyle = INK;
    c.fillRect(x - 2, y, 1, 1); c.fillRect(x + 2, y, 1, 1);
    c.fillRect(x - 7, y + 10, 14, 2);
  }
}

function documentIcon(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = WHITE; c.strokeStyle = INK; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x - 16, y - 24); c.lineTo(x + 7, y - 24); c.lineTo(x + 18, y - 13);
  c.lineTo(x + 18, y + 21); c.lineTo(x - 16, y + 21); c.closePath(); c.fill(); c.stroke();
  line(c, x + 7, y - 24, x + 7, y - 13); line(c, x + 7, y - 13, x + 18, y - 13);
  c.lineWidth = 1; for (let row = 0; row < 5; row++) line(c, x - 10, y - 8 + row * 5, x + 11 - (row === 4 ? 7 : 0), y - 8 + row * 5);
}

function disk(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = PAPER; c.strokeStyle = INK; c.lineWidth = 2;
  c.fillRect(x - 23, y - 22, 46, 41); c.strokeRect(x - 23, y - 22, 46, 41);
  c.fillStyle = WHITE; c.fillRect(x - 20, y - 19, 40, 22); c.strokeRect(x - 20, y - 19, 40, 22);
  line(c, x - 20, y + 7, x + 20, y + 7); line(c, x - 15, y + 12, x + 7, y + 12);
  c.fillStyle = INK; c.fillRect(x + 14, y + 11, 3, 3);
}

function trash(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = WHITE; c.strokeStyle = INK; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x - 17, y - 15); c.lineTo(x + 17, y - 15); c.lineTo(x + 13, y + 21);
  c.lineTo(x - 13, y + 21); c.closePath(); c.fill(); c.stroke();
  c.strokeRect(x - 20, y - 21, 40, 6); c.strokeRect(x - 7, y - 26, 14, 5);
  c.lineWidth = 1; for (let i = -1; i <= 1; i++) line(c, x + i * 8, y - 10, x + i * 6, y + 17);
}

function happyMac(c: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  c.save(); c.translate(x, y); c.scale(scale, scale); c.fillStyle = PAPER; c.strokeStyle = INK; c.lineWidth = 2;
  c.fillRect(-27, -38, 54, 68); c.strokeRect(-27, -38, 54, 68);
  c.fillStyle = WHITE; c.fillRect(-21, -31, 42, 37); c.strokeRect(-21, -31, 42, 37);
  c.fillStyle = INK; c.fillRect(-12, -22, 3, 6); c.fillRect(10, -22, 3, 6);
  c.beginPath(); c.moveTo(-10, -9); c.lineTo(-6, -5); c.lineTo(7, -5); c.lineTo(11, -9); c.stroke();
  c.fillRect(4, 17, 17, 3); c.fillRect(-20, 19, 5, 5); c.fillRect(-22, 32, 44, 5);
  c.restore();
}

function finder(c: CanvasRenderingContext2D, w: number, h: number) {
  chrome(c, w, h, "Finder", true);
  c.fillStyle = PAPER; c.fillRect(3, 30, w - 22, 27); c.strokeStyle = INK; c.lineWidth = 1;
  line(c, 3, 56.5, w - 19, 56.5);
  label(c, "6 items", 15, 48, 16); label(c, "2.4 MB in disk", 216, 48, 16); label(c, "13.6 MB available", 421, 48, 16);
  const icons: [string, "disk" | "folder" | "system" | "doc" | "trash"][] = [
    ["Macintosh HD", "disk"], ["System Folder", "system"], ["Documents", "folder"],
    ["HADESD", "folder"], ["README.txt", "doc"], ["Trash", "trash"],
  ];
  icons.forEach(([name, kind], i) => {
    const x = 106 + i % 3 * 201, y = 128 + Math.floor(i / 3) * 153;
    c.save(); c.translate(x, y); c.scale(1.38, 1.38);
    if (kind === "disk") disk(c, 0, 0);
    else if (kind === "doc") documentIcon(c, 0, 0);
    else if (kind === "trash") trash(c, 0, 0);
    else folder(c, 0, 0, kind === "system");
    c.restore();
    c.textAlign = "center";
    if (name === "HADESD") {
      c.fillStyle = INK; c.fillRect(x - 47, y + 41, 94, 26); c.fillStyle = WHITE;
      c.font = "bold 18px Geneva, Arial, sans-serif"; c.fillText(name, x, y + 61);
    } else label(c, name, x, y + 60, 18, true);
    c.textAlign = "left";
  });
}

function simpleText(c: CanvasRenderingContext2D, w: number, h: number) {
  chrome(c, w, h, "HADESD — SimpleText", true);
  c.save(); c.beginPath(); c.rect(4, 30, w - 24, h - 50); c.clip();
  label(c, "Welcome to HADESD.", 33, 78, 31, true);
  c.fillStyle = INK; c.fillRect(33, 95, w - 82, 2);
  const lines = [
    "A place for things worth keeping.", "Notes. Experiments. A blinking cursor.", "",
    "Today's session", "  [x] Mount Macintosh HD", "  [x] Open personal notes", "  [ ] Follow your curiosity", "",
    "/home/hades/notes", "Your terminal awaits.",
  ];
  c.font = "bold 20px 'Courier New', monospace";
  lines.forEach((text, index) => c.fillText(text, 34, 128 + index * 26));
  c.fillRect(34 + 21 * 12, 345, 3, 21);
  c.restore();
}

function about(c: CanvasRenderingContext2D, w: number, h: number) {
  chrome(c, w, h, "About This Macintosh", false);
  happyMac(c, 81, 102, 1.12);
  label(c, "Macintosh", 139, 77, 27, true);
  label(c, "System Software 7.1", 142, 107, 19);
  label(c, "HADESD Personal Computer", 142, 134, 17);
  c.strokeStyle = INK; c.lineWidth = 1; line(c, 28, 166.5, w - 28, 166.5);
  label(c, "Built-in Memory:", 33, 197, 18, true); label(c, "16,384 K", w - 131, 197, 18);
  label(c, "Largest Unused Block:", 33, 224, 18); label(c, "10,240 K", w - 131, 224, 18);
  const rows: [string, string, number][] = [["System Software", "4,096 K", .28], ["Finder", "1,024 K", .12], ["SimpleText", "1,024 K", .12]];
  rows.forEach(([name, memory, amount], i) => {
    const y = 260 + i * 42;
    label(c, name, 33, y + 14, 17, true);
    c.fillStyle = WHITE; c.fillRect(224, y - 1, 276, 21); c.strokeStyle = INK; c.strokeRect(224.5, y - .5, 276, 21);
    c.fillStyle = INK; c.fillRect(227, y + 2, Math.floor(270 * amount), 15);
    checker(c, 228, y + 3, Math.floor(268 * amount), 13, 1);
    c.textAlign = "right"; label(c, memory, w - 32, y + 14, 17); c.textAlign = "left";
  });
  label(c, "Everything in its right place.", 33, h - 24, 17);
}

function windowTexture(kind: WindowKind) {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = kind === "about" ? 420 : 416;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Classic Macintosh windows require a 2D drawing surface.");
  c.imageSmoothingEnabled = false; c.textBaseline = "alphabetic";
  if (kind === "finder") finder(c, canvas.width, canvas.height);
  else if (kind === "simpletext") simpleText(c, canvas.width, canvas.height);
  else about(c, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.name = `classic-macintosh / ${kind}`;
  texture.colorSpace = SRGBColorSpace; texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** A reversible, scroll-driven desk: open three familiar windows, then file them away. */
export function ClassicWindows(props: ForegroundProps) {
  const windows = useRef<(Group | null)[]>([]);
  const resources = useMemo(() => {
    const kinds: WindowKind[] = ["finder", "simpletext", "about"];
    return kinds.map(kind => {
      const texture = windowTexture(kind);
      const width = kind === "finder" ? 3.1 : kind === "simpletext" ? 3.0 : 2.9;
      const height = width * texture.image.height / texture.image.width;
      const geometry = new PlaneGeometry(width, height);
      const edgeGeometry = new BoxGeometry(width + .035, height + .035, .052);
      // Paper stays below the CRT bloom threshold; its black pixel ink remains crisp.
      const face = new MeshBasicNodeMaterial({ map: texture, color: "#b8c0b1", transparent: true, side: DoubleSide, toneMapped: false });
      const edge = new MeshBasicNodeMaterial({ color: "#52574e", transparent: true, toneMapped: false });
      const shadow = new MeshBasicNodeMaterial({ color: "#050906", transparent: true, depthWrite: false });
      return { kind, texture, geometry, edgeGeometry, face, edge, shadow };
    });
  }, []);
  useEffect(() => () => resources.forEach(resource => {
    resource.texture.dispose(); resource.geometry.dispose(); resource.edgeGeometry.dispose();
    resource.face.dispose(); resource.edge.dispose(); resource.shadow.dispose();
  }), [resources]);

  const root = useForegroundFrame(props, ({ travel, alpha, width, mobile }) => {
    const compact = mobile || width < 6;
    const spread = Math.min(width / 2 - 2.02, 3.5);
    resources.forEach((resource, i) => {
      const window = windows.current[i];
      if (!window) return;
      const open = MathUtils.smootherstep(travel, i * .065, .30 + i * .075);
      const archive = MathUtils.smootherstep(travel, .68 + i * .06, .90 + i * .04);
      const initialX = compact ? .08 : Math.max(1.7, spread * .83);
      const destinationX = compact ? [.12, -.12, .34][i]! : [spread, -spread, spread - .32][i]!;
      const destinationY = compact ? [1.65, -1.72, .23][i]! : [1.11, -.44, -1.62][i]!;
      const desktopScale = i === 2 ? .82 : 1;
      const size = compact ? [ .62, .61, .44 ][i]! : desktopScale;
      const fanX = MathUtils.lerp(initialX + i * .09, destinationX, open);
      const fanY = MathUtils.lerp(.38 - i * .14, destinationY, open);
      window.position.set(
        MathUtils.lerp(fanX, 0, archive),
        MathUtils.lerp(fanY, -.12, archive),
        .20 + i * .18 + Math.sin(open * Math.PI) * .55 + archive * .45,
      );
      window.rotation.set(
        MathUtils.lerp(-.12, i === 1 ? .035 : -.045, open) * (1 - archive),
        MathUtils.lerp(-.42, i === 1 ? .18 : -.19, open) * (1 - archive),
        MathUtils.lerp(-.11 + i * .045, [ .035, -.065, .095 ][i]!, open) * (1 - archive),
      );
      window.scale.setScalar(size * MathUtils.lerp(.67, 1, open) * MathUtils.lerp(1, .16, archive));
      const opacity = alpha * (1 - MathUtils.smoothstep(archive, .69, 1));
      window.visible = opacity > .002;
      resource.face.opacity = opacity;
      resource.edge.opacity = opacity;
      resource.shadow.opacity = opacity * .47;
    });
  });

  return <group ref={root} name="foreground-macos" visible={false} userData={{ itemCount: 3 }} dispose={null}>
    {resources.map((resource, i) => <group key={resource.kind} ref={node => { windows.current[i] = node; }} name={`mac-window-${resource.kind}`}>
      <mesh geometry={resource.geometry} material={resource.shadow} position={[.075, -.095, -.08]} />
      <mesh geometry={resource.edgeGeometry} material={resource.edge} />
      <mesh geometry={resource.geometry} material={resource.face} position={[0, 0, .028]} />
    </group>)}
  </group>;
}
