import { HardwareAssembly } from "./HardwareAssembly";
import { CircuitSignals } from "./CircuitSignals";
import { PaperFeed } from "./PaperFeed";
import { ClassicWindows } from "./ClassicWindows";
import type { ForegroundMode, ForegroundProps } from "./shared";
import type { MeshBasicNodeMaterial } from "three/webgpu";
import type { PortalShape } from "./portalShapes";

export default function ForegroundEffects({ mode, portalMaterial, portalShape, ...props }: ForegroundProps & { mode: ForegroundMode; portalMaterial: MeshBasicNodeMaterial; portalShape: PortalShape }) {
  if (mode === "assembly") return <HardwareAssembly {...props} />;
  if (mode === "circuit") return <CircuitSignals {...props} portalMaterial={portalMaterial} shape={portalShape} />;
  if (mode === "paper") return <PaperFeed {...props} />;
  if (mode === "macos") return <ClassicWindows {...props} />;
  return null;
}
