# CanvasX

[![CI](https://github.com/Patni05/canvasx/actions/workflows/ci.yml/badge.svg)](https://github.com/Patni05/canvasx/actions/workflows/ci.yml)

An infinite canvas for sketching, diagramming, notes and code, with a hand-drawn
aesthetic. Shapes and arrows that bind to them, freehand drawing, text in real
handwriting fonts, images, sticky notes, callouts, tables, syntax-highlighted code
blocks, a laser pointer, canvas search, export, and end-to-end-encrypted live
collaboration.

TypeScript, React and Canvas2D. React draws none of the canvas — it renders the
chrome and nothing else. No editor library, no CRDT, no charting library; the
reasons are below.

The first eight phases follow the spec in [build.md](build.md). Everything after
it — the plugin architecture, canvas search, tables — is not in that spec.

```bash
npm install
npm run dev          # http://localhost:5173
npm run server       # ws://localhost:3002 — only for live collaboration

npm run check        # typecheck + verify + build — run before pushing
npm run deploy       # check, then ship to Cloudflare
```

---

## Using it

| Key | Tool | | Key | Tool |
|---|---|---|---|---|
| `v` `1` | Select | | `t` `8` | Text |
| `r` `2` | Rectangle | | `9` | Image |
| `d` `3` | Diamond | | `e` `0` | Eraser |
| `o` `4` | Ellipse | | `k` | Laser pointer |
| `a` `5` | Arrow | | `h` | Hand (pan) |
| `l` `6` | Line | | `q` | Keep tool active |
| `p` `7` | Draw (freehand) | | | |

**Insert (+)** — 16 elements, all from the plugin registry: a sticky note, four
dividers, a callout, a code block, eight flowchart shapes and a table. The menu is
searchable; type "if" for the decision diamond.

**Editing** — double-click: empty canvas → text · a shape → a label inside it · a
sticky, callout, code block or flowchart shape → its text · a table → *that cell*
· a line or arrow → its point editor · a group → drill in.

**Search** — `Ctrl+F` finds text, shape labels, image filenames, element links and
shape type names. `Enter` / `Shift+Enter` step through matches, each zooming to
centre and flashing.

**Shortcuts** — `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Ctrl+D` duplicate ·
`Ctrl+G` / `Ctrl+Shift+G` group/ungroup · `Ctrl+A` select all · `Ctrl+C/V/X`
clipboard · `Ctrl+[` / `Ctrl+]` z-order · `Ctrl+0` reset zoom · `Ctrl+S` save ·
`Ctrl+Shift+E` export PNG · `Alt+/` stats · `Space+drag` pan · `Ctrl+wheel` zoom.

**Modifiers** — `Shift` constrains (square/circle, 15° angles, axis-locked drags),
`Alt` draws from centre or duplicate-drags, `Ctrl` resizes from centre.

**Images** — toolbar, drag-and-drop or paste. PNG, JPG, SVG, WebP, GIF, AVIF. They
are ordinary elements, so they move, resize, rotate and layer like anything else.

**Selection persists.** It survives moving, resizing, rotating and restyling, and
is dropped only by clicking empty canvas, `Escape`, an explicit deselect, or
switching tool.

---

## Architecture

Why things are the way they are. Most of these are load-bearing: change one
without reading the reason and something breaks quietly.

### Rendering

**Two stacked canvases** ([render.ts](src/scene/render.ts)). The static layer holds
committed elements and repaints only when the scene or viewport changes. The
interactive layer holds selection handles, the shape being dragged out, the laser
and remote cursors, and repaints every frame. Dragging a marquee over 2,000
elements touches only the cheap layer.

**One RAF loop, nothing draws outside it.** Pointer events fire faster than frames,
so drawing in a handler means drawing several times per painted frame. Handlers
only mutate state and call `invalidateStatic()` / `invalidateInteractive()`. A
dev-only `assertInFrame()` guard makes this self-enforcing rather than a
convention.

**Every element stores a `seed`** ([types.ts](src/element/types.ts)). Rough.js is
randomized; without a fixed seed you get *different* sketchy geometry every repaint
and shapes visibly shimmer as you pan.

**Rough drawables are cached by `version`** ([roughCache.ts](src/scene/roughCache.ts)).
Generation costs ~100× the draw. Geometry is generated in each element's *local*
frame, so a move reuses the cache via a canvas transform instead of regenerating.

**Dark mode inverts the canvas in CSS** rather than recolouring elements — right
for line art, wrong for photographs, which come out as negatives. So images are
pre-inverted with the *same* filter, which the CSS one then cancels exactly:
with `I(x) = 1-x` and `H` the hue-rotate matrix, `F(F(x)) = x`. Export carries no
filter, so it must never compensate — the two strings are checked to be
byte-identical, because that failure is silent.

### Elements

**`mutateElement` is the only write path** ([mutate.ts](src/element/mutate.ts)). It
bumps `version`, rolls a new `versionNonce`, evicts the caches, and drags bound
arrows and labels along. Elements are mutated in place — a fresh object per
pointermove would thrash the GC during freehand.

**Deletion is soft.** A tombstone can be undone and can lose a merge race; a
spliced array entry can do neither.

**Points-based elements break the `x..x+width` assumption.** Lines, arrows and
freehand strokes store points relative to `x,y` with `points[0] === [0,0]`, and
later points may run *negative*. Their bounds come from `getUnrotatedBounds()`
([bounds.ts](src/element/bounds.ts)), never from `width`/`height` directly.

**Resizing works in the element's original local frame**
([resize.ts](src/element/resize.ts)). Rotating the scene by `-angle` makes the box
axis-aligned, so resizing is plain arithmetic; the result is rotated back about the
*original* centre, which is what pins the opposite corner. Resizing in scene space
instead makes rotated shapes drift and shear.

**Arrow binding cannot oscillate** ([binding.ts](src/element/binding.ts)). When both
ends are bound, each end aims from the *other shape's centre* — never from the
arrow's own opposite endpoint. Anchoring to a value that is itself being recomputed
is exactly how these systems spin; centres are fixed during an update, so it
converges in one pass.

**Selected means draggable anywhere in the box**
([selection.ts](src/scene/selection.ts)). Shapes default to a transparent
background, and an unfilled shape only hit-tests near its *outline* — so dragging
one from the middle reads as a click on empty canvas. Once something is selected
its whole box is a drag target, as in Figma.

### Text

**Fonts gate the first render** ([load.ts](src/fonts/load.ts)). `measureText` against
an unloaded family silently returns the *fallback's* metrics, so every wrap, bound
and hit box would be computed wrong and then visibly reflow. Nothing renders until
`document.fonts.ready`.

**A text element's box is a result, not an input** ([text.ts](src/element/text.ts)).
Glyphs do not derive from `width`/`height`, so rewriting those resizes the selection
box and nothing else. Text has its own resize semantics: corners scale `fontSize`,
side handles pin a wrap width, and the box is re-measured from the content either
way so the handles stay glued to the glyphs. `textWrapWidth()` is the single source
of truth for where lines break — canvas, SVG exporter and DOM textarea all read it,
because three copies of that rule can disagree and make text jump on commit.

**The editor owns "don't draw what I'm editing"** ([TextEditor.tsx](src/ui/TextEditor.tsx)).
While a textarea is mounted over an element, the canvas must not paint that element
too, or you get doubled glyphs offset by the baseline difference. `renderStatic`
skips it, and the editor invalidates the static layer on mount and unmount — doing
it at each call site works right up until someone adds one more.

**An editor must save however it goes away**
([PluginTextEditor.tsx](src/ui/PluginTextEditor.tsx)). Clicking blank canvas clears
the editing state and unmounts the editor, and a detached node never fires focusout
— so `onBlur` alone silently discarded everything typed. But StrictMode
double-invokes effects in development, so a cleanup that commits unconditionally
fires the instant the editor opens. The cleanup therefore distinguishes a real
teardown (the app has already moved on) from React pretending. Both halves are
covered by a check, because each was wrong once.

**A textarea can only render one colour** ([CodeEditor.tsx](src/plugins/builtin/code/CodeEditor.tsx)).
That is why the code block puts a transparent textarea over a coloured `<pre>`, both
driven by the same tokenizer as the canvas, so the editor, the highlight layer and
the committed render cannot disagree.

### Extending

**One open element type is the seam** ([plugins/types.ts](src/plugins/types.ts)).
Adding an element type used to mean editing fifteen files. `CustomElement` carries a
plugin id and an opaque `data` bag, and shares `x/y/width/height/angle` with
everything else — so move, resize, rotate, z-order, group, delete, undo, snapping,
export and collaboration all work for a plugin element without the plugin doing
anything.

`data` is opaque **by design**: the moment the core reads a field out of it, that
field stops belonging to the plugin and this stops being extensible. A check
registers an element type the core has never heard of and greps six core files to
prove none names a plugin.

A minimal plugin is one file:

```tsx
registerPlugin({
  id: 'badge',
  label: 'Badge',
  category: 'basic',
  icon: <BadgeIcon />,
  create: ({ at }) => ({ x: at.x, y: at.y, width: 120, height: 40, data: { text: '' } }),
  render: (element, { ctx }) => { /* draw at 0..width, 0..height */ },
});
```

Add `editing` for double-click-to-edit, `StylePanel` for its own controls,
`InsertDialog` to ask something before inserting, `getPartAt`/`getPartRect`/`nextPart`
for sub-parts (a table cell), `Editor` to replace the textarea entirely, and
`darkMode: 'own'` when the element's colour is the point and must not invert. Then
add one import to [`plugins/builtin/index.ts`](src/plugins/builtin). Nothing else
changes.

### Collaboration

**No server authority** ([sync.ts](src/collab/sync.ts)). Higher `version` wins; on a
tie, lower `versionNonce` wins. Both peers run the identical comparison and converge
on the same answer with no round trip. The relay only sees ciphertext: the room key
lives in the URL fragment, which browsers never transmit.

There are two relays, because they answer to different constraints. In development it
is [server/index.js](server/index.js) — Node and `ws`, no account and no build step.
Deployed it is a Durable Object ([worker/RelayRoom.ts](worker/RelayRoom.ts)); see
[Deploying](#deploying) for why that is a port rather than a copy. Both speak the same
protocol, and the client picks by origin rather than by configuration.

Only changed elements go on the wire — `sentVersions` tracks each element's version
when last sent, so a drag that mutates one shape sends one shape. Scene diffs are
throttled to ~30/s and pointers to ~20/s; activity changes ("started typing") bypass
the pointer throttle, because they are rare, meaningful, and would otherwise wait for
a mouse move that may never come.

**Remote cursors are interpolated, not snapped** ([presence.ts](src/collab/presence.ts)).
A cursor that teleports 20 times a second reads as broken. Easing toward the last
reported position each frame turns the same packets into smooth motion — the network
cost of smoothness is zero.

### Search

**Extract once, match many times** ([search/index.ts](src/search/index.ts)). Matching
is not the cost — a lowercase substring test over 10,000 short strings is ~1ms.
*Extraction* is: reaching into containers for bound labels, normalizing case, joining
fields. So extraction is cached per element by `version`, exactly like the rough
drawables, and a keystroke costs one linear scan over pre-computed strings. Measured
at **1.6ms per keystroke over 10,000 elements**.

---

## Deploying

Cloudflare, as one Worker serving both the app and the relay.

```bash
npx wrangler login   # once — browser OAuth
npm run deploy       # check, then wrangler deploy
```

That publishes to `canvasx.<your-subdomain>.workers.dev`. Configuration is
[wrangler.toml](wrangler.toml); it needs no secrets, because there are none — the
room key never reaches the server.

**One origin, not two.** [worker/index.ts](worker/index.ts) routes `/ws` to the relay
and everything else to the static build. That is not tidiness. Same origin means the
WebSocket needs no CORS, the room link is the URL you are already on, and HTTPS makes
the page a secure context — which is what Web Crypto requires, and therefore what the
end-to-end encryption requires. Split across two hosts, each of those becomes a thing
to configure and get wrong. Static assets are served without waking the Worker at all.

**The relay is a Durable Object, and had to be rewritten to become one.** A relay
holds many connections open and broadcasts between them — the one thing a stateless
Worker cannot do. A Durable Object is a single addressable instance with its own
memory, so one room maps to one object and "everyone else in the room" is just its
socket list. `idFromName(room)` is a pure hash, so every peer on a link independently
addresses the same instance: no lookup table, no coordination. Sockets are accepted
with hibernation, so an idle room can be evicted from memory while its connections
stay open — a whiteboard is idle almost all the time, and without it you pay to keep
empty rooms resident.

**Why SQLite-backed.** The migration in `wrangler.toml` says `new_sqlite_classes`
rather than `new_classes`. The room persists nothing — its sockets live in memory —
but SQLite-backed objects are the ones available on the free plan, and the storage
backend is fixed at creation and cannot be changed afterwards.

```bash
npm run verify:relay
```

Boots the real Workers runtime and drives it with real WebSockets: two peers in a
room, one in another, join counts, verbatim ciphertext relay, no echo to the sender,
`peer-left` identity, junk tolerance, and the app served from the same origin. It sits
outside `npm run verify` because it needs a built `dist/` and a few seconds to boot a
server; that suite is pure and instant and worth keeping so.

---

## Verified

```bash
npm run verify
```

Most of this app can only be judged by eye. These eleven things can't be, so they
are checked instead — mostly thousands of randomized cases against the real modules,
asserting properties rather than fixtures.

| Property | Result |
|---|---|
| Resize pins the opposite corner of a rotated shape | worst drift `3.4e-13` over 48,000 cases |
| Arrow binding converges and never loops | drift exactly `0.0`; 0/200 idle movements |
| Selection box hit test is correct when rotated | 0 errors either way over 100,000 cases |
| Merge rule converges regardless of arrival order | 0 divergent of 200,000 pairs; 0 order-dependent of 20,000 sets |
| PNG round-trips its embedded scene | CRCs intact, payload byte-identical |
| Search finds the right things, fast | correctness + `1.6ms` per keystroke over 10,000 elements |
| Code tokenizes correctly, fast enough per keystroke | 20 cases across 8 languages; `1.4ms` for 300 lines |
| Table cell text persists into the data model | click→cell mapping, round trip, out-of-bounds pruning, navigation |
| A new element type needs zero core changes | unknown type works end to end; 6 core files free of plugin names |
| Dark-mode invert stays self-inverse and in sync | CSS and TS byte-identical; export never compensates |
| An editor tells a real unmount from StrictMode | both shipped bugs reproduced by mutation |

Several caught real bugs rather than confirming what was already true:

- **Binding** — two shapes close enough that the outline hit sat nearer than the gap
  sent the arrow tip *past* its reference point, drawing the arrow backwards.
- **Selection** — a transparent shape dragged from its middle missed the outline
  hit-test, read as a click on empty canvas, and dropped the selection.
- **Plugin hit-testing** — several plugins returned an unconditional `true` on the
  assumption the core had already checked their bounding box. It had not, so every
  click anywhere "hit" them and the selection could never clear.

Where a check guards a coupling rather than a calculation, it is **mutation-tested**:
the bug is put back to confirm the check fails, and fails by name. A check that has
never failed is not yet a check.

They live in [`scripts/verify/`](scripts/verify) and run in CI on every push.

**What this does not cover.** Anything needing a real canvas context or a real
browser: text measurement, the render loop, every gesture, and all of the visual
design. There is no DOM in the suite, so React lifecycle wiring is only guarded where
the decision could be extracted into a pure function. Treat green CI as *the maths
and the build are sound*, not *the app works*.

Three bugs in a row have been of one kind: correct code that nothing called, or
called wrong. The checks keep covering the parts and missing the seams between them.
Adding jsdom and a React testing library is the honest fix if it happens again.

---

## Not built

Honest gaps against [build.md](build.md):

- **Frames** (spec §6.9) — the clipping container element.
- **Element library** and **element links** (spec §12).
- **Point add/delete** — the point editor drags existing points but cannot insert or
  remove them mid-line.
- **SVG font subsetting** (spec §10.2) — exports embed the full latin subset (~85KB)
  rather than only the glyphs used. Needs a tool like `glyphhanger`.
- **Binding gap is a constant 4** rather than measured at bind time.
- **Merge / split table cells.** Spanning cells change hit-testing, rendering,
  navigation and serialization at once — it is its own system, and a half-working
  merge silently corrupts a table rather than failing visibly.
- **Undo/redo is not synchronised** across a live session, and this is the one gap
  needing real work rather than an addition. History is snapshot-based: undo restores
  a copy of the whole scene, which in a room would stamp your snapshot over everyone
  else's concurrent edits. Doing it properly means delta-based history (store the
  inverse patch per entry) so an undo becomes an ordinary element change that merges
  like any other. The spec calls this out in §9.

Two **deliberate departures** from the spec, rather than omissions:

- **Multi-select resize does not scale stroke widths**, though the spec's Phase 2
  criterion says it should. Stroke widths are a discrete set (1/2/4) the style panel
  must be able to display, and scaling turns them into arbitrary floats it cannot.
  Rotated elements also distort slightly under non-uniform multi-select resize: that
  needs a shear, which the `x/y/w/h/angle` model cannot express.
- **Shape geometry is normalized during the drag**, not fixed up on release as the
  spec describes. Same visual result, but no downstream code ever sees a negative
  extent — which kills a class of edge cases in hit-testing and bounds.

---

## Decisions worth the argument

**Why not a CRDT.** The obvious question, since Yjs exists. The current model is
last-write-wins per element, keyed by `version` / `versionNonce` — the same approach
Excalidraw uses. A CRDT would buy character-level text merging, offline editing, and
no lost update when two peers change *different properties of the same element*.
Those are real wins. The cost: the element store, history, persistence and the file
format all assume plain mutable objects, and every one would be rebuilt on
`Y.Map`/`Y.Array` — a core rewrite with a large regression surface, for edge cases a
whiteboard hits rarely, since people mostly edit different elements. If it ever
becomes a requirement, the seam is `Scene` plus `mergeRemote`; nothing outside those
two knows how elements arrive.

**Why not CodeMirror or Monaco.** A code block here is a *canvas object* — it must
render to canvas for PNG/SVG export, rotation and zoom. Both render to the DOM and
cannot. Adopting one would leave the canvas still needing this tokenizer, so
highlighting would have two implementations that must agree — strictly worse than
one — plus several hundred KB for 22 language modes. The tokenizer is ~150 lines and
lexical, not syntactic: it knows strings, comments, numbers and keywords, and will
not colour a user-defined class name. For reading a snippet on a whiteboard that is
the right amount of correctness.

**Why not Prism or highlight.js.** They emit HTML; this must colour runs inside a
`fillText` loop. Adapting one means parsing its output back out of a DOM.

---

## Fonts and branding

`Caveat` (hand-drawn), `Nunito` (normal), `JetBrains Mono` (code) — all SIL OFL 1.1,
self-hosted as latin subsets under `public/fonts/`. See
[OFL-NOTICE.md](public/fonts/OFL-NOTICE.md) for the notice the licence requires, and
for swapping in Excalifont or another face.

`fav2.png` is the icon source and is **not served** — at 560KB every visitor would
download it to draw a 16px tab icon. `public/favicon.ico` (16/32/48),
`favicon-32.png`, `favicon-192.png` and `apple-touch-icon.png` are generated from it
and total ~53KB. The wordmark ([Brand.tsx](src/ui/Brand.tsx)) reuses `favicon-32.png`
rather than a second copy that could drift.

The source arrives as artwork, so generating the set keys out the white background
(a white tile looks like a sticker on a dark tab), trims 146px of dead margin, and
pads to square — the source is 1060×992, and a favicon box is square. Alpha below 3%
is forced to zero before trimming, because `getbbox()` counts any non-zero alpha as
content and the corner pixel reads `(254,254,254)`. Redo those steps with Pillow and
LANCZOS to change it; a ~33× downscale aliases badly with cheaper filters.

---

## Licence

Excalidraw is MIT-licensed and the `.excalidraw` format is open. This is an
independent implementation written from an architecture spec, and reads/writes that
format for interop. Fonts carry their own licences, independent of the code — see the
OFL notice.
