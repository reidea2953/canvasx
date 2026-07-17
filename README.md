# Hand-Drawn Whiteboard

[![CI](https://github.com/Patni05/handdrawn-whiteboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Patni05/handdrawn-whiteboard/actions/workflows/ci.yml)

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
npm run check        # typecheck + verify + build — run this before pushing
npm run typecheck    # tsc --noEmit
npm run verify       # the property checks (see Verified)
npm run build        # typecheck + production build
```

## Tools

| Key | Tool | | Key | Tool |
|---|---|---|---|---|
| `v` `1` | Select | | `t` `8` | Text |
| `r` `2` | Rectangle | | `9` | Image |
| `d` `3` | Diamond | | `e` `0` | Eraser |
| `o` `4` | Ellipse | | `k` | Laser pointer |
| `a` `5` | Arrow | | `h` | Hand (pan) |
| `l` `6` | Line | | `q` | Keep tool active |
| `p` `7` | Draw (freehand) | | | |

`Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Ctrl+D` duplicate · `Ctrl+G` / `Ctrl+Shift+G`
group/ungroup · `Ctrl+A` select all · `Ctrl+C/V/X` clipboard · `Ctrl+[` / `Ctrl+]`
z-order · `Ctrl+0` reset zoom · `Ctrl+S` save · `Ctrl+Shift+E` export PNG · `Alt+/`
stats · `Space+drag` pan · `Ctrl+wheel` zoom.

Modifiers: `Shift` constrains (square/circle, 15° angles, axis-locked drags), `Alt`
draws from centre or duplicate-drags, `Ctrl` resizes from centre.

Double-click: empty canvas → text · a shape → label inside it · a line/arrow → point
editor · a group → drill in.

`Ctrl+F` searches the canvas: text, shape labels, image filenames, element links and
shape type names. `Enter` / `Shift+Enter` step through matches, each one zooming to
centre and flashing.

Images arrive by toolbar button, drag-and-drop or paste — PNG, JPG, SVG, WebP, GIF,
AVIF — and are ordinary elements, so they move, resize, rotate and layer like anything
else.

**Selection persists.** It survives moving, resizing, rotating and restyling, and is
dropped only by clicking empty canvas, `Escape`, an explicit deselect, or switching
tool.

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

**A text element's box is a result, not an input** ([text.ts](src/element/text.ts)).
Glyphs do not derive from `width`/`height`, so rewriting those resizes the selection box
and nothing else. Text therefore has its own resize semantics: corners scale `fontSize`,
side handles set `autoResize: false` and pin a wrap width, and the box is re-measured
from the content either way so the handles stay glued to the glyphs. `textWrapWidth()` is
the single source of truth for where lines break — the canvas, the SVG exporter and the
DOM textarea all read it, because three copies of that rule can disagree and make text
jump the moment you click away.

**The editor owns "don't draw what I'm editing"** ([TextEditor.tsx](src/ui/TextEditor.tsx)).
While a textarea is mounted over an element, the canvas must not paint that element too,
or you get doubled glyphs offset by the baseline difference. `renderStatic` skips it, and
the editor invalidates the static layer on mount and unmount — putting the invalidation
at each call site that opens an editor works right up until someone adds one more.

**Selected means draggable anywhere in the box**
([selection.ts](src/scene/selection.ts)). Shapes default to a transparent background, and
an unfilled shape only hit-tests near its *outline* — so dragging one from the middle
reads as a click on empty canvas. Once something is selected its whole box is a drag
target, as in Figma.

**Icons are stroked SVG in `currentColor`** ([Icons.tsx](src/ui/Icons.tsx)). Emoji glyphs
are colour bitmaps the OS renders; CSS cannot recolour them, so they turn to mud on a
dark panel and no filter fixes it. Drawn as paths instead, an icon is exactly as visible
as the text beside it and inverts with the theme for free.

**Collaboration needs no server authority** ([sync.ts](src/collab/sync.ts)). Higher
`version` wins; on a tie, lower `versionNonce` wins. Both peers run the identical
comparison and converge on the same answer with no round trip. The relay
([server/index.js](server/index.js)) only sees ciphertext: the room key lives in the URL
fragment, which browsers never transmit.

Only changed elements go on the wire — `sentVersions` tracks what each element's version
was when last sent, so a drag that mutates one shape sends one shape. Scene diffs are
throttled to ~30/s and pointers to ~20/s; activity changes ("started typing") bypass the
pointer throttle, because they are rare, meaningful, and would otherwise wait for a mouse
move that may never come.

**Remote cursors are interpolated, not snapped** ([presence.ts](src/collab/presence.ts)).
Pointers arrive at ~20Hz to keep traffic down, and a cursor that teleports 20 times a
second reads as broken. Easing toward the last reported position each frame turns the same
packets into smooth motion for free — the network cost of smoothness is zero.

**Search extracts once, matches many times** ([search/index.ts](src/search/index.ts)).
Matching is not the cost — a lowercase substring test over 10,000 short strings is ~1ms.
*Extraction* is: reaching into containers for bound labels, normalizing case, joining
fields. So extraction is cached per element by `version`, exactly like the rough
drawables, and a keystroke costs one linear scan over pre-computed strings. Measured at
**1.6ms per keystroke over 10,000 elements**.

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
| Search finds the right things, fast | correctness + `1.6ms` per keystroke over 10,000 elements |

Two of these caught real bugs rather than merely confirming what was already true:

- **Binding**: two shapes close enough that the outline hit sat nearer than the gap sent
  the arrow tip *past* its reference point, drawing the arrow backwards. The pull-back is
  now clamped.
- **Selection**: a transparent shape dragged from its middle missed the outline hit-test,
  read as a click on empty canvas, and silently dropped the selection.

They live in [`scripts/verify/`](scripts/verify) and run in CI on every push.

**What this does not cover.** Anything needing a real canvas context or a real browser:
text measurement and wrapping, the render loop, every gesture, and all of the visual
design. `measureText` has no headless equivalent here, so the text metrics are checked by
eye. Treat green CI as "the maths and the build are sound", not "the app works".

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
- **Undo/redo is not synchronised** across a live session, and this is the one gap that
  needs real work rather than a small addition. History is snapshot-based: undo restores
  a copy of the whole scene, which in a room would stamp your snapshot over everyone
  else's concurrent edits. Doing it properly means delta-based history (store the inverse
  patch per entry) so an undo becomes an ordinary element change that merges like any
  other. The spec calls this out in §9.

## Why not a CRDT

The obvious question, since Yjs exists. The current model is last-write-wins per element,
keyed by `version` / `versionNonce` — the same approach Excalidraw itself uses.

A CRDT would buy character-level text merging (two people typing in one label), offline
editing, and no lost update when two peers change *different properties of the same
element* at once. Those are real wins.

What it would cost: the element store, history, persistence and the file format all
assume plain mutable objects, and every one would have to be rebuilt on Y.Map/Y.Array.
That is a rewrite of the core with a large regression surface, in exchange for edge cases
that a whiteboard hits rarely — people mostly edit *different* elements.

So: not now, and the reasoning is written down rather than assumed. If character-level
text merging or offline support becomes a requirement, the seam to cut at is `Scene` plus
`mergeRemote`, since nothing outside those two knows how elements arrive.

Two deliberate departures from the spec, rather than omissions:

- **Multi-select resize does not scale stroke widths**, though the spec's Phase 2
  criterion says it should. Stroke widths are a discrete set (1/2/4) the style panel has
  to be able to display, and scaling turns them into arbitrary floats it cannot. Rotated
  elements also distort slightly under non-uniform multi-select resize: that needs a
  shear, which the `x/y/w/h/angle` model cannot express.
- **Shape geometry is normalized during the drag**, not fixed up on release as the spec
  describes. Same visual result, but no downstream code ever sees a negative extent —
  which kills a class of edge cases in hit-testing and bounds.

## Licence note

Excalidraw is MIT-licensed and the `.excalidraw` format is open; this is an independent
implementation written from an architecture spec, and reads/writes that format for
interop. Fonts carry their own licences, independent of the code — see the OFL notice.
