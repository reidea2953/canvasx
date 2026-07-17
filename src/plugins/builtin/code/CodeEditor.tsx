import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PluginEditorProps } from '../../types';
import type { CodeData } from './codeblock';
import { CODE_METRICS, THEMES } from './theme';
import { tokenizeLine } from './highlight';

/**
 * A code editor that highlights as you type.
 *
 * WHY THIS SHAPE
 *
 * A <textarea> is a form control: it can render exactly one colour. That is the
 * whole reason the previous version showed flat monochrome text while typing and
 * only coloured itself on blur — the highlighting lived on the canvas, and the
 * canvas deliberately stops drawing an element while its editor is open.
 *
 * So: two perfectly aligned layers.
 *
 *   - a <pre> underneath, holding coloured <span> runs — this is what you SEE
 *   - a <textarea> on top with `color: transparent` — this is what you TYPE into
 *
 * The textarea still owns the caret, selection, IME, clipboard and native
 * undo/redo. Its glyphs are invisible; the identical glyphs in the <pre> show
 * through. React re-renders the <pre> on every keystroke, so highlighting is
 * exactly as immediate as the character itself.
 *
 * The two must use identical font, size, line-height, padding and tab size or
 * the illusion collapses — hence CODE_METRICS, shared with the canvas renderer.
 *
 * WHY NOT CODEMIRROR
 *
 * A code block here is a canvas object: it has to render to canvas for PNG/SVG
 * export, rotation and zoom. CodeMirror renders to the DOM and cannot. Adopting
 * it would still leave the canvas needing this tokenizer, so highlighting would
 * have TWO implementations that must agree — worse than one, plus several
 * hundred KB for 22 language modes. Here, both layers and the canvas call the
 * same tokenizeLine, so they cannot disagree by construction.
 */
export function CodeEditor({ element, dark, onCommit }: PluginEditorProps<CodeData>) {
  const data = element.data;
  const palette = THEMES[data.theme];

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [value, setValue] = useState(data.code);

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    // Caret to the END, never select-all: selecting existing text means the
    // first keystroke destroys it.
    const end = node.value.length;
    node.setSelectionRange(end, end);
  }, []);

  /**
   * Re-tokenized on every render, i.e. every keystroke — that is the point.
   * Memoized on (text, language) so an unrelated re-render (a pan, a theme
   * flip) does not redo the work, and so switching language re-tokenizes at
   * once rather than waiting for the next edit.
   */
  const lines = useMemo(() => {
    const out: { tokens: ReturnType<typeof tokenizeLine>['tokens'] }[] = [];
    let inBlockComment = false;
    for (const line of value.split('\n')) {
      const result = tokenizeLine(line, data.language, inBlockComment);
      inBlockComment = result.inBlockComment;
      out.push({ tokens: result.tokens });
    }
    return out;
  }, [value, data.language]);

  const commit = () => onCommit({ ...data, code: value });

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const node = event.currentTarget;

    if (event.key === 'Escape') {
      event.preventDefault();
      commit();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const spaces = ' '.repeat(CODE_METRICS.tabSize);
      const { selectionStart: start, selectionEnd: end } = node;
      setValue(`${value.slice(0, start)}${spaces}${value.slice(end)}`);
      // Restore the caret after React's re-render, or it jumps to the end.
      requestAnimationFrame(() => {
        node.selectionStart = node.selectionEnd = start + spaces.length;
      });
      event.stopPropagation();
      return;
    }

    // Carry the previous line's indentation onto the new one.
    if (event.key === 'Enter' && !event.shiftKey) {
      const start = node.selectionStart;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(lineStart, start))?.[0] ?? '';
      if (indent !== '') {
        event.preventDefault();
        setValue(`${value.slice(0, start)}\n${indent}${value.slice(node.selectionEnd)}`);
        const caret = start + 1 + indent.length;
        requestAnimationFrame(() => {
          node.selectionStart = node.selectionEnd = caret;
        });
        event.stopPropagation();
        return;
      }
    }

    // Everything else — arrows, Home/End, Backspace, Ctrl+Z — is the textarea's
    // own business. Just keep the canvas from reading it as a shortcut.
    event.stopPropagation();
  };

  /** The layers scroll as one, or the colours drift off the characters. */
  const syncScroll = () => {
    const node = textareaRef.current;
    const pre = preRef.current;
    if (!node || !pre) return;
    pre.scrollTop = node.scrollTop;
    pre.scrollLeft = node.scrollLeft;
  };

  const shared: React.CSSProperties = {
    margin: 0,
    border: 0,
    fontFamily: CODE_METRICS.font,
    fontSize: `${CODE_METRICS.fontSize}px`,
    lineHeight: `${CODE_METRICS.fontSize * CODE_METRICS.lineHeight}px`,
    tabSize: CODE_METRICS.tabSize,
    whiteSpace: 'pre',
    overflowWrap: 'normal',
    // Padding is on the shared box, not on either layer, so both start at
    // exactly the same origin.
    padding: 0,
  };

  return (
    <div
      className="code-editor"
      style={{
        background: palette.bg,
        // The header is canvas-drawn chrome and stays put; the editor covers
        // only the code area beneath it.
        paddingTop: CODE_METRICS.headerHeight + CODE_METRICS.paddingY,
        paddingBottom: CODE_METRICS.paddingY,
      }}
      // dark comes from the app theme; the block's own theme is independent, so
      // this is recorded for completeness rather than used to recolour.
      data-app-theme={dark ? 'dark' : 'light'}
    >
      {data.showLineNumbers && (
        <div
          className="code-gutter"
          aria-hidden="true"
          style={{
            ...shared,
            width: CODE_METRICS.gutterWidth,
            color: palette.gutter,
            paddingLeft: CODE_METRICS.paddingX,
          }}
        >
          {lines.map((_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
      )}

      <div className="code-scroll" style={{ paddingLeft: CODE_METRICS.paddingX }}>
        {/* What you see. */}
        <pre
          ref={preRef}
          className="code-highlight"
          aria-hidden="true"
          style={{ ...shared, color: palette.plain }}
        >
          {lines.map((line, index) => (
            <div key={index}>
              {line.tokens.length === 0 ? (
                // A blank line still needs to occupy one line box, or every
                // line below it shifts up relative to the textarea.
                '\n'
              ) : (
                line.tokens.map((token, i) => (
                  <span key={i} style={{ color: palette[token.kind] }}>
                    {token.text}
                  </span>
                ))
              )}
            </div>
          ))}
        </pre>

        {/* What you type into. Invisible glyphs, visible caret. */}
        <textarea
          ref={textareaRef}
          className="code-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onScroll={syncScroll}
          onBlur={commit}
          onKeyDown={onKeyDown}
          style={{
            ...shared,
            color: 'transparent',
            caretColor: palette.plain,
            background: 'transparent',
            resize: 'none',
            outline: 'none',
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Edit code"
        />
      </div>
    </div>
  );
}
