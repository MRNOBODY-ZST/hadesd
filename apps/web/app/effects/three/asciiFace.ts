import {
  CanvasTexture,
  Color,
  LinearFilter,
  NoColorSpace,
  Vector2,
  type ColorRepresentation,
  type Node,
} from "three/webgpu";
import {
  abs,
  clamp,
  cos,
  float,
  Fn,
  fract,
  max,
  mix,
  positionLocal,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { mirrorMacFacePixels } from "./macFaceSymmetry";

const FACE_WIDTH = 768;
const FACE_HEIGHT = 768;
const GLYPH_WIDTH = 32;
const GLYPH_HEIGHT = 44;
const ATLAS_COLUMNS = 16;
const FACE_BACKGROUND = 246 / 255;

function surface(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Mac face rendering requires a 2D canvas.");
  return { canvas, context };
}

function dataTexture(canvas: HTMLCanvasElement, name: string) {
  const result = new CanvasTexture(canvas);
  // These grayscale values encode luminance, rather than photographic sRGB.
  result.colorSpace = NoColorSpace;
  result.minFilter = LinearFilter;
  result.magFilter = LinearFilter;
  result.generateMipmaps = false;
  result.name = name;
  return result;
}

/** The complete computer and both eye states share the same x=384 mirror axis. */
function drawFace(eyesClosed: boolean) {
  const { canvas, context: c } = surface(FACE_WIDTH, FACE_HEIGHT);
  c.fillStyle = "#f6f6f6";
  c.fillRect(0, 0, FACE_WIDTH, FACE_HEIGHT);

  c.fillStyle = "#404040";
  c.strokeStyle = "#101010";
  c.lineWidth = 15;
  c.lineJoin = "round";
  c.beginPath();
  c.roundRect(130, 62, 508, 618, 28);
  c.fill();
  c.stroke();

  c.fillStyle = "#666666";
  c.lineWidth = 13;
  c.beginPath();
  c.roundRect(169, 108, 430, 365, 22);
  c.fill();
  c.stroke();

  c.fillStyle = "#080808";
  if (eyesClosed) {
    c.lineWidth = 13;
    c.lineCap = "square";
    c.beginPath();
    c.moveTo(270, 253);
    c.lineTo(284.5, 243);
    c.lineTo(299, 253);
    c.stroke();
  } else {
    c.fillRect(270, 224, 29, 50);
  }

  c.lineWidth = 16;
  c.lineCap = "square";
  c.beginPath();
  c.moveTo(266, 340);
  c.lineTo(297, 366);
  c.lineTo(384, 366);
  c.stroke();

  // A disk slot and vents retain the unmistakable small-computer silhouette.
  c.fillStyle = "#151515";
  c.fillRect(304, 553, 160, 17);
  c.fillRect(374, 582, 20, 11);
  for (let i = 0; i < 5; i++) c.fillRect(191 + i * 21, 546, 10, 48);
  c.fillRect(256, 703, 256, 14);
  // Copy actual pixels, rather than trusting independently antialiased paths.
  // This also guarantees symmetry when both eyes close during the blink.
  const artwork = c.getImageData(0, 0, FACE_WIDTH, FACE_HEIGHT);
  mirrorMacFacePixels(artwork.data, FACE_WIDTH, FACE_HEIGHT);
  c.putImageData(artwork, 0, 0);
  return dataTexture(canvas, eyesClosed ? "hadesd-face-eyes-closed" : "hadesd-face-open");
}

/** Sort our own glyphs by measured ink coverage, so intensity means density. */
function densityAtlas() {
  const glyphs = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)), "░", "▒", "▓"];
  const tile = surface(GLYPH_WIDTH, GLYPH_HEIGHT);
  const prepare = (context: CanvasRenderingContext2D) => {
    context.font = "bold 36px 'Courier New', monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "white";
  };
  prepare(tile.context);
  const ranked = glyphs.map((glyph) => {
    tile.context.clearRect(0, 0, GLYPH_WIDTH, GLYPH_HEIGHT);
    tile.context.fillText(glyph, GLYPH_WIDTH / 2, GLYPH_HEIGHT / 2);
    const pixels = tile.context.getImageData(0, 0, GLYPH_WIDTH, GLYPH_HEIGHT).data;
    let ink = 0;
    for (let i = 3; i < pixels.length; i += 4) ink += pixels[i]!;
    return { glyph, coverage: ink / (255 * GLYPH_WIDTH * GLYPH_HEIGHT) };
  }).sort((a, b) => a.coverage - b.coverage || a.glyph.charCodeAt(0) - b.glyph.charCodeAt(0));
  const rows = Math.ceil(ranked.length / ATLAS_COLUMNS);
  const { canvas, context } = surface(ATLAS_COLUMNS * GLYPH_WIDTH, rows * GLYPH_HEIGHT);
  prepare(context);
  ranked.forEach(({ glyph }, index) => {
    context.fillText(glyph, (index % ATLAS_COLUMNS + 0.5) * GLYPH_WIDTH, (Math.floor(index / ATLAS_COLUMNS) + 0.5) * GLYPH_HEIGHT);
  });
  return { texture: dataTexture(canvas, "hadesd-density-glyph-atlas"), rows, ranked };
}

