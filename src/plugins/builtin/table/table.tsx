import { useState } from 'react';
import { wrapText } from '../../../element/text';
import type { CustomElement } from '../../../element/types';
import { registerPlugin } from '../../registry';
import type { ElementPlugin, PluginStylePanelProps, RenderContext } from '../../types';

export interface TableCell {
  text: string;
  align: 'left' | 'center' | 'right';
  bg: string | null;
  bold: boolean;
}

export interface TableData {
  /**
   * Column widths and row heights ARE the source of truth for the grid's shape.
   * rows/cols are derived from their lengths, so the two can never disagree —
   * a separate count would be one more thing to keep in sync.
   */
  colWidths: number[];
  rowHeights: number[];
  /** Sparse, keyed "row,col". Empty cells cost nothing. */
  cells: Record<string, TableCell>;
  headerRow: boolean;
  borderColor: string;
}

const DEFAULT_COL_WIDTH = 120;
const DEFAULT_ROW_HEIGHT = 36;
const MIN_COL_WIDTH = 40;
const MIN_ROW_HEIGHT = 24;
const CELL_PADDING = 8;
const FONT_SIZE = 13;
const LINE_HEIGHT = 1.3;

const cellKey = (row: number, col: number) => `${row},${col}`;
const parsePart = (part: string | null): { row: number; col: number } | null => {
  if (!part) return null;
  const [row, col] = part.split(',').map(Number);
  return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
};

const EMPTY_CELL: TableCell = { text: '', align: 'left', bg: null, bold: false };
const cellAt = (data: TableData, row: number, col: number): TableCell =>
  data.cells[cellKey(row, col)] ?? EMPTY_CELL;

const totalWidth = (data: TableData) => data.colWidths.reduce((sum, w) => sum + w, 0);
const totalHeight = (data: TableData) => data.rowHeights.reduce((sum, h) => sum + h, 0);

/** Cumulative offset of a column/row edge. */
const offsetOf = (sizes: number[], index: number) =>
  sizes.slice(0, index).reduce((sum, size) => sum + size, 0);

const TableIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="3" y="4.4" width="14" height="11.2" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 8.2h14M3 11.8h14M8 4.4v11.2M13 4.4v11.2" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

// ---------------------------------------------------------- insert dialog

function TableInsertDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (seed: Partial<TableData>) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);

  const clamp = (value: number) => Math.max(1, Math.min(20, value || 1));

  const confirm = () => {
    onConfirm({
      colWidths: Array.from({ length: clamp(cols) }, () => DEFAULT_COL_WIDTH),
      rowHeights: Array.from({ length: clamp(rows) }, () => DEFAULT_ROW_HEIGHT),
    });
  };

  return (
    <div
      className="insert-dialog"
      role="dialog"
      aria-label="Insert table"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') confirm();
        if (event.key === 'Escape') onCancel();
      }}
    >
      <p className="dialog-title">Insert table</p>

      <div className="dialog-fields">
        <label>
          <span>Rows</span>
          <input
            type="number"
            min={1}
            max={20}
            value={rows}
            autoFocus
            onChange={(event) => setRows(clamp(Number(event.target.value)))}
          />
        </label>
        <label>
          <span>Columns</span>
          <input
            type="number"
            min={1}
            max={20}
            value={cols}
            onChange={(event) => setCols(clamp(Number(event.target.value)))}
          />
        </label>
      </div>

      {/* A preview grid: cheaper to read than two numbers. */}
      <div
        className="dialog-preview"
        style={{ gridTemplateColumns: `repeat(${clamp(cols)}, 1fr)` }}
        aria-hidden="true"
      >
        {Array.from({ length: clamp(rows) * clamp(cols) }, (_, i) => (
          <span key={i} />
        ))}
      </div>

      <div className="dialog-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={confirm}>
          Create
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ style panel

const CELL_COLORS = [null, '#fff3bf', '#ffdeeb', '#d0ebff', '#d3f9d8', '#f1f3f5'];

