# Build Spec — Hand-Drawn Whiteboard (Excalidraw-style)

A complete, buildable specification for an infinite-canvas whiteboard with a hand-drawn
aesthetic: shapes, arrows with binding, freehand drawing, text with handwriting fonts,
laser pointer, and export.

Build it **in the phase order given**. Each phase ends with acceptance criteria you can
actually check. Do not skip Phase 0 — the rendering architecture decided there is what
makes everything after it feel smooth, and it is very expensive to retrofit.

---

## 1. Stack

| Concern | Choice | Why this one |
|---|---|---|
| Build | Vite + TypeScript | Instant HMR, zero config |
| UI | React 18 | Only for chrome (toolbar, panels) — **never** for canvas |
| Canvas | Raw Canvas2D | No React, no VDOM, no scene-graph lib |
| Hand-drawn look | `roughjs` | Generates the sketchy geometry |
| Freehand strokes | `perfect-freehand` | Pressure-tapered pen strokes |
| State | `zustand` | Small, no context re-render storms |
| Image/file blobs | `idb-keyval` | localStorage can't hold images |
| IDs | `nanoid` | Short, collision-safe |

Everything else you can add as you go. Resist adding a canvas framework (Konva, Fabric,
PixiJS) — they own the render loop, and this app needs to own it.

### Project layout

```
src/
  element/          # element types, factories, mutation, bounds, hit-test
    types.ts
    factory.ts
    bounds.ts
    hitTest.ts
    resize.ts
    binding.ts
    textElement.ts
  scene/
    Scene.ts        # element store + spatial queries
    render.ts       # the render loop
    roughCache.ts   # cached rough drawables (critical for perf)
    export.ts       # PNG / SVG / .excalidraw
  tools/            # one file per tool, all share the same interface
  state/            # zustand store, appState, history
  ui/               # React chrome
  utils/            # math, geometry, throttle
  fonts/            # self-hosted woff2
```

---

## 2. Core data model

### 2.1 The element

Every drawable is a flat, JSON-serializable object. No classes, no methods, no
prototypes — elements cross `postMessage`, `localStorage`, and the network.

```ts
type ElementType =
  | 'rectangle' | 'diamond' | 'ellipse'
  | 'arrow' | 'line'
  | 'freedraw' | 'text' | 'image' | 'frame';

interface BaseElement {
  id: string;
  type: ElementType;

  // Position/size in SCENE coordinates (never viewport coordinates)
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;            // radians, rotated about the element's center

  // Style
  strokeColor: string;      // '#1e1e1e'
  backgroundColor: string;  // 'transparent' | '#ffc9c9'
  fillStyle: 'hachure' | 'cross-hatch' | 'solid' | 'zigzag';
  strokeWidth: number;      // 1 | 2 | 4
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  roughness: 0 | 1 | 2;     // 0=architect 1=artist 2=cartoonist
  opacity: number;          // 0..100

  // Identity & bookkeeping
  seed: number;             // SEE 2.2 — do not omit
  version: number;          // bumped on every mutation
  versionNonce: number;     // random; tie-breaker for collab merge
  updated: number;          // epoch ms
  isDeleted: boolean;       // soft delete — SEE 2.3

  // Relationships
  groupIds: string[];       // innermost first
  frameId: string | null;
  boundElements: { id: string; type: 'arrow' | 'text' }[] | null;
  locked: boolean;
  link: string | null;
}
```

Per-type extensions:

```ts
interface LinearElement extends BaseElement {
  type: 'arrow' | 'line';
  points: [number, number][];      // RELATIVE to element x,y. points[0] is always [0,0]
  startBinding: Binding | null;
  endBinding: Binding | null;
  startArrowhead: Arrowhead | null;
  endArrowhead: Arrowhead | null;  // 'arrow' | 'triangle' | 'dot' | 'bar' | null
  elbowed: boolean;                // right-angle routing
}

interface FreedrawElement extends BaseElement {
  type: 'freedraw';
  points: [number, number][];
  pressures: number[];             // parallel array, same length as points
  simulatePressure: boolean;       // true when input device gave no real pressure
}

interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;                // 16 | 20 | 28 | 36
  fontFamily: 1 | 2 | 3;           // 1=hand-drawn 2=normal 3=code
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle';
  containerId: string | null;      // set when this label lives inside a shape
  lineHeight: number;              // unitless multiplier, e.g. 1.25
}

interface ImageElement extends BaseElement {
  type: 'image';
  fileId: string;                  // key into the IndexedDB file store
  scale: [number, number];         // for flips: [-1, 1] etc.
  status: 'pending' | 'saved' | 'error';
}

interface Binding {
  elementId: string;
  focus: number;   // -1..1, where across the shape the arrow aims. SEE 6.3
  gap: number;     // px of air between arrow tip and shape outline
}
```

### 2.2 `seed` — the single most important field

Rough.js is randomized. If you call `rough.rectangle()` twice without a fixed seed you
get two *different* sketchy rectangles. Without a stored seed, **every shape jitters on
every repaint** — during pan, during zoom, during any redraw. It looks broken.

Assign `seed = Math.floor(Math.random() * 2 ** 31)` once at creation, never change it,
and always pass it to Rough. A duplicated element gets a **new** seed (so copies look
hand-drawn separately rather than identical); a moved/resized element keeps its seed.

### 2.3 Soft delete

