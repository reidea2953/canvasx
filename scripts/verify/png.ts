import { embedSceneInPng, extractSceneFromPng, PNG_SCENE_KEYWORD } from '../../src/scene/export';

/**
 * A PNG is: an 8-byte signature, then [length(4)][type(4)][data][crc(4)] chunks.
 * This builds a structurally valid minimal one — enough to exercise the chunk
 * walking without needing a real encoder.
 */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const forCrc = new Uint8Array(typeBytes.length + data.length);
  forCrc.set(typeBytes, 0);
  forCrc.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(forCrc));
  return out;
}

function minimalPng(): Blob {
  const ihdrData = new Uint8Array(13);
  const view = new DataView(ihdrData.buffer);
  view.setUint32(0, 1); // width
  view.setUint32(4, 1); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // colour type RGBA
  return new Blob(
    [
      new Uint8Array(SIGNATURE),
      chunk('IHDR', ihdrData),
      chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
      chunk('IEND', new Uint8Array(0)),
    ],
    { type: 'image/png' },
  );
}

/** Walk the chunk stream, verifying every CRC. Returns the chunk type list. */
async function validateChunks(png: Blob): Promise<string[]> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error(`signature byte ${i} corrupted`);
  }

  const types: string[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const stored = view.getUint32(offset + 8 + length);
    const computed = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (stored !== computed) {
      throw new Error(`CRC mismatch on ${type}: stored ${stored.toString(16)} computed ${computed.toString(16)}`);
    }
    types.push(type);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (offset !== bytes.length) throw new Error(`trailing bytes after IEND (${bytes.length - offset})`);
  return types;
}

const failures: string[] = [];
const note = (m: string) => failures.push(m);

// A payload with the awkward cases: unicode, quotes, newlines, NULs would be
// illegal in tEXt so are excluded by design.
const payload = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [{ id: 'a', text: 'héllo "wörld"\nsecond line — ünicode ✎' }],
});

const original = minimalPng();
const originalTypes = await validateChunks(original);
if (originalTypes.join(',') !== 'IHDR,IDAT,IEND') {
  note(`fixture is malformed: ${originalTypes.join(',')}`);
}

const embedded = await embedSceneInPng(original, PNG_SCENE_KEYWORD, payload);

// 1. Still a structurally valid PNG, every CRC intact, tEXt before IEND.
let types: string[] = [];
try {
  types = await validateChunks(embedded);
} catch (error) {
  note(`embedded PNG is corrupt: ${(error as Error).message}`);
}
if (types.join(',') !== 'IHDR,IDAT,tEXt,IEND') {
  note(`unexpected chunk order: ${types.join(',')}`);
}

// 2. The payload round-trips byte for byte.
const recovered = await extractSceneFromPng(embedded);
if (recovered === null) note('extractSceneFromPng found no payload');
else if (recovered !== payload) {
  note(`payload changed in transit\n    sent: ${payload.slice(0, 60)}\n    got:  ${recovered.slice(0, 60)}`);
}

// 3. A PNG with no payload must return null rather than throw or invent one.
const none = await extractSceneFromPng(original);
if (none !== null) note(`expected null for a payload-free PNG, got ${String(none).slice(0, 40)}`);

// 4. Round-tripping twice must not corrupt or duplicate.
const twice = await embedSceneInPng(embedded, PNG_SCENE_KEYWORD, payload);
try {
  await validateChunks(twice);
} catch (error) {
  note(`double-embed corrupts: ${(error as Error).message}`);
}

console.log('PNG scene-embedding verification');
console.log(`  fixture chunks:        ${originalTypes.join(', ')}`);
console.log(`  embedded chunks:       ${types.join(', ')}`);
console.log(`  payload bytes:         ${new TextEncoder().encode(payload).length}`);
console.log(`  round-trip identical:  ${recovered === payload}`);
console.log(`  payload-free -> null:  ${none === null}`);
console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