export interface AsciiFaceOptions {
  /** At 1440 px, 140 columns gives the reference's dense but legible character scale. */
  columns?: number;
  rows?: number;
  /** Physical panel width / height; update on resize to preserve the face proportions. */
  aspect?: number;
  tint?: ColorRepresentation;
}

/**
 * Reusable RGB nodes for a real luminance-driven face and its ASCII rendering.
 * Update uniforms.progress from scroll and uniforms.time from elapsed seconds.
 * The immutable atlas also supplies animated side tiles entirely on the GPU.
 */
export function createAsciiFace(options: AsciiFaceOptions = {}) {
  const open = drawFace(false);
  const wink = drawFace(true);
  const atlas = densityAtlas();
  const columns = options.columns ?? 140;
  const aspect = options.aspect ?? 1.6;
  const uniforms = {
    progress: uniform(0),
    time: uniform(0),
    grid: uniform(new Vector2(columns, options.rows ?? Math.round(columns / aspect * GLYPH_WIDTH / GLYPH_HEIGHT))),
    aspect: uniform(aspect),
    tint: uniform(new Color(options.tint ?? "#d5e3d8")),
    /** Set to 0 to freeze both symmetric blinking and the background animation. */
    blinkEnabled: uniform(1),
  };

  // Both eyes close together for 0.4 seconds every 4.8 seconds.
  const blinkPhase = fract(uniforms.time.add(2.1).div(4.8)).mul(4.8);
  const blinkNode = smoothstep(0, 0.07, blinkPhase)
    .mul(float(1).sub(smoothstep(0.28, 0.4, blinkPhase)))
    .mul(uniforms.blinkEnabled);

  const faceSample = (coordinates: Node<"vec2">) => {
    const centered = coordinates.sub(0.5);
    // Contain the square source on any physical panel. The face stays clear
    // at progress 0.3–0.5; the later lens change is entirely scroll controlled.
    const fit = vec2(max(uniforms.aspect, 1), max(float(1).div(uniforms.aspect), 1));
    const later = smoothstep(0.52, 0.9, uniforms.progress);
    const lens = centered.dot(centered).mul(later).mul(0.12).add(1);
    const sourceUv = centered.mul(fit).mul(lens).mul(mix(1, 0.92, later)).add(0.5);
    const inside = step(0, sourceUv.x).mul(step(sourceUv.x, 1))
      .mul(step(0, sourceUv.y)).mul(step(sourceUv.y, 1));
    // Contain margins belong to the same bright field as the source canvas.
    // Multiplying by `inside` would turn every wide/portrait tile into black bars.
    const sampleUv = clamp(sourceUv, 0, 1);
    const source = mix(texture(open, sampleUv).rgb, texture(wink, sampleUv).rgb, blinkNode);
    return mix(vec3(FACE_BACKGROUND), source, inside);
  };

  const sampleImage = (coordinates: Node<"vec2">) => faceSample(coordinates).mul(uniforms.tint);
  const sampleGlyph = (index: Node<"float">, local: Node<"vec2">) => {
    const column = index.mod(ATLAS_COLUMNS);
    const row = index.div(ATLAS_COLUMNS).floor();
    // Half-texel insets prevent adjacent atlas characters from bleeding together.
    const glyphUv = vec2(
      column.mul(GLYPH_WIDTH).add(local.x.mul(GLYPH_WIDTH - 1)).add(0.5).div(ATLAS_COLUMNS * GLYPH_WIDTH),
      float(1).sub(row.mul(GLYPH_HEIGHT).add(float(1).sub(local.y).mul(GLYPH_HEIGHT - 1)).add(0.5).div(atlas.rows * GLYPH_HEIGHT)),
    );
    return texture(atlas.texture, glyphUv).a;
  };
  // Skyworks samples animated luminance once per fixed cell, then selects from
  // its atlas. We retain that cell/atlas model with a procedural moving field
  // and seeded character changes, so there is no video or frame texture upload.
  // https://github.com/shader-sweden/skyworks/blob/2eb7ad3b4b861cbfc17adebff5e9fa8c861babeb/src/components/asci-background.tsx
  const sampleBackground = (coordinates: Node<"vec2">, seed: Node<"float">) => {
    const cellPosition = coordinates.mul(uniforms.grid);
    const cell = cellPosition.floor();
    const stable = fract(sin(cell.dot(vec2(127.1, 311.7)).add(seed.mul(17.13))).mul(43758.5453));
    const time = uniforms.time.mul(uniforms.blinkEnabled);
    const tick = time.mul(stable.mul(4).add(3)).add(stable.mul(7)).floor();
    const random = fract(sin(cell.dot(vec2(269.5, 183.3)).add(tick.mul(31.7)).add(seed.mul(53.1))).mul(43758.5453));
    const field = sin(cell.x.mul(.11).add(time.mul(.7)))
      .add(cos(cell.y.mul(.14).sub(time.mul(.48)))).mul(.09).add(.82);
    const index = random.mul(atlas.ranked.length * .56).add(atlas.ranked.length * .35).floor();
    const ink = sampleGlyph(index, fract(cellPosition));
    return vec3(.94, .97, 1).mul(ink.mul(random.mul(.35).add(.95)).mul(field).add(.009));
  };
  const sampleColor = (coordinates: Node<"vec2">, seed: Node<"float"> = float(0)) => Fn(() => {
    // Fold before quantizing: both halves use the same cell and mirrored glyph
    // pixels, including when the viewport produces an odd number of columns.
    const mirrored = vec2(abs(coordinates.x.sub(.5)).add(.5), coordinates.y);
    const iconCellPosition = mirrored.mul(uniforms.grid);
    const center = iconCellPosition.floor().add(0.5).div(uniforms.grid);
    const source = faceSample(center);
    const luminance = source.dot(vec3(0.2126, 0.7152, 0.0722));
    const level = clamp(luminance.sub(0.025).div(0.975), 0, 1);
    const density = clamp(level.pow(0.78).mul(0.89), 0, 0.98);
    const index = density.mul(atlas.ranked.length - 1).floor();
    const ink = sampleGlyph(index, fract(iconCellPosition));
    const icon = uniforms.tint.mul(ink.mul(1.32).add(0.025)).mul(level.pow(0.58));
    // The source's bright exterior is the only animated region. Source body,
    // screen, eyes, smile and stand remain a stable symmetric silhouette.
    const iconMask = float(1).sub(step(FACE_BACKGROUND - .002, luminance));
    return mix(sampleBackground(coordinates, seed), icon, iconMask);
  })();
  const imageNode = Fn(() => sampleImage(uv()))();
  const colorNode = sampleColor(uv());

  let disposed = false;
  return {
    colorNode,
    imageNode,
    /** Shared symmetric Mac plus animated exterior; an optional seed varies only the background. */
    sampleColor,
    sampleImage,
    blinkNode,
    uniforms,
    textures: { open, wink, atlas: atlas.texture },
    glyphs: atlas.ranked.map(({ glyph }) => glyph),
    glyphCoverage: atlas.ranked.map(({ coverage }) => coverage),
    dispose() {
      if (disposed) return;
      disposed = true;
      open.dispose();
      wink.dispose();
      atlas.texture.dispose();
    },
  };
}

