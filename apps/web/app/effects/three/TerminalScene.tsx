import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type GLProps } from "@react-three/fiber";
import {
  CanvasTexture, Color, DirectionalLight, Group, LinearFilter, MathUtils, Mesh, MeshBasicMaterial, MeshBasicNodeMaterial, NoToneMapping,
  OrthographicCamera, PerspectiveCamera, PCFShadowMap, PlaneGeometry, RenderPipeline, RenderTarget, Scene,
  SRGBColorSpace, Vector2, Vector3, Vector4, WebGPURenderer, type WebGPURendererParameters, type Node,
} from "three/webgpu";
import type { WebGLRenderer } from "three";
import { createAsciiFace } from "./asciiFace";
import { AsciiCarousel } from "./AsciiCarousel";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Fn, abs, cos, float, fract, length, mix, pass, positionLocal, screenUV, sin, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type { CrtLevel, Theme } from "@hadesd/contracts";
import type { IntroPhase } from "../timeline";
import { createTerminalSurface } from "./terminalTexture";
import { RetroMac, RETRO_MAC_SCREEN, RETRO_COMPUTER_BOUNDS } from "./RetroMac";
import { MAC_SCREEN_HANDOFF, macFaceUvScale } from "./screenProjection";
import { HardwareField } from "./HardwareParts";
import { createBootTexture, createMacScreenTexture } from "./introTextures";
import { crtAperture, crtSignal } from "./crtNodes";
import { Atmosphere } from "./Atmosphere";
import { computerGroundHeight, computerLens } from "./computerPlacement";
import { sceneMotion, scenePixelRatio } from "./sceneMotion";
import { takeFiberClock } from "./fiberRendererClock";
import { shouldSubmitFrame } from "./frameSubmission";
import type { ForegroundMode } from "./foreground/shared";
import { SIGNAL_PORTAL } from "./foreground/signalPortalMotion";
import type { PortalShape } from "./foreground/portalShapes";

const ForegroundEffects = import.meta.env.DEV ? lazy(() => import("./foreground/ForegroundEffects")) : null;

type Props = {
  surface: HTMLElement; theme: Theme; level: CrtLevel; ready: boolean; phase: IntroPhase;
  bootProgress: MutableRefObject<number>; progress: MutableRefObject<number>;
  phaseState: MutableRefObject<IntroPhase>; phaseProgress: MutableRefObject<number>; revealStep: number;
  pointer: MutableRefObject<{ x: number; y: number }>; reducedMotion: boolean;
  foregroundMode?: ForegroundMode;
  portalShape?: PortalShape;
  onInitialized: (backend: string) => void; onFailure: () => void;
};
type RendererStats = {
  backend: string; frames: number; renderTargets: number; tsl: true; textTexture: true;
  width: number; height: number; textureWidth: number; textureHeight: number;
  introPhase: IntroPhase; journey: number; phaseProgress: number; bootProgress: number; revealStep: number; asciiActive: boolean; asciiTilesVisible: boolean; hardwareVisible: boolean; visibleHardwareCount: number; binaryStreamsVisible: boolean; visibleBinaryStreamCount: number; macVisible: boolean;
  bootScreenVisible: boolean; bootScreenZ: number; bootScreenAlpha: number;
  bootSequence: number; macPreset: number; macScreenSeconds: number;
  foregroundEffect: ForegroundMode; visibleForegroundCount: number; foregroundPose: number[];
  portalActive: boolean; portalCoversViewport: boolean; portalCrossedCamera: boolean; portalLeaderZ: number; terminalUnderlay: boolean;
  carouselRotation: number;
  portalShape: PortalShape; portalRotation: number;
  drawCalls: number; triangles: number; points: number; lines: number; textures: number; geometries: number; renderCpuMs: number; dpr: number; frameRateTarget: number; reflection: boolean; fiberClockOwned: boolean;
};
type FiberRendererParameters = Parameters<Extract<GLProps, (...args: never[]) => unknown>>[0];
declare global { interface Window { __hadesdGraphics?: RendererStats } }
const ease = (start: number, end: number, value: number) => MathUtils.smoothstep(value, start, end);

