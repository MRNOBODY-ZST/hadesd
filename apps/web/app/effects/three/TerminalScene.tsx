import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type GLProps } from "@react-three/fiber";
import {
  CanvasTexture, Color, DirectionalLight, Group, LinearFilter, MathUtils, Mesh, MeshBasicNodeMaterial, MeshStandardMaterial, NoToneMapping,
  OrthographicCamera, PlaneGeometry, RenderPipeline, RenderTarget, Scene,
  SRGBColorSpace, Vector2, Vector3, Vector4, WebGPURenderer, type WebGPURendererParameters,
} from "three/webgpu";
import type { WebGLRenderer } from "three";
import { createAsciiFace } from "./asciiFace";
import { AsciiCarousel } from "./AsciiCarousel";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Fn, abs, cos, float, fract, length, mix, pass, sin, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type { CrtLevel, Theme } from "@hadesd/contracts";
import type { IntroPhase } from "../timeline";
import { createTerminalSurface } from "./terminalTexture";
import { RetroMac, RETRO_MAC_SCREEN } from "./RetroMac";
import { MAC_SCREEN_HANDOFF, macFaceUvScale } from "./screenProjection";
import { HardwareField } from "./HardwareParts";
import { createBootTexture, createMacScreenTexture } from "./introTextures";

type Props = {
  surface: HTMLElement; theme: Theme; level: CrtLevel; ready: boolean; phase: IntroPhase;
  bootProgress: MutableRefObject<number>; progress: MutableRefObject<number>;
  phaseState: MutableRefObject<IntroPhase>; phaseProgress: MutableRefObject<number>; revealStep: number;
  pointer: MutableRefObject<{ x: number; y: number }>; reducedMotion: boolean;
  onInitialized: (backend: string) => void; onFailure: () => void;
};
type RendererStats = {
  backend: string; frames: number; renderTargets: number; tsl: true; textTexture: true;
  width: number; height: number; textureWidth: number; textureHeight: number;
  introPhase: IntroPhase; journey: number; phaseProgress: number; bootProgress: number; revealStep: number; asciiActive: boolean; asciiTilesVisible: boolean; hardwareVisible: boolean; visibleHardwareCount: number; macVisible: boolean;
  bootScreenVisible: boolean; bootScreenZ: number; bootScreenAlpha: number;
};
type FiberRendererParameters = Parameters<Extract<GLProps, (...args: never[]) => unknown>>[0];
declare global { interface Window { __hadesdGraphics?: RendererStats } }
const ease = (start: number, end: number, value: number) => MathUtils.smoothstep(value, start, end);

