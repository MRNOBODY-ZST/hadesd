import type { IntroPhase } from "../timeline";
import { MAC_SCREEN_HANDOFF } from "./screenProjection";

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, value: number) => { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Shared boundary envelopes: the next scene starts at the previous scene's exact endpoint. */
export function sceneMotion(phase: IntroPhase, t: number, p: number) {
  const pull = smooth(0, 1, t);
  const framed = phase === "boot" ? 0 : phase === "pullback" ? 1 - Math.pow(1 - pull, 2)
    : phase === "journey" ? 1 - smooth(0, MAC_SCREEN_HANDOFF, p) : 1;
  // Reuse the live boot signal on both physical glass and the returning card.
  const bootMix = ["boot", "resume", "penetrate"].includes(phase) ? 1
    : phase === "pullback" ? 1 - smooth(.64, .99, t)
      : phase === "journey" ? smooth(.83, .985, p) : 0;
  const acquisition = phase === "penetrate" ? smooth(.60, .94, t) : ["reveal", "terminal"].includes(phase) ? 1 : 0;
  const burst = phase === "pullback" ? Math.sin(Math.PI * clamp(t)) ** 2
    : 0;
  // Restore the continuous push through the last card; keep it in front of the
  // near plane until transparent, without pulsing its height or flashing it.
  const entryDepth = phase === "penetrate" ? 9.8 * smooth(0, 1, t) : 0;
  // The ground, reflection and fog belong to the physical Mac. Once inside its
  // screen, keep them hidden: the ground otherwise cuts across the carousel.
  const worldAlpha = phase === "pullback" ? framed : phase === "hero" ? 1
    : phase === "journey" ? 1 - smooth(.18, .265, p) : 0;
  return { framed, bootMix, burst, entryDepth, worldAlpha, bootAlpha: 1 - acquisition, terminalAlpha: acquisition };
}
/** Keep HiDPI buffers bounded without pretending to measure GPU utilization. */
export function scenePixelRatio(width: number, height: number, deviceRatio: number) {
  const budget = width < 700 ? 900_000 : 2_300_000;
  return Math.min(Math.max(.1, deviceRatio || 1), 1.65, Math.sqrt(budget / Math.max(1, width * height)));
}
