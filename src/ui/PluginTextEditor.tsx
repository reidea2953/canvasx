import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { mutateElement } from '../element/mutate';
import { isCustomElement, type CustomElement } from '../element/types';
import { getPluginFor } from '../plugins/registry';
import type { ElementPlugin } from '../plugins/types';
import { DARK_MODE_FILTER, invalidateInteractive, invalidateStatic } from '../scene/render';
import { scene } from '../scene/Scene';
import { record } from '../state/history';
import { setAppState, useAppState } from '../state/store';

/**
 * Text editing for plugin elements.
 *
 * The default overlay is a real DOM textarea, for the same reasons the built-in
 * text editor uses one: IME, spellcheck, native selection, arrow keys,
 * word-jumps and clipboard, all for free.
 *
 * A textarea is a form control, though, and can only render ONE colour. A
 * plugin needing coloured text while typing supplies its own overlay via
 * `Editor` — see the code block.
 */
export function PluginTextEditor() {
  const editingId = useAppState((state) => state.editingPluginElementId);
  const part = useAppState((state) => state.editingPluginPart);
  /**
   * Elements mutate in place, so `element` keeps its identity when its data
   * changes and React would never re-render on its own. Without this, switching
   * language while the editor is open leaves it tokenizing the old one.
   */
  useSyncExternalStore(scene.subscribe, scene.getRevision);

  const element = editingId ? scene.getById(editingId) : null;
  if (!element || !isCustomElement(element)) return null;

  const plugin = getPluginFor(element);
  if (!plugin?.editing) return null;

  /**
   * The `key` is the whole fix for stale content.
   *
   * This used to be one component seeding its state in a useEffect. Effects run
   * AFTER paint, and the component sits at a fixed place in the tree, so
   * switching from one element to another rendered — and PAINTED — with the
   * previous element's text still in state before the effect corrected it. That
   * was the flash of the old code block's content.
   *
   * Keying by target forces React to unmount and remount, so state cannot
   * outlive the element it belonged to. Isolation is structural now, not
   * something a future effect has to remember to do.
   */
  const key = `${element.id}::${part ?? ''}`;

  // Two components rather than one with a branch: the choice decides which
  // hooks run, and a conditional hook is a crash waiting for the first person
  // to move between a plugin with a custom editor and one without.
  return plugin.Editor ? (
    <CustomEditorHost key={key} element={element} plugin={plugin} part={part} />
  ) : (
    <TextareaEditor key={key} element={element} plugin={plugin} part={part} />
  );
}

interface EditorProps {
  element: CustomElement;
  plugin: ElementPlugin<never>;
  part: string | null;
}

/** Commit, and either close or move to the next part. */
function useCommit(element: CustomElement) {
  /** Guards the blur React fires while unmounting. */
  const committed = useRef(false);

  return (data: unknown, nextPart?: string | null) => {
    if (committed.current) return;
    committed.current = true;

    mutateElement(element, { data: data as Record<string, unknown> });
    setAppState(
      nextPart !== undefined
        ? { editingPluginPart: nextPart }
        : {
            editingPluginElementId: null,
            editingPluginPart: null,
            // Stay selected after editing, as Figma does.
            selectedElementIds: { [element.id]: true },
          },
    );
    scene.emit();
    invalidateStatic();
    invalidateInteractive();
    record();
  };
}

/** The static layer must stop — and later resume — drawing what the overlay paints. */
function useStaticRepaint() {
  useLayoutEffect(() => {
    invalidateStatic();
    return () => invalidateStatic();
  }, []);
}

function partRect(plugin: ElementPlugin<never>, element: CustomElement, part: string | null) {
  return (
    plugin.editing!.getPartRect?.(element as never, part) ?? {
      x: 0,
      y: 0,
      width: element.width,
      height: element.height,
    }
  );
}

// ------------------------------------------------------- custom overlay

/**
 * The core positions and sizes the host and owns commit; the plugin fills it.
 * That split keeps geometry and history in one place while letting an element
 * render its own insides.
 */
