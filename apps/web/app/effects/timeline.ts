export type IntroPhase =
  | "boot"
  | "pullback"
  | "hero"
  | "journey"
  | "resume"
  | "penetrate"
  | "reveal"
  | "terminal";
export type TimedIntroPhase = "boot" | "pullback" | "resume" | "penetrate" | "reveal";
export const BOOT_DURATION_MS = 2600;
export const PULLBACK_DURATION_MS = 2200;
export const RESUME_DURATION_MS = 1300;
export const PENETRATE_DURATION_MS = 1100;
export const REVEAL_GROUP_COUNT = 7;
export const REVEAL_SETTLE_MS = 100;
export const clampProgress = (value: number) =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export const bootProgressAt = (elapsed: number) =>
  clampProgress(elapsed / BOOT_DURATION_MS) * 0.8;
export const phaseForJourney = (progress: number): IntroPhase =>
  progress >= 1 ? "resume" : progress <= 0 ? "hero" : "journey";
export function isTimedPhase(phase: IntroPhase): phase is TimedIntroPhase {
  return ["boot", "pullback", "resume", "penetrate", "reveal"].includes(phase);
}
export function timedPhaseDuration(phase: TimedIntroPhase, revealSchedule: readonly number[]) {
  switch (phase) {
    case "boot": return BOOT_DURATION_MS;
    case "pullback": return PULLBACK_DURATION_MS;
    case "resume": return RESUME_DURATION_MS;
    case "penetrate": return PENETRATE_DURATION_MS;
    case "reveal": return (revealSchedule.at(-1) ?? 1680) + REVEAL_SETTLE_MS;
  }
}
export function nextTimedPhase(phase: TimedIntroPhase): IntroPhase {
  switch (phase) {
    case "boot": return "pullback";
    case "pullback": return "hero";
    case "resume": return "penetrate";
    case "penetrate": return "reveal";
    case "reveal": return "terminal";
  }
}
/** Seven real DOM reveals; fresh bounded jitter on each boot, never a random render. */
export function createRevealSchedule(random: () => number = Math.random): number[] {
  let elapsed = 0;
  return Array.from({ length: REVEAL_GROUP_COUNT }, () =>
    (elapsed += 190 + Math.floor(clampProgress(random()) * 70)),
  );
}
export const revealStepAt = (elapsed: number, schedule: readonly number[]) =>
  schedule.filter((time) => elapsed >= time).length;

export function wheelStep(
  delta: number,
  deltaMode: number,
  viewportHeight: number,
) {
  const pixels =
    delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? viewportHeight : 1);
  return Math.max(
    -0.45,
    Math.min(0.45, pixels / Math.max(1200, viewportHeight * 2.1)),
  );
}
export function touchStep(distance: number, viewportHeight: number) {
  return Math.max(
    -0.45,
    Math.min(0.45, distance / Math.max(600, viewportHeight * 1.2)),
  );
}
export function keyStep(key: string, shift = false): number | null {
  switch (key) {
    case "ArrowDown":
      return 0.12;
    case "ArrowUp":
      return -0.12;
    case "PageDown":
      return 0.24;
    case "PageUp":
      return -0.24;
    case " ":
      return shift ? -0.24 : 0.24;
    case "Home":
      return -1;
    case "End":
      return 1;
    default:
      return null;
  }
}
export function easeJourney(current: number, target: number, elapsed: number) {
  const destination = clampProgress(target);
  if (Math.abs(destination - current) < 0.001) return destination;
  const next =
    current +
    (destination - current) *
      (1 - Math.exp(-Math.min(64, Math.max(0, elapsed)) / 135));
  return Math.abs(destination - next) < 0.001
    ? destination
    : clampProgress(next);
}
