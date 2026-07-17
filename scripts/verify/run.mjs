import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the property checks in scripts/verify/.
 *
 * These assert things that are true of the maths rather than of a fixture, so
 * they run thousands of randomized cases against the real modules. They are the
 * only automated check on behaviour this project has — everything else is
 * visual and needs a human.
 *
 * Each is bundled with esbuild (the modules are TS with browser imports) and
 * run in a fresh node process, so one failure cannot poison the next.
 */
const here = dirname(fileURLToPath(import.meta.url));

const CHECKS = [
  ['resize', 'resize pins the opposite corner of a rotated shape'],
  ['binding', 'arrow binding converges and never loops'],
  ['png', 'PNG round-trips its embedded scene'],
  ['merge', 'collab merge converges regardless of arrival order'],
  ['selectbox', 'selection box hit test is correct when rotated'],
];

const outDir = mkdtempSync(join(tmpdir(), 'verify-'));
let failed = 0;

try {
  for (const [name, description] of CHECKS) {
    const outfile = join(outDir, `${name}.mjs`);

    try {
      await build({
        entryPoints: [join(here, `${name}.ts`)],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'esm',
        logLevel: 'error',
      });
    } catch {
      console.error(`\n✗ ${name} — failed to bundle`);
      failed++;
      continue;
    }

    console.log(`\n▸ ${name} — ${description}`);
    const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
    if (result.status !== 0) failed++;
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(
  failed === 0
    ? `\n${CHECKS.length}/${CHECKS.length} checks passed.`
    : `\n${failed}/${CHECKS.length} checks FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