Deleting sets `isDeleted = true` and bumps `version`. Never splice the array. This is
what makes undo, and later collaborative merge, tractable — a tombstone can be
resurrected and can lose a merge race; a missing array entry can do neither.

Filter at read time. Garbage-collect tombstones only when serializing to disk.

### 2.4 Mutation discipline

All writes go through one function:

```ts
function mutateElement<T extends BaseElement>(el: T, updates: Partial<T>): T {
  Object.assign(el, updates);
  el.version++;
  el.versionNonce = randomInteger();
  el.updated = Date.now();
  invalidateShapeCache(el);   // SEE 4.3
  return el;
}
```

Elements are mutated **in place** (a fresh object per pointermove frame would thrash the
GC on freedraw). The `version` counter is what downstream caches and the renderer diff
against, so it must never be bypassed.

### 2.5 App state

Separate from elements; not persisted in the same lane.

```ts
interface AppState {
  // Viewport
  scrollX: number; scrollY: number; zoom: number;   // zoom: 0.1 .. 30

  // Tool
  activeTool: ToolType;
  toolLocked: boolean;             // stay on tool after drawing

  // Selection
  selectedElementIds: Record<string, true>;
  selectedGroupIds: Record<string, true>;
  editingTextElementId: string | null;

  // Current style (applied to next created element)
  currentItemStrokeColor: string;
  currentItemBackgroundColor: string;
  currentItemFillStyle: FillStyle;
  currentItemStrokeWidth: number;
  currentItemStrokeStyle: StrokeStyle;
  currentItemRoughness: 0 | 1 | 2;
  currentItemOpacity: number;
  currentItemFontFamily: 1 | 2 | 3;
  currentItemFontSize: number;

  // Canvas
  viewBackgroundColor: string;
  gridSize: number | null;
  objectsSnapModeEnabled: boolean;
  theme: 'light' | 'dark';
}
```

---

## 3. Coordinates

Two spaces. Mixing them up is the most common bug in this kind of app, so name every
variable `sceneX`/`viewportX` explicitly and never write a bare `x` at a boundary.

- **Scene space** — where elements live. Infinite, zoom-independent.
- **Viewport space** — CSS pixels in the canvas element. What pointer events give you.

```ts
// utils/coords.ts
export const sceneToViewport = (sceneX: number, sceneY: number, s: AppState) => ({
  x: (sceneX + s.scrollX) * s.zoom,
  y: (sceneY + s.scrollY) * s.zoom,
});

export const viewportToScene = (clientX: number, clientY: number, s: AppState, rect: DOMRect) => ({
  x: (clientX - rect.left) / s.zoom - s.scrollX,
  y: (clientY - rect.top) / s.zoom - s.scrollY,
});
```

### Zoom to cursor

Zooming must keep the scene point under the cursor pinned there. Solve for the new
scroll such that the mapping is invariant:

```ts
function zoomAt(clientX: number, clientY: number, nextZoom: number, s: AppState, rect: DOMRect) {
  const before = viewportToScene(clientX, clientY, s, rect);
  s.zoom = clamp(nextZoom, 0.1, 30);
  const after = viewportToScene(clientX, clientY, s, rect);
  s.scrollX += after.x - before.x;
  s.scrollY += after.y - before.y;
}
```

### Input mapping

| Gesture | Action |
|---|---|
| Wheel | Pan vertically |
| Shift + wheel | Pan horizontally |
| Ctrl/Cmd + wheel | Zoom at cursor |
| Trackpad pinch | Arrives as `wheel` with `ctrlKey === true` — same path as zoom |
| Space + drag / middle-drag | Pan |

Deltas need `deltaMode` normalization: `deltaMode === 1` (lines) → multiply by ~16;
`deltaMode === 2` (pages) → multiply by viewport height.

---

## 4. Rendering — the part that decides "smooth"

### 4.1 Two canvases, stacked

```
<div class="canvas-stack">
  <canvas id="static" />       <!-- committed elements -->
  <canvas id="interactive" />  <!-- selection, handles, in-progress shape, laser -->
</div>
```

- **Static canvas** — every committed element. Redrawn **only** when the scene version,
  the viewport, or the theme changes. Not during a selection drag. Not during a laser
  sweep. Not on hover.
- **Interactive canvas** — selection outlines, resize/rotate handles, snap guides, the
  shape currently being dragged out, the laser trail, remote cursors. Cheap, cleared and
  redrawn every frame.

This split is the whole trick. Dragging a selection box over 2,000 elements repaints only
the thin interactive layer; the expensive rough geometry underneath is untouched.

### 4.2 One RAF loop, no exceptions

**Never draw inside a pointer handler.** Pointer events fire faster than frames; drawing
in the handler means drawing 3–5× per frame and a stuttery feel.

```ts
let staticDirty = true, interactiveDirty = true, rafId = 0;

export const invalidateStatic = () => { staticDirty = true; schedule(); };
export const invalidateInteractive = () => { interactiveDirty = true; schedule(); };

function schedule() {
  if (rafId) return;
  rafId = requestAnimationFrame(frame);
}

function frame(now: number) {
  rafId = 0;
  if (staticDirty)      { renderStatic(); staticDirty = false; }
  if (interactiveDirty) { renderInteractive(now); interactiveDirty = false; }
  if (laserHasTrail())  invalidateInteractive();   // keeps loop alive while fading
}
```

Handlers only mutate state and call `invalidate*()`.

