export interface FrameSubmission {
  nowMs: number;
  previousMs: number;
  frameRateTarget: number;
  demand: boolean;
  phaseChanged: boolean;
  textureDirty: boolean;
  hidden: boolean;
}

/** A requested demand frame is work, not a continuous animation tick to drop. */
export function shouldSubmitFrame(frame: FrameSubmission): boolean {
  if (frame.hidden) return false;
  return frame.demand || frame.phaseChanged || frame.textureDirty ||
    frame.nowMs - frame.previousMs >= 1000 / frame.frameRateTarget - 0.8;
}
