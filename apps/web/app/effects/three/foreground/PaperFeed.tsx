import { useEffect, useMemo } from "react";
import {
  CanvasTexture, DoubleSide, LinearFilter, MathUtils, MeshStandardNodeMaterial,
  PlaneGeometry, RepeatWrapping, SRGBColorSpace,
} from "three/webgpu";
import { useForegroundFrame, type ForegroundProps } from "./shared";

const PAPER_WIDTH = 1.76;
const PAPER_LENGTH = 13;
const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 3072;

/** Printing through a dot stencil keeps the ribbon visibly impact-printed up close. */
function printDots(context: CanvasRenderingContext2D, text: string, x: number, y: number, size = 34, bold = true) {
  const stamp = document.createElement("canvas");
  stamp.width = TEXTURE_WIDTH; stamp.height = Math.ceil(size * 1.5) + 8;
  const ink = stamp.getContext("2d");
  if (!ink) return;
  ink.font = `${bold ? "700" : "400"} ${size}px 'Courier New', monospace`;
  ink.fillStyle = "#000"; ink.textBaseline = "top";
  ink.fillText(text, 0, 4);
  const pixels = ink.getImageData(0, 0, stamp.width, stamp.height).data;
  context.fillStyle = "#0d140f";
  const pitch = 2.2;
  for (let row = 0; row < stamp.height; row += pitch) {
    for (let column = 0; column < TEXTURE_WIDTH - x - 42; column += pitch) {
      const offset = (Math.floor(row) * TEXTURE_WIDTH + Math.floor(column)) * 4;
      if ((pixels[offset + 3] ?? 0) < 80) continue;
      context.beginPath(); context.arc(x + column, y + row, 1.08, 0, Math.PI * 2); context.fill();
    }
  }
}

function createPaperTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH; canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Paper feed requires a 2D print texture.");
  context.fillStyle = "#e9e2ce";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Green-bar stationery, small deterministic fibres, and punched tractor holes.
  for (let y = 0; y < TEXTURE_HEIGHT; y += 100) {
    context.fillStyle = "rgba(123, 148, 115, .065)";
    context.fillRect(37, y, TEXTURE_WIDTH - 74, 50);
  }
  for (let index = 0; index < 14500; index++) {
    const x = ((index * 743) % 65521) / 65521 * TEXTURE_WIDTH;
    const y = ((index * 977) % 65519) / 65519 * TEXTURE_HEIGHT;
    context.fillStyle = index % 3 ? "rgba(111, 94, 62, .035)" : "rgba(255, 255, 237, .14)";
    context.fillRect(x, y, .8, 1.7);
  }
  context.strokeStyle = "rgba(111, 108, 86, .33)"; context.lineWidth = 1;
  context.setLineDash([3, 5]);
  for (const x of [37, TEXTURE_WIDTH - 37]) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, TEXTURE_HEIGHT); context.stroke();
  }
  context.setLineDash([]);
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = "#000";
  for (let y = 16; y < TEXTURE_HEIGHT; y += 36) {
    for (const x of [17, TEXTURE_WIDTH - 17]) {
      context.beginPath(); context.arc(x, y, 6.4, 0, Math.PI * 2); context.fill();
    }
  }
  context.globalCompositeOperation = "source-over";

  const pages = [
    {
      number: "001", title: "HADESD / BOOT LOG", subtitle: "SYSTEM 7.5 / STARTUP",
      lines: [
        "ROM CHECK...... OK", "MEMORY 4096 KB. OK", "SCSI BUS 0..... OK", "BOOT VOLUME.... HD", "",
        "mount /dev/disk0 /", "init: extensions", "[OK] filesystem", "[OK] display", "[OK] terminal", "",
        "DEVICE READY", "WAITING FOR INPUT _",
      ],
    },
    {
      number: "002", title: "MACINTOSH HD", subtitle: "DIRECTORY / VOLUME 01",
      lines: [
        "/", "|-- Applications", "|   |-- SimpleText", "|   `-- Terminal", "|-- System Folder", "|-- home", "|   `-- hades", "|      |-- journal", "|      `-- projects", "`-- README.md", "",
        "FILES......... 128", "PATH /home/hades",
      ],
    },
    {
      number: "003", title: "TERMINAL / SPOOL", subtitle: "LOCALHOST / SESSION 01",
      lines: [
        "$ whoami", "hades", "", "$ cd ~/journal", "$ ls -la", "drwx  ..", "-rw-  hello.md", "-rw-  hardware.md", "-rw-  README.md", "", "SPOOL COMPLETE", "hades@hadesd ~ % _",
      ],
    },
  ];
  pages.forEach((page, index) => {
    const top = index * 1024;
    context.strokeStyle = "rgba(71, 67, 52, .45)"; context.lineWidth = 1;
    context.setLineDash([6, 5]);
    context.beginPath(); context.moveTo(0, top + 1); context.lineTo(TEXTURE_WIDTH, top + 1); context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#ba7939";
    context.fillRect(57, top + 36, 8, 36);
    printDots(context, `FEED ${page.number}`, 79, top + 32, 42, true);
    printDots(context, page.title, 57, top + 108, 31, true);
    printDots(context, page.subtitle, 57, top + 151, 24, true);
    context.strokeStyle = "#77795e";
    context.beginPath(); context.moveTo(57, top + 187); context.lineTo(455, top + 187); context.stroke();
    page.lines.forEach((line, lineIndex) => printDots(context, line, 57, top + 221 + lineIndex * 51, 34, true));
    printDots(context, `HADESD.SH  /  PAGE ${page.number}`, 57, top + 953, 25, true);
  });
  const texture = new CanvasTexture(canvas);
  texture.name = "paper-feed / perforated impact-print stationery";
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = false;
  return texture;
}

