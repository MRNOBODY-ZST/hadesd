# CRT journey v5

Reference: the supplied 4.109-second desktop recording shows a blue curved CRT loading screen, rapid camera pullback with phosphor trails, then a computer over a reflective, misty floor. Preserve the existing HADESD identity and original Mac model; adapt that motion language to the entire eight-phase sequence.

- [x] Clean the DOM presentation: one slogan, one scroll hint, remove Skip/Enter jumps and the requested metadata/footer. Preserve accessible off/reduced-motion paths.
- [x] Share curved CRT phosphor between the opening screen, physical Mac and returning boot card. Fill the boot progress bar with a GPU uniform, preserving texture artwork across frames.
- [x] Use a continuous physical-screen pullback, pointer movement, bounded radial trails, stable Mac/first-tile UVs and overlapping boot/terminal acquisition.
- [x] Replace physical fly-bys with instanced binary streams; animate side glyphs in the shader and reduce carousel geometry/draw calls.
- [x] Add a reduced-resolution, single-bounce planar reflection and procedural mist, plus live screen light in the floor haze. Fade the floor at the Mac/tile handoff.
- [x] Remove the hard 30fps Full limit, cap render pixels, and make Fiber the sole frame-clock owner on the pinned non-XR Three version.
- [x] Test phase/motion boundaries, geometry and clock behavior. Check actual WebGPU/WebGL2 desktop/mobile rendering and native scrolling/touch.
- [x] Record final performance matrix, inspect the full recorded transition and verify the updated remote isolated preview.

Ownership: root coordinates scene/material/camera/reflection; terminal_panels owns Stage/timeline and affected E2E; terminal_vim owns instanced glyphs; backend_minio owns performance tooling and the guarded renderer clock adapter. Keep all earlier blog/MinIO/terminal changes intact. Production is outside this development rollout.

## v8 reference correction

Superseded by the user's request to restore the old Macintosh 128K character. Its isolated release and checks are historical, not acceptance of the current design.

Use the user's close-up SuperPET reference: a wide trapezoid monitor, substantial tapered rear casing, visible sloped nameplate and integrated keyboard under a low wide lens. CRT phosphor meets black directly, without a luminous perimeter. Interpret the final reference to a pasted-on effect as the mist from the preceding request.

- [x] Remove perimeter strokes from shared CRT shaders, DOM fallback and terminal frame; retain lens curvature, scanning and content artwork.
- [x] Transition the presentation camera from 44 to 68 degrees with distance compensation, restoring the exact first-tile camera endpoint.
- [x] Replace viewport cloud patterns with bounded world-space raymarched density, and fade the complete environment to black at screen handoffs.
- [ ] Finish reference-based casing, nameplate and keyboard proportions; verify desktop/mobile composition and support clearance.
- [ ] Run fresh unit/type/browser and GPU performance verification on stable source.
- [ ] Publish the isolated QA release, capture the complete static walkthrough, and update evidence/docs.

## v9 classic Macintosh restoration

Restore the previous compact beige upright model from repository history, with its floppy drive, detached light keyboard and one-button mouse. Keep the curved CRT without a luminous perimeter, terminal presets, world-space mist and continuous carousel handoff. Use a milder 52-degree presentation lens and a level support plane shared by the chassis and peripherals.

- [x] Restore the classic geometry and verify real support heights for all three objects.
- [x] Give the chassis, keyboard and mouse separate contact shadows and fog clearance.
- [x] Restore a moderate presentation perspective with the same fullscreen camera endpoint.
- [x] Inspect desktop/mobile rendering and verify the complete intro, terminal and performance.
- [x] Publish and record the final isolated preview; update current documentation.
