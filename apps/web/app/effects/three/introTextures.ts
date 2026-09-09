import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three/webgpu";

function canvasTexture(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The display requires a 2D text surface.");
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return { canvas, context, texture };
}

/** Original DOS title card; its progress describes this visual startup sequence. */
export function createBootTexture() {
  const result = canvasTexture(1440, 900);
  let last = -1;
  const paint = (progress: number) => {
    const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    const step = Math.floor(percent / 100 * 25);
    if (percent === last) return;
    last = percent;
    const c = result.context;
    c.fillStyle = "#28218e"; c.fillRect(0, 0, 1440, 900);
    c.fillStyle = "#e1e0bd"; c.strokeStyle = "#e1e0bd";
    c.lineWidth = 5;
    // A striped display glyph, authored here rather than borrowed branding.
    c.strokeRect(198, 142, 154, 116);
    c.fillRect(254, 264, 42, 13); c.fillRect(226, 279, 100, 9);
    for (let i = 0; i < 8; i++) c.fillRect(180 - i * 3, 153 + i * 13, 150 + i * 3, 5);
    c.font = "italic bold 132px Georgia, serif"; c.textAlign = "left";
    c.fillText("HADESD", 399, 267);
    c.textAlign = "center"; c.font = "bold 27px 'Courier New', monospace";
    c.fillText("PERSONAL COMPUTER / TERMINAL SYSTEM", 720, 365);
    c.font = "25px 'Courier New', monospace"; c.fillText("Version 04.00", 720, 405);
    c.lineWidth = 3; c.strokeRect(420, 486, 600, 49);
    for (let i = 0; i < step; i++) c.fillRect(426 + i * 23.5, 492, 18, 37);
    c.textAlign = "right"; c.font = "18px 'Courier New', monospace";
    c.fillText(`${String(percent).padStart(2, '0')}%`, 1019, 568);
    const messages = ["DISPLAY ADAPTER ................ OK", "MEMORY MAP ..................... OK", "KEYBOARD CONTROLLER ............ OK", "LOADING HADESD.SYS .............. OK", percent < 100 ? "C:\\> LINKING TERMINAL..." : "C:\\> PERSONAL COMPUTING, READY_"];
    c.textAlign = "left"; c.font = "20px 'Courier New', monospace";
    messages.slice(0, Math.min(5, 1 + Math.floor(step / 5))).forEach((line, i) => c.fillText(line, 420, 590 + i * 29));
    c.textAlign = "center"; c.font = "20px 'Courier New', monospace";
    c.fillText("HADESD SYSTEMS  •  HARDWARE / SOFTWARE / CURIOSITY", 720, 815);
    result.texture.needsUpdate = true;
  };
  paint(0);
  return { texture: result.texture, paint };
}

export function createMacScreenTexture() {
  const { context: c, texture } = canvasTexture(800, 600);
  c.fillStyle = "#06100d"; c.fillRect(0, 0, 800, 600);
  c.fillStyle = "#b6d6ad";
  c.textAlign = "left"; c.font = "32px 'Courier New', monospace";
  c.fillText("hades@macintosh ~ %", 70, 110);
  const cursorX = 70 + c.measureText("hades@macintosh ~ % ").width;
  texture.needsUpdate = true;
  return { texture, cursor: [cursorX / 800, (600 - 115) / 600, 18 / 800, 33 / 600] as const };
}

export function createGlyphAtlas() {
  const glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz$%&*+-:<=>?/[]{}░▒▓█";
  const columns = 16, rows = Math.ceil(glyphs.length / columns), cellWidth = 32, cellHeight = 44;
  const { context: c, texture } = canvasTexture(columns * cellWidth, rows * cellHeight);
  c.clearRect(0, 0, columns * cellWidth, rows * cellHeight);
  c.font = "bold 28px 'Courier New', monospace";
  c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "white";
  [...glyphs].forEach((glyph, index) => c.fillText(glyph, (index % columns + .5) * cellWidth, (Math.floor(index / columns) + .5) * cellHeight));
  texture.needsUpdate = true;
  return { texture, columns, rows, count: glyphs.length };
}
