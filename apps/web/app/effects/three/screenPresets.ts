export type ScreenLine = { text: string; color?: string };
export type ScreenPreset = { id: string; title: string; lines: ScreenLine[]; face?: boolean };
const command = (text: string): ScreenLine => ({ text, color: "#e5d4a2" });
const output = (text: string): ScreenLine => ({ text, color: "#9bd8c8" });
const prompt = "hades@macintosh ~ %";
export const SCREEN_PRESETS: ScreenPreset[] = [
  { id: "prompt", title: "COMMAND LINE", lines: [
    command(`${prompt} help`),
    output("help   ls   open <file>"),
    output("search <keyword>   display   reboot"),
    { text: "" },
    command(`${prompt} ls`),
    output("posts/       projects/     research/"),
    output("about.md     now.md        links.json"),
    { text: "" }, command(prompt),
  ] },
  { id: "squares", title: "PYTHON / INTEGER STUDY", lines: [
    command(`${prompt} python3 - <<'PY'`),
    { text: "for n in range(1, 7):" },
    { text: "    print(f\"{n:2}  {'#' * n:<6}  {n*n:2}\")" },
    { text: "PY" },
    ...Array.from({ length: 6 }, (_, i) => { const n = i + 1; return output(`${String(n).padStart(2)}  ${"#".repeat(n).padEnd(6)}  ${String(n * n).padStart(2)}`); }),
    command(prompt),
  ] },
  { id: "ansi", title: "ANSI / COLOR STUDY", lines: [
    command(`${prompt} printf '\\033[36mCYAN\\033[0m\\n'`),
    { text: "CYAN", color: "#70dce8" },
    command("for c in 31 32 33 34 35 36; do"),
    { text: "  printf '\\033[%sm##########\\033[0m\\n' \"$c\"" },
    { text: "done" },
    ...["#f07777", "#9cdb8a", "#e5d174", "#879bf0", "#d698d7", "#70dce8"].map(color => ({ text: "##########", color })),
    command(prompt),
  ] },
  { id: "sine", title: "PYTHON / WAVE STUDY", lines: [
    command(`${prompt} python3 - <<'PY'`),
    { text: "from math import sin" },
    { text: "for i in range(10):" },
    { text: "    print(' ' * (12 + round(10*sin(i/2))) + '*')" },
    { text: "PY" },
    ...Array.from({ length: 10 }, (_, i) => output(" ".repeat(12 + Math.round(10 * Math.sin(i / 2))) + "*")),
    command(prompt),
  ] },
  { id: "binary", title: "PYTHON / BINARY STUDY", lines: [
    command(`${prompt} python3 - <<'PY'`),
    { text: "for n in range(8):" },
    { text: "    print(f'{n:2}  {n:08b}')" },
    { text: "PY" },
    ...Array.from({ length: 8 }, (_, n) => output(`${String(n).padStart(2)}  ${n.toString(2).padStart(8, "0")}`)),
    command(prompt),
  ] },
  { id: "matrix", title: "PYTHON / MATRIX STUDY", lines: [
    command(`${prompt} python3 - <<'PY'`),
    { text: "a = [[1, 2], [3, 4]]" },
    { text: "b = [[2, 0], [1, 2]]" },
    { text: "for row in a:" },
    { text: "    print([sum(x*y for x,y in zip(row,col))" },
    { text: "           for col in zip(*b)])" },
    { text: "PY" }, output("[4, 4]"), output("[10, 8]"),
    { text: "" }, command(prompt),
  ] },
  { id: "triangle", title: "PYTHON / PASCAL STUDY", lines: [
    command(`${prompt} python3 - <<'PY'`),
    { text: "from math import comb" },
    { text: "for n in range(6):" },
    { text: "    print(' '.join(str(comb(n,k)) for k in range(n+1)))" },
    { text: "PY" },
    ...["1", "1 1", "1 2 1", "1 3 3 1", "1 4 6 4 1", "1 5 10 10 5 1"].map(output),
    command(prompt),
  ] },
  { id: "face", title: "MACINTOSH", face: true, lines: [{ text: "" }] },
];

/** Prompt first, then a shuffled set of self-contained local screen studies. */
export function createScreenOrder(seed: number): number[] {
  let value = (seed >>> 0) || 0x6d2b79f5;
  const order = SCREEN_PRESETS.map((_, index) => index);
  for (let i = order.length - 1; i > 1; i--) {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    const j = 1 + (value >>> 0) % i;
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

export function screenFrameAt(elapsed: number, order: readonly number[]) {
  const time = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const preset = order[Math.floor(time / 8) % Math.max(1, order.length)] ?? 0;
  const data = SCREEN_PRESETS[preset] ?? SCREEN_PRESETS[0]!;
  const total = data.lines.reduce((count, line) => count + Math.max(1, line.text.length), 0);
  let remaining = Math.floor(Math.min(1, (time % 8) / 5.5) * total), reveal = -1;
  for (let row = 0; row < data.lines.length; row++) {
    const length = Math.max(1, data.lines[row]!.text.length);
    reveal = row * 60 + Math.min(length, remaining) - 1;
    if (remaining < length) break;
    remaining -= length;
  }
  return { preset, reveal, faceMix: data.face ? 1 : 0 };
}

export function advanceScreenClock(state: { last: number | null; elapsed: number }, now: number, visible: boolean) {
  const last = Number.isFinite(now) ? now : state.last ?? 0;
  const delta = state.last === null ? 0 : Math.max(0, Math.min(.25, last - state.last));
  return { last, elapsed: state.elapsed + (visible ? delta : 0) };
}
