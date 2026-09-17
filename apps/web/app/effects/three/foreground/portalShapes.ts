export type PortalShape = "star" | "spark" | "diamond" | "hexagon" | "ring";

export const PORTAL_SHAPES: readonly { id: PortalShape; label: string }[] = [
  { id: "star", label: "五角星" },
  { id: "spark", label: "四芒星" },
  { id: "diamond", label: "菱形" },
  { id: "hexagon", label: "六边形" },
  { id: "ring", label: "圆环" },
];

export function portalShapeFromSearch(search: string): PortalShape {
  const shape = new URLSearchParams(search).get("shape");
  return PORTAL_SHAPES.find(option => option.id === shape)?.id ?? "star";
}