### 4.3 Cache the rough drawables — mandatory

Rough.js **generates geometry** (`generator.rectangle(...)` → a drawable with hundreds of
computed points) and then draws it. Generation is ~100× costlier than drawing. Doing it
per frame is what makes naive clones crawl at 200 elements.

Cache the drawable, keyed by element, invalidated by `version`:

```ts
// scene/roughCache.ts
const cache = new WeakMap<BaseElement, { version: number; drawable: Drawable | Drawable[] }>();

export function getShape(el: BaseElement, rc: RoughCanvas) {
  const hit = cache.get(el);
  if (hit && hit.version === el.version) return hit.drawable;

  const drawable = generateShape(el, rc.generator);   // the expensive call
  cache.set(el, { version: el.version, drawable });
  return drawable;
}

export const invalidateShapeCache = (el: BaseElement) => cache.delete(el);
```

**Translation must not invalidate.** Moving an element changes `x`/`y` only — apply that
with `ctx.translate`, and keep the cached geometry. Only size, points, or style changes
force regeneration. (Generate all shapes at their local origin so this holds.)

### 4.4 Rough options from an element

```ts
function roughOptions(el: BaseElement): Options {
  return {
    seed: el.seed,                                  // SEE 2.2
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    roughness: el.roughness,
    fill: el.backgroundColor === 'transparent' ? undefined : el.backgroundColor,
    fillStyle: el.fillStyle,
    fillWeight: el.strokeWidth / 2,
    hachureGap: el.strokeWidth * 4,
    disableMultiStroke: el.strokeStyle !== 'solid',  // dashes double-stroke ugly otherwise
    strokeLineDash:
      el.strokeStyle === 'dashed' ? [8, 8] :
      el.strokeStyle === 'dotted' ? [1.5, 6] : undefined,
    preserveVertices: el.roughness === 0,
  };
}
```

Generate ellipses/rects/diamonds at local origin `(0,0,w,h)`; position happens in the
transform, not the geometry.

### 4.5 Drawing one element

```ts
function drawElement(el: BaseElement, ctx: CanvasRenderingContext2D, rc: RoughCanvas) {
  ctx.save();
  ctx.globalAlpha = el.opacity / 100;

  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate(el.angle);
  ctx.translate(-el.width / 2, -el.height / 2);   // now at element-local (0,0)

  switch (el.type) {
    case 'rectangle': case 'diamond': case 'ellipse':
    case 'line': case 'arrow':
      rc.draw(getShape(el, rc) as Drawable);
      break;
    case 'freedraw': drawFreedraw(el as FreedrawElement, ctx); break;
    case 'text':     drawText(el as TextElement, ctx); break;
    case 'image':    drawImage(el as ImageElement, ctx); break;
  }
  ctx.restore();
}
```

### 4.6 Static render, with culling

```ts
function renderStatic() {
  const { ctx, canvas } = staticLayer;
  const dpr = window.devicePixelRatio || 1;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = appState.viewBackgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.scale(dpr * appState.zoom, dpr * appState.zoom);
  ctx.translate(appState.scrollX, appState.scrollY);

  if (appState.gridSize) drawGrid(ctx);

  const vb = getVisibleSceneBounds(appState, canvas);
  for (const el of scene.getNonDeleted()) {
    if (el.isDeleted) continue;
    if (!intersects(getElementBounds(el), vb)) continue;   // cull
    drawElement(el, ctx, roughStatic);
  }
}
```

Pad the visible bounds by ~`strokeWidth * 4` so wide/rough strokes near the edge don't
pop in late.

### 4.7 HiDPI

Do this once on mount and on every resize, or everything is blurry:

```ts
function resizeCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}
```

Use a `ResizeObserver` on the container. `devicePixelRatio` changes when a window moves
between monitors — listen for it:
`matchMedia(\`(resolution: ${devicePixelRatio}dppx)\`).addEventListener('change', ...)`.

### 4.8 Performance budget

Targets: **60fps pan/zoom at 5,000 elements**; **sub-16ms** from pointermove to painted
freehand point.

Non-negotiables:
- Rough drawables cached by `version` (4.3)
- Viewport culling (4.6)
- All rendering in one RAF (4.2)
- Interactive work never touches the static layer (4.1)
- No allocation in the pointermove path — mutate in place, reuse point arrays
- Batch by state: don't `save()`/`restore()` per element when nothing changed

If it still drags at 10k+ elements, add — in this order — (1) a viewport-culling grid
index, (2) render-to-`OffscreenCanvas` tiles for the static layer, (3) a lower-fidelity
LOD pass below ~0.3 zoom (`roughness: 0`, skip hachure fills).

---

## 5. Pointer handling

### 5.1 State machine

One machine, driven by three listeners on the interactive canvas. Never a soup of
booleans.

```ts
type Interaction =
  | { kind: 'idle' }
  | { kind: 'panning'; lastX: number; lastY: number }
  | { kind: 'selecting'; origin: Point; current: Point }        // marquee
  | { kind: 'dragging'; origin: Point; offsets: Map<string, Point> }
  | { kind: 'resizing'; handle: Handle; origin: Point; initial: Snapshot }
  | { kind: 'rotating'; origin: Point; initialAngle: number }
  | { kind: 'drawing'; element: BaseElement }                    // shape being dragged out
  | { kind: 'freedrawing'; element: FreedrawElement }
  | { kind: 'linearEditing'; element: LinearElement; pointIndex: number }
  | { kind: 'laser' };
```