export interface CurledPanelOptions {
  height: number;
  radius?: number;
  segmentCount?: number;
  /** Panel center angle in radians. The containing group can rotate independently. */
  angle?: number | Node<"float">;
  /** 0: tangent plane. 1: true cylinder surface. */
  curvature?: number | Node<"float">;
}

/**
 * Cylinder axis is X; the cylinder center is the local origin and front is z=+R.
 * Place the containing group at z=-R. Use an XY PlaneGeometry subdivided along Y
 * (at least 32 rows), and frustumCulled=false because the GPU moves its vertices.
 * For N panels use angle=i*2π/N and rotate the group around X from scroll.
 */
export function createCurledPanelPosition(options: CurledPanelOptions) {
  const radius = options.radius ?? options.height * (options.segmentCount ?? 16) / (Math.PI * 2);
  if (!(options.height > 0) || !(radius > 0)) throw new Error("Curled panels require positive height and radius.");
  const angleValue = options.angle ?? 0;
  const curvatureValue = options.curvature ?? 1;
  const center = typeof angleValue === "number" ? float(angleValue) : angleValue;
  const amount = clamp(typeof curvatureValue === "number" ? float(curvatureValue) : curvatureValue, 0, 1);
  return Fn(() => {
    const travel = positionLocal.y;
    const angle = center.add(travel.div(radius));
    const cylindrical = vec3(positionLocal.x, sin(angle).mul(radius), cos(angle).mul(radius));
    // Derivative of (R sin θ, R cos θ) gives the exact tangent direction.
    const tangent = vec3(positionLocal.x, sin(center).mul(radius).add(cos(center).mul(travel)),
      cos(center).mul(radius).sub(sin(center).mul(travel)));
    return mix(tangent, cylindrical, amount);
  })();
}
