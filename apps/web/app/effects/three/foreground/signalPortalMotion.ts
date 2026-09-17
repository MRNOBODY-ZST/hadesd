/** Camera-relative coordinates: the camera is at the origin, looking down -Z. */
export type SignalPortalPose = {
  x: number;
  y: number;
  z: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  scale: number;
  alpha: number;
};

export const SIGNAL_PORTAL = {
  fov: 44,
  innerRadius: .72,
  depth: .16,
  appearStart: .285,
  appearEnd: .335,
  approachStart: .65,
  alignedAt: .8,
  fillsViewportAt: .955,
  crossesCameraAt: .985,
  finishedAt: .995,
} as const;

const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (start: number, end: number, value: number) => {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};
const tangent = Math.tan(SIGNAL_PORTAL.fov * Math.PI / 360);
const viewportAspect = (aspect: number) => Number.isFinite(aspect) && aspect > 0 ? clamp(aspect, .2, 6) : 1;

function arcPose(progress: number, aspect: number): SignalPortalPose {
  const t = smooth(.3, SIGNAL_PORTAL.approachStart, progress);
  const u = 1 - t;
  // A broad cubic arc, from the distant upper-right to the near lower-left.
  const screenX = u ** 3 * .96 + 3 * u * u * t * .74 + 3 * u * t * t * -.04 + t ** 3 * -.55;
  const screenY = u ** 3 * .86 + 3 * u * u * t * .14 + 3 * u * t * t * -.74 + t ** 3 * -.43;
  const distance = mix(20, 6.8, t);
  const halfTurn = mix(-Math.PI, 0, smooth(SIGNAL_PORTAL.appearEnd, SIGNAL_PORTAL.alignedAt, progress));
  return {
    x: screenX * distance * tangent * aspect,
    y: screenY * distance * tangent,
    z: -distance,
    // A vertical flip and a counterclockwise roll both finish facing the lens.
    rotateX: halfTurn,
    rotateY: mix(.8, -.42, t),
    // After the entrance, positive world Z gives one counterclockwise half-turn.
    rotateZ: halfTurn,
    scale: .56,
    alpha: smooth(SIGNAL_PORTAL.appearStart, SIGNAL_PORTAL.appearEnd, progress),
  };
}

/**
 * Conservative coverage through the entire ring bore, including its far side.
 * Only used after the ring faces the camera; no circular-mask approximation of
 * a tilted ellipse can prematurely expose the scene outside the opening.
 */
function coversViewport(pose: SignalPortalPose, aspect: number, apertureInradius: number) {
  if (pose.rotateX !== 0 || pose.rotateY !== 0) return false;
  if (pose.z >= 0) return true;
  const farDistance = -pose.z + SIGNAL_PORTAL.depth * pose.scale / 2;
  const halfHeight = farDistance * tangent;
  const farthestCorner = Math.hypot(halfHeight * aspect + Math.abs(pose.x), halfHeight + Math.abs(pose.y));
  return apertureInradius * pose.scale >= farthestCorner;
}

/** Scroll is the only animation clock, so holding and reversing reproduce the same pose. */
export function signalPortalMotion(progress: number, aspect: number, apertureInradius: number = SIGNAL_PORTAL.innerRadius) {
  const p = Number.isFinite(progress) ? clamp(progress) : 0;
  const ratio = viewportAspect(aspect);
  const radius = Number.isFinite(apertureInradius) && apertureInradius > 0 ? clamp(apertureInradius, .25, 1) : SIGNAL_PORTAL.innerRadius;
  const leader = arcPose(p, ratio);
  const approach = clamp((p - SIGNAL_PORTAL.approachStart) / (SIGNAL_PORTAL.crossesCameraAt - SIGNAL_PORTAL.approachStart));
  const centered = smooth(SIGNAL_PORTAL.approachStart, SIGNAL_PORTAL.alignedAt, p);

  if (p > SIGNAL_PORTAL.approachStart) {
    // Solve coverage at the far end of the finite bore, rather than treating
    // narrow star/diamond openings as a circle with the original ring radius.
    const coverApproach = (SIGNAL_PORTAL.fillsViewportAt - SIGNAL_PORTAL.approachStart) / (SIGNAL_PORTAL.crossesCameraAt - SIGNAL_PORTAL.approachStart);
    const coverDistance = 6.8 * Math.pow(1 - coverApproach * coverApproach, 1.4);
    const cornerSlope = tangent * Math.hypot(ratio, 1);
    const coverScale = coverDistance * cornerSlope / (radius - SIGNAL_PORTAL.depth * cornerSlope / 2);
    const endScale = Math.max(Math.max(.72, Math.hypot(ratio, 1) * .5) * SIGNAL_PORTAL.innerRadius / radius, coverScale * 1.04);
    // Real forward travel and continuous growth carry the hole across the lens.
    const distance = 6.8 * Math.pow(1 - approach * approach, 1.4);
    leader.scale = mix(.56, endScale, smooth(.65, .9, p));
    leader.x = -.55 * (1 - centered) * distance * tangent * ratio;
    leader.y = -.43 * (1 - centered) * distance * tangent;
    leader.z = -distance;
    leader.rotateY = mix(-.42, 0, centered);
    if (p >= SIGNAL_PORTAL.crossesCameraAt) {
      leader.z = Math.max(.5, leader.scale * .24) * smooth(SIGNAL_PORTAL.crossesCameraAt, 1, p);
    }
  }

  const alpha = smooth(SIGNAL_PORTAL.appearStart, SIGNAL_PORTAL.appearEnd, p);
  const trailing = Array.from({ length: 4 }, (_, index) => {
    const pose = arcPose(p - .08 * (index + 1), ratio);
    // The smaller rings remain on the same arc, behind the lead portal, and
    // disappear before its aperture fills the viewport.
    pose.scale *= .7;
    pose.alpha *= 1 - smooth(.69, .8, p);
    return pose;
  });

  return {
    leader,
    trailing,
    alpha,
    portalProgress: smooth(SIGNAL_PORTAL.approachStart, SIGNAL_PORTAL.fillsViewportAt, p),
    terminalRevealProgress: smooth(SIGNAL_PORTAL.fillsViewportAt, SIGNAL_PORTAL.crossesCameraAt, p),
    apertureCoversViewport: coversViewport(leader, ratio, radius),
    crossedCamera: p >= SIGNAL_PORTAL.crossesCameraAt,
    completed: p >= SIGNAL_PORTAL.finishedAt,
  };
}