### 5.2 Wiring

```ts
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);   // keep events after leaving the canvas
  handleDown(e);
});
canvas.addEventListener('pointermove', handleMove);
canvas.addEventListener('pointerup', handleUp);
canvas.addEventListener('pointercancel', handleUp);
```

`touch-action: none` on the canvas, or mobile scrolls the page instead of drawing.

### 5.3 Coalesced events — free smoothness

Chrome throttles `pointermove` to display rate but buffers the real high-frequency
samples (up to 240Hz on a good stylus). Use them for freedraw and you get visibly
smoother strokes for two lines of code:

```ts
function handleMove(e: PointerEvent) {
  if (interaction.kind === 'freedrawing') {
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events) appendFreedrawPoint(ev);
  } else {
    handleMoveSingle(e);
  }
  invalidateInteractive();     // never render here
}
```

`getPredictedEvents()` can cut perceived latency further, but it overshoots on direction
changes — leave it off unless you're chasing stylus feel specifically.

### 5.4 Pressure

`e.pressure` is `0.5` for mouse and `0` for some trackpads. Detect real pressure:

```ts
const hasRealPressure = e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5;
element.simulatePressure = !hasRealPressure;
```

When simulating, `perfect-freehand` derives width from velocity instead — that's what
gives mouse strokes their taper.

### 5.5 Modifiers

| Modifier | Effect |
|---|---|
| Shift while drawing | Constrain: square/circle; line angle to 15° increments |
| Alt while drawing | Draw from center outward |
| Shift while dragging | Lock to horizontal/vertical axis |
| Alt while dragging | Duplicate, then drag the copy |
| Ctrl while resizing | Resize from center |
| Shift while resizing | Preserve aspect ratio |
| Shift + click | Toggle element in/out of selection |

---

## 6. Elements & tools

### 6.1 Shape tools (rectangle, diamond, ellipse)

`pointerdown` creates a zero-size element and enters `drawing`. `pointermove` updates
width/height (negative sizes are fine mid-drag — normalize on `pointerup` so `width`/
`height` end up positive and `x`/`y` sit at the top-left). Sub-threshold drags (< 5px)
on `pointerup` become a **default-size shape** (e.g. 100×100) centered at the click —
users expect click-to-place.

Diamond geometry (local coords): `rc.polygon([[w/2,0],[w,h/2],[w/2,h],[0,h/2]], opts)`.

### 6.2 Linear elements (line, arrow)

Two creation modes, and both must work:

- **Drag** — press, drag, release → 2-point element.
- **Multi-point** — click, click, click… → each click commits a point; `Enter`,
  `Escape`, or clicking the last point again finishes. This is how you draw polylines.

`points` are relative to the element's `x,y`, with `points[0] === [0,0]` invariant. After
editing points, renormalize: shift all points so the first is `[0,0]`, adding the delta
into `x,y`, then recompute `width`/`height` from the point extents.

Render with ≥3 points as a curve: `rc.curve(points, opts)` (Rough uses a Catmull-Rom-ish
spline). Two points → `rc.line(...)`.

**Arrowheads** are drawn manually, not by Rough — take the last segment's direction,
build two 20°-off barbs of length `min(30, segmentLength/2)`, and stroke them with the
same rough options so they match the sketchy line.

### 6.3 Arrow binding

The feature that makes it a diagramming tool instead of a drawing toy.

**On hover during arrow creation** — if the pointer is within `maxBindingGap` (≈
`max(16, min(0.25 * min(w,h), 32))`) of a bindable shape, highlight that shape and record
a candidate binding.

**On commit** — store `{ elementId, focus, gap }`:
- `focus` ∈ `[-1, 1]`: where across the shape the arrow aims. `0` = dead center, `±1` =
  grazing the edge. Compute it once at bind time from where the arrow actually pointed,
  then keep it fixed — that's what makes a bound arrow keep its *character* when the
  shape moves, rather than snapping to center.
- `gap`: distance to hold off the outline (default 4).

**On every move of either endpoint or either bound shape**, recompute the visible tip:
1. Take the focus line: from the arrow's other end toward a point on the bound shape's
   center-line, offset perpendicular by `focus × (shape half-extent)`.
2. Intersect that ray with the shape's outline (analytic per type: rect → segment/AABB
   clip; ellipse → ray/ellipse quadratic; diamond → 4 segment tests).
3. Pull back by `gap`. That's the endpoint.

Keep it in a single `updateBoundElements(changedElement)` called from `mutateElement`,
which walks `boundElements` and fixes each arrow. **Guard against cycles** (arrow bound
to a shape that contains a label that…) with a visited set.

**Bound text labels** — a text element with `containerId` set. It centers in its
container, wraps to `containerWidth - 2 * padding`, and grows the container's height if
the text no longer fits. Double-clicking a shape creates or edits its label.

### 6.4 Freehand

