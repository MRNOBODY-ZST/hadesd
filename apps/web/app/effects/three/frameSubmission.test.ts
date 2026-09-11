import { describe, expect, it } from "vitest";
import { shouldSubmitFrame, type FrameSubmission } from "./frameSubmission";

const frame: FrameSubmission = {
  nowMs: 30_001,
  previousMs: 30_000,
  frameRateTarget: 30,
  demand: false,
  phaseChanged: false,
  textureDirty: false,
  hidden: false,
};

describe("pipeline frame submission", () => {
  it("honors each demand invalidation even when Fiber resets its clock on a mode switch", () => {
    expect(shouldSubmitFrame({ ...frame, nowMs: 1, demand: true })).toBe(true);
    expect(shouldSubmitFrame({ ...frame, demand: true })).toBe(true);
  });

  it("submits the final phase and changed text without waiting for another invalidation", () => {
    expect(shouldSubmitFrame({ ...frame, phaseChanged: true })).toBe(true);
    expect(shouldSubmitFrame({ ...frame, textureDirty: true })).toBe(true);
  });

  it("still caps unchanging continuous animation at the selected frame rate", () => {
    expect(shouldSubmitFrame(frame)).toBe(false);
    expect(shouldSubmitFrame({ ...frame, nowMs: 30_034 })).toBe(true);
    expect(shouldSubmitFrame({ ...frame, nowMs: 30_008, frameRateTarget: 120 })).toBe(true);
    expect(shouldSubmitFrame({ ...frame, nowMs: 30_008, frameRateTarget: 60 })).toBe(false);
  });

  it("never submits a hidden scene, including dirty demand frames", () => {
    expect(shouldSubmitFrame({ ...frame, hidden: true, demand: true, textureDirty: true, phaseChanged: true })).toBe(false);
  });
});
