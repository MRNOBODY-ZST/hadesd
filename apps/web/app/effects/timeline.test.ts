import { expect, it } from "vitest";
import {
  BOOT_DURATION_MS,
  BOOT_CRT_WARMUP_MS,
  BOOT_POST_DURATION_MS,
  BOOT_GUI_TRANSITION_MS,
  BOOT_GUI_DURATION_MS,
  BOOT_POST_START,
  BOOT_TRANSITION_START,
  BOOT_GUI_START,
  bootSegmentsAt,
  bootProgressAt,
  clampProgress,
  easeJourney,
  createRevealSchedule,
  isTimedPhase,
  nextTimedPhase,
  revealStepAt,
  timedPhaseDuration,
  keyStep,
  phaseForJourney,
  touchStep,
  wheelStep,
} from "./timeline";

it("pauses the first boot at 80% and user travel leads to resume rather than a ready terminal", () => {
  expect(bootProgressAt(0)).toBe(0);
  expect(bootProgressAt(BOOT_GUI_START * BOOT_DURATION_MS + BOOT_GUI_DURATION_MS / 2)).toBeCloseTo(0.4);
  expect(bootProgressAt(BOOT_DURATION_MS + 10000)).toBe(0.8);
  expect(phaseForJourney(0)).toBe("hero");
  expect(easeJourney(0, 0, 60000)).toBe(0);
  expect(phaseForJourney(0.35)).toBe("journey");
  expect(phaseForJourney(1)).toBe("resume");
});
it("normalizes wheels, touch swipes and keyboard travel in both directions", () => {
  expect(wheelStep(160, 0, 800)).toBeCloseTo(wheelStep(10, 1, 800));
  expect(wheelStep(800, 0, 800)).toBe(wheelStep(1, 2, 800));
  expect(wheelStep(-160, 0, 800)).toBe(-wheelStep(160, 0, 800));
  expect(touchStep(200, 800)).toBeGreaterThan(0);
  expect(touchStep(-200, 800)).toBe(-touchStep(200, 800));
  expect(keyStep("ArrowDown")).toBe(0.04);
  expect(keyStep("PageDown")).toBe(0.12);
  expect(keyStep(" ", true)).toBe(-0.12);
  expect(keyStep("PageUp")).toBe(-0.12);
  expect(keyStep("x")).toBeNull();
});
it("keeps signal portals under scroll control until crossing, then continues the terminal reveal", () => {
  expect(phaseForJourney(0, true)).toBe("hero");
  expect(phaseForJourney(.52, true)).toBe("journey");
  expect(phaseForJourney(.999, true)).toBe("journey");
  expect(phaseForJourney(1, true)).toBe("reveal");
  expect(nextTimedPhase("reveal")).toBe("terminal");
  expect(phaseForJourney(1, false)).toBe("resume");
});
it("holds a black CRT, scrolls POST, then flashes to GUI before its progress bar begins", () => {
  expect(BOOT_DURATION_MS).toBe(5000);
  expect(BOOT_CRT_WARMUP_MS + BOOT_POST_DURATION_MS + BOOT_GUI_TRANSITION_MS + BOOT_GUI_DURATION_MS).toBe(BOOT_DURATION_MS);
  expect(bootSegmentsAt(0).segment).toBe("warmup");
  expect(bootSegmentsAt((BOOT_CRT_WARMUP_MS - 1) / BOOT_DURATION_MS)).toMatchObject({ segment: "warmup", post: 0, transition: 0, gui: 0 });
  expect(bootSegmentsAt(BOOT_POST_START)).toMatchObject({ segment: "post", warmup: 1, post: 0, gui: 0 });
  expect(bootSegmentsAt(BOOT_TRANSITION_START)).toMatchObject({ segment: "transition", post: 1, transition: 0, gui: 0 });
  expect(bootSegmentsAt(BOOT_GUI_START)).toMatchObject({ segment: "gui", transition: 1, gui: 0 });
  expect(bootSegmentsAt(1)).toMatchObject({ segment: "gui", gui: 1 });
  expect(bootProgressAt(BOOT_GUI_START * BOOT_DURATION_MS)).toBe(0);
  expect(bootProgressAt(BOOT_CRT_WARMUP_MS + BOOT_POST_DURATION_MS / 2)).toBe(0);
});
it("keeps a wheel notch subtle and bounds even a very large wheel or keyboard event", () => {
  expect(wheelStep(120, 0, 900)).toBeGreaterThan(0.01);
  expect(wheelStep(120, 0, 900)).toBeLessThan(0.025);
  expect(wheelStep(10000, 0, 900)).toBeLessThanOrEqual(0.06);
  expect(wheelStep(-10000, 0, 900)).toBeGreaterThanOrEqual(-0.06);
  expect(keyStep("End")).toBe(0.12);
  expect(keyStep("Home")).toBe(-0.12);
  expect(touchStep(900, 900)).toBeLessThanOrEqual(0.12);
});
it("smooths toward a fixed user destination and can reverse fully to hero", () => {
  let progress = 0;
  for (let i = 0; i < 150; i++) progress = easeJourney(progress, 0.6, 16);
  expect(progress).toBe(0.6);
  expect(easeJourney(progress, 0.6, 60000)).toBe(0.6);
  for (let i = 0; i < 150; i++) progress = easeJourney(progress, 0, 16);
  expect(progress).toBe(0);
  expect(phaseForJourney(progress)).toBe("hero");
  for (let i = 0; i < 150; i++) progress = easeJourney(progress, 1, 16);
  expect(progress).toBe(1);
  expect(clampProgress(-0.3)).toBe(0);
  expect(clampProgress(1.8)).toBe(1);
});