```ts
import { getStroke } from 'perfect-freehand';

const FREEDRAW_OPTIONS = (el: FreedrawElement) => ({
  size: el.strokeWidth * 4.25,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t: number) => Math.sin((t * Math.PI) / 2),
  simulatePressure: el.simulatePressure,
  last: !!el.lastCommittedPoint,
  start: { cap: true, taper: 0 },
  end:   { cap: true, taper: 0 },
});

function drawFreedraw(el: FreedrawElement, ctx: CanvasRenderingContext2D) {
  const input = el.points.map(([x, y], i) => [x, y, el.pressures[i] ?? 0.5]);
  const outline = getStroke(input, FREEDRAW_OPTIONS(el));
  ctx.fillStyle = el.strokeColor;
  ctx.fill(getSvgPathFromStroke(outline));   // returns a Path2D
}
```

`getStroke` returns a **closed outline polygon**, not a centerline — you `fill()` it, you
never `stroke()` it. Convert with quadratic midpoints for a smooth hull:

```ts
function getSvgPathFromStroke(points: number[][]): Path2D {
  const d = new Path2D();
  if (!points.length) return d;
  d.moveTo(points[0][0], points[0][1]);
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    d.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  d.closePath();
  return d;
}
```

Cache the resulting `Path2D` per `version` alongside the rough cache — regenerating the
stroke outline of a 3,000-point scribble every frame is a real cost.

While actively drawing, draw the in-progress stroke on the **interactive** canvas only;
commit to static on `pointerup`.

### 6.5 Text

Editing uses a real DOM `<textarea>` overlaid on the canvas — absolutely positioned,
transparent background, `resize: none`, `overflow: hidden`, with `font`, `lineHeight`,
`color`, and `textAlign` matched to the element and its position/size driven by the
current transform. You get IME, spellcheck, native selection, mobile keyboards, and
clipboard for free. Reimplementing a caret on canvas is a trap.

On blur/`Escape`: read `.value`, write it to the element, destroy the textarea, redraw.
Empty text → delete the element.

Canvas drawing:

```ts
function drawText(el: TextElement, ctx: CanvasRenderingContext2D) {
  ctx.font = `${el.fontSize}px ${FONT_FAMILY[el.fontFamily]}`;
  ctx.fillStyle = el.strokeColor;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = el.textAlign;

  const lineHeightPx = el.fontSize * el.lineHeight;
  const x = el.textAlign === 'center' ? el.width / 2
          : el.textAlign === 'right'  ? el.width : 0;

  el.text.split('\n').forEach((line, i) => {
    // +0.8 ≈ ascender ratio; keeps canvas baseline aligned with the textarea's box
    ctx.fillText(line, x, (i + 0.8) * lineHeightPx);
  });
}
```

Wrapping is manual: greedy word-wrap on `measureText().width`, breaking mid-word only
when a single word exceeds the width. **Cache wrap results** keyed by
`(text, fontSize, fontFamily, maxWidth)` — `measureText` is not free at scale.

### 6.6 Images

Paste/drop → read blob → `createImageBitmap` → store the blob in IndexedDB under
`fileId`, keep the decoded bitmap in an in-memory `Map<fileId, ImageBitmap>`. Elements
reference `fileId` only; **never** put base64 in the element (it destroys JSON perf and
localStorage quota).

Initial size: fit inside the viewport, max ~50% of it, preserving aspect ratio.
`status: 'pending'` until the bitmap resolves — draw a placeholder box meanwhile.

### 6.7 Eraser

Two behaviors under one tool:
- **Click** an element → delete it.
- **Drag** → everything the pointer path crosses gets `isDeleted = true`.

While the eraser is down, render pending-erase elements at `opacity 20` on the
interactive layer so it's undoable-looking before release. Commit on `pointerup` as a
**single** history entry — not one per element.

Test the *segment* between consecutive pointer positions against elements, not just the
point. A fast flick otherwise skips right over things between frames.

### 6.8 Laser pointer

Ephemeral, never enters the scene, never enters history, never exports.

```ts
interface LaserPoint { x: number; y: number; t: number }

const DECAY_MS = 1000;
const trail: LaserPoint[] = [];

export function addLaserPoint(sceneX: number, sceneY: number, now: number) {
  trail.push({ x: sceneX, y: sceneY, t: now });
  invalidateInteractive();
}

export function drawLaser(ctx: CanvasRenderingContext2D, now: number) {
  while (trail.length && now - trail[0].t > DECAY_MS) trail.shift();
  if (trail.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < trail.length; i++) {
    const age = (now - trail[i].t) / DECAY_MS;   // 0 = fresh, 1 = dead
    const life = 1 - age;

    // glow underlay
    ctx.globalAlpha = life * 0.3;
    ctx.strokeStyle = '#ff8080';
    ctx.lineWidth = (12 * life) / zoom;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();

    // hot core
    ctx.globalAlpha = life;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = (4 * life) / zoom;
    ctx.stroke();
  }
  ctx.restore();
}

export const laserHasTrail = () => trail.length > 0;
```

Dividing widths by `zoom` keeps the beam a constant on-screen thickness. `laserHasTrail()`
is what keeps the RAF loop alive so the tail fades out after the pointer stops (4.2).

### 6.9 Frames

A `frame` element is a named rectangle that owns the elements inside it: children carry
`frameId`, move with the frame, and are **clipped** to it when rendered
(`ctx.save(); ctx.beginPath(); ctx.rect(...); ctx.clip(); …; ctx.restore()`).
Membership is recomputed on drop — an element whose center lands inside a frame joins it.
Frames export as individual images.

---

## 7. Hit testing

Threshold: `10 / zoom` scene units, so the grab area stays constant on screen.

