import {
  BufferGeometry, CircleGeometry, CurvePath, ExtrudeGeometry, LatheGeometry,
  LineCurve3, MeshStandardNodeMaterial, Path, RingGeometry, Shape,
  ShapeGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PortalShape } from "./portalShapes";

export type SignalPortalPart = {
  name: string;
  geometry: BufferGeometry;
  material: MeshStandardNodeMaterial;
};

function polygonOutline(shape: Exclude<PortalShape, "ring">) {
  const count = shape === "star" ? 10 : shape === "spark" ? 8 : shape === "hexagon" ? 6 : 4;
  return Array.from({ length: count }, (_, index) => {
    const angle = Math.PI / 2 + index * Math.PI * 2 / count;
    const radius = index % 2 === 1 ? shape === "star" ? .46 : shape === "spark" ? .4 : 1 : 1;
    return new Vector2(Math.cos(angle) * radius * (shape === "diamond" ? .78 : 1), Math.sin(angle) * radius);
  });
}

function polygonRing(points: Vector2[], outer: number, inner: number) {
  const shape = new Shape(points.map(point => point.clone().multiplyScalar(outer)));
  shape.closePath();
  const hole = new Path(points.map(point => point.clone().multiplyScalar(inner)).reverse());
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

/** A beveled metal silhouette with a real opening through its entire depth. */
export function createSignalPortalResources(shape: PortalShape = "ring") {
  const outerRadius = 1;
  const innerRadius = .72;
  const segments = 128;
  const geometries: BufferGeometry[] = [];
  const materials: MeshStandardNodeMaterial[] = [];
  const parts: SignalPortalPart[] = [];
  const add = (name: string, geometry: BufferGeometry, material: MeshStandardNodeMaterial) => {
    geometry.name = name;
    geometries.push(geometry);
    materials.push(material);
    parts.push({ name, geometry, material });
  };
  const merge = (pieces: BufferGeometry[]) => {
    const geometry = mergeGeometries(pieces, false)!;
    pieces.forEach(piece => piece.dispose());
    return geometry;
  };

  let apertureGeometry: BufferGeometry;
  let apertureInradius = innerRadius * Math.cos(Math.PI / segments) - .001;
  if (shape === "ring") {
    // The closed cross section includes both inner and outer walls. Revolving it
    // keeps the center empty through the full depth, including during edge-on turns.
    const crossSection = [
      [.72, .052], [.72, -.052], [.748, -.079], [.972, -.079],
      [1, -.052], [1, .052], [.972, .079], [.748, .079], [.72, .052],
    ];
    const body = new LatheGeometry(crossSection.map(([radius, z]) => new Vector2(radius, z)), segments)
      .rotateX(Math.PI / 2);
    add("signal-contact-body", body, new MeshStandardNodeMaterial({
      color: "#35342e", metalness: .72, roughness: .28,
    }));

    // Champagne plating on both faces catches the scene's key light while the
    // charcoal bevels preserve a clear silhouette over the bright ASCII tiles.
    const faces = merge([
      new RingGeometry(.749, .971, segments).translate(0, 0, .0795),
      new RingGeometry(.749, .971, segments).rotateY(Math.PI).translate(0, 0, -.0795),
    ]);
    add("signal-contact-plating", faces, new MeshStandardNodeMaterial({
      color: "#aa9363", metalness: .76, roughness: .27,
    }));

    const edge = merge([
      new TorusGeometry(.748, .004, 6, segments).translate(0, 0, .076),
      new TorusGeometry(.748, .004, 6, segments).translate(0, 0, -.076),
    ]);
    add("signal-contact-inner-light", edge, new MeshStandardNodeMaterial({
      color: "#d9c48c", metalness: .5, roughness: .22,
      emissive: "#c69243", emissiveIntensity: .32,
    }));

    apertureGeometry = new CircleGeometry(.78, segments);
  } else {
    const points = polygonOutline(shape);
    const body = new ExtrudeGeometry(polygonRing(points, .979, .745), {
      depth: .112, steps: 1, bevelEnabled: true, bevelSegments: 3,
      bevelThickness: .024, bevelSize: .015, curveSegments: 1,
    }).translate(0, 0, -.056);
    add("signal-contact-body", body, new MeshStandardNodeMaterial({
      color: "#35342e", metalness: .72, roughness: .28,
    }));

    const face = polygonRing(points, .967, .758);
    add("signal-contact-plating", merge([
      new ShapeGeometry(face).translate(0, 0, .0805),
      new ShapeGeometry(face).rotateY(Math.PI).translate(0, 0, -.0805),
    ]), new MeshStandardNodeMaterial({
      color: "#aa9363", metalness: .76, roughness: .27,
    }));

    const rim = (z: number) => {
      const curve = new CurvePath<Vector3>();
      points.forEach((point, index) => {
        const next = points[(index + 1) % points.length]!;
        curve.add(new LineCurve3(new Vector3(point.x * .751, point.y * .751, z), new Vector3(next.x * .751, next.y * .751, z)));
      });
      return new TubeGeometry(curve, points.length * 6, .0035, 4, true);
    };
    add("signal-contact-inner-light", merge([rim(.081), rim(-.081)]), new MeshStandardNodeMaterial({
      color: "#d9c48c", metalness: .5, roughness: .22,
      emissive: "#c69243", emissiveIntensity: .32,
    }));

    // The backing overlaps the metal at the thickness midpoint. The actual
    // front face and bore define the opening through depth, without a second
    // smaller outline leaving a strip of the previous scene around its edge.
    apertureGeometry = new ShapeGeometry(new Shape(points.map(point => point.clone().multiplyScalar(.90))));
    const opening = points.map(point => point.clone().multiplyScalar(innerRadius));
    // A non-convex star's tip radius does not cover the viewport. The distance
    // from the center to its nearest edge gives an inscribed disk that does.
    // ExtrudeGeometry caps bevel travel to sqrt(2) * bevelSize; subtract it
    // so even the concave side wall stays outside the declared clear disk.
    apertureInradius = Math.min(...opening.map((point, index) => {
      const next = opening[(index + 1) % opening.length]!;
      const edge = next.clone().sub(point);
      const along = Math.max(0, Math.min(1, -point.dot(edge) / edge.lengthSq()));
      return point.clone().addScaledVector(edge, along).length();
    })) - Math.SQRT2 * .015 - .001;
  }
  const position = apertureGeometry.getAttribute("position");
  const uvs = apertureGeometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) uvs.setXY(i, (position.getX(i) + 1) / 2, (position.getY(i) + 1) / 2);
  apertureGeometry.name = "signal-contact-aperture";
  geometries.push(apertureGeometry);
  let disposed = false;
  return {
    parts,
    apertureGeometry,
    /** Front face and bore occlude the overlapping image at the metal midpoint. */
    apertureZ: 0,
    outerRadius,
    innerRadius,
    apertureInradius,
    materials,
    dispose() {
      if (disposed) return;
      disposed = true;
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
    },
  };
}