function TableStylePanel({ element, update }: PluginStylePanelProps<TableData>) {
  const data = element.data;

  /**
   * Structural edits rebuild the size arrays, and the element's box follows —
   * a table that adds a column but keeps its old width would squash every cell.
   * The core reads width/height off the element, so those move together here.
   */
  const resize = (patch: Partial<TableData>) => {
    const next = { ...data, ...patch };
    update(patch, { width: totalWidth(next), height: totalHeight(next) });
  };

  const addRow = () => resize({ rowHeights: [...data.rowHeights, DEFAULT_ROW_HEIGHT] });
  const addCol = () => resize({ colWidths: [...data.colWidths, DEFAULT_COL_WIDTH] });

  const removeRow = () => {
    if (data.rowHeights.length <= 1) return;
    const last = data.rowHeights.length - 1;
    // Drop the cells with it, or they linger invisibly and reappear if a row
    // is added back.
    const cells = Object.fromEntries(
      Object.entries(data.cells).filter(([key]) => parsePart(key)!.row !== last),
    );
    resize({ rowHeights: data.rowHeights.slice(0, -1), cells });
  };

  const removeCol = () => {
    if (data.colWidths.length <= 1) return;
    const last = data.colWidths.length - 1;
    const cells = Object.fromEntries(
      Object.entries(data.cells).filter(([key]) => parsePart(key)!.col !== last),
    );
    resize({ colWidths: data.colWidths.slice(0, -1), cells });
  };

  return (
    <>
      <fieldset className="style-group">
        <legend>
          Grid — {data.rowHeights.length} × {data.colWidths.length}
        </legend>
        <div className="options options-wrap">
          <button className="option" onClick={addRow} title="Add row">
            +↓
          </button>
          <button
            className="option"
            onClick={removeRow}
            disabled={data.rowHeights.length <= 1}
            title="Delete last row"
          >
            −↓
          </button>
          <button className="option" onClick={addCol} title="Add column">
            +→
          </button>
          <button
            className="option"
            onClick={removeCol}
            disabled={data.colWidths.length <= 1}
            title="Delete last column"
          >
            −→
          </button>
        </div>
      </fieldset>

      <fieldset className="style-group">
        <legend>Header row</legend>
        <div className="options">
          <button
            className={data.headerRow ? 'option active' : 'option'}
            onClick={() => update({ headerRow: !data.headerRow })}
            aria-pressed={data.headerRow}
            title="Shade and bold the first row"
          >
            ▤
          </button>
        </div>
      </fieldset>

      <fieldset className="style-group">
        <legend>Border</legend>
        <div className="swatches">
          {['#adb5bd', '#1e1e1e', '#1971c2', '#e03131', '#2f9e44'].map((color) => (
            <button
              key={color}
              className={color === data.borderColor ? 'swatch active' : 'swatch'}
              style={{ background: color, borderColor: color }}
              onClick={() => update({ borderColor: color })}
              aria-pressed={color === data.borderColor}
              title={color}
            />
          ))}
        </div>
      </fieldset>

      <p className="panel-hint">
        Double-click a cell to edit. Tab and Enter move between cells. Select a
        cell to colour or align it.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- plugin

const table: ElementPlugin<TableData> = {
  id: 'table',
  label: 'Table',
  category: 'data',
  description: 'A grid of editable cells',
  keywords: ['table', 'grid', 'rows', 'columns', 'spreadsheet', 'matrix', 'cells'],
  icon: <TableIcon />,
  minSize: { width: MIN_COL_WIDTH, height: MIN_ROW_HEIGHT },
  StylePanel: TableStylePanel,
  InsertDialog: TableInsertDialog,

  create({ at }, seed) {
    const colWidths = seed?.colWidths ?? Array.from({ length: 3 }, () => DEFAULT_COL_WIDTH);
    const rowHeights = seed?.rowHeights ?? Array.from({ length: 3 }, () => DEFAULT_ROW_HEIGHT);
    const width = colWidths.reduce((sum, w) => sum + w, 0);
    const height = rowHeights.reduce((sum, h) => sum + h, 0);

    return {
      x: at.x - width / 2,
      y: at.y - height / 2,
      width,
      height,
      data: { colWidths, rowHeights, cells: {}, headerRow: true, borderColor: '#adb5bd' },
    };
  },

  searchText: (element) =>
    Object.values(element.data.cells)
      .map((cell) => cell.text)
      .join(' '),

  editing: {
    getText: (element, part) => {
      const at = parsePart(part);
      return at ? cellAt(element.data, at.row, at.col).text : '';
    },

    setText: (element, text, part) => {
      const at = parsePart(part);
      if (!at) return element.data;
      const key = cellKey(at.row, at.col);
      const existing = element.data.cells[key] ?? EMPTY_CELL;

      // Drop the entry entirely when a cell is emptied, so the map stays sparse
      // rather than accumulating blanks for every cell ever visited.
      const cells = { ...element.data.cells };
      if (text === '' && !existing.bg && existing.align === 'left' && !existing.bold) {
        delete cells[key];
      } else {
        cells[key] = { ...existing, text };
      }
      return { ...element.data, cells };
    },

    getPartAt: (element, local) => {
      const { colWidths, rowHeights } = element.data;
      // The grid is scaled to the element's box, which resize changes freely.
      const scaleX = element.width / totalWidth(element.data);
      const scaleY = element.height / totalHeight(element.data);

      let y = 0;
      for (let row = 0; row < rowHeights.length; row++) {
        const h = rowHeights[row] * scaleY;
        if (local.y >= y && local.y < y + h) {
          let x = 0;
          for (let col = 0; col < colWidths.length; col++) {
            const w = colWidths[col] * scaleX;
            if (local.x >= x && local.x < x + w) return cellKey(row, col);
            x += w;
          }
          return null;
        }
        y += h;
      }
      return null;
    },

    getPartRect: (element, part) => {
      const at = parsePart(part);
      const { colWidths, rowHeights } = element.data;
      if (!at) return { x: 0, y: 0, width: element.width, height: element.height };

      const scaleX = element.width / totalWidth(element.data);
      const scaleY = element.height / totalHeight(element.data);
      return {
        x: offsetOf(colWidths, at.col) * scaleX,
        y: offsetOf(rowHeights, at.row) * scaleY,
        width: colWidths[at.col] * scaleX,
        height: rowHeights[at.row] * scaleY,
      };
    },

    nextPart: (element, part, direction) => {
      const at = parsePart(part);
      if (!at) return null;
      const rows = element.data.rowHeights.length;
      const cols = element.data.colWidths.length;

      if (direction === 'up') return at.row > 0 ? cellKey(at.row - 1, at.col) : null;
      if (direction === 'down') return at.row < rows - 1 ? cellKey(at.row + 1, at.col) : null;

      // Tab flows across then wraps to the next row, as a spreadsheet does.
      const flat = at.row * cols + at.col + (direction === 'next' ? 1 : -1);
      if (flat < 0 || flat >= rows * cols) return null;
      return cellKey(Math.floor(flat / cols), flat % cols);
    },

    editorStyle: (element, { dark, part }) => {
      const at = parsePart(part);
      const cell = at ? cellAt(element.data, at.row, at.col) : EMPTY_CELL;
      const isHeader = element.data.headerRow && at?.row === 0;
      return {
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        // Authored for light: the canvas inverts this element, and the core
        // re-applies the same filter to the overlay so the two match.
        color: dark ? '#1e1e1e' : '#1e1e1e',
        padding: {
          top: CELL_PADDING,
          right: CELL_PADDING,
          bottom: CELL_PADDING,
          left: CELL_PADDING,
        },
        textAlign: cell.align,
        fontWeight: cell.bold || isHeader ? 600 : 400,
        whiteSpace: 'pre-wrap',
      };
    },
  },

  render(element: CustomElement<TableData>, { ctx, isEditing, editingPart }: RenderContext) {
    const data = element.data;
    const { colWidths, rowHeights } = data;
    const scaleX = element.width / totalWidth(data);
    const scaleY = element.height / totalHeight(data);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, element.width, element.height);

    // Cell fills first, so the grid lines sit on top of them.
    let y = 0;
    for (let row = 0; row < rowHeights.length; row++) {
      const h = rowHeights[row] * scaleY;
      let x = 0;
      for (let col = 0; col < colWidths.length; col++) {
        const w = colWidths[col] * scaleX;
        const cell = cellAt(data, row, col);
        const fill = cell.bg ?? (data.headerRow && row === 0 ? '#f1f3f5' : null);
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, w, h);
        }
        x += w;
      }
      y += h;
    }

    ctx.strokeStyle = data.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Offset by 0.5 so a 1px line lands on a pixel rather than straddling two.
    let gx = 0;
    for (let col = 0; col <= colWidths.length; col++) {
      ctx.moveTo(Math.round(gx) + 0.5, 0);
      ctx.lineTo(Math.round(gx) + 0.5, element.height);
      gx += (colWidths[col] ?? 0) * scaleX;
    }
    let gy = 0;
    for (let row = 0; row <= rowHeights.length; row++) {
      ctx.moveTo(0, Math.round(gy) + 0.5);
      ctx.lineTo(element.width, Math.round(gy) + 0.5);
      gy += (rowHeights[row] ?? 0) * scaleY;
    }
    ctx.stroke();

    ctx.textBaseline = 'alphabetic';
    y = 0;
    for (let row = 0; row < rowHeights.length; row++) {
      const h = rowHeights[row] * scaleY;
      let x = 0;
      for (let col = 0; col < colWidths.length; col++) {
        const w = colWidths[col] * scaleX;
        const cell = cellAt(data, row, col);

        // The overlay is already painting exactly this cell's glyphs; every
        // other cell in the grid still draws.
        const skip = isEditing && editingPart === cellKey(row, col);
        if (cell.text !== '' && !skip) {
          const isHeader = data.headerRow && row === 0;
          ctx.fillStyle = '#1e1e1e';
          ctx.font = `${cell.bold || isHeader ? '600 ' : ''}${FONT_SIZE}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = cell.align;

          const anchorX =
            cell.align === 'center'
              ? x + w / 2
              : cell.align === 'right'
                ? x + w - CELL_PADDING
                : x + CELL_PADDING;

          const lines = wrapText(cell.text, FONT_SIZE, 2, w - CELL_PADDING * 2);
          const step = FONT_SIZE * LINE_HEIGHT;
          const maxLines = Math.max(1, Math.floor((h - CELL_PADDING) / step));

          ctx.save();
          // Clip so a long cell cannot bleed into its neighbour.
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          lines.slice(0, maxLines).forEach((line, index) => {
            ctx.fillText(line, anchorX, y + CELL_PADDING + index * step + FONT_SIZE * 0.8);
          });
          ctx.restore();
        }
        x += w;
      }
      y += h;
    }
  },

  reviveData(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as Partial<TableData>;

    const colWidths =
      Array.isArray(data.colWidths) && data.colWidths.length > 0
        ? data.colWidths.map((w) => Math.max(MIN_COL_WIDTH, Number(w) || DEFAULT_COL_WIDTH))
        : [DEFAULT_COL_WIDTH];
    const rowHeights =
      Array.isArray(data.rowHeights) && data.rowHeights.length > 0
        ? data.rowHeights.map((h) => Math.max(MIN_ROW_HEIGHT, Number(h) || DEFAULT_ROW_HEIGHT))
        : [DEFAULT_ROW_HEIGHT];

    const cells: Record<string, TableCell> = {};
    if (data.cells && typeof data.cells === 'object') {
      for (const [key, value] of Object.entries(data.cells)) {
        const at = parsePart(key);
        // Drop cells outside the grid rather than keeping data nothing can show.
        if (!at || at.row >= rowHeights.length || at.col >= colWidths.length) continue;
        const cell = value as Partial<TableCell>;
        cells[key] = {
          text: typeof cell.text === 'string' ? cell.text : '',
          align: cell.align === 'center' || cell.align === 'right' ? cell.align : 'left',
          bg: typeof cell.bg === 'string' ? cell.bg : null,
          bold: cell.bold === true,
        };
      }
    }

    return {
      colWidths,
      rowHeights,
      cells,
      headerRow: data.headerRow !== false,
      borderColor: typeof data.borderColor === 'string' ? data.borderColor : '#adb5bd',
    };
  },
};

registerPlugin(table);

export { CELL_COLORS, cellKey, parsePart };
