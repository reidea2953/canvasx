import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hitTestElement } from '../../src/element/hitTest';
import type { ExcaliElement } from '../../src/element/types';
import { getPlugin, listPlugins, registerPlugin, searchPlugins } from '../../src/plugins/registry';
import type { ElementPlugin } from '../../src/plugins/types';
import '../../src/plugins/builtin';

/**
 * The plugin architecture's whole claim is that a new element type needs ZERO
 * core changes. That is an architectural promise, and architectural promises rot
 * silently — someone adds `if (element.pluginId === 'sticky')` to the renderer
 * for one quick fix and the property is gone with nothing to notice.
 *
 * So: register a plugin the core has never heard of, and check it works.
 */
const failures: string[] = [];
const note = (m: string) => failures.push(m);
const root = process.cwd();

// ---------------------------------------------- a type the core cannot know

interface FakeData {
  caption: string;
  count: number;
}

let rendered = false;

const fake: ElementPlugin<FakeData> = {
  id: 'test-only-widget',
  label: 'Test Widget',
  category: 'data',
  description: 'Exists only in this check',
  keywords: ['zzz-unique-keyword'],
  icon: null,
  create: ({ at }) => ({ x: at.x, y: at.y, width: 100, height: 50, data: { caption: 'hi', count: 1 } }),
  render: () => {
    rendered = true;
  },
  searchText: (element) => element.data.caption,
  reviveData: (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as Partial<FakeData>;
    return {
      caption: typeof data.caption === 'string' ? data.caption : '',
      count: typeof data.count === 'number' ? data.count : 0,
    };
  },
};

registerPlugin(fake);

// 1. Registered and retrievable, with no core file mentioning it.
if (!getPlugin('test-only-widget')) note('a freshly registered plugin was not retrievable');

// 2. It appears in the menu without the menu knowing it exists.
if (!listPlugins().some((p) => p.id === 'test-only-widget')) note('plugin missing from listPlugins');
if (!searchPlugins('zzz-unique-keyword').some((p) => p.id === 'test-only-widget')) {
  note('menu search does not match a plugin keyword');
}
if (!searchPlugins('Test Widget').some((p) => p.id === 'test-only-widget')) {
  note('menu search does not match a plugin label');
}

// 3. Its data survives a round trip through its own reviver.
const revived = fake.reviveData!({ caption: 'kept', count: 7 });
if (revived?.caption !== 'kept' || revived.count !== 7) note('reviveData lost plugin data');
// And junk is rejected rather than trusted.
if (fake.reviveData!('not an object') !== null) note('reviveData accepted a non-object');
if (fake.reviveData!({ caption: 42 })?.caption !== '') note('reviveData trusted a wrong-typed field');

// 4. create() produces geometry the core can place.
const init = fake.create({ at: { x: 10, y: 20 }, viewport: { width: 800, height: 600 } });
const one = Array.isArray(init) ? init[0] : init;
if (one.width <= 0 || one.height <= 0) note('create() returned a degenerate box');

// 5. render() is reachable through the contract.
fake.render(
  { data: { caption: 'hi', count: 1 }, width: 100, height: 50 } as never,
  { ctx: {} as never, zoom: 1, dark: false },
);
if (!rendered) note('render() was not invoked through the plugin contract');

// 6. Duplicate ids must throw: ids are persisted onto elements, so a collision
//    would silently make one plugin render another's data.
let threw = false;
try {
  registerPlugin({ ...fake });
} catch {
  threw = true;
}
if (!threw) note('registering a duplicate plugin id did not throw');

// ------------------------------ a plugin must never claim the whole canvas

/**
 * The regression this exists for.
 *
 * plugin.hitTest was being called with no bounds check, and several plugins
 * returned an unconditional `true` on the assumption the core had already
 * tested the box. It had not — so every click anywhere on the canvas "hit" the
 * element, and the selection could never be cleared. The pointer was captured
 * forever by the last diagram you placed.
 *
 * A plugin that claims everything is now impossible: the core tests the box
 * first, and only refines inside it.
 */
const greedy: ElementPlugin<{ x: 1 }> = {
  id: 'test-only-greedy',
  label: 'Greedy',
  category: 'data',
  icon: null,
  create: () => ({ x: 0, y: 0, width: 10, height: 10, data: { x: 1 } }),
  render: () => {},
  // The exact mistake: "the core checked the box, so anything here is a hit".
  hitTest: () => true,
};
registerPlugin(greedy);

const element = {
  id: 'g1',
  type: 'custom',
  pluginId: 'test-only-greedy',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  angle: 0,
  isDeleted: false,
  locked: false,
  data: { x: 1 },
  strokeColor: '#000',
  backgroundColor: 'transparent',
} as unknown as ExcaliElement;

// Inside the box: the plugin's `true` is honoured.
if (!hitTestElement(element, { x: 50, y: 50 }, 1)) {
  note('a point inside a greedy plugin element did not register a hit');
}

// Far outside: the core must refuse regardless of what the plugin says. If this
// fails, clicking empty canvas will not clear the selection.
for (const point of [
  { x: 5000, y: 5000 },
  { x: -400, y: 20 },
  { x: 50, y: 900 },
  { x: 101, y: 101 },
]) {
  if (hitTestElement(element, point, 1)) {
    note(
      `point (${point.x},${point.y}) is outside the element but registered a hit — ` +
        'a plugin is claiming the whole canvas and selection can never clear',
    );
  }
}

// ------------------------------------- the core must stay ignorant of plugins

/**
 * The real regression risk. Every one of these files dispatches through the
 * registry; none may name a specific plugin. A grep is crude, but it catches
 * exactly the shortcut someone reaches for under time pressure.
 */
const CORE_FILES = [
  'src/scene/render.ts',
  'src/element/hitTest.ts',
  'src/state/persist.ts',
  'src/search/index.ts',
  'src/ui/InsertMenu.tsx',
  'src/scene/interaction.ts',
];

const BUILTIN_IDS = listPlugins()
  .map((plugin) => plugin.id)
  .filter((id) => !id.startsWith('test-only-'));

for (const file of CORE_FILES) {
  const source = readFileSync(join(root, file), 'utf8');
  for (const id of BUILTIN_IDS) {
    if (source.includes(`'${id}'`) || source.includes(`"${id}"`)) {
      note(`${file} names the plugin "${id}" — the core must dispatch, not special-case`);
    }
  }
}

console.log('plugin architecture');
console.log(`  built-in plugins registered:         ${BUILTIN_IDS.length}`);
console.log(`  a brand-new type works end to end:   ${failures.length === 0 ? 'yes' : 'NO'}`);
console.log(`  core files free of plugin names:     ${CORE_FILES.length} checked`);
console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
