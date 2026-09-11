import { CanvasTexture, LinearFilter, SRGBColorSpace, type Node } from "three/webgpu";
import { float, floor, fract, mix, sin, step, texture as sampleTexture, uniform, vec2, vec3 } from "three/tsl";
import { BOOT_GUI_START, BOOT_POST_START, BOOT_TRANSITION_START, type IntroPhase } from "../timeline";
import { advanceScreenClock, createScreenOrder, screenFrameAt, SCREEN_PRESETS } from "./screenPresets";

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

const postLines = [
  "HADESD BIOS 05.00", "Copyright (C) HADESD SYSTEMS", "",
  "VIDEO ADAPTER ................. SIGNAL LOCKED",
  "PHOSPHOR GRID ................. READY",
  "CHARACTER ROM ................. READY",
  "KEYBOARD CONTROLLER ........... READY", "",
  "Scanning boot devices...", "  A:  ROM DRIVE", "  C:  SYSTEM VOLUME", "",
  "C:\\> CONFIG.SYS", "DEVICE=DISPLAY.SYS /CRT", "DEVICE=KEYBOARD.SYS",
  "BUFFERS=32", "FILES=64", "SHELL=HADESD.EXE", "",
  "C:\\> AUTOEXEC.BAT", "@ECHO OFF", "PATH C:\\SYSTEM;C:\\TOOLS",
  "SET TERM=HADESD-CRT", "SET COLOR=PHOSPHOR", "",
  "Loading text services ........ READY", "Loading screen buffers ....... READY",
  "Linking command interpreter .. READY", "Checking signal timing ....... READY", "",
  "C:\\> WIN HADESD", "Switching display mode...",
];

/** Immutable DOS, GUI and numeral atlases; every animated pixel is shader driven. */
export function createBootTexture() {
  const result = canvasTexture(1440, 900);
  const dos = canvasTexture(1440, 1440), digits = canvasTexture(180, 28);
  const progress = uniform(0), sequence = uniform(1);
  const c = result.context;
  c.fillStyle = "#28218e"; c.fillRect(0, 0, 1440, 900);
  c.fillStyle = "#e1e0bd"; c.strokeStyle = "#e1e0bd"; c.lineWidth = 5;
  c.strokeRect(198, 142, 154, 116);
  c.fillRect(254, 264, 42, 13); c.fillRect(226, 279, 100, 9);
  for (let i = 0; i < 8; i++) c.fillRect(180 - i * 3, 153 + i * 13, 150 + i * 3, 5);
  c.font = "italic bold 132px Georgia, serif"; c.textAlign = "left";
  c.fillText("HADESD", 399, 267);
  c.textAlign = "center"; c.font = "bold 27px 'Courier New', monospace";
  c.fillText("TERMINAL SYSTEM / BOOT MANAGER", 720, 365);
  c.font = "25px 'Courier New', monospace"; c.fillText("Version 05.00", 720, 405);
  c.lineWidth = 3; c.strokeRect(420, 486, 600, 49);
  c.textAlign = "left"; c.textBaseline = "top"; c.font = "18px 'Courier New', monospace";
  c.fillText("%", 999, 547);
  c.font = "20px 'Courier New', monospace";
  ["DISPLAY ADAPTER ................ OK", "MEMORY MAP ..................... OK", "KEYBOARD CONTROLLER ............ OK",
    "LOADING HADESD.SYS .............. OK", "C:\\> START TERMINAL.EXE"].forEach((line, index) => c.fillText(line, 420, 590 + index * 29));
  c.textAlign = "center"; c.fillText("HADESD SYSTEMS", 720, 815);
  const d = dos.context;
  d.fillStyle = "#030808"; d.fillRect(0, 0, 1440, 1440);
  d.fillStyle = "#c8d8c8"; d.font = "24px 'Courier New', monospace"; d.textBaseline = "top";
  postLines.forEach((line, index) => d.fillText(line, 88, 70 + index * 36));
  const n = digits.context;
  n.clearRect(0, 0, 180, 28); n.fillStyle = "#e1e0bd";
  n.font = "18px 'Courier New', monospace"; n.textAlign = "center"; n.textBaseline = "top";
  for (let i = 0; i < 10; i++) n.fillText(String(i), i * 18 + 9, 1);
  result.texture.needsUpdate = true;
  dos.texture.needsUpdate = true; digits.texture.needsUpdate = true;
  const sampleColor = (coordinate: Node<"vec2">) => {
    const x = coordinate.x.mul(1440), top = coordinate.y.oneMinus().mul(900);
    const guiBase = sampleTexture(result.texture, coordinate).rgb;
    const row = floor(top.sub(590).div(29));
    const statusArea = step(420, x).mul(step(x, 1100)).mul(step(590, top)).mul(step(top, 735));
    const statusVisible = step(row, floor(progress.mul(4)));
    let gui = mix(guiBase, vec3(.0212, .0152, .2705), statusArea.mul(statusVisible.oneMinus()));
    const barX = x.sub(426).div(23.5);
    const blocks = step(0, barX).mul(step(barX, floor(progress.mul(25))))
      .mul(step(fract(barX), 18 / 23.5)).mul(step(492, top)).mul(step(top, 529));
    gui = mix(gui, vec3(.7529, .7454, .5089), blocks);
    const percent = floor(progress.mul(100).add(.001)), cell = floor(x.sub(944).div(18)).clamp(0, 2);
    const divisor = mix(mix(float(100), float(10), step(1, cell)), float(1), step(2, cell));
    const digit = floor(percent.div(divisor)).mod(10);
    const number = sampleTexture(digits.texture, vec2(digit.add(fract(x.sub(944).div(18))).div(10), float(1).sub(top.sub(546).div(28))));
    const numberArea = step(944, x).mul(step(x, 998)).mul(step(546, top)).mul(step(top, 574));
    const numberVisible = step(1, cell).max(step(99.5, percent));
    gui = mix(gui, number.rgb, number.a.mul(numberArea).mul(numberVisible));
    const post = sequence.sub(BOOT_POST_START).div(BOOT_TRANSITION_START - BOOT_POST_START).clamp(0, 1);
    const scroll = floor(post.mul(postLines.length)).sub(20).max(0).mul(36);
    const documentY = top.add(scroll), dosRow = floor(documentY.sub(70).div(36));
    const character = dosRow.mul(80).add(floor(x.sub(88).div(14.4)));
    const reveal = step(character, floor(post.mul(postLines.length * 80)));
    const dosColor = sampleTexture(dos.texture, vec2(coordinate.x, float(1).sub(documentY.div(1440)))).rgb.mul(reveal);
    const transition = sequence.sub(BOOT_TRANSITION_START).div(BOOT_GUI_START - BOOT_TRANSITION_START).clamp(0, 1);
    const flash = sin(transition.mul(Math.PI)).pow(4).mul(.92);
    const startup = mix(dosColor, vec3(.72, .85, 1), flash);
    const visible = step(BOOT_POST_START, sequence);
    return mix(startup, gui, step(BOOT_GUI_START, sequence)).mul(visible);
  };
  const paint = (value: number, phase: IntroPhase = "terminal", phaseProgress = 1) => {
    progress.value = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    sequence.value = phase === "boot" ? Math.max(0, Math.min(1, phaseProgress)) : 1;
  };
  return { texture: result.texture, progress, sequence, paint, sampleColor,
    dispose() { result.texture.dispose(); dos.texture.dispose(); digits.texture.dispose(); } };
}