```ts
export function hitTest(el: BaseElement, p: Point, zoom: number): boolean {
  const threshold = 10 / zoom;
  const local = rotatePoint(p, elementCenter(el), -el.angle);   // undo rotation first

  const filled = el.backgroundColor !== 'transparent';

  switch (el.type) {
    case 'rectangle':
    case 'image':
    case 'frame':
      return filled
        ? insideRect(local, el, threshold)
        : nearRectOutline(local, el, threshold);

    case 'ellipse':
      return filled
        ? insideEllipse(local, el)
        : Math.abs(ellipseDistance(local, el)) < threshold;

    case 'diamond':
      return filled
        ? insidePolygon(local, diamondPoints(el))
        : nearPolygonOutline(local, diamondPoints(el), threshold);

    case 'line':
    case 'arrow':
    case 'freedraw':
      return nearPolyline(local, el, threshold + el.strokeWidth / 2);

    case 'text':
      return insideRect(local, el, 0);
  }
}
```

`nearPolyline` = min distance from the point to any segment. Reject early with an
inflated bounding-box check before the per-segment loop — that's the difference between
a snappy and a laggy hover on long scribbles.

Iterate elements **back to front** (topmost = last in z-order wins) and return the first
hit.

**Marquee selection**: an element is selected when its bounds *intersect* the marquee
(not "are contained by"). Test the rotated bounds, not the axis-aligned ones.

---

## 8. Selection, transform, groups

### 8.1 Handles

8 resize handles + 1 rotation handle above the top edge. Handle size `8 / zoom`, hit area
`~1.5×` that. For a multi-element selection, operate on the union AABB and scale each
element's `x`, `y`, `width`, `height`, `fontSize`, and `points` proportionally.

### 8.2 Resize

Keep the **anchor** (the opposite handle) fixed; recompute the element from anchor +
pointer. For rotated elements, transform the pointer into element-local space, resize
there, then transform the resulting center back — otherwise resizing a rotated shape
drifts and shears.

Text: resizing from a **corner** scales `fontSize`; from a **side** it rewraps at the new
width. Freedraw and linear: scale every point by `(newW/oldW, newH/oldH)`.

Flipping (dragging a handle past its anchor) is legal — normalize afterward and mirror
`points` / `scale`.

### 8.3 Rotation

`angle = atan2(pointer - center) - initialGrabAngle`. Shift snaps to 15°. Rotating a
multi-selection rotates each element *and* orbits its center about the selection center.

### 8.4 Groups

`groupIds: string[]`, innermost first. Clicking any member selects the **outermost**
group it belongs to. Double-click enters the group and selects the individual. `Ctrl+G`
groups, `Ctrl+Shift+G` ungroups (pops the outermost id).

Z-order is array order. Grouped elements must be kept **contiguous** in the array when
reordering, or a raise/lower will interleave two groups and they'll render shredded.

### 8.5 Snapping

- **Grid** — when `gridSize` is set, round positions to it during move/resize/create.
- **Object snap** — while dragging, compare the dragged bounds' 6 lines (left/center-x/
  right, top/center-y/bottom) against nearby elements' equivalents; within `5 / zoom`,
  snap and draw a guide on the interactive canvas.

Only consider elements in the viewport — snapping against 5,000 offscreen elements is
pure waste.

---

## 9. History

Snapshot-based, committed at interaction boundaries:

```ts
interface HistoryEntry { elements: BaseElement[]; appState: Partial<AppState> }
```

- Push **on `pointerup`**, not on `pointermove`. A 500-point drag is *one* undo step.
- Store deep-ish clones of changed elements; unchanged elements can be shared by
  reference (they're only mutated through `mutateElement`, which you can make
  copy-on-write at commit time).
- Cap at ~100 entries; drop from the tail.
- Redo stack clears on any new action.
- Selection changes are **not** undoable on their own, but each entry restores the
  selection that was live when it was captured — undo should return you to the scene as
  it looked.

`Ctrl+Z` / `Ctrl+Shift+Z` (and `Ctrl+Y`).

If you later add collaboration, swap this for delta-based history (store the inverse
patch per entry) — snapshots can't merge with remote edits.

---

## 10. Fonts

The handwriting font *is* the product's personality, so treat it as a first-class asset.

### 10.1 Choices

| Slot | Font | License |
|---|---|---|
| 1 — Hand-drawn | **Excalifont** | SIL OFL 1.1 |
| 2 — Normal | **Nunito** | SIL OFL 1.1 |
| 3 — Code | **Comic Shanns Mono** / **JetBrains Mono** | OFL / Apache-2.0 |

