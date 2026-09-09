/** The physical Mac reaches the same z=0 plane as the first cylinder tile here. */
export const MAC_SCREEN_HANDOFF = .275;

/** Convert the Mac's physical screen UV into the shared viewport-sized image UV. */
export function macFaceUvScale(screenWidth: number, screenHeight: number,
  viewportWidth: number, viewportHeight: number, fullScale: number, framed: number): [number, number] {
  const aspect = viewportWidth / viewportHeight;
  const fullX = screenWidth * fullScale / viewportWidth;
  const fullY = screenHeight * fullScale / viewportHeight;
  const framedX = (screenWidth / screenHeight) / Math.max(aspect, 1);
  const framedY = 1 / Math.max(1 / aspect, 1);
  return [fullX + (framedX - fullX) * framed, fullY + (framedY - fullY) * framed];
}
