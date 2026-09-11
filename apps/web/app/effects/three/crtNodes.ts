import { type Node, type Texture } from "three/webgpu";
import { abs, float, floor, fract, length, mix, sin, smoothstep, step, texture, vec2, vec3, vec4 } from "three/tsl";

export type ScreenSignal = (coordinate: Node<"vec2">) => Node<"vec3">;

/** Shared near-full-viewport aperture with a rounded fade into black. */
export function crtAperture(coordinate: Node<"vec2">) {
  return float(1).sub(smoothstep(.057, .066,
    length(abs(coordinate.sub(.5)).sub(vec2(.429, .414)).max(0))));
}

/** Apply the lens to the complete signal, including ASCII and preset content. */
export function crtSignal(sample: ScreenSignal, coordinate: Node<"vec2">, clock: Node<"float">,
  strength: Node<"float">, signal: Node<"float"> = float(0),
  contentScale: Node<"vec2"> = vec2(1)) {
  const q = coordinate.sub(.5);
  const warped = q.mul(q.dot(q).mul(.24).mul(strength).add(1)).add(.5);
  const row = floor(warped.y.mul(64));
  const shift = sin(row.mul(7.3).add(clock.mul(31))).mul(signal).mul(.009);
  const v = warped.add(vec2(shift, 0));
  const split = vec2(float(.0008).add(abs(q.x).mul(.0018)).mul(strength), 0);
  const sampleUv = v.sub(.5).mul(contentScale).add(.5);
  const rgb = vec3(sample(sampleUv.add(split)).r, sample(sampleUv).g, sample(sampleUv.sub(split)).b);
  const inside = crtAperture(coordinate);
  const scan = sin(v.y.mul(1600)).mul(.065).mul(strength).add(float(1).sub(strength.mul(.06)));
  const vignette = float(1).sub(smoothstep(.18, .68, length(q)).mul(.43).mul(strength));
  // A faint broad reflection can reveal the unlit tube without tracing its edge.
  const glint = float(1).sub(smoothstep(.04, .24, length(q.sub(vec2(-.24, .31)).mul(vec2(.7, 1.8))))).mul(.008);
  return vec4(rgb.mul(scan).mul(vignette).add(vec3(glint)).mul(inside), inside);
}

/** Compatibility for simple texture sources; new animated screens supply a signal. */
export function crtSample(map: Texture, coordinate: Node<"vec2">, clock: Node<"float">,
  strength: Node<"float">, signal: Node<"float"> = float(0), progress?: Node<"float">,
  contentScale: Node<"vec2"> = vec2(1)) {
  return crtSignal((p) => {
    const source = texture(map, p).rgb;
    const barX = p.x.sub(426 / 1440).mul(1440 / 23.5);
    const blocks = progress ? step(0, barX).mul(step(barX, floor(progress.mul(25))))
      .mul(step(fract(barX), 18 / 23.5)).mul(step(1 - 529 / 900, p.y)).mul(step(p.y, 1 - 492 / 900)) : float(0);
    return mix(source, vec3(.76, .76, .51), blocks);
  }, coordinate, clock, strength, signal, contentScale);
}

/** Three smooth octaves, evaluated in the fragment shader; no animated bitmap uploads. */
export function mistNoise(p: Node<"vec2">) {
  const hash = (v: Node<"vec2">) => fract(sin(v.dot(vec2(127.1, 311.7))).mul(43758.5453));
  const noise = (v: Node<"vec2">) => {
    const i = floor(v), f = fract(v), w = f.mul(f).mul(float(3).sub(f.mul(2)));
    return mix(mix(hash(i), hash(i.add(vec2(1, 0))), w.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(1)), w.x), w.y);
  };
  return noise(p).mul(.57).add(noise(p.mul(2.07).add(13.4)).mul(.29)).add(noise(p.mul(4.13).add(31.7)).mul(.14));
}