/** An endless folded stationery strip. Its physical folds and printed feed rewind with scroll. */
export function PaperFeed(props: ForegroundProps) {
  const resources = useMemo(() => {
    const texture = createPaperTexture();
    const geometry = new PlaneGeometry(PAPER_WIDTH, PAPER_LENGTH, 12, 176);
    const original = Float32Array.from(geometry.attributes.position!.array);
    const material = new MeshStandardNodeMaterial({
      map: texture, color: "#929187", roughness: .96, metalness: 0,
      emissiveIntensity: 0,
      transparent: true, alphaTest: .025, side: DoubleSide, depthWrite: true,
    });
    material.name = "paper-feed / warm cellulose and black ribbon ink";
    return { texture, geometry, original, material, lastTravel: -1, lastWidth: -1 };
  }, []);
  useEffect(() => () => {
    resources.texture.dispose(); resources.geometry.dispose(); resources.material.dispose();
  }, [resources]);

  const root = useForegroundFrame(props, ({ travel, alpha, width, mobile }) => {
    resources.material.opacity = alpha;
    resources.texture.offset.y = -.11 - travel * 1.46;
    if (root.current) {
      root.current.userData.itemCount = 1;
      root.current.userData.feedOffset = resources.texture.offset.y;
    }
    if (resources.lastTravel === travel && resources.lastWidth === width) return;
    resources.lastTravel = travel; resources.lastWidth = width;
    const positions = resources.geometry.attributes.position!;
    const paperScale = MathUtils.clamp(width / 8, .42, 1);
    const centre = -Math.min(width * .36, 3.55);
    const unfold = MathUtils.smoothstep(travel, 0, .2);
    const archive = MathUtils.smoothstep(travel, .8, 1);
    for (let index = 0; index < positions.count; index++) {
      const across = resources.original[index * 3]! * paperScale;
      const along = resources.original[index * 3 + 1]!;
      const wave = along * .77 + travel * 3.8;
      const twist = Math.sin(wave * .8) * .34 + .1;
      // Accordion creases soften into a broad S curve while the tractor feed advances.
      const crease = Math.sin(wave * 1.9) * (1 - unfold) * .13;
      const x = centre + Math.sin(along * .55 + .55) * (mobile ? .1 : .31)
        + across * Math.cos(twist) - archive * (mobile ? .5 : 1.1);
      const y = along + Math.sin(across / PAPER_WIDTH * Math.PI) * .08 - archive * 1.15;
      const z = .36 + Math.sin(wave) * .53 + across * Math.sin(twist) + crease;
      positions.setXYZ(index, x, y, z);
    }
    positions.needsUpdate = true;
    resources.geometry.computeVertexNormals();
    resources.geometry.computeBoundingSphere();
  });

  return <group ref={root} name="foreground-paper" visible={false} dispose={null}>
    <mesh name="continuous-tractor-feed" geometry={resources.geometry} material={resources.material} frustumCulled={false} />
  </group>;
}