function Display({ surface, theme, level, phaseState, bootProgress, progress, phaseProgress, revealStep, pointer, reducedMotion, foregroundMode = "binary", portalShape = "star", onInitialized, onFailure }: Props) {
  const { gl: fiberRenderer, scene, camera, size, invalidate, setDpr } = useThree();
  const viewport = useMemo(() => { const height = 2 * Math.tan(22 * Math.PI / 180) * 11; return { width: height * size.width / size.height, height }; }, [size.width, size.height]);
  const renderer = fiberRenderer as unknown as WebGPURenderer;
  const fiberClock = useMemo(() => takeFiberClock(renderer), [renderer]);
  useEffect(() => { setDpr(scenePixelRatio(size.width, size.height, window.devicePixelRatio)); }, [size.width, size.height, setDpr]);
  const reported = useRef(false), lastFrame = useRef(-Infinity), targetDirty = useRef(true);
  const lastSubmittedPhase = useRef<IntroPhase | null>(null);
  const uploadedSize = useRef({ width: 0, height: 0 });
  const clock = useMemo(() => uniform(0), []), journey = useMemo(() => uniform(0), []);
  const mouse = useMemo(() => uniform(new Vector2()), []);
  const pixels = useMemo(() => uniform(new Vector2(1200, 700)), []);
  const face = useMemo(() => createAsciiFace(), []);
  const macBoot = useMemo(() => uniform(1), []), macAscii = useMemo(() => uniform(0), []);
  const glassFraming = useMemo(() => uniform(0), []);
  const contentRect = useMemo(() => uniform(new Vector4(0, 0, 1, 1)), []);
  const bootUvScale = useMemo(() => uniform(new Vector2(1, 1)), []);
  const bootArtScale = useMemo(() => uniform(new Vector2(1, 1)), []);
  const macArtScale = useMemo(() => uniform(new Vector2(1, 1)), []);
  const faceUvScale = useMemo(() => uniform(new Vector2(1, 1)), []);
  const cardAlpha = useMemo(() => uniform(1), []);
  const hardwareProgress = useRef(0);
  const burst = useMemo(() => uniform(0), []);
  const signal = useMemo(() => uniform(0), []);
  const floorY = useRef(-3), floorOpacity = useRef(1);
  const computerGround = useRef({ x: 0, z: 0, scale: 1, yaw: 0 });
  const cursor = useMemo(() => uniform(new Vector4(-2, -2, 0, 0)), []);
  const intensity = useMemo(() => uniform(1), []), terminalAlpha = useMemo(() => uniform(0), []);
  const portalAlignment = useMemo(() => uniform(0), []), portalInk = useMemo(() => uniform(0), []);
  const portalFit = useMemo(() => uniform(new Vector2(1, 1)), []);
  const tint = useMemo(() => uniform(new Color("#b9955b")), []);
  const monitor = useRef<Mesh>(null), monitorBack = useRef<Mesh>(null), mac = useRef<Group>(null);
  const bootScreen = useRef<Mesh>(null);
  const screenOffset = useMemo(() => new Vector3(), []);
  const keyLight = useRef<DirectionalLight>(null);
  const resources = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
    // WebGPU requires a backed canvas even before the first DOM capture arrives.
    canvas.getContext("2d")?.fillRect(0, 0, 8, 8);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace; map.minFilter = LinearFilter; map.magFilter = LinearFilter; map.generateMipmaps = false;
    const target = new RenderTarget(1200, 700, { depthBuffer: false, stencilBuffer: false });
    target.texture.name = "hadesd-terminal-framebuffer";
    const copy = new MeshBasicNodeMaterial();
    copy.colorNode = texture(map, vec2(uv().x, uv().y.oneMinus()));
    const geometry = new PlaneGeometry(2, 2), sourceScene = new Scene();
    sourceScene.add(new Mesh(geometry, copy));
    const sourceCamera = new OrthographicCamera(-1, 1, 1, -1, .1, 10); sourceCamera.position.z = 1;
    return { map, target, copy, geometry, sourceScene, sourceCamera, boot: createBootTexture(), desktop: createMacScreenTexture() };
  }, []);

  const { material, portalMaterial } = useMemo(() => {
    // Both the window through the ring and the final screen use exactly the
    // same live text signal. No screenshot or duplicate terminal can jump at entry.
    const sample = (glassUv: Node<"vec2">) => Fn(() => {
      const q = glassUv.sub(.5);
      // Keep terminal glyphs registered to their native DOM hit targets. The
      // lens rim, scan, highlight and phosphor live on the larger glass plane.
      const sourceUv = glassUv.sub(contentRect.xy).div(contentRect.zw);
      const distance = length(glassUv.sub(mouse.mul(.5).add(.5)));
      const touch = sin(distance.mul(43).sub(clock.mul(2.4))).mul(float(1).sub(smoothstep(0, .4, distance))).mul(.0007).mul(intensity);
      const coord = sourceUv.add(vec2(touch, touch.mul(.45)));
      const split = vec2(float(.00012).add(abs(q.x).mul(.0007)).mul(intensity), 0);
      const rgb = vec3(texture(resources.target.texture, coord.add(split)).r, texture(resources.target.texture, coord).g, texture(resources.target.texture, coord.sub(split)).b);
      const scan = sin(coord.y.mul(pixels.y).mul(Math.PI)).mul(.08).mul(intensity).add(float(1).sub(intensity.mul(.065)));
      const mask = sin(coord.x.mul(pixels.x).mul(2.094)).mul(.021).mul(intensity).add(.979);
      const vignette = float(1).sub(smoothstep(.23, .76, length(q)).mul(.22));
      const inside = crtAperture(glassUv);
      const contentInside = step(0, coord.x).mul(step(coord.x, 1)).mul(step(0, coord.y)).mul(step(coord.y, 1));
      const cursorArea = step(cursor.x, coord.x).mul(step(coord.x, cursor.x.add(cursor.z))).mul(step(cursor.y, coord.y)).mul(step(coord.y, cursor.y.add(cursor.w)));
      const blink = step(0, sin(clock.mul(5.5)));
      const illumination = float(1).add(float(1).sub(smoothstep(0, .32, distance)).mul(.12).mul(intensity));
      const content = mix(rgb, vec3(.003, .005, .004), cursorArea.mul(blink)).mul(scan).mul(mask).mul(vignette).mul(illumination);
      const sweep = float(1).sub(smoothstep(.002, .012, abs(coord.y.sub(fract(clock.mul(.052)))))).mul(.016).mul(intensity);
      return vec4(content.mul(contentInside).add(tint.mul(sweep)).mul(inside), inside);
    })();
    const material = new MeshBasicNodeMaterial();
    material.name = "HADESD / live terminal phosphor"; material.transparent = true;
    const screen = sample(uv());
    material.colorNode = vec4(screen.rgb, screen.a.mul(terminalAlpha));
    const portalMaterial = new MeshBasicNodeMaterial();
    portalMaterial.name = "signal aperture / live terminal beyond the ring";
    portalMaterial.transparent = true;
    const local = uv().sub(.5).mul(portalFit).add(.5);
    // screenUV is top-left on both backends; our glass texture uses bottom-left UVs.
    const portal = sample(mix(local, vec2(screenUV.x, screenUV.y.oneMinus()), portalAlignment));
    portalMaterial.colorNode = vec4(portal.rgb, portalInk);
    return { material, portalMaterial };
  }, [resources, clock, mouse, intensity, pixels, cursor, tint, terminalAlpha, contentRect, portalAlignment, portalInk, portalFit]);

  const bootMaterial = useMemo(() => {
    const m = new MeshBasicNodeMaterial(); m.transparent = true; m.name = "DOS / curved boot phosphor";
    const sample = crtSignal(resources.boot.sampleColor, uv(), clock, float(1), signal, bootArtScale);
    m.colorNode = vec4(sample.rgb, sample.a.mul(cardAlpha));
    return m;
  }, [resources, cardAlpha, clock, signal, bootArtScale]);

  const macMaterial = useMemo(() => {
    const m = new MeshBasicNodeMaterial(); m.name = "Mac / convex CRT glass and phosphor";
    // The glass is physically convex; flatten it into the shared first ASCII tile.
    const local = positionLocal.xy.div(vec2(RETRO_MAC_SCREEN.width, RETRO_MAC_SCREEN.height)).mul(2);
    const dome = float(1).sub(local.x.mul(local.x)).max(0).mul(float(1).sub(local.y.mul(local.y)).max(0)).mul(.20).mul(glassFraming).mul(macAscii.oneMinus());
    m.positionNode = vec3(positionLocal.xy, positionLocal.z.add(dome));
    m.colorNode = Fn(() => {
      const bootUv = uv().sub(.5).mul(bootUvScale).add(.5);
      const loading = crtSignal(resources.boot.sampleColor, bootUv, clock, float(1), float(0), macArtScale);
      const screenSignal = (p: Node<"vec2">) => {
        const faceUv = p.sub(.5).mul(faceUvScale).add(.5);
        const phosphor = vec3(.009, .021, .014)
          .mul(float(1).sub(smoothstep(.08, .70, length(p.sub(.5)))))
          .mul(glassFraming).mul(macAscii.oneMinus());
        return mix(resources.desktop.sampleColor(p).add(phosphor), face.sampleColor(faceUv), resources.desktop.faceMix.max(macAscii));
      };
      const glass = crtSignal(screenSignal, uv(), clock, macAscii.oneMinus());
      const readyScreen = mix(glass.rgb.mul(1.35), screenSignal(uv()), macAscii);
      return vec4(mix(readyScreen, loading.rgb, macBoot), 1);
    })(); return m;
  }, [resources, face, clock, bootUvScale, faceUvScale, macBoot, macAscii, macArtScale, glassFraming]);
  const caseMaterial = useMemo(() => new MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0 }), []);
  const pipeline = useMemo(() => {
    const scenePass = pass(scene, camera), color = scenePass.getTextureNode("output");
    const glow = bloom(color, .25, .35, .68); glow.setResolutionScale(.3);
    const q = uv().sub(.5), coord = q.mul(q.dot(q).mul(.028).mul(intensity).mul(terminalAlpha.oneMinus()).add(1)).add(.5);
    const split = vec2(float(.00028).add(burst.mul(.004)).mul(intensity), 0);
    const sharp = vec3(color.sample(coord.add(split)).r, color.sample(coord).g, color.sample(coord.sub(split)).b);
    const ray = q.mul(burst.mul(.10));
    const trail = color.sample(coord.sub(ray.mul(.33))).rgb.mul(.44).add(color.sample(coord.sub(ray.mul(.66))).rgb.mul(.33)).add(color.sample(coord.sub(ray)).rgb.mul(.23));
    const rgb = mix(sharp, trail, burst.mul(.38));
    const scan = sin(uv().y.mul(pixels.y).mul(3.14159)).mul(.025).mul(intensity).add(.975);
    const edge = float(1).sub(smoothstep(.26, .72, length(q)).mul(.26).mul(intensity));
    const grain = fract(sin(uv().mul(vec2(1431, 937)).add(clock.mul(.015)).dot(vec2(12.9898, 78.233))).mul(43758.5453)).sub(.5).mul(.006).mul(intensity);
    const render = new RenderPipeline(renderer); render.outputNode = vec4(rgb.mul(scan).mul(edge).add(vec3(grain)), 1).add(glow);
    return { render, scenePass, glow };
  }, [scene, camera, renderer, clock, intensity, pixels, burst, terminalAlpha]);

  useEffect(() => {
    const capture = createTerminalSurface(surface, () => {
      if (uploadedSize.current.width !== capture.canvas.width || uploadedSize.current.height !== capture.canvas.height) {
        resources.map.dispose(); uploadedSize.current = { width: capture.canvas.width, height: capture.canvas.height };
      }
      resources.map.image = capture.canvas; resources.map.needsUpdate = true; targetDirty.current = true;
      const w = capture.canvas.width, h = capture.canvas.height;
      if (resources.target.width !== w || resources.target.height !== h) resources.target.setSize(w, h);
      pixels.value.set(w, h);
      const box = surface.getBoundingClientRect(), cb = surface.querySelector<HTMLElement>("[data-terminal-cursor]")?.getBoundingClientRect();
      if (cb && box.width && box.height) cursor.value.set((cb.left - box.left) / box.width, 1 - (cb.bottom - box.top) / box.height, cb.width / box.width, cb.height / box.height);
      else cursor.value.set(-2, -2, 0, 0);
      invalidate();
    });
    capture.refresh(); return () => capture.dispose();
  }, [surface, resources, pixels, cursor, invalidate]);
  useEffect(() => {
    const measure = () => {
      const rect = surface.getBoundingClientRect(), cr = renderer.domElement.getBoundingClientRect();
      contentRect.value.set((rect.left - cr.left) / size.width, (cr.bottom - rect.bottom) / size.height, rect.width / size.width, rect.height / size.height);
      monitor.current?.scale.set(viewport.width, viewport.height, 1); monitor.current?.position.set(0, 0, 0);
      monitorBack.current?.scale.set(viewport.width * .995, viewport.height * .97, .2); monitorBack.current?.position.set(0, 0, -.16);
      bootScreen.current?.scale.set(viewport.width, viewport.height, 1);
      const aspect = size.width / size.height;
      portalFit.value.set(Math.max(1, 1 / aspect), Math.max(1, aspect));
      bootArtScale.value.set(Math.max(1, aspect / 1.6), Math.max(1, 1.6 / aspect));
      face.uniforms.aspect.value = size.width / size.height;
      // Skyworks uses a 20-physical-pixel square character cell. Retain enough
      // cells on narrow screens for the Mac's eyes and mouth to stay legible.
      const glyphCell = Math.min(20 / renderer.getPixelRatio(), size.width / 48, size.height / 40);
      face.uniforms.grid.value.set(Math.round(size.width / glyphCell), Math.round(size.height / glyphCell));
      invalidate();
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(surface); return () => observer.disconnect();
  }, [surface, renderer, size, viewport, face, invalidate, bootArtScale, contentRect, portalFit]);
  useEffect(() => {
    intensity.value = level === "full" ? 1 : .38; tint.value.set(theme === "green" ? "#8edcae" : "#e1b16d");
    const move = () => invalidate(); window.addEventListener("pointermove", move, { passive: true });
    const timer = level === "low" ? window.setInterval(invalidate, 500) : undefined;
    return () => { window.removeEventListener("pointermove", move); clearInterval(timer); };
  }, [level, theme, intensity, tint, invalidate]);
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onFailure(); };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => renderer.domElement.removeEventListener("webglcontextlost", lost);
  }, [renderer, onFailure]);
  useEffect(() => () => {
    resources.map.dispose(); resources.target.dispose(); resources.copy.dispose(); resources.geometry.dispose();
    resources.boot.dispose(); resources.desktop.dispose(); face.dispose();
    for (const m of [material, portalMaterial, bootMaterial, macMaterial, caseMaterial]) m.dispose();
    pipeline.render.dispose(); pipeline.scenePass.dispose(); pipeline.glow.dispose(); delete window.__hadesdGraphics;
  }, [resources, material, portalMaterial, bootMaterial, macMaterial, caseMaterial, pipeline, face]);

  useFrame(({ clock: frameClock }) => {
    // React may commit after the next GPU frame. Read the phase and its progress
    // from the same clock so a new phase's zero cannot rewind the previous card.
    const phase = phaseState.current;
    const elapsed = frameClock.elapsedTime;
    clock.value = reducedMotion ? 1 : elapsed;
    const p = progress.current, phaseP = phaseProgress.current;
    const portalActive = import.meta.env.DEV && foregroundMode === "circuit" && phase === "journey";
    const rolling = MathUtils.smootherstep(p, MAC_SCREEN_HANDOFF, 1);
    const motion = sceneMotion(phase, phaseP, p);
    burst.value = reducedMotion ? 0 : motion.burst;
    signal.value = 0;
    glassFraming.value = motion.framed;
    journey.value = p; mouse.value.set(pointer.current.x, pointer.current.y);
    face.uniforms.time.value = reducedMotion ? 1 : elapsed;
    face.uniforms.progress.value = p;
    face.uniforms.blinkEnabled.value = reducedMotion ? 0 : 1;
    hardwareProgress.current = phase === "journey" ? p : 0;
    const presentation = phase === "pullback" || phase === "hero" || (phase === "journey" && p < MAC_SCREEN_HANDOFF) ? motion.framed : 0;
    const lens = computerLens(presentation);
    if ((camera as PerspectiveCamera).fov !== lens.fov) {
      (camera as PerspectiveCamera).fov = lens.fov;
      camera.updateProjectionMatrix();
    }
    camera.position.set(0, (size.width < 700 ? 1.05 : 1.25) * presentation,
      lens.distance + (phase === "journey" ? Math.sin(rolling * Math.PI) * 16.5 : 0));
    camera.lookAt(0, 0, 0);
    terminalAlpha.value = portalActive ? ease(.82, .94, p) : motion.terminalAlpha;
    portalAlignment.value = ease(.82, .94, p);
    portalInk.value = ease(.48, .55, p);
    floorOpacity.current = motion.worldAlpha;
    caseMaterial.opacity = terminalAlpha.value;
    if (keyLight.current) keyLight.current.intensity = 2.3 + (phase === "journey" ? .4 * ease(0, .18, p) : 0);
    cardAlpha.value = phase === "penetrate" ? motion.bootAlpha : 1;
    if (bootScreen.current) {
      bootScreen.current.visible = phase === "resume" || phase === "penetrate";
      bootScreen.current.position.z = motion.entryDepth;
      bootScreen.current.scale.set(viewport.width, viewport.height, 1);
      bootScreen.current.rotation.y = 0;
    }
    const terminalUnderlay = portalActive && p >= SIGNAL_PORTAL.fillsViewportAt;
    if (monitor.current) {
      monitor.current.visible = terminalUnderlay || motion.terminalAlpha > 0;
      monitor.current.position.z = terminalUnderlay ? camera.position.z - 11 : 0;
    }
    if (monitorBack.current) {
      monitorBack.current.visible = terminalUnderlay || motion.terminalAlpha > 0;
      monitorBack.current.position.z = (terminalUnderlay ? camera.position.z - 11 : 0) - .16;
    }
    resources.boot.paint(bootProgress.current, phase, phaseP);
    resources.desktop.update(elapsed, !reducedMotion && (phase === "pullback" || phase === "hero"));
    if (mac.current) {
      mac.current.visible = ["boot", "pullback", "hero", "journey"].includes(phase) && p < MAC_SCREEN_HANDOFF;
      const mobile = size.width < 700;
      const heroScale = mobile ? Math.min(viewport.width / 6.6, .68) : Math.min(viewport.width / 14.0, viewport.height / 8.1, 1.05);
      const fullScale = Math.max(viewport.width / RETRO_MAC_SCREEN.width, viewport.height / RETRO_MAC_SCREEN.height) * 1.025;
      const hx = mobile ? .12 : viewport.width * .20, hy = mobile ? -.75 : .08;
      const framed = motion.framed;
      const artAspect = MathUtils.lerp(size.width / size.height, RETRO_MAC_SCREEN.width / RETRO_MAC_SCREEN.height, framed);
      macArtScale.value.set(Math.max(1, artAspect / 1.6), Math.max(1, 1.6 / artAspect));
      const scale = MathUtils.lerp(fullScale, heroScale, framed);
      mac.current.scale.setScalar(scale);
      // Keep the feet and keyboard level; the camera supplies the elevated view.
      mac.current.rotation.set(0, ((mobile ? -.38 : -.65) + (reducedMotion ? 0 : pointer.current.x * .035)) * framed, 0);
      screenOffset.set(0, .65, 1.06).multiplyScalar(scale).applyQuaternion(mac.current.quaternion);
      // Keep the close-up centered on the very same physical CRT plane.
      const heroScreenY = hy + .65 * heroScale;
      mac.current.position.set(hx * framed - screenOffset.x * (1 - framed),
        MathUtils.lerp(0, heroScreenY, framed) - screenOffset.y,
        -screenOffset.z * (1 - framed));
      bootUvScale.value.set(MathUtils.lerp(2.7 * fullScale / viewport.width, 1, framed), MathUtils.lerp(2.05 * fullScale / viewport.height, 1, framed));
      faceUvScale.value.set(...macFaceUvScale(RETRO_MAC_SCREEN.width, RETRO_MAC_SCREEN.height,
        viewport.width, viewport.height, fullScale, framed));
      macBoot.value = motion.bootMix;
      macAscii.value = phase === "journey" ? ease(.035, .22, p) : 0;
      floorY.current = mac.current.visible
        ? computerGroundHeight(RETRO_COMPUTER_BOUNDS, mac.current.position.y, mac.current.quaternion, scale) - .004 * scale
        : -viewport.height * .445 * camera.position.z / 11;
      computerGround.current.x = mac.current.position.x;
      computerGround.current.z = mac.current.position.z;
      computerGround.current.scale = scale;
      computerGround.current.yaw = mac.current.rotation.y;
    }
  }, -1);
  useFrame(({ frameloop }) => {
    const phase = phaseState.current, p = progress.current, phaseP = phaseProgress.current;
    const frameRateTarget = level === "full" ? (phase === "terminal" ? 60 : 120) : 30;
    // R3F resets clock.elapsedTime when switching always/demand. Use monotonic
    // wall time for the continuous cap and honor every demand/input invalidation.
    const nowMs = performance.now();
    if (!shouldSubmitFrame({ nowMs, previousMs: lastFrame.current, frameRateTarget,
      demand: frameloop === "demand", phaseChanged: phase !== lastSubmittedPhase.current,
      textureDirty: targetDirty.current, hidden: document.hidden })) return;
    lastFrame.current = nowMs;
    lastSubmittedPhase.current = phase;
    renderer.info.reset();
    const started = performance.now();
    try {
      fiberClock.beginFrame();
      if (targetDirty.current) {
        renderer.setRenderTarget(resources.target); renderer.render(resources.sourceScene, resources.sourceCamera); renderer.setRenderTarget(null); targetDirty.current = false;
      }
      pipeline.render.render();
      if (!reported.current) {
        reported.current = true;
        const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2";
        onInitialized(backend);
        window.__hadesdGraphics = { backend, frames: 0, renderTargets: 2, tsl: true, textTexture: true, width: size.width, height: size.height, textureWidth: resources.target.width, textureHeight: resources.target.height,
          introPhase: phase, journey: p, phaseProgress: phaseP, bootProgress: bootProgress.current, revealStep, asciiActive: false, asciiTilesVisible: false, hardwareVisible: false, visibleHardwareCount: 0, binaryStreamsVisible: false, visibleBinaryStreamCount: 0, macVisible: false,
          bootScreenVisible: false, bootScreenZ: 0, bootScreenAlpha: 0, bootSequence: resources.boot.sequence.value, macPreset: 0, macScreenSeconds: 0,
          foregroundEffect: foregroundMode, visibleForegroundCount: 0, foregroundPose: [],
          portalActive: false, portalCoversViewport: false, portalCrossedCamera: false, portalLeaderZ: -20, terminalUnderlay: false,
          carouselRotation: 0,
          portalShape, portalRotation: 0,
          drawCalls: 0, triangles: 0, points: 0, lines: 0, textures: 0, geometries: 0, renderCpuMs: 0, dpr: 1, frameRateTarget, reflection: true, fiberClockOwned: fiberClock.owned };
      }
      if (window.__hadesdGraphics) {
        const hardware = scene.getObjectByName("hardware-components-field");
        const foreground = import.meta.env.DEV ? scene.getObjectByName(`foreground-${foregroundMode}`) : undefined;
        const foregroundPose: number[] = [];
        if (foreground?.visible) foreground.traverse(object => {
          foregroundPose.push(...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray());
          if (object instanceof Mesh) {
            const positions = object.geometry.getAttribute("position");
            if (positions) for (const index of [0, Math.floor(positions.count / 2), positions.count - 1]) {
              foregroundPose.push(positions.getX(index), positions.getY(index), positions.getZ(index));
            }
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(material => {
              if ("map" in material && material.map instanceof CanvasTexture) foregroundPose.push(...material.map.offset.toArray());
            });
          }
        });
        Object.assign(window.__hadesdGraphics, { introPhase: phase, journey: p, phaseProgress: phaseP, bootProgress: bootProgress.current, revealStep, asciiActive: phase === "journey" && p > .20,
          asciiTilesVisible: !!scene.getObjectByName("ascii-screen-carousel")?.visible,
          bootScreenVisible: !!bootScreen.current?.visible, bootScreenZ: bootScreen.current?.position.z ?? 0, bootScreenAlpha: cardAlpha.value,
          bootSequence: resources.boot.sequence.value, macPreset: resources.desktop.uniforms.preset.value, macScreenSeconds: resources.desktop.uniforms.seconds.value,
          hardwareVisible: false, visibleHardwareCount: 0,
          binaryStreamsVisible: !!hardware?.visible, visibleBinaryStreamCount: hardware?.visible ? Number(hardware.userData.visibleStreamCount || 0) : 0,
          foregroundEffect: foregroundMode, visibleForegroundCount: foreground?.visible ? Number(foreground.userData.itemCount || 0) : 0, foregroundPose,
          portalActive: foregroundMode === "circuit" && phase === "journey",
          portalCoversViewport: Boolean(foreground?.userData.apertureCoversViewport),
          portalCrossedCamera: Boolean(foreground?.userData.crossedCamera),
          portalLeaderZ: Number(foreground?.userData.leaderZ ?? -20),
          carouselRotation: Number(scene.getObjectByName("ascii-screen-carousel")?.userData.scrollRotation ?? 0),
          portalShape, portalRotation: Number(foreground?.userData.leaderRotation ?? 0),
          terminalUnderlay: foregroundMode === "circuit" && phase === "journey" && p >= SIGNAL_PORTAL.fillsViewportAt,
          drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, points: renderer.info.render.points, lines: renderer.info.render.lines,
          textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, renderCpuMs: performance.now() - started, dpr: renderer.getPixelRatio(), frameRateTarget,
          macVisible: !!mac.current?.visible, width: size.width, height: size.height, textureWidth: resources.target.width, textureHeight: resources.target.height });
        window.__hadesdGraphics.frames++;
      }
    } catch (error) {
      console.warn("HADESD display initialization failed; opening the DOM terminal.", error instanceof Error ? error.message : "graphics unavailable"); onFailure();
    } finally { fiberClock.endFrame(); }
  }, 1);
  const caseGeometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 4, .035), []);
  useEffect(() => () => caseGeometry.dispose(), [caseGeometry]);
  return <>
    <color attach="background" args={["#000000"]} />
    <Atmosphere floorY={floorY} floorOpacity={floorOpacity} computerGround={computerGround} level={level} reducedMotion={reducedMotion} />
    <ambientLight intensity={.38} />
    <hemisphereLight args={["#d5cbd7", "#302622", .65]} />
    <directionalLight ref={keyLight} position={[-3, 7, 5]} intensity={2.3} color="#ffebd3" />
    <directionalLight position={[6, 4, -4]} intensity={2.2} color="#baaccb" />
    <pointLight position={[4, 1, 6]} intensity={8} color="#e0cab8" distance={18} />
    <group ref={mac} visible={false}><RetroMac screenMaterial={macMaterial} /></group>
    <mesh ref={bootScreen} visible={false}><planeGeometry args={[1, 1]} /><primitive object={bootMaterial} attach="material" /></mesh>
    <AsciiCarousel width={viewport.width} height={viewport.height} face={face} bootMaterial={bootMaterial} progress={progress} phaseState={phaseState} terminalPortal={import.meta.env.DEV && foregroundMode === "circuit"} />
    {ForegroundEffects && foregroundMode !== "binary"
      ? <Suspense fallback={null}><ForegroundEffects mode={foregroundMode} progress={hardwareProgress} pointer={pointer} reducedMotion={reducedMotion} portalMaterial={portalMaterial} portalShape={portalShape} /></Suspense>
      : <HardwareField progress={hardwareProgress} pointer={pointer} reducedMotion={reducedMotion} />}
    <mesh ref={monitorBack} geometry={caseGeometry} material={caseMaterial} visible={false} />
    <mesh ref={monitor} visible={false}><planeGeometry args={[1, 1, 24, 16]} /><primitive object={material} attach="material" /></mesh>
  </>;
}

