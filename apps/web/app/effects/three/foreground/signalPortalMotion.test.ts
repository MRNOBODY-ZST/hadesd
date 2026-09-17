import { expect, it } from "vitest";
import { SIGNAL_PORTAL, signalPortalMotion } from "./signalPortalMotion";

it("turns exactly half a revolution counterclockwise after entering, then holds its upright face", () => {
  const entrance = signalPortalMotion(SIGNAL_PORTAL.appearEnd, 16 / 9).leader;
  expect(entrance.rotateZ).toBe(-Math.PI);
  let previousAngle = entrance.rotateZ;
  for (let index = 336; index <= 800; index++) {
    const angle = signalPortalMotion(index / 1000, 16 / 9).leader.rotateZ;
    // Positive world-Z rotation is counterclockwise to the camera looking down -Z.
    expect(angle).toBeGreaterThanOrEqual(previousAngle);
    expect(angle).toBeLessThanOrEqual(0);
    previousAngle = angle;
  }
  const aligned = signalPortalMotion(SIGNAL_PORTAL.alignedAt, 16 / 9).leader;
  expect(aligned.rotateZ - entrance.rotateZ).toBeCloseTo(Math.PI, 12);
  for (const p of [.8, .9, .955, .985, 1]) expect(signalPortalMotion(p, 16 / 9).leader.rotateZ).toBe(0);
  const { trailing } = signalPortalMotion(.7, 16 / 9);
  for (let index = 0; index < trailing.length; index++) {
    expect(trailing[index]!.rotateZ).toBeCloseTo(signalPortalMotion(.7 - .08 * (index + 1), 16 / 9).leader.rotateZ, 12);
  }
});

it("also flips vertically by 180 degrees, without restarting the flip during the approach", () => {
  const start = SIGNAL_PORTAL.appearEnd;
  const end = SIGNAL_PORTAL.alignedAt;
  expect(signalPortalMotion(start, 16 / 9).leader.rotateX).toBe(-Math.PI);
  expect(signalPortalMotion((start + end) / 2, 16 / 9).leader.rotateX).toBeCloseTo(-Math.PI / 2, 12);
  let previous = -Math.PI;
  for (let index = 336; index <= 800; index++) {
    const angle = signalPortalMotion(index / 1000, 16 / 9).leader.rotateX;
    expect(angle).toBeGreaterThanOrEqual(previous);
    expect(angle - previous).toBeLessThan(.02);
    previous = angle;
  }
  for (const p of [.8, .9, .955, .985, 1]) expect(signalPortalMotion(p, 16 / 9).leader.rotateX).toBe(0);
  const { trailing } = signalPortalMotion(.7, 16 / 9);
  trailing.forEach((pose, index) => {
    expect(pose.rotateX).toBeCloseTo(signalPortalMotion(.7 - .08 * (index + 1), 16 / 9).leader.rotateX, 12);
  });
});

it("fits narrow star apertures around all viewport corners before crossing the finite bore", () => {
  for (const radius of [.25, .3, .42, .6, .72]) {
    for (const aspect of [.2, 390 / 844, 1, 16 / 9, 32 / 9, 6]) {
      const motion = signalPortalMotion(SIGNAL_PORTAL.fillsViewportAt, aspect, radius);
      const { leader: pose } = motion;
      expect(motion.apertureCoversViewport).toBe(true);
      expect(motion.crossedCamera).toBe(false);
      for (const side of [-1, 1]) {
        const distance = -pose.z + side * SIGNAL_PORTAL.depth * pose.scale / 2;
        for (const x of [-1, 1]) for (const y of [-1, 1]) {
          const rayY = y * Math.tan(22 * Math.PI / 180);
          const rayX = x * Math.tan(22 * Math.PI / 180) * aspect;
          expect(Math.hypot(rayX * distance - pose.x, rayY * distance - pose.y)).toBeLessThan(radius * pose.scale);
        }
      }
      const finished = signalPortalMotion(SIGNAL_PORTAL.finishedAt, aspect, radius).leader;
      expect(finished.z - SIGNAL_PORTAL.depth * finished.scale / 2).toBeGreaterThan(0);
    }
  }
});

it("flies on a curved path from the distant upper-right to the near lower-left", () => {
  const start = signalPortalMotion(.3, 16 / 9).leader;
  const middle = signalPortalMotion(.475, 16 / 9).leader;
  const end = signalPortalMotion(.65, 16 / 9).leader;
  expect(start.x).toBeGreaterThan(0);
  expect(start.y).toBeGreaterThan(0);
  expect(end.x).toBeLessThan(0);
  expect(end.y).toBeLessThan(0);
  expect(start.z).toBeLessThan(middle.z);
  expect(middle.z).toBeLessThan(end.z);
  // Compare in screen space: the mid-arc is visibly bowed away from the chord.
  const screen = (pose: typeof start) => ({ x: pose.x / -pose.z, y: pose.y / -pose.z });
  const a = screen(start), b = screen(middle), c = screen(end);
  const distanceFromChord = Math.abs((c.x - a.x) * (a.y - b.y) - (a.x - b.x) * (c.y - a.y)) / Math.hypot(c.x - a.x, c.y - a.y);
  expect(distanceFromChord).toBeGreaterThan(.08);
});