function Display({ surface, theme, level, phaseState, bootProgress, progress, phaseProgress, revealStep, pointer, reducedMotion, onInitialized, onFailure }: Props) {
  const { gl: fiberRenderer, scene, camera, size, invalidate } = useThree();
  const viewport = useMemo(() => { const height = 2 * Math.tan(22 * Math.PI / 180) * 11; return { width: height * size.width / size.height, height }; }, [size.width, size.height]);
  const renderer = fiberRenderer as unknown as WebGPURenderer;
  const reported = useRef(false), lastFrame = useRef(-1), targetDirty = useRef(true);
  const uploadedSize = useRef({ width: 0, height: 0 });
  const clock = useMemo(() => uniform(0), []), journey = useMemo(() => uniform(0), []);
  const mouse = useMemo(() => uniform(new Vector2()), []);
  const pixels = useMemo(() => uniform(new Vector2(1200, 700)), []);
  const face = useMemo(() => createAsciiFace(), []);
  const macBoot = useMemo(() => uniform(1), []), macAscii = useMemo(() => uniform(0), []);
  const bootUvScale = useMemo(() => uniform(new Vector2(1, 1)), []);
  const faceUvScale = useMemo(() => uniform(new Vector2(1, 1)), []);
  const cardAlpha = useMemo(() => uniform(1), []);
  const hardwareProgress = useRef(0);
  const workbench = useMemo(() => uniform(1), []);
  const cursor = useMemo(() => uniform(new Vector4(-2, -2, 0, 0)), []);
  const intensity = useMemo(() => uniform(1), []), terminalAlpha = useMemo(() => uniform(0), []);
  const tint = useMemo(() => uniform(new Color("#b9955b")), []);
  const monitor = useRef<Mesh>(null), monitorBack = useRef<Mesh>(null), mac = useRef<Group>(null);
  const bootScreen = useRef<Mesh>(null), shadow = useRef<Mesh>(null);
  const screenOffset = useMemo(() => new Vector3(), []);
  const keyLight = useRef<DirectionalLight>(null);
  const projected = useMemo(() => new Vector3(), []);
  const resources = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
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

  const material = useMemo(() => {
    const m = new MeshBasicNodeMaterial(); m.name = "HADESD / live terminal phosphor"; m.transparent = true;
    m.colorNode = Fn(() => {
      const q = uv().sub(.5), curved = q.mul(q.dot(q).mul(.075).add(1)).add(.5);
      const distance = length(curved.sub(mouse.mul(.5).add(.5)));
      const touch = sin(distance.mul(43).sub(clock.mul(2.4))).mul(float(1).sub(smoothstep(0, .4, distance))).mul(.0007).mul(intensity);
      const coord = curved.add(vec2(touch, touch.mul(.45)));
      const split = vec2(float(.00012).add(abs(q.x).mul(.0007)).mul(intensity), 0);
      const rgb = vec3(texture(resources.target.texture, coord.add(split)).r, texture(resources.target.texture, coord).g, texture(resources.target.texture, coord.sub(split)).b);
      const scan = sin(coord.y.mul(pixels.y).mul(Math.PI)).mul(.08).mul(intensity).add(float(1).sub(intensity.mul(.065)));
      const mask = sin(coord.x.mul(pixels.x).mul(2.094)).mul(.021).mul(intensity).add(.979);
      const vignette = float(1).sub(smoothstep(.23, .76, length(q)).mul(.22));
      const inside = step(0, coord.x).mul(step(coord.x, 1)).mul(step(0, coord.y)).mul(step(coord.y, 1));
      const cursorArea = step(cursor.x, coord.x).mul(step(coord.x, cursor.x.add(cursor.z))).mul(step(cursor.y, coord.y)).mul(step(coord.y, cursor.y.add(cursor.w)));
      const blink = step(0, sin(clock.mul(5.5)));
      const content = mix(rgb, vec3(.003, .005, .004), cursorArea.mul(blink)).mul(scan).mul(mask).mul(vignette);
      const sweep = float(1).sub(smoothstep(.002, .012, abs(coord.y.sub(fract(clock.mul(.052)))))).mul(.016).mul(intensity);
      return vec4(content.add(tint.mul(sweep)).mul(inside), inside.mul(terminalAlpha));
    })(); return m;
  }, [resources, clock, mouse, intensity, pixels, cursor, tint, terminalAlpha]);

  const bootMaterial = useMemo(() => {
    const m = new MeshBasicNodeMaterial(); m.transparent = true; m.name = "DOS / boot phosphor";
    m.colorNode = Fn(() => {
      const q = uv().sub(.5), v = q.mul(q.dot(q).mul(.12).add(1)).add(.5);
      const sample = v, split = vec2(.00115, 0);
      const rgb = vec3(texture(resources.boot.texture, sample.add(split)).r, texture(resources.boot.texture, sample).g, texture(resources.boot.texture, sample.sub(split)).b);
      const corners = abs(q).sub(vec2(.45, .43));
      const border = float(1).sub(smoothstep(.035, .05, length(corners.max(0))));
      const scan = sin(v.y.mul(1800)).mul(.09).add(.91);
      const vignette = float(1).sub(smoothstep(.15, .72, length(q)).mul(.30));
      return vec4(rgb.mul(scan).mul(vignette), border.mul(cardAlpha));
    })(); return m;
  }, [resources, cardAlpha]);

  const macMaterial = useMemo(() => {
    const m = new MeshBasicNodeMaterial(); m.name = "Mac / continuous DOS-to-prompt screen";
    m.colorNode = Fn(() => {
      const q = uv().sub(.5), v = q.mul(q.dot(q).mul(.045).add(1)).add(.5);
      const bootUv = v.sub(.5).mul(bootUvScale).add(.5);
      const loading = texture(resources.boot.texture, bootUv).rgb;
      const bounds = resources.desktop.cursor;
      const caret = step(bounds[0], v.x).mul(step(v.x, bounds[0] + bounds[2])).mul(step(bounds[1], v.y)).mul(step(v.y, bounds[1] + bounds[3])).mul(step(0, sin(clock.mul(5.5))));
      const prompt = texture(resources.desktop.texture, v).rgb.add(vec3(.60, .76, .54).mul(caret));
      const faceUv = uv().sub(.5).mul(faceUvScale).add(.5);
      const readyScreen = mix(prompt, face.sampleColor(faceUv), macAscii);
      const scan = sin(v.y.mul(1200)).mul(.045).add(.955);
      // The two surfaces share the same image and global CRT at the handoff.
      return vec4(mix(readyScreen, loading, macBoot).mul(mix(scan, 1, macAscii)), 1);
    })(); return m;
  }, [resources, face, clock, bootUvScale, faceUvScale, macBoot, macAscii]);
  const background = useMemo(() => {
    const m = new MeshBasicNodeMaterial(); m.name = "workbench / diffuse light";
    m.colorNode = Fn(() => {
      const p = uv().sub(.5);
      const pool = float(1).sub(smoothstep(.03, .48, length(p.sub(vec2(.15, -.12)).mul(vec2(1.1, .8)))));
      const falloff = float(1).sub(smoothstep(.32, .71, length(p)));
      const horizontal = sin(p.y.mul(220)).mul(.0014);
      return vec4(vec3(.009, .012, .016).add(vec3(.044, .052, .070).mul(pool.pow(2))).mul(falloff.mul(.4).add(.6)).add(vec3(horizontal)).mul(workbench), 1);
    })(); return m;
  }, [workbench]);
  const caseMaterial = useMemo(() => new MeshStandardMaterial({ color: "#282d2d", metalness: .3, roughness: .48, transparent: true, opacity: 0 }), []);
  const contactMaterial = useMemo(() => {
    const m = new MeshBasicNodeMaterial(); m.transparent = true; m.depthWrite = false;
    m.colorNode = Fn(() => vec4(vec3(0), float(1).sub(smoothstep(.12, .5, length(uv().sub(.5)))).mul(.7)))(); return m;
  }, []);
  const pipeline = useMemo(() => {
    const scenePass = pass(scene, camera), color = scenePass.getTextureNode("output");
    const glow = bloom(color, .18, .35, .92); glow.setResolutionScale(.35);
    const q = uv().sub(.5), coord = q.mul(q.dot(q).mul(.028).mul(intensity).add(1)).add(.5);
    const split = vec2(float(.00028).mul(intensity), 0);
    const rgb = vec3(color.sample(coord.add(split)).r, color.sample(coord).g, color.sample(coord.sub(split)).b);
    const scan = sin(uv().y.mul(pixels.y).mul(3.14159)).mul(.025).mul(intensity).add(.975);
    const edge = float(1).sub(smoothstep(.26, .72, length(q)).mul(.26).mul(intensity));
    const grain = fract(sin(uv().mul(vec2(1431, 937)).add(clock.mul(.015)).dot(vec2(12.9898, 78.233))).mul(43758.5453)).sub(.5).mul(.012).mul(intensity);
    const render = new RenderPipeline(renderer); render.outputNode = vec4(rgb.mul(scan).mul(edge).add(vec3(grain)), 1).add(glow);
    return { render, scenePass, glow };
  }, [scene, camera, renderer, clock, intensity, pixels]);

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
      const w = rect.width / size.width * viewport.width, h = rect.height / size.height * viewport.height;
      const x = ((rect.left + rect.width / 2 - cr.left) / size.width - .5) * viewport.width;
      const y = (.5 - (rect.top + rect.height / 2 - cr.top) / size.height) * viewport.height;
      monitor.current?.scale.set(w, h, 1); monitor.current?.position.set(x, y, 0);
      monitorBack.current?.scale.set(w + .34, h + .34, .2); monitorBack.current?.position.set(x, y, -.16);
      bootScreen.current?.scale.set(viewport.width, viewport.height, 1);
      face.uniforms.aspect.value = size.width / size.height;
      // Skyworks uses a 20-physical-pixel square character cell. Retain enough
      // cells on narrow screens for the Mac's eyes and mouth to stay legible.
      const glyphCell = Math.min(20 / renderer.getPixelRatio(), size.width / 48, size.height / 40);
      face.uniforms.grid.value.set(Math.round(size.width / glyphCell), Math.round(size.height / glyphCell));
      invalidate();
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(surface); return () => observer.disconnect();
  }, [surface, renderer, size, viewport, face, invalidate]);
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
    resources.boot.texture.dispose(); resources.desktop.texture.dispose(); face.dispose();
    for (const m of [material, bootMaterial, macMaterial, background, caseMaterial, contactMaterial]) m.dispose();
    pipeline.render.dispose(); pipeline.scenePass.dispose(); pipeline.glow.dispose(); delete window.__hadesdGraphics;
  }, [resources, material, bootMaterial, macMaterial, background, caseMaterial, contactMaterial, pipeline, face]);

  useFrame(({ clock: frameClock }) => {
    // React may commit after the next GPU frame. Read the phase and its progress
    // from the same clock so a new phase's zero cannot rewind the previous card.
    const phase = phaseState.current;
    const elapsed = frameClock.elapsedTime;
    if (elapsed - lastFrame.current < 1 / 30 && (level === "full" || phase !== "terminal")) return;
    lastFrame.current = elapsed; clock.value = reducedMotion ? 1 : elapsed;
    const p = progress.current, phaseP = phaseProgress.current;
    const rolling = MathUtils.smootherstep(p, MAC_SCREEN_HANDOFF, 1);
    journey.value = p; mouse.value.set(pointer.current.x, pointer.current.y);
    face.uniforms.time.value = reducedMotion ? 1 : elapsed;
    face.uniforms.progress.value = p;
    face.uniforms.blinkEnabled.value = reducedMotion ? 0 : 1;
    hardwareProgress.current = phase === "journey" ? p : 0;
    camera.position.z = phase === "journey" ? 11 + Math.sin(rolling * Math.PI) * 16.5 : 11;
    workbench.value = phase === "journey" ? 1 - ease(.18, .25, p) : phase === "resume" || phase === "penetrate" ? 0 : 1;
    terminalAlpha.value = phase === "reveal" || phase === "terminal" ? 1 : 0;
    caseMaterial.opacity = terminalAlpha.value;
    if (keyLight.current) keyLight.current.intensity = phase === "journey" ? 2.7 : 1.55;
    cardAlpha.value = phase === "penetrate" ? 1 - ease(.60, .92, phaseP) : 1;
    if (bootScreen.current) {
      bootScreen.current.visible = phase === "resume" || phase === "penetrate";
      bootScreen.current.position.z = phase === "penetrate" ? MathUtils.smootherstep(phaseP, 0, 1) * 13 : 0;
      bootScreen.current.rotation.y = phase === "penetrate" ? Math.sin(phaseP * Math.PI) * .065 : 0;
    }
    if (monitor.current) monitor.current.visible = terminalAlpha.value > 0;
    if (monitorBack.current) monitorBack.current.visible = terminalAlpha.value > 0;
    resources.boot.paint(bootProgress.current);
    if (mac.current) {
      mac.current.visible = ["boot", "pullback", "hero", "journey"].includes(phase) && p < MAC_SCREEN_HANDOFF;
      const mobile = size.width < 700;
      const heroScale = mobile ? Math.min(viewport.width / 6.6, .82) : Math.min(viewport.height / 7.7, .93);
      const fullScale = Math.max(viewport.width / RETRO_MAC_SCREEN.width, viewport.height / RETRO_MAC_SCREEN.height) * 1.025;
      const hx = mobile ? 0 : viewport.width * .232, hy = mobile ? -viewport.height * .11 : -.18;
      let framed = phase === "boot" ? 0 : phase === "pullback" ? MathUtils.smootherstep(phaseP, 0, 1) : 1;
      if (phase === "journey") framed = 1 - MathUtils.smootherstep(p, 0, MAC_SCREEN_HANDOFF);
      const scale = MathUtils.lerp(fullScale, heroScale, framed);
      mac.current.scale.setScalar(scale);
      mac.current.rotation.set(.11 * framed, -.72 * framed, .025 * framed);
      screenOffset.set(0, .65, 1.06).multiplyScalar(scale).applyQuaternion(mac.current.quaternion);
      // Keep the close-up centered on the very same physical CRT plane.
      const heroScreenY = hy + .65 * heroScale;
      mac.current.position.set(hx * framed - screenOffset.x * (1 - framed),
        MathUtils.lerp(0, heroScreenY, framed) - screenOffset.y,
        -screenOffset.z * (1 - framed));
      bootUvScale.value.set(MathUtils.lerp(2.7 * fullScale / viewport.width, 1, framed), MathUtils.lerp(2.05 * fullScale / viewport.height, 1, framed));
      faceUvScale.value.set(...macFaceUvScale(RETRO_MAC_SCREEN.width, RETRO_MAC_SCREEN.height,
        viewport.width, viewport.height, fullScale, framed));
      macBoot.value = phase === "boot" || phase === "pullback" ? 1 : 0;
      macAscii.value = phase === "journey" ? ease(.035, .22, p) : 0;
      if (shadow.current) {
        shadow.current.visible = mac.current.visible && framed > .8;
        shadow.current.position.set(hx, hy - 2.76 * heroScale, .2);
        shadow.current.scale.setScalar(heroScale);
      }
    }
    try {
      if (targetDirty.current) {
        renderer.setRenderTarget(resources.target); renderer.render(resources.sourceScene, resources.sourceCamera); renderer.setRenderTarget(null); targetDirty.current = false;
      }
      pipeline.render.render();
      if (!reported.current) {
        reported.current = true;
        const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2";
        onInitialized(backend);
        window.__hadesdGraphics = { backend, frames: 0, renderTargets: 2, tsl: true, textTexture: true, width: size.width, height: size.height, textureWidth: resources.target.width, textureHeight: resources.target.height,
          introPhase: phase, journey: p, phaseProgress: phaseP, bootProgress: bootProgress.current, revealStep, asciiActive: false, asciiTilesVisible: false, hardwareVisible: false, visibleHardwareCount: 0, macVisible: false,
          bootScreenVisible: false, bootScreenZ: 0, bootScreenAlpha: 0 };
      }
      if (window.__hadesdGraphics) {
        const hardware = scene.getObjectByName("hardware-components-field");
        Object.assign(window.__hadesdGraphics, { introPhase: phase, journey: p, phaseProgress: phaseP, bootProgress: bootProgress.current, revealStep, asciiActive: phase === "journey" && p > .20,
          asciiTilesVisible: !!scene.getObjectByName("ascii-screen-carousel")?.visible,
          bootScreenVisible: !!bootScreen.current?.visible, bootScreenZ: bootScreen.current?.position.z ?? 0, bootScreenAlpha: cardAlpha.value,
          hardwareVisible: !!hardware?.visible, visibleHardwareCount: hardware?.visible ? hardware.children.filter(part => { part.getWorldPosition(projected).project(camera); return part.visible && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && projected.z >= -1 && projected.z <= 1; }).length : 0,
          macVisible: !!mac.current?.visible, width: size.width, height: size.height, textureWidth: resources.target.width, textureHeight: resources.target.height });
        window.__hadesdGraphics.frames++;
      }
    } catch (error) {
      console.warn("HADESD display initialization failed; opening the DOM terminal.", error instanceof Error ? error.message : "graphics unavailable"); onFailure();
    }
  }, 1);
  const caseGeometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 4, .035), []);
  useEffect(() => () => caseGeometry.dispose(), [caseGeometry]);
  return <>
    <color attach="background" args={["#080a0e"]} />
    <mesh position={[0, 0, -90]}><planeGeometry args={[400, 280]} /><primitive object={background} attach="material" /></mesh>
    <ambientLight intensity={.65} />
    <directionalLight ref={keyLight} position={[-4, 7, 8]} intensity={1.35} color="#fff0da" />
    <pointLight position={[4, 2, 5]} intensity={9} color="#9eb7ff" distance={20} />
    <pointLight position={[-4, -2, 3]} intensity={5} color="#deb996" distance={16} />
    <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[6, 3.8]} /><primitive object={contactMaterial} attach="material" /></mesh>
    <group ref={mac} visible={false}><RetroMac screenMaterial={macMaterial} /></group>
    <mesh ref={bootScreen} visible={false}><planeGeometry args={[1, 1]} /><primitive object={bootMaterial} attach="material" /></mesh>
    <AsciiCarousel width={viewport.width} height={viewport.height} face={face} bootMaterial={bootMaterial} progress={progress} phaseState={phaseState} />
    <HardwareField progress={hardwareProgress} pointer={pointer} reducedMotion={reducedMotion} />
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
    gl={createRenderer} dpr={[1, 1.25]} frameloop={props.reducedMotion || (props.ready && props.level === "low") ? "demand" : "always"}
    fallback={null} onPointerMissed={() => {}}>
    <Display {...props} />
  </Canvas>;
}
