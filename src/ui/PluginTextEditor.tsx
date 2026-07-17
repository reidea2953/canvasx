import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mutateElement } from '../element/mutate';
import { isCustomElement } from '../element/types';
import { getPluginFor } from '../plugins/registry';
import { invalidateInteractive, invalidateStatic } from '../scene/render';
import { scene } from '../scene/Scene';
import { record } from '../state/history';
import { setAppState, useAppState } from '../state/store';

/**
 * Text editing for plugin elements.
 *
 * The same approach as the built-in text editor, and for the same reason: a real
 * DOM textarea overlaid on the canvas buys IME, spellcheck, native selection,
 * arrow keys, word-jumps, undo-within-the-field and clipboard for free.
 * Reimplementing a caret on canvas is a trap.
 *
 * Everything specific to an element type comes from the plugin's `editing`
 * contract, so this file works for a sticky note and a code block alike and does
 * not know what either of them is.
 */
export function PluginTextEditor() {
  const editingId = useAppState((state) => state.editingPluginElementId);
  const scrollX = useAppState((state) => state.scrollX);
  const scrollY = useAppState((state) => state.scrollY);
  const zoom = useAppState((state) => state.zoom);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  /** Guards the blur React fires while unmounting. */
  const committedRef = useRef(false);

  const element = editingId ? scene.getById(editingId) : null;
  const custom = element && isCustomElement(element) ? element : null;
  const plugin = custom ? getPluginFor(custom) : undefined;
  const editing = plugin?.editing;

  useEffect(() => {
    committedRef.current = false;
    const current = editingId ? scene.getById(editingId) : null;
    if (!current || !isCustomElement(current)) {
      setValue('');
      return;
    }
    const owner = getPluginFor(current);
    setValue(owner?.editing?.getText(current as never) ?? '');
  }, [editingId]);

  useLayoutEffect(() => {
    if (!editingId) return;
    const node = textareaRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    // Caret to the END, never select-all: selecting existing text means the
    // first keystroke destroys it.
    const end = node.value.length;
    node.setSelectionRange(end, end);
  }, [editingId]);

  // The static layer must repaint so the element stops (and later resumes)
  // drawing its own text while the overlay is up.
  useEffect(() => {
    invalidateStatic();
    return () => invalidateStatic();
  }, [editingId]);

  if (!custom || !editing) return null;

  const style = editing.editorStyle(custom as never);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;

    mutateElement(custom, { data: editing.setText(custom as never, value) });
    setAppState({
      editingPluginElementId: null,
      // Stay selected after editing, as Figma does.
      selectedElementIds: { [custom.id]: true },
    });
    scene.emit();
    invalidateStatic();
    invalidateInteractive();
    record();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const node = event.currentTarget;

    if (event.key === 'Escape') {
      event.preventDefault();
      commit();
      return;
    }

    // Tab indents code rather than leaving the field. Only where the plugin
    // asked for it — for prose, Tab must remain the way out.
    if (event.key === 'Tab' && editing.tabInsertsSpaces) {
      event.preventDefault();
      const spaces = ' '.repeat(editing.tabInsertsSpaces);
      const { selectionStart: start, selectionEnd: end } = node;
      const next = `${value.slice(0, start)}${spaces}${value.slice(end)}`;
      setValue(next);
      // Restore the caret after React's re-render, or it jumps to the end.
      requestAnimationFrame(() => {
        node.selectionStart = node.selectionEnd = start + spaces.length;
      });
      event.stopPropagation();
      return;
    }

    // Carry the previous line's indentation onto the new one.
    if (event.key === 'Enter' && editing.autoIndent && !event.shiftKey) {
      const start = node.selectionStart;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(lineStart, start))?.[0] ?? '';
      if (indent !== '') {
        event.preventDefault();
        const next = `${value.slice(0, start)}\n${indent}${value.slice(node.selectionEnd)}`;
        setValue(next);
        const caret = start + 1 + indent.length;
        requestAnimationFrame(() => {
          node.selectionStart = node.selectionEnd = caret;
        });
        event.stopPropagation();
        return;
      }
    }

    // Everything else — arrows, Home/End, Backspace, Enter — is the textarea's
    // own business. Just keep the canvas from reading it as a shortcut.
    event.stopPropagation();
  };

  // Scene → viewport: the textarea is a DOM node, so it lives in CSS pixels.
  const left = (custom.x + style.padding.left + scrollX) * zoom;
  const top = (custom.y + style.padding.top + scrollY) * zoom;
  const width = (custom.width - style.padding.left - style.padding.right) * zoom;
  const height = (custom.height - style.padding.top - style.padding.bottom) * zoom;

  return (
    <textarea
      ref={textareaRef}
      className="plugin-text-editor"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(width, 8)}px`,
        height: `${Math.max(height, 8)}px`,
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize * zoom}px`,
        lineHeight: `${style.fontSize * style.lineHeight * zoom}px`,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        textDecoration: style.textDecoration,
        color: style.color,
        textAlign: style.textAlign,
        whiteSpace: style.whiteSpace,
        overflowWrap: style.whiteSpace === 'pre' ? 'normal' : 'break-word',
        // Long code has to be reachable; prose grows its box instead.
        overflow: style.whiteSpace === 'pre' ? 'auto' : 'hidden',
        transform: custom.angle ? `rotate(${custom.angle}rad)` : undefined,
        transformOrigin: 'center center',
        opacity: custom.opacity / 100,
      }}
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      aria-label={`Edit ${plugin?.label ?? 'element'}`}
    />
  );
}