it("covers every viewport corner through both ends of the opening before crossing the camera", () => {
  for (const aspect of [390 / 844, 1, 16 / 9, 21 / 9, 32 / 9, 6]) {
    const motion = signalPortalMotion(SIGNAL_PORTAL.fillsViewportAt, aspect);
    const pose = motion.leader;
    expect(pose.z).toBeLessThan(0);
    expect(pose.rotateX).toBe(0);
    expect(pose.rotateY).toBe(0);
    expect(motion.crossedCamera).toBe(false);
    expect(motion.apertureCoversViewport).toBe(true);
    // Intersect the four camera rays with both faces of the finite-depth bore.
    for (const side of [-1, 1]) {
      const distance = -pose.z + side * SIGNAL_PORTAL.depth * pose.scale / 2;
      for (const x of [-1, 1]) for (const y of [-1, 1]) {
        const rayY = y * Math.tan(22 * Math.PI / 180);
        const rayX = x * Math.tan(22 * Math.PI / 180) * aspect;
        expect(Math.hypot(rayX * distance - pose.x, rayY * distance - pose.y)).toBeLessThan(SIGNAL_PORTAL.innerRadius * pose.scale);
      }
    }
  }
});

it("increases the apparent aperture continuously through the approach and crosses without a cut", () => {
  for (const radius of [.25, .3, .72]) for (const aspect of [390 / 844, 16 / 9, 32 / 9, 6]) {
    let previousAperture = 0;
    let previousZ = -Infinity;
    let covered = false;
    for (let index = 700; index <= 984; index++) {
      const motion = signalPortalMotion(index / 1000, aspect, radius);
      const pose = motion.leader;
      // The minor projected radius includes the tilt and the depth of the bore.
      const aperture = radius * pose.scale * Math.cos(pose.rotateX) * Math.cos(pose.rotateY) / (-pose.z + .08 * pose.scale);
      expect(aperture).toBeGreaterThanOrEqual(previousAperture);
      expect(pose.z).toBeGreaterThanOrEqual(previousZ);
      if (covered) expect(motion.apertureCoversViewport).toBe(true);
      covered ||= motion.apertureCoversViewport;
      previousAperture = aperture;
      previousZ = pose.z;
    }
    expect(covered).toBe(true);
    expect(signalPortalMotion(.985, aspect, radius).leader.z).toBe(0);
    const finished = signalPortalMotion(SIGNAL_PORTAL.finishedAt, aspect, radius);
    expect(finished.leader.z - .08 * finished.leader.scale).toBeGreaterThan(0);
    expect(finished.completed).toBe(true);
    expect(finished.terminalRevealProgress).toBe(1);
  }
});

it("reproduces the same poses when scrubbing backward and keeps trailing rings out of the final opening", () => {
  const progress = Array.from({ length: 101 }, (_, index) => index / 100);
  for (const radius of [.3, .72]) {
    const forward = progress.map(p => signalPortalMotion(p, 16 / 9, radius));
    for (const index of [...progress.keys()].reverse()) expect(signalPortalMotion(progress[index]!, 16 / 9, radius)).toEqual(forward[index]);
  }
  for (const p of [.8, .84, .9, .955, .985]) {
    expect(signalPortalMotion(p, 16 / 9).trailing.every(pose => pose.alpha === 0)).toBe(true);
  }
  expect(signalPortalMotion(.27, 16 / 9).alpha).toBe(0);
});

it("keeps the smaller trailing rings spread along the arc on a narrow phone viewport", () => {
  const { leader, trailing } = signalPortalMotion(.7, 390 / 844);
  for (const pose of trailing) expect(pose.scale).toBeLessThan(leader.scale * .75);
  // Use perspective-projected centers and conservative outer radii in pixels.
  const projection = 844 / (2 * Math.tan(22 * Math.PI / 180));
  const screens = trailing.map(pose => ({ x: pose.x / -pose.z * projection, y: pose.y / -pose.z * projection, radius: pose.scale / -pose.z * projection }));
  for (let index = 1; index < screens.length; index++) {
    const a = screens[index - 1]!, b = screens[index]!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan((a.radius + b.radius) * .65);
  }
});

it("keeps every transform finite for out-of-range or invalid input", () => {
  for (const p of [NaN, Infinity, -Infinity, -100, 0, .65, .955, .985, 1, 100]) {
    for (const aspect of [NaN, Infinity, -1, 0, Number.MIN_VALUE, 1, Number.MAX_VALUE]) for (const radius of [NaN, Infinity, -1, 0, Number.MIN_VALUE, .25, .72, Number.MAX_VALUE]) {
      const motion = signalPortalMotion(p, aspect, radius);
      for (const pose of [motion.leader, ...motion.trailing]) {
        expect(Object.values(pose).every(Number.isFinite)).toBe(true);
        expect(pose.scale).toBeGreaterThan(0);
        expect(pose.alpha).toBeGreaterThanOrEqual(0);
        expect(pose.alpha).toBeLessThanOrEqual(1);
      }
    }
  }
});
