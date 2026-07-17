/**
 * A small tokenizer for canvas syntax highlighting.
 *
 * Deliberately not Prism or highlight.js: those emit HTML, and this has to
 * colour runs of text inside a canvas fillText loop. Adapting one would mean
 * parsing its output back out of a DOM — more code than this, and slower.
 *
 * The trade is honest: this is lexical, not syntactic. It knows strings,
 * comments, numbers, keywords and punctuation. It does not know types, scope or
 * context, so it will not colour a user-defined class name. For reading a
 * snippet on a whiteboard that is the right amount of correctness for ~150
 * lines and no dependency.
 */
export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'punct' | 'type';

export interface Token {
  text: string;
  kind: TokenKind;
}

export type LanguageId =
  | 'plaintext' | 'python' | 'c' | 'cpp' | 'java' | 'javascript' | 'typescript'
  | 'jsx' | 'html' | 'css' | 'json' | 'sql' | 'bash' | 'powershell' | 'php'
  | 'go' | 'rust' | 'kotlin' | 'swift' | 'dart' | 'yaml' | 'markdown';

export const LANGUAGES: { id: LanguageId; label: string }[] = [
  { id: 'plaintext', label: 'Plain Text' },
  { id: 'python', label: 'Python' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'jsx', label: 'React (JSX)' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Bash' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'php', label: 'PHP' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'swift', label: 'Swift' },
  { id: 'dart', label: 'Dart' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
];

interface Grammar {
  keywords: string[];
  /** Words highlighted as types/builtins. */
  types?: string[];
  lineComment?: string[];
  blockComment?: [open: string, close: string];
  /** Quote characters that open a string. */
  quotes?: string[];
  /** Languages where # starts a preprocessor line, coloured as a keyword. */
  hash?: 'comment' | 'keyword';
}

const C_LIKE_TYPES = ['int', 'char', 'float', 'double', 'void', 'bool', 'long', 'short', 'unsigned', 'signed'];

const GRAMMARS: Record<LanguageId, Grammar> = {
  plaintext: { keywords: [] },

  python: {
    keywords: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'pass', 'break', 'continue', 'global', 'nonlocal', 'assert', 'del', 'async', 'await', 'is', 'None', 'True', 'False', 'self'],
    types: ['int', 'str', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes', 'object'],
    lineComment: ['#'],
    quotes: ['"', "'"],
  },
  c: {
    keywords: ['if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'struct', 'union', 'enum', 'typedef', 'static', 'const', 'sizeof', 'goto', 'extern', 'register', 'volatile'],
    types: C_LIKE_TYPES,
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    hash: 'keyword',
  },
  cpp: {
    keywords: ['if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'class', 'struct', 'public', 'private', 'protected', 'virtual', 'override', 'template', 'typename', 'namespace', 'using', 'new', 'delete', 'this', 'const', 'constexpr', 'static', 'auto', 'try', 'catch', 'throw', 'nullptr', 'true', 'false', 'operator', 'friend', 'inline'],
    types: [...C_LIKE_TYPES, 'string', 'vector', 'map', 'set', 'size_t', 'auto'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    hash: 'keyword',
  },
  java: {
    keywords: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'static', 'final', 'void', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package', 'this', 'super', 'null', 'true', 'false', 'abstract', 'synchronized', 'instanceof', 'enum', 'record'],
    types: ['int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'String', 'List', 'Map', 'Object', 'var'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
  },
  javascript: {
    keywords: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'default', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'async', 'await', 'yield', 'null', 'undefined', 'true', 'false'],
    types: ['Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Map', 'Set', 'Symbol', 'JSON', 'Math', 'console'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'", '`'],
  },
  typescript: {
    keywords: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'class', 'extends', 'implements', 'new', 'this', 'super', 'import', 'export', 'from', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'async', 'await', 'yield', 'null', 'undefined', 'true', 'false', 'interface', 'type', 'enum', 'namespace', 'declare', 'readonly', 'public', 'private', 'protected', 'abstract', 'as', 'satisfies', 'keyof', 'infer'],
    types: ['string', 'number', 'boolean', 'any', 'unknown', 'never', 'void', 'object', 'Array', 'Promise', 'Record', 'Partial', 'Readonly'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'", '`'],
  },
  jsx: {
    keywords: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'new', 'this', 'import', 'export', 'from', 'default', 'async', 'await', 'null', 'undefined', 'true', 'false', 'useState', 'useEffect', 'useMemo', 'useRef', 'useCallback'],
    types: ['React', 'Component', 'Fragment', 'props', 'state'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'", '`'],
  },
  html: {
    keywords: ['html', 'head', 'body', 'div', 'span', 'a', 'p', 'ul', 'li', 'script', 'style', 'link', 'meta', 'title', 'img', 'input', 'button', 'form', 'table', 'tr', 'td', 'th', 'header', 'footer', 'nav', 'section', 'article', 'main', 'DOCTYPE'],
    types: ['class', 'id', 'href', 'src', 'type', 'rel', 'alt', 'width', 'height', 'style'],
    blockComment: ['<!--', '-->'],
    quotes: ['"', "'"],
  },
  css: {
    keywords: ['import', 'media', 'keyframes', 'supports', 'font-face', 'root', 'important', 'from', 'to'],
    types: ['color', 'background', 'display', 'position', 'margin', 'padding', 'border', 'width', 'height', 'flex', 'grid', 'font', 'transform', 'transition', 'opacity'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
  },
  json: {
    keywords: ['true', 'false', 'null'],
    quotes: ['"'],
  },
  sql: {
    keywords: ['SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'DISTINCT', 'UNION', 'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'],
    types: ['INT', 'INTEGER', 'VARCHAR', 'TEXT', 'DATE', 'TIMESTAMP', 'BOOLEAN', 'DECIMAL', 'FLOAT', 'SERIAL'],
    lineComment: ['--'],
    blockComment: ['/*', '*/'],
    quotes: ["'", '"'],
  },
  bash: {
    keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'export', 'local', 'source', 'echo', 'cd', 'exit', 'set', 'unset', 'in'],
    types: ['ls', 'grep', 'sed', 'awk', 'cat', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'curl', 'git', 'npm', 'node'],
    lineComment: ['#'],
    quotes: ['"', "'"],
  },
  powershell: {
    keywords: ['function', 'param', 'if', 'else', 'elseif', 'foreach', 'for', 'while', 'do', 'switch', 'return', 'try', 'catch', 'finally', 'throw', 'begin', 'process', 'end', 'in'],
    types: ['Get-ChildItem', 'Set-Location', 'Write-Host', 'Write-Output', 'New-Item', 'Remove-Item', 'Select-Object', 'Where-Object', 'ForEach-Object', 'Test-Path'],
    lineComment: ['#'],
    blockComment: ['<#', '#>'],
    quotes: ['"', "'"],
  },
  php: {
    keywords: ['function', 'class', 'public', 'private', 'protected', 'static', 'return', 'if', 'else', 'elseif', 'foreach', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'echo', 'print', 'require', 'include', 'namespace', 'use', 'try', 'catch', 'finally', 'throw', 'extends', 'implements', 'interface', 'null', 'true', 'false', 'array', 'as'],
    types: ['int', 'string', 'float', 'bool', 'array', 'object', 'mixed', 'void'],
    lineComment: ['//', '#'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
  },
  go: {
    keywords: ['package', 'import', 'func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'select', 'nil', 'true', 'false', 'make', 'new'],
    types: ['int', 'int64', 'string', 'bool', 'float64', 'byte', 'rune', 'error', 'any'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', '`'],
  },
  rust: {
    keywords: ['fn', 'let', 'mut', 'const', 'static', 'if', 'else', 'match', 'for', 'while', 'loop', 'return', 'break', 'continue', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'where', 'async', 'await', 'move', 'ref', 'dyn', 'unsafe', 'true', 'false'],
    types: ['i32', 'i64', 'u32', 'u64', 'usize', 'f64', 'bool', 'char', 'str', 'String', 'Vec', 'Option', 'Result', 'Box'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"'],
  },
  kotlin: {
    keywords: ['fun', 'val', 'var', 'class', 'object', 'interface', 'if', 'else', 'when', 'for', 'while', 'do', 'return', 'break', 'continue', 'import', 'package', 'private', 'public', 'internal', 'protected', 'override', 'open', 'abstract', 'data', 'sealed', 'suspend', 'companion', 'init', 'this', 'super', 'null', 'true', 'false', 'is', 'in', 'as'],
    types: ['Int', 'Long', 'Double', 'Float', 'Boolean', 'String', 'Char', 'List', 'Map', 'Set', 'Any', 'Unit'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"'],
  },
  swift: {
    keywords: ['func', 'let', 'var', 'class', 'struct', 'enum', 'protocol', 'extension', 'if', 'else', 'guard', 'switch', 'case', 'default', 'for', 'in', 'while', 'repeat', 'return', 'break', 'continue', 'import', 'private', 'public', 'internal', 'fileprivate', 'static', 'override', 'init', 'deinit', 'self', 'super', 'nil', 'true', 'false', 'try', 'catch', 'throw', 'throws', 'async', 'await'],
    types: ['Int', 'Double', 'Float', 'Bool', 'String', 'Character', 'Array', 'Dictionary', 'Set', 'Any', 'Void', 'Optional'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"'],
  },
  dart: {
    keywords: ['class', 'void', 'var', 'final', 'const', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'import', 'export', 'library', 'part', 'new', 'this', 'super', 'extends', 'implements', 'with', 'abstract', 'static', 'async', 'await', 'yield', 'try', 'catch', 'finally', 'throw', 'null', 'true', 'false', 'get', 'set', 'factory'],
    types: ['int', 'double', 'num', 'bool', 'String', 'List', 'Map', 'Set', 'dynamic', 'Object', 'Future', 'Stream', 'Widget'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
  },
  yaml: {
    keywords: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'],
    lineComment: ['#'],
    quotes: ['"', "'"],
  },
  markdown: {
    keywords: [],
    quotes: ['`'],
  },
};

const isWordChar = (char: string) => /[A-Za-z0-9_$-]/.test(char);
const isDigit = (char: string) => char >= '0' && char <= '9';

/**
 * Tokenize a single line.
 *
 * Line-at-a-time by design: the renderer draws line by line, and a whole-file
 * tokenizer would have to be re-run and re-sliced for every one. The cost is
 * that a block comment spanning lines needs `inBlockComment` threaded through —
 * which the caller does, since it is drawing in order anyway.
 */
export function tokenizeLine(
  line: string,
  language: LanguageId,
  inBlockComment: boolean,
): { tokens: Token[]; inBlockComment: boolean } {
  const grammar = GRAMMARS[language] ?? GRAMMARS.plaintext;
  const tokens: Token[] = [];
  let block = inBlockComment;
  let index = 0;

  const push = (text: string, kind: TokenKind) => {
    if (text === '') return;
    // Merge with the previous token of the same kind: fewer fillText calls,
    // and fewer measureText calls to position them.
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };

  while (index < line.length) {
    // Inside a block comment, everything up to the closer is comment.
    if (block && grammar.blockComment) {
      const close = grammar.blockComment[1];
      const at = line.indexOf(close, index);
      if (at === -1) {
        push(line.slice(index), 'comment');
        return { tokens, inBlockComment: true };
      }
      push(line.slice(index, at + close.length), 'comment');
      index = at + close.length;
      block = false;
      continue;
    }

    const rest = line.slice(index);

    if (grammar.blockComment && rest.startsWith(grammar.blockComment[0])) {
      block = true;
      push(grammar.blockComment[0], 'comment');
      index += grammar.blockComment[0].length;
      continue;
    }

    const lineComment = grammar.lineComment?.find((marker) => rest.startsWith(marker));
    if (lineComment) {
      push(line.slice(index), 'comment');
      break;
    }

    const char = line[index];

    if (grammar.quotes?.includes(char)) {
      let end = index + 1;
      // Walk to the closing quote, honouring backslash escapes. An unterminated
      // string just runs to end-of-line, which is what an editor shows too.
      while (end < line.length) {
        if (line[end] === '\\') {
          end += 2;
          continue;
        }
        if (line[end] === char) {
          end++;
          break;
        }
        end++;
      }
      push(line.slice(index, end), 'string');
      index = end;
      continue;
    }

    if (isDigit(char)) {
      let end = index;
      while (end < line.length && /[0-9a-fA-FxX._]/.test(line[end])) end++;
      push(line.slice(index, end), 'number');
      index = end;
      continue;
    }

    if (isWordChar(char)) {
      let end = index;
      while (end < line.length && isWordChar(line[end])) end++;
      const word = line.slice(index, end);

      // SQL is conventionally written in either case; everything else is not.
      const match =
        language === 'sql'
          ? (list: string[]) => list.some((k) => k.toLowerCase() === word.toLowerCase())
          : (list: string[]) => list.includes(word);

      push(word, match(grammar.keywords) ? 'keyword' : match(grammar.types ?? []) ? 'type' : 'plain');
      index = end;
      continue;
    }

    if (/[{}()[\];,.:<>=+\-*/%!&|^~?@#]/.test(char)) {
      push(char, 'punct');
      index++;
      continue;
    }

    push(char, 'plain');
    index++;
  }

  return { tokens, inBlockComment: block };
}
