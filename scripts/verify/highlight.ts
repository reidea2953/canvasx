import { LANGUAGES, tokenizeLine, type LanguageId, type TokenKind } from '../../src/plugins/builtin/code/highlight';
import { CODE_METRICS, THEMES } from '../../src/plugins/builtin/code/theme';

/**
 * The code block highlights as you type by re-tokenizing on every keystroke.
 * That is only viable if tokenizing is (a) correct and (b) far cheaper than a
 * frame — and only coherent if the DOM editor and the canvas renderer produce
 * the SAME tokens, which they do by calling this one function.
 */
const failures: string[] = [];
const note = (m: string) => failures.push(m);

/** Kind of the first token whose text matches. */
const kindOf = (line: string, language: LanguageId, text: string): TokenKind | undefined =>
  tokenizeLine(line, language, false).tokens.find((t) => t.text === text)?.kind;

// --------------------------------------------------------- correctness

const CASES: [LanguageId, string, string, TokenKind][] = [
  // The exact example from the bug report.
  ['javascript', 'console.log("Hello");', 'console', 'type'],
  ['javascript', 'console.log("Hello");', '"Hello"', 'string'],
  ['javascript', 'let a = 10;', 'let', 'keyword'],
  ['javascript', 'let a = 10;', '10', 'number'],
  ['javascript', '// a comment', '// a comment', 'comment'],

  ['python', 'def main():', 'def', 'keyword'],
  ['python', '# note', '# note', 'comment'],
  ['python', "s = 'hi'", "'hi'", 'string'],

  ['typescript', 'interface Foo {', 'interface', 'keyword'],
  ['typescript', 'const x: string = "a";', 'string', 'type'],

  ['cpp', 'int main() {', 'int', 'type'],
  ['cpp', 'return 0;', 'return', 'keyword'],

  ['rust', 'fn main() {', 'fn', 'keyword'],
  ['go', 'func main() {', 'func', 'keyword'],
  ['java', 'public class A {', 'public', 'keyword'],
  ['bash', 'echo "hi"', 'echo', 'keyword'],
  ['json', '{"a": true}', 'true', 'keyword'],
  ['css', '/* c */', '/* c */', 'comment'],
];

for (const [language, line, text, expected] of CASES) {
  const actual = kindOf(line, language, text);
  if (actual !== expected) {
    note(`${language}: "${text}" in \`${line}\` → ${actual ?? 'not found'}, expected ${expected}`);
  }
}

// SQL is written in either case, unlike everything else.
if (kindOf('select * from t', 'sql', 'select') !== 'keyword') note('sql: lowercase keyword missed');
if (kindOf('SELECT * FROM t', 'sql', 'SELECT') !== 'keyword') note('sql: uppercase keyword missed');

// Partial input must still classify — the point is highlighting WHILE typing,
// so every prefix of a line has to tokenize without throwing.
for (const partial of ['c', 'co', 'con', 'cons', 'consol', 'console', 'console.', 'console.log', 'console.log(']) {
  try {
    tokenizeLine(partial, 'javascript', false);
  } catch (error) {
    note(`partial input "${partial}" threw: ${(error as Error).message}`);
  }
}
if (kindOf('console', 'javascript', 'console') !== 'type') {
  note('a bare "console" does not highlight — highlighting must not need a complete statement');
}

// An unterminated string runs to end-of-line rather than swallowing the file.
const unterminated = tokenizeLine('s = "oops', 'javascript', false);
if (unterminated.tokens.at(-1)?.kind !== 'string') note('unterminated string not treated as a string');

// Block comment state threads across lines.
const opened = tokenizeLine('/* start', 'javascript', false);
if (!opened.inBlockComment) note('block comment did not open');
const closed = tokenizeLine('end */ let a', 'javascript', true);
if (closed.inBlockComment) note('block comment did not close');
if (closed.tokens.find((t) => t.text === 'let')?.kind !== 'keyword') {
  note('code after a closing block comment was not tokenized');
}

// Every language must have a palette entry for every kind it can emit, or a
// token renders as `undefined` — i.e. invisible.
for (const theme of ['dark', 'light'] as const) {
  for (const kind of ['plain', 'keyword', 'string', 'comment', 'number', 'punct', 'type'] as TokenKind[]) {
    if (!THEMES[theme][kind]) note(`theme "${theme}" has no colour for token kind "${kind}"`);
  }
}

// Every advertised language must tokenize rather than throw.
for (const language of LANGUAGES) {
  try {
    tokenizeLine('x = 1; // t', language.id, false);
  } catch (error) {
    note(`${language.id} threw: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------- performance

/**
 * The editor re-tokenizes the whole document on every keystroke. At a 16.7ms
 * frame that must be a rounding error, not a budget item.
 */
const doc = Array.from({ length: 300 }, (_, i) =>
  i % 4 === 0
    ? `// line ${i} explaining something`
    : `const value${i} = compute({ id: ${i}, name: "item ${i}" });`,
);

const start = performance.now();
const KEYSTROKES = 60;
for (let k = 0; k < KEYSTROKES; k++) {
  let inBlock = false;
  for (const line of doc) {
    const result = tokenizeLine(line, 'typescript', inBlock);
    inBlock = result.inBlockComment;
  }
}
const perKeystroke = (performance.now() - start) / KEYSTROKES;

if (perKeystroke > 5) {
  note(`${perKeystroke.toFixed(2)}ms to tokenize 300 lines — too slow to run per keystroke`);
}

// Metrics must be single-sourced: the DOM editor and the canvas overlay each
// other, so a drift here slides the colours off the characters.
if (CODE_METRICS.fontSize <= 0 || CODE_METRICS.lineHeight <= 0) note('CODE_METRICS are degenerate');

console.log('code highlighting');
console.log(`  languages:                     ${LANGUAGES.length}`);
console.log(`  classification cases:          ${CASES.length + 2} (+ partial-input, block-comment, palette)`);
console.log(`  300 lines, per keystroke:      ${perKeystroke.toFixed(3)} ms  (budget 5 ms)`);
console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