export default function TerminalScene(props: Props) {
  const pending = useRef<Promise<WebGLRenderer> | null>(null);
  const initializedRenderer = useRef<WebGPURenderer | null>(null);
  const alive = useRef(true);
  const disposeInitialized = useCallback(() => {
    const renderer = initializedRenderer.current;
    if (!renderer) return;
    initializedRenderer.current = null;
    renderer.onDeviceLost = () => {};
    void Promise.resolve(renderer.dispose()).catch(() => {
      console.warn("HADESD display was detached before its backend finished cleanup.");
    });
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // R3F's WebGL-oriented unmount does not dispose WebGPURenderer. Wait past
      // StrictMode's synchronous effect replay before releasing the real owner.
      queueMicrotask(() => { if (!alive.current) disposeInitialized(); });
    };
  }, [disposeInitialized]);
  const createRenderer = useCallback((parameters: FiberRendererParameters) => {
    if (!pending.current) pending.current = (async () => {
      const forceWebGL = new URLSearchParams(location.search).get("gpu") === "webgl";
      const renderer = new WebGPURenderer({ ...(parameters as WebGPURendererParameters), antialias: false, alpha: false, forceWebGL, powerPreference: "high-performance" });
      renderer.toneMapping = NoToneMapping;
      renderer.info.autoReset = false;
      renderer.onDeviceLost = props.onFailure;
      try {
        await renderer.init();
      } catch {
        // R3F awaits this factory outside React's error boundary. Unmount the
        // Canvas through the host fallback without rejecting its configure job.
        // An uninitialized Three renderer cannot be disposed: dispose() starts
        // its failed init again through setAnimationLoop(null).
        if (alive.current) props.onFailure();
        return new Promise<WebGLRenderer>(() => {});
      }
      initializedRenderer.current = renderer;
      if (!alive.current) {
        disposeInitialized();
        return new Promise<WebGLRenderer>(() => {});
      }
      return renderer as unknown as WebGLRenderer;
    })();
    return pending.current;
  }, [props.onFailure, disposeInitialized]);
  return <Canvas className="stage-graphics" aria-hidden="true" camera={{ position: [0, 0, 11], fov: 44, near: .1, far: 200 }}
    shadows={{ enabled: false, type: PCFShadowMap }} gl={createRenderer} dpr={scenePixelRatio(typeof innerWidth === "number" ? innerWidth : 1440, typeof innerHeight === "number" ? innerHeight : 900, typeof devicePixelRatio === "number" ? devicePixelRatio : 1)} frameloop={props.reducedMotion || (props.ready && props.level === "low") ? "demand" : "always"}
    fallback={null} onPointerMissed={() => {}}>
    <Display {...props} />
  </Canvas>;
}