function CustomEditorHost({ element, plugin, part }: EditorProps) {
  const scrollX = useAppState((state) => state.scrollX);
  const scrollY = useAppState((state) => state.scrollY);
  const zoom = useAppState((state) => state.zoom);
  const dark = useAppState((state) => state.theme) === 'dark';

  const finish = useCommit(element);
  useStaticRepaint();

  const rect = partRect(plugin, element, part);
  const Editor = plugin.Editor!;

  return (
    <div
      className="plugin-editor-host"
      style={{
        left: `${(element.x + rect.x + scrollX) * zoom}px`,
        top: `${(element.y + rect.y + scrollY) * zoom}px`,
        width: `${rect.width * zoom}px`,
        height: `${rect.height * zoom}px`,
        transform: element.angle ? `rotate(${element.angle}rad)` : undefined,
        transformOrigin: 'center center',
        opacity: element.opacity / 100,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <Editor
        element={element as never}
        part={part}
        zoom={zoom}
        dark={dark}
        onCommit={(data) => finish(data)}
        onCommitAndMove={(data, next) => finish(data, next)}
      />
    </div>
  );
}

// ------------------------------------------------------ default overlay

function TextareaEditor({ element, plugin, part }: EditorProps) {
  const scrollX = useAppState((state) => state.scrollX);
  const scrollY = useAppState((state) => state.scrollY);
  const zoom = useAppState((state) => state.zoom);
  const dark = useAppState((state) => state.theme) === 'dark';

  const editing = plugin.editing!;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const finish = useCommit(element);

  // Seeded once, on mount. Fresh mount per target, so this is never stale.
  const [value, setValue] = useState(() => editing.getText(element as never, part));

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    // Caret to the END, never select-all: selecting existing text means the
    // first keystroke destroys it.
    const end = node.value.length;
    node.setSelectionRange(end, end);
  }, []);

  useStaticRepaint();

  const style = editing.editorStyle(element as never, { dark, part });
  const commit = (nextPart?: string | null) =>
    finish(editing.setText(element as never, value, part), nextPart);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const node = event.currentTarget;

    if (event.key === 'Escape') {
      event.preventDefault();
      commit();
      return;
    }

    // Move between parts (table cells) rather than indenting.
    if (editing.nextPart && (event.key === 'Tab' || event.key === 'Enter')) {
      const direction =
        event.key === 'Enter'
          ? event.shiftKey
            ? 'up'
            : 'down'
          : event.shiftKey
            ? 'previous'
            : 'next';
      const target = editing.nextPart(element as never, part, direction);
      if (target !== null) {
        event.preventDefault();
        event.stopPropagation();
        commit(target);
        return;
      }
    }

    // Tab indents rather than leaving the field — only where the plugin asked.
    // For prose, Tab must remain the way out.
    if (event.key === 'Tab' && editing.tabInsertsSpaces) {
      event.preventDefault();
      const spaces = ' '.repeat(editing.tabInsertsSpaces);
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
    if (event.key === 'Enter' && editing.autoIndent && !event.shiftKey) {
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

    // Everything else — arrows, Home/End, Backspace, Enter — is the textarea's
    // own business. Just keep the canvas from reading it as a shortcut.
    event.stopPropagation();
  };

  const rect = partRect(plugin, element, part);
  const left = (element.x + rect.x + style.padding.left + scrollX) * zoom;
  const top = (element.y + rect.y + style.padding.top + scrollY) * zoom;
  const width = (rect.width - style.padding.left - style.padding.right) * zoom;
  const height = (rect.height - style.padding.top - style.padding.bottom) * zoom;

  /**
   * The overlay is a DOM node OUTSIDE .canvas-stack, so the dark-mode filter on
   * .layer never reaches it. For a plugin the canvas inverts, the overlay must
   * be inverted too or its glyphs will not match the ones underneath — dark ink
   * on a dark wash, invisible until you click away. That looked like a typing
   * delay; it was text you could not see.
   *
   * Plugins owning their own dark palette need no filter: they already returned
   * colours for this theme.
   */
  const needsInvert = dark && plugin.darkMode !== 'own';

  return (
    <textarea
      ref={textareaRef}
      className="plugin-text-editor"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => commit()}
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
        overflow: style.whiteSpace === 'pre' ? 'auto' : 'hidden',
        transform: element.angle ? `rotate(${element.angle}rad)` : undefined,
        transformOrigin: 'center center',
        opacity: element.opacity / 100,
        filter: needsInvert ? DARK_MODE_FILTER : undefined,
      }}
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      aria-label={`Edit ${plugin.label}`}
    />
  );
}
