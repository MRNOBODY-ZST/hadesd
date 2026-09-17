import { expect, it, vi } from "vitest";
import { DoubleSide, Euler, Mesh, MeshBasicNodeMaterial, Quaternion, Raycaster, Vector3 } from "three/webgpu";
import { createSignalPortalResources } from "./signalPortalResources";

it("leaves a true opening through the contact while the metal rim remains solid", () => {
  const resources = createSignalPortalResources();
  const meshes = resources.parts.map(part => new Mesh(part.geometry, part.material));
  meshes.forEach(mesh => mesh.updateMatrixWorld());
  const ray = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1));
  expect(ray.intersectObjects(meshes)).toHaveLength(0);
  ray.ray.origin.x = .6;
  expect(ray.intersectObjects(meshes)).toHaveLength(0);
  ray.ray.origin.x = .85;
  expect(ray.intersectObjects(meshes).length).toBeGreaterThan(0);
  ray.set(new Vector3(.85, 0, -2), new Vector3(0, 0, 1));
  expect(ray.intersectObjects(meshes).length).toBeGreaterThan(0);
  resources.dispose();
});

it("keeps the enlarged backing behind the physical rim and releases GPU resources once", () => {
  const resources = createSignalPortalResources();
  const imageMaterial = new MeshBasicNodeMaterial();
  const aperture = new Mesh(resources.apertureGeometry, imageMaterial);
  aperture.position.z = resources.apertureZ;
  const metal = resources.parts.map(part => new Mesh(part.geometry, part.material));
  [...metal, aperture].forEach(mesh => mesh.updateMatrixWorld());
  const ray = new Raycaster(new Vector3(.76, 0, 2), new Vector3(0, 0, -1));
  expect(ray.intersectObject(aperture).length).toBeGreaterThan(0);
  expect(ray.intersectObjects([...metal, aperture])[0]!.object).not.toBe(aperture);
  imageMaterial.dispose();
  const all = [...resources.parts.map(part => part.geometry), resources.apertureGeometry, ...resources.materials];
  const disposed = all.map(resource => {
    const callback = vi.fn();
    resource.addEventListener("dispose", callback);
    return callback;
  });
  resources.dispose();
  resources.dispose();
  disposed.forEach(callback => expect(callback).toHaveBeenCalledOnce());
});

it("builds a recognizable five-point silhouette instead of retaining the circular contact", () => {
  const resources = createSignalPortalResources("star");
  const meshes = resources.parts.map(part => new Mesh(part.geometry, part.material));
  meshes.forEach(mesh => mesh.updateMatrixWorld());
  const ray = new Raycaster(new Vector3(0, .85, 2), new Vector3(0, 0, -1));
  expect(ray.intersectObjects(meshes).length).toBeGreaterThan(0);
  ray.ray.origin.set(.9, 0, 2);
  expect(ray.intersectObjects(meshes)).toHaveLength(0);
  resources.dispose();
});

it.each(["star", "spark", "diamond", "hexagon", "ring"] as const)("%s supplies a conservative clear aperture for a rotated camera crossing", shape => {
  const resources = createSignalPortalResources(shape);
  expect(resources.apertureInradius).toBeGreaterThan(.25);
  const meshes = resources.parts.map(part => new Mesh(part.geometry, part.material));
  const apertureMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  const aperture = new Mesh(resources.apertureGeometry, apertureMaterial);
  const rotation = new Quaternion().setFromEuler(new Euler(.39, -.73, 2.1));
  [...meshes, aperture].forEach(mesh => { mesh.quaternion.copy(rotation); mesh.updateMatrixWorld(); });
  const direction = new Vector3(0, 0, -1).applyQuaternion(rotation);
  const ray = new Raycaster();
  for (let i = 0; i < 128; i++) {
    const angle = .013 + i * Math.PI * 2 / 128;
    const radius = resources.apertureInradius * .999;
    const origin = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 2).applyQuaternion(rotation);
    ray.set(origin, direction);
    expect(ray.intersectObjects(meshes), `metal intrudes at angle ${angle}`).toHaveLength(0);
    expect(ray.intersectObject(aperture).length, `terminal image missing at angle ${angle}`).toBeGreaterThan(0);
  }
  const positions = resources.apertureGeometry.getAttribute("position");
  const uvs = resources.apertureGeometry.getAttribute("uv");
  for (let i = 0; i < positions.count; i++) {
    expect(uvs.getX(i)).toBeCloseTo((positions.getX(i) + 1) / 2);
    expect(uvs.getY(i)).toBeCloseTo((positions.getY(i) + 1) / 2);
  }
  apertureMaterial.dispose();
  resources.dispose();
});

it.each(["star", "spark", "diamond", "hexagon"] as const)("%s closes the gap between the terminal image and the inner bevel", shape => {
  const resources = createSignalPortalResources(shape);
  const metal = resources.parts.map(part => new Mesh(part.geometry, part.material));
  const imageMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  const aperture = new Mesh(resources.apertureGeometry, imageMaterial);
  aperture.position.z = resources.apertureZ;
  [...metal, aperture].forEach(mesh => mesh.updateMatrixWorld());
  const ray = new Raycaster();
  for (const tilt of [0, -.6, .6]) {
    const direction = new Vector3(Math.sin(tilt), 0, -Math.cos(tilt));
    // These tip-edge rays formerly missed both the undersized .72 image and
    // the beveled metal hole, exposing the old ASCII scene through a thin seam.
    for (const y of [.721, .722, .723, .725, .727, .735, .745, .76]) {
      const target = new Vector3(0, y, 0);
      ray.set(target.clone().addScaledVector(direction, -2), direction);
      expect(ray.intersectObjects([...metal, aperture]).length, `uncovered edge y=${y}, tilt=${tilt}`).toBeGreaterThan(0);
    }
  }
  // The backing image may overlap solid metal, but the front face must win
  // the depth test. Moving the enlarged image in front would erase the rim.
  ray.set(new Vector3(0, .82, 2), new Vector3(0, 0, -1));
  expect(ray.intersectObjects([...metal, aperture])[0]!.object).not.toBe(aperture);
  imageMaterial.dispose();
  resources.dispose();
});