export function createMacScreenTexture() {
  const columns = 4, rows = 2, width = 800, height = 600;
  const result = canvasTexture(columns * width, rows * height), c = result.context;
  SCREEN_PRESETS.forEach((screen, index) => {
    c.save(); c.translate(index % columns * width, Math.floor(index / columns) * height);
    c.fillStyle = "#06100d"; c.fillRect(0, 0, width, height);
    c.textAlign = "left"; c.textBaseline = "top"; c.fillStyle = "#668875";
    c.font = "16px 'Courier New', monospace"; c.fillText(screen.title, 40, 26);
    c.fillRect(40, 52, 720, 1);
    c.font = `${index === 0 ? 28 : 20}px 'Courier New', monospace`;
    screen.lines.forEach((line, row) => { c.fillStyle = line.color ?? "#b6d6ad"; c.fillText(line.text, 40, 76 + row * (index === 0 ? 38 : 27)); });
    c.fillStyle = "#668875"; c.font = "13px 'Courier New', monospace";
    c.fillText(`HADESD / ${String(index + 1).padStart(2, "0")}`, 40, 573);
    c.restore();
  });
  result.texture.needsUpdate = true;
  const preset = uniform(0), reveal = uniform(-1), seconds = uniform(0), faceMix = uniform(0);
  const order = createScreenOrder(Math.floor(Math.random() * 0xffffffff));
  let clockState: { last: number | null; elapsed: number } = { last: null, elapsed: 0 };
  const update = (elapsed: number, visible = true) => {
    clockState = advanceScreenClock(clockState, elapsed, visible);
    if (!visible) return;
    const next = screenFrameAt(clockState.elapsed, order);
    preset.value = next.preset; reveal.value = next.reveal; faceMix.value = next.faceMix; seconds.value = clockState.elapsed;
  };
  const sampleColor = (coordinate: Node<"vec2">) => {
    // Barrel distortion and RGB separation may cross a tile boundary. Keep
    // filtered samples inside this preset while retaining original layout UVs.
    const local = coordinate.clamp(vec2(.5 / width, .5 / height), vec2(1 - .5 / width, 1 - .5 / height));
    const atlasUv = vec2(preset.mod(columns).add(local.x).div(columns), float(rows - 1).sub(floor(preset.div(columns))).add(local.y).div(rows));
    const source = sampleTexture(result.texture, atlasUv).rgb;
    const x = coordinate.x.mul(width), top = coordinate.y.oneMinus().mul(height);
    const prominent = step(.5, preset).oneMinus();
    const cellWidth = mix(float(12), float(16.8), prominent), rowHeight = mix(float(27), float(38), prominent);
    const row = floor(top.sub(76).div(rowHeight)), column = floor(x.sub(40).div(cellWidth));
    const textArea = step(40, x).mul(step(x, 760)).mul(step(76, top)).mul(step(top, 562));
    const character = row.mul(60).add(column), ink = step(character, reveal);
    const background = vec3(.0018, .0052, .004);
    const content = mix(source, background, textArea.mul(ink.oneMinus()));
    const cursorIndex = reveal.add(1), cursorRow = floor(cursorIndex.div(60)), cursorColumn = cursorIndex.mod(60);
    const cursorX = cursorColumn.mul(cellWidth).add(40), cursorY = cursorRow.mul(rowHeight).add(76);
    const cursorArea = step(cursorX, x).mul(step(x, cursorX.add(mix(float(10), float(14), prominent)))).mul(step(cursorY, top)).mul(step(top, cursorY.add(mix(float(21), float(30), prominent))));
    const blink = step(0, sin(seconds.mul(5.5)));
    return mix(content, vec3(.466, .673, .417), cursorArea.mul(blink));
  };
  return { texture: result.texture, cursor: [40 / width, 1 - 97 / height, 10 / width, 21 / height] as const,
    uniforms: { preset, reveal, seconds }, faceMix, update, sampleColor, dispose() { result.texture.dispose(); } };
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