Excalifont is the open, OFL-licensed handwriting face used by Excalidraw today (it
replaced the older Virgil, which had a more restrictive license — don't grab a random
`Virgil.woff2` off a CDN and assume it's free). Good OFL alternatives if you want a
different hand: **Caveat**, **Kalam**, **Patrick Hand**, **Architects Daughter**.

Whatever you pick, download the `.woff2`, self-host it under `src/fonts/`, and keep the
license file next to it. OFL requires that notice ship with the font — it does not
require anything of your app's own code.

### 10.2 The gotcha: canvas does not wait for fonts

`ctx.fillText` with an unloaded font silently falls back to a system font. `measureText`
then returns metrics for the **wrong** font, so your wrapping, bounds, and hit boxes are
all computed against the fallback and everything visibly reflows a moment later. This is
the single most common "my text is broken" bug in canvas apps.

Gate the first render on font readiness, and force a reflow if fonts land late:

```ts
// fonts/load.ts
const FACES = [
  new FontFace('Excalifont', 'url(/fonts/Excalifont-Regular.woff2)', { display: 'block' }),
  new FontFace('Nunito',     'url(/fonts/Nunito-Regular.woff2)',     { display: 'block' }),
  new FontFace('ComicShanns','url(/fonts/ComicShanns-Regular.woff2)',{ display: 'block' }),
];

export async function loadFonts() {
  await Promise.all(FACES.map(async (f) => {
    await f.load();
    document.fonts.add(f);
  }));
  await document.fonts.ready;
}

// main.tsx — do not render the scene before this resolves
await loadFonts();
invalidateTextMeasureCache();
invalidateStatic();
mountApp();
```

`font-display: block` (not `swap`) — a brief invisible period is far better than a full
canvas reflow mid-session. Also add
`<link rel="preload" as="font" type="font/woff2" href="/fonts/Excalifont-Regular.woff2" crossorigin>`
to `index.html`.

For **SVG export**, the font must be embedded as a base64 `@font-face` in a `<defs>`
block, or the exported file renders in Times New Roman on any machine that lacks the
font. Subset it (`glyphhanger` / `subset-font`) to the characters actually used — a full
face is ~100KB per export, a subset is a few KB.

---

## 11. Persistence & export

### 11.1 Local

- **Elements + appState** → `localStorage`, debounced ~300ms, `JSON.stringify` with
  `isDeleted` tombstones stripped.
- **Image blobs** → IndexedDB via `idb-keyval`, keyed by `fileId`.
- Restore on boot; on parse failure, keep the corrupt copy under a backup key rather than
  wiping the user's work.

### 11.2 File format (`.excalidraw`)

Plain JSON, matching the widely-used open format so files interop:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://your-app.example.com",
  "elements": [ /* ... */ ],
  "appState": { "viewBackgroundColor": "#ffffff", "gridSize": null },
  "files": { "<fileId>": { "mimeType": "image/png", "id": "<fileId>", "dataURL": "data:..." } }
}
```

Write an import path that tolerates missing fields (fill defaults, generate absent
`seed`s) — real files in the wild come from many versions.

### 11.3 PNG

Render the export bounds to an offscreen canvas at `scale` (1/2/3), with padding
(default 10) and optional background. Reuse `drawElement` — same code path as the screen,
which is how you guarantee the export matches what the user sees.

```ts
async function exportToPng(elements, opts): Promise<Blob> {
  const b = getCommonBounds(elements);
  const w = (b.maxX - b.minX + opts.padding * 2) * opts.scale;
  const h = (b.maxY - b.minY + opts.padding * 2) * opts.scale;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  if (opts.background) { ctx.fillStyle = opts.viewBackgroundColor; ctx.fillRect(0, 0, w, h); }
  ctx.scale(opts.scale, opts.scale);
  ctx.translate(-b.minX + opts.padding, -b.minY + opts.padding);
  const rc = rough.canvas(canvas as any);
  for (const el of elements) if (!el.isDeleted) drawElement(el, ctx, rc);
  return canvas.convertToBlob({ type: 'image/png' });
}
```

Embed the source JSON in a `tEXt` chunk so the PNG re-imports as an editable scene — that
round-trip is a genuinely great feature and it's cheap.

### 11.4 SVG

`rough.svg()` produces the same geometry as SVG paths. Include: embedded subset fonts
(10.2), images as base64 `<image href>`, and the scene JSON in a `<!-- payload -->`
comment for round-tripping.

### 11.5 Clipboard

- **Copy** → both `text/plain` (JSON) and an `image/png` blob, so pasting into Slack or
  Figma gives a picture while pasting back in gives editable elements.
- **Paste** → sniff in order: internal JSON → image blob → plain text (becomes a text
  element, or auto-parses into a diagram if it's valid scene JSON).
- Paste lands at the cursor, with new ids and new seeds.

---

## 12. UI chrome (React)

Keep it thin. It reads state and dispatches; it never participates in rendering.

- **Toolbar** — center-top island: hand, selection, rectangle, diamond, ellipse, arrow,
  line, draw, text, image, eraser, frame, laser. Number keys 1–0 plus letters (below).
- **Left panel** — appears only when a tool or selection implies style: stroke color,
  background, fill style, stroke width, stroke style, sloppiness, edges, arrowheads,
  opacity, layers, align, actions (duplicate/delete/link/copy-styles).
- **Bottom-left** — zoom out / reset / in, undo/redo.
- **Top-right** — library, share, main menu (export, save, load, theme, canvas bg, reset).
- **Context menu** — right-click on canvas vs. on selection: different sets.
- **Stats panel** (`Alt+/`) — element count, selected dimensions, live x/y/w/h/angle
  editing.

Subscribe with selectors (`useStore(s => s.activeTool)`), not whole-state, or every
pointermove re-renders the toolbar.

### Keyboard map

```
v / 1  selection      r / 2  rectangle     d / 3  diamond      o / 4  ellipse
a / 5  arrow          l / 6  line          p / 7  draw         t / 8  text
9      image          e / 0  eraser        f      frame        k      laser
h      hand           space+drag  pan      q      toggle lock