it("uses separate bounded phase clocks, with no timer for the stationary hero or scroll journey", () => {
  expect(nextTimedPhase("boot")).toBe("pullback");
  expect(nextTimedPhase("pullback")).toBe("hero");
  expect(nextTimedPhase("resume")).toBe("penetrate");
  expect(nextTimedPhase("penetrate")).toBe("reveal");
  expect(nextTimedPhase("reveal")).toBe("terminal");
  expect(isTimedPhase("hero")).toBe(false);
  expect(isTimedPhase("journey")).toBe(false);
  expect(timedPhaseDuration("boot", [])).toBe(5000);
  expect(timedPhaseDuration("pullback", [])).toBe(1800);
  expect(timedPhaseDuration("resume", [])).toBe(1300);
  expect(timedPhaseDuration("penetrate", [])).toBe(1100);
});
it("reveals seven groups with bounded irregular intervals and a final readable settling beat", () => {
  const random = [0, .7, .2, 1, .4, .8, .1];
  let index = 0;
  const schedule = createRevealSchedule(() => random[index++]!);
  expect(schedule).toHaveLength(7);
  expect(new Set(schedule.map((time, i) => time - (schedule[i - 1] ?? 0))).size).toBeGreaterThan(1);
  expect(revealStepAt(0, schedule)).toBe(0);
  schedule.forEach((time, i) => {
    expect(revealStepAt(time - 1, schedule)).toBe(i);
    expect(revealStepAt(time, schedule)).toBe(i + 1);
    expect(time - (schedule[i - 1] ?? 0)).toBeGreaterThanOrEqual(70);
    expect(time - (schedule[i - 1] ?? 0)).toBeLessThanOrEqual(120);
  });
  expect(timedPhaseDuration("reveal", schedule)).toBe(schedule[6]! + 100);
  expect(timedPhaseDuration("reveal", createRevealSchedule(() => 0))).toBeGreaterThanOrEqual(590);
  expect(timedPhaseDuration("reveal", createRevealSchedule(() => 1))).toBeLessThanOrEqual(940);
});
