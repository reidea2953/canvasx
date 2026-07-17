import { searchScene } from '../../src/search';
import { scene } from '../../src/scene/Scene';
import type { ExcaliElement } from '../../src/element/types';

let seed = 4242;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const base = (id: string, type: string) =>
  ({
    id,
    type,
    x: rnd() * 5000,
    y: rnd() * 5000,
    width: 100,
    height: 60,
    angle: 0,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'hachure',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 0,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    locked: false,
    link: null,
  }) as unknown as ExcaliElement;

const text = (id: string, content: string, containerId: string | null = null) =>
  Object.assign(base(id, 'text'), {
    text: content,
    fontSize: 20,
    fontFamily: 1,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId,
    lineHeight: 1.25,
    autoResize: containerId === null,
  }) as ExcaliElement;

const image = (id: string, fileName: string) =>
  Object.assign(base(id, 'image'), {
    fileId: `f-${id}`,
    fileName,
    scale: [1, 1],
    status: 'saved',
  }) as ExcaliElement;

const failures: string[] = [];
const note = (m: string) => failures.push(m);

// ------------------------------------------------------ correctness

const rectWithLabel = base('rect-1', 'rectangle');
const label = text('label-1', 'Quarterly Revenue', 'rect-1');
(rectWithLabel as { boundElements: unknown }).boundElements = [{ id: 'label-1', type: 'text' }];

const linked = base('rect-2', 'rectangle');
(linked as { link: string | null }).link = 'https://example.com/roadmap';

scene.replaceAll([
  text('t-1', 'Hello World'),
  text('t-2', 'goodbye world'),
  rectWithLabel,
  label,
  image('i-1', 'diagram-final.png'),
  linked,
  base('e-1', 'ellipse'),
]);

const ids = (query: string) => searchScene(query).map((m) => m.element.id);

// Case insensitive, both directions.
if (!ids('hello').includes('t-1')) note('lowercase query missed a capitalised match');
if (!ids('HELLO').includes('t-1')) note('uppercase query missed a lowercase match');
if (ids('world').length !== 2) note(`"world" should hit 2 texts, got ${ids('world').length}`);

// A bound label reports via its CONTAINER, once — the shape is the thing you
// can see and click. Reporting both would double every labelled result.
const labelHits = ids('quarterly');
if (labelHits.length !== 1) note(`label search returned ${labelHits.length} rows, expected 1`);
if (labelHits[0] !== 'rect-1') note(`label search returned ${labelHits[0]}, expected the container`);

// Images by filename, shapes by type name, elements by link.
if (!ids('diagram-final').includes('i-1')) note('image filename not searchable');
if (!ids('.png').includes('i-1')) note('image extension not searchable');
if (!ids('ellipse').includes('e-1')) note('shape type name not searchable');
if (!ids('roadmap').includes('rect-2')) note('element link not searchable');

// Deleted elements must never surface.
const tombstone = text('t-3', 'Hello World');
(tombstone as { isDeleted: boolean }).isDeleted = true;
scene.replaceAll([...scene.getAll(), tombstone]);
if (ids('hello').includes('t-3')) note('a deleted element appeared in results');

// An empty query is not a match-everything.
if (searchScene('').length !== 0) note('empty query returned results');
if (searchScene('   ').length !== 0) note('whitespace-only query returned results');

// Exact match should outrank a mid-word one.
scene.replaceAll([text('r-exact', 'ship'), text('r-mid', 'a battleship sails')]);
const ranked = searchScene('ship').map((m) => m.element.id);
if (ranked[0] !== 'r-exact') note(`ranking put ${ranked[0]} first; expected the exact match`);

// ------------------------------------------------------ performance

const LARGE = 10_000;
const many: ExcaliElement[] = [];
for (let i = 0; i < LARGE; i++) {
  many.push(
    i % 3 === 0
      ? text(`p-${i}`, `note number ${i} about something`)
      : i % 3 === 1
        ? image(`p-${i}`, `asset-${i}.png`)
        : base(`p-${i}`, 'rectangle'),
  );
}
many.push(text('needle', 'xyzzy the unique needle'));
scene.replaceAll(many);

// First pass populates the extraction cache; later passes are the steady state
// that matters, since a user types many characters against one scene.
const cold = performance.now();
searchScene('needle');
const coldMs = performance.now() - cold;

// Simulate typing: 12 keystrokes, each a full query.
const QUERIES = ['x', 'xy', 'xyz', 'xyzz', 'xyzzy', 'n', 'ne', 'nee', 'need', 'needl', 'needle', 'note'];
const warm = performance.now();
for (const q of QUERIES) searchScene(q);
const perKeystroke = (performance.now() - warm) / QUERIES.length;

if (searchScene('xyzzy').length !== 1) note('needle not found in the large scene');
// A frame is 16.7ms; search must not be a visible fraction of one.
if (perKeystroke > 5) note(`${perKeystroke.toFixed(2)}ms per keystroke at ${LARGE} elements — too slow`);

console.log('canvas search verification');
console.log(`  correctness checks:                  ${failures.length === 0 ? 'all passed' : 'FAILURES'}`);
console.log(`  cold scan of ${LARGE} elements:       ${coldMs.toFixed(2)} ms  (builds extraction cache)`);
console.log(`  warm, per keystroke:                 ${perKeystroke.toFixed(3)} ms  (budget 5 ms)`);
console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
