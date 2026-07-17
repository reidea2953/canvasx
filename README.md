# Hand-Drawn Whiteboard

An infinite-canvas whiteboard with a hand-drawn aesthetic: shapes, arrows that bind to
them, freehand drawing, text with real handwriting fonts, images, a laser pointer,
export, and end-to-end-encrypted live collaboration.

Built to the spec in [build.md](build.md), phase by phase.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
npm run server       # ws://localhost:3002 — only needed for live collaboration
```

```bash
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build
```

## Tools

| Key | Tool | | Key | Tool |
|---|---|---|---|---|
| `v` `1` | Selection | | `p` `7` | Draw (freehand) |
| `r` `2` | Rectangle | | `t` `8` | Text |
| `d` `3` | Diamond | | `e` `0` | Eraser |
| `o` `4` | Ellipse | | `k` | Laser pointer |
| `a` `5` | Arrow | | `h` | Hand (pan) |
| `l` `6` | Line | | `q` | Keep tool active |

`Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Ctrl+D` duplicate · `Ctrl+G` / `Ctrl+Shift+G`
group/ungroup · `Ctrl+A` select all · `Ctrl+C/V/X` clipboard · `Ctrl+[` / `Ctrl+]`
z-order · `Ctrl+0` reset zoom · `Ctrl+S` save · `Ctrl+Shift+E` export PNG · `Alt+/`
stats · `Space+drag` pan · `Ctrl+wheel` zoom.

Modifiers: `Shift` constrains (square/circle, 15° angles, axis-locked drags), `Alt`
draws from centre or duplicate-drags, `Ctrl` resizes from centre.

Double-click: empty canvas → text · a shape → label inside it · a line/arrow → point
editor · a group → drill in.

## Architecture

The parts that decide whether it feels smooth, and why:

**Two stacked canvases** ([render.ts](src/scene/render.ts)). The static layer holds
committed elements and repaints only when the scene or viewport changes. The
interactive layer holds selection handles, the shape being dragged out, the laser and
remote cursors, and repaints every frame. Dragging a marquee over 2,000 elements
touches only the cheap layer.

**One RAF loop, nothing draws outside it.** Pointer events fire faster than frames, so
drawing in a handler means drawing several times per painted frame. Handlers only
mutate state and call `invalidateStatic()` / `invalidateInteractive()`. A dev-only
`assertInFrame()` guard makes this self-enforcing rather than a convention.

**Every element stores a `seed`** ([types.ts](src/element/types.ts)). Rough.js is
randomized; without a fixed seed you get *different* sketchy geometry every repaint and
shapes visibly shimmer as you pan.

**Rough drawables are cached by `version`** ([roughCache.ts](src/scene/roughCache.ts)).
Generation costs ~100× the draw. Geometry is generated in each element's *local* frame,
so a move reuses the cache via a canvas transform instead of regenerating.

**`mutateElement` is the only write path** ([mutate.ts](src/element/mutate.ts)). It
bumps `version`, rolls a new `versionNonce`, evicts the caches, and drags bound arrows
and labels along. Elements are mutated in place — a fresh object per pointermove would
thrash the GC during freehand.

**Deletion is soft.** A tombstone can be undone and can lose a merge race; a spliced
array entry can do neither.

**Points-based elements break the `x..x+width` assumption.** Lines, arrows and freehand
strokes store points relative to `x,y` with `points[0] === [0,0]`, and later points may
run *negative*. Their bounds come from `getUnrotatedBounds()`
([bounds.ts](src/element/bounds.ts)), never from `width`/`height` directly.

**Resizing works in the element's original local frame**
([resize.ts](src/element/resize.ts)). Rotating the scene by `-angle` makes the box
axis-aligned, so resizing is plain arithmetic; the result is rotated back about the
*original* centre, which is what pins the opposite corner. Resizing in scene space
instead makes rotated shapes drift and shear.

**Arrow binding cannot oscillate** ([binding.ts](src/element/binding.ts)). When both
ends are bound, each end aims from the *other shape's centre* — never from the arrow's
own opposite endpoint. Anchoring to a value that is itself being recomputed is exactly
how these systems spin; centres are fixed during an update, so it converges in one pass.

**Fonts gate the first render** ([load.ts](src/fonts/load.ts)). `measureText` against an
unloaded family silently returns the *fallback's* metrics, so every wrap, bound and hit
box would be computed wrong and then visibly reflow. Nothing renders until
`document.fonts.ready`.

**Collaboration needs no server authority** ([sync.ts](src/collab/sync.ts)). Higher
`version` wins; on a tie, lower `versionNonce` wins. Both peers run the identical
comparison and converge on the same answer with no round trip. The relay
([server/index.js](server/index.js)) only sees ciphertext: the room key lives in the URL
fragment, which browsers never transmit.

## Verified

```bash
npm run verify     # the property checks below
npm run check      # typecheck + verify + build — run this before pushing
```

Most of this app can only be judged by eye. These five things can't be, so they are
checked numerically instead — each runs thousands of randomized cases against the real
modules, asserting properties of the maths rather than of a fixture.

| Property | Result |
|---|---|
| Resize pins the opposite corner of a rotated shape | worst drift `3.4e-13` over 48,000 cases |
| Arrow binding converges and never loops | drift exactly `0.0`; 0/200 idle movements |
| PNG round-trips its embedded scene | CRCs intact, payload byte-identical |
| Merge rule converges regardless of arrival order | 0 divergent of 200,000 pairs; 0 order-dependent of 20,000 sets |
| Selection box hit test is correct when rotated | 0 errors either way over 100,000 cases |

Two of these caught real bugs rather than merely confirming what was already true:

- **Binding**: two shapes close enough that the outline hit sat nearer than the gap sent
  the arrow tip *past* its reference point, drawing the arrow backwards. The pull-back is
  now clamped.
- **Selection**: a transparent shape dragged from its middle missed the outline hit-test,
  read as a click on empty canvas, and silently dropped the selection.

They live in [`scripts/verify/`](scripts/verify) and run in CI on every push.

## Fonts

`Caveat` (hand-drawn), `Nunito` (normal), `JetBrains Mono` (code) — all SIL OFL 1.1,
self-hosted as latin subsets under `public/fonts/`. See
[public/fonts/OFL-NOTICE.md](public/fonts/OFL-NOTICE.md) for the notice the licence
requires, and for how to swap in Excalifont or another face.

## Not built

Honest gaps against [build.md](build.md):

- **Frames** (spec §6.9) — the clipping container element.
- **Element library** and **element links** (spec §12).
- **Point add/delete** — the point editor drags existing points but cannot insert or
  remove them mid-line.
- **SVG font subsetting** (spec §10.2) — exports embed the full latin subset (~85KB)
  rather than only the glyphs used. Needs a tool like `glyphhanger`.
- **Binding gap is a constant 4** rather than measured at bind time.
- **Multi-select resize does not scale stroke widths**, though the spec's Phase 2
  criterion says it should — stroke widths are a discrete set (1/2/4) the style panel
  has to be able to represent, and scaling turns them into arbitrary floats. Rotated
  elements also distort slightly under non-uniform multi-select resize: that needs a
  shear, which the `x/y/w/h/angle` model cannot express.
- **Delta-based history** (spec §9) — history is snapshot-based and does not merge with
  remote edits, so undo in a live session is local-only.

## Licence note

Excalidraw is MIT-licensed and the `.excalidraw` format is open; this is an independent
implementation written from an architecture spec, and reads/writes that format for
interop. Fonts carry their own licences, independent of the code — see the OFL notice.