Ctrl+Z / Ctrl+Shift+Z   undo / redo        Ctrl+D  duplicate
Ctrl+G / Ctrl+Shift+G   group / ungroup    Ctrl+A  select all
Ctrl+C / V / X          clipboard          Delete  delete
Ctrl + wheel            zoom               Ctrl+0  reset zoom
Ctrl+Shift+E            export image       Ctrl+S  save
Alt+drag                duplicate-drag     Shift   constrain
```

---

## 13. Collaboration (optional — Phase 8)

Only after everything above is solid.

- **Transport** — WebSocket room server (Socket.IO or plain `ws`); room id in the URL.
- **Merge** — per-element `version` / `versionNonce`. Higher `version` wins; equal
  version → lower `versionNonce` wins. Deterministic on every peer, no server authority
  needed. This is exactly why 2.2/2.3/2.4 exist.
- **Broadcast** — throttle scene diffs to ~33ms; send only elements whose `version`
  changed since last send. Pointer positions go on a separate unreliable-ish channel at
  ~50ms.
- **Presence** — remote cursors + name labels on the interactive canvas.
- **E2EE** — keep the room key in the URL **fragment** (`#room=id,key`), which never
  reaches the server; AES-GCM the payloads client-side.

---

## 14. Build phases

Each phase must pass its criteria before you start the next.

### Phase 0 — Skeleton and render loop
Vite + TS + React. Two stacked canvases, DPR handling, `ResizeObserver`. The RAF
loop with `invalidateStatic`/`invalidateInteractive`. Pan and zoom-to-cursor. Grid.
Zustand store with `AppState`.
> ✅ Pan and zoom a 10k-element synthetic scene of plain rects at a locked 60fps.
> Nothing blurry on a HiDPI display. Zero draws outside the RAF.

### Phase 1 — Shapes
Element model, factories, `mutateElement`, rough cache. Rectangle, diamond, ellipse
tools. Style state and the left panel. localStorage persistence.
> ✅ Shapes never jitter on pan/zoom (proves `seed`). Dragging out a shape doesn't
> repaint the static canvas (proves the layer split). 1,000 shapes still pan at 60fps
> (proves the cache).

### Phase 2 — Selection and transform
Hit testing, marquee, move, 8-handle resize, rotation, z-order, groups, snapping,
alignment, delete/duplicate.
> ✅ Resizing a rotated shape from any handle keeps the opposite corner pinned exactly.
> Multi-select resize scales strokes and text proportionally.

### Phase 3 — Linear elements
Line and arrow, drag + multi-point modes, curves, arrowheads, point editing, and
binding (6.3).
> ✅ Bind an arrow between two shapes, move either shape at speed — the arrow stays
> attached, keeps its focus offset, and never enters an update loop.

### Phase 4 — Freehand and laser
`perfect-freehand`, coalesced events, pressure, `Path2D` cache. Eraser. Laser with decay.
> ✅ A fast scribble shows no visible lag or polygonal corners. The laser tail fades
> smoothly to nothing after the pointer stops and appears in no export.

### Phase 5 — Text
Font loading gate (10.2), textarea overlay, wrapping + measure cache, all three
families, bound container labels.
> ✅ Hard-reload with a cold cache: text is measured and laid out in the handwriting
> font on the first paint, with no reflow. Double-click a rectangle → type → text
> centers and grows the box.

### Phase 6 — Images and export
Paste/drop, IndexedDB, PNG (+ embedded scene), SVG (+ embedded subset fonts),
`.excalidraw` import/export, clipboard.
> ✅ Export a PNG, re-import it, get the editable scene back. The SVG renders correctly
> in a browser on a machine without your fonts installed.

### Phase 7 — Polish
Full keyboard map, context menus, dark theme, stats panel, frames, element links,
library, mobile touch, a11y (focus rings, ARIA on chrome, reduced-motion).
> ✅ Every action in the UI has a shortcut and works from the keyboard alone. Usable on
> a phone.

### Phase 8 — Collaboration (optional)
Section 13.

---

## 15. Pitfalls — read this before you start

1. **No stored `seed`** → shapes shimmer on every repaint. (2.2)
2. **Regenerating rough drawables per frame** → dies at ~200 elements. (4.3)
3. **Rendering inside pointer handlers** → jank; you're drawing 3–5× per frame. (4.2)
4. **One canvas** → selection drags repaint the whole scene. (4.1)
5. **Ignoring `devicePixelRatio`** → blurry on every modern display. (4.7)
6. **Measuring text before fonts load** → wrong metrics, reflow, broken hit boxes. (10.2)
7. **Hard-deleting elements** → undo and collab both become unfixable. (2.3)
8. **Mixing scene and viewport coords** → subtle drift at non-1 zoom. Name every
   variable for its space. (3)
9. **History on `pointermove`** → 500 undo steps for one drag. (9)
10. **base64 images inside elements** → JSON perf collapses, localStorage quota blows. (6.6)
11. **No `touch-action: none`** → the page scrolls instead of drawing on mobile. (5.2)
12. **Unbounded binding updates** → cyclic arrow/shape updates lock the tab. Use a
    visited set. (6.3)

---

## 16. Licensing note

Excalidraw itself is MIT-licensed, and the `.excalidraw` file format is open — building a
compatible app and reading/writing that format is fine. This spec describes architecture,
not their source; write your own implementation from it. If you do vendor any of their
code, keep the MIT notice. Fonts carry their **own** licenses independent of any code
license (10.1) — ship the OFL text with the `.woff2`.
```
