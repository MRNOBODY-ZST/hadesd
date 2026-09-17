# Local foreground comparison

Start the web development server with the project's normal snapshot configuration,
then visit `http://127.0.0.1:5173/?effects=macos`.

The preview panel switches between `assembly`, `circuit`, `paper`, and `macos`
without restarting the renderer or changing scroll progress. It opens at the
expanded carousel after boot; **重播开场** replays the complete introduction.
Use the slider, wheel, or pose buttons to compare frames.

The `circuit` option is now **信号穿屏**: five hollow metal silhouettes follow one
curved flight path. Choose **五角星 / 四芒星 / 菱形 / 六边形 / 圆环** in the panel,
or use `?effects=circuit&shape=star|spark|diamond|hexagon|ring` (default: `star`).
Shape changes preserve progress and the terminal reveal. Each silhouette turns
counterclockwise exactly 180 degrees and flips vertically by 180 degrees after
entering, then faces the camera. The opening shows the terminal once its front
turns toward the camera; its back stays open to the background.
The leader displays the actual terminal render target through its opening,
grows in perspective, and passes behind the camera before interaction is
enabled. Its preview buttons are **弧线 / 靠近 / 穿屏**.
Terminal groups warm up inside the opening; the existing reveal clock continues
through entry without clearing the screen or returning to the DOS card.
The carousel keeps scrolling until the opening covers the entire viewport.
Coverage uses the actual opening's inscribed radius, including the metal bore;
the image overlaps behind that bore to avoid cracks at beveled polygon edges.

Both the panel and the effect loader are gated by `import.meta.env.DEV`.
Production retains the existing foreground until a direction is selected.

`shared.ts` places each foreground nine units in front of the camera in a
six-unit-high design space. Position, deformation, print feed, and signal travel
depend only on scroll progress. The effects clear before the DOS handoff and
use the existing scene-wide CRT pass. Each component owns and disposes its GPU
resources when switching away. The signal option uses camera-relative world
coordinates instead of this fixed-depth framing so its forward travel is real.
