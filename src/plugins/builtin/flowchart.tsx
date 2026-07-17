import type { CustomElement } from '../../element/types';
import { pointInPolygon, type Point } from '../../utils/geometry';
import { registerPlugin } from '../registry';
import type { ElementPlugin, RenderContext } from '../types';

export type FlowKind =
  | 'process'
  | 'decision'
  | 'terminator'
  | 'database'
  | 'document'
  | 'io'
  | 'manualInput'
  | 'connector';

export interface FlowData {
  kind: FlowKind;
  label: string;
}

/**
 * Standard flowchart silhouettes, each drawn as a path in a 0..1 unit square so
 * the geometry is independent of size. Everything below scales that path — a
 * shape defined at one size and scaled by canvas transform would give unequal
 * stroke widths on non-square boxes.
 */
type UnitPath = (w: number, h: number, ctx: CanvasRenderingContext2D) => void;

const PATHS: Record<FlowKind, UnitPath> = {
  process: (w, h, ctx) => {
    ctx.rect(0, 0, w, h);
  },

  decision: (w, h, ctx) => {
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w, h / 2);
    ctx.lineTo(w / 2, h);
    ctx.lineTo(0, h / 2);
    ctx.closePath();
  },

  terminator: (w, h, ctx) => {
    const r = Math.min(h / 2, w / 2);
    ctx.roundRect(0, 0, w, h, r);
  },

  // A cylinder: the top ellipse reads as the open end.
  database: (w, h, ctx) => {
    const ry = Math.min(h * 0.16, w * 0.3);
    ctx.moveTo(0, ry);
    ctx.ellipse(w / 2, ry, w / 2, ry, 0, Math.PI, 0);
    ctx.lineTo(w, h - ry);
    ctx.ellipse(w / 2, h - ry, w / 2, ry, 0, 0, Math.PI);
    ctx.lineTo(0, ry);
  },

  // A wavy bottom edge, the conventional "printed page".
  document: (w, h, ctx) => {
    const wave = h * 0.16;
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h - wave);
    ctx.bezierCurveTo(w * 0.75, h, w * 0.25, h - wave * 2, 0, h - wave * 0.4);
    ctx.closePath();
  },

  // Parallelogram.
  io: (w, h, ctx) => {
    const skew = Math.min(w * 0.18, h * 0.6);
    ctx.moveTo(skew, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w - skew, h);
    ctx.lineTo(0, h);
    ctx.closePath();
  },

  // Sloped top edge.
  manualInput: (w, h, ctx) => {
    const slope = h * 0.28;
    ctx.moveTo(0, slope);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
  },

  connector: (w, h, ctx) => {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  },
};

/** Polygon outlines for the hit test, where the silhouette is not a rectangle. */
const HIT_POLYGONS: Partial<Record<FlowKind, (w: number, h: number) => Point[]>> = {
  decision: (w, h) => [
    { x: w / 2, y: 0 },
    { x: w, y: h / 2 },
    { x: w / 2, y: h },
    { x: 0, y: h / 2 },
  ],
  io: (w, h) => {
    const skew = Math.min(w * 0.18, h * 0.6);
    return [
      { x: skew, y: 0 },
      { x: w, y: 0 },
      { x: w - skew, y: h },
      { x: 0, y: h },
    ];
  },
};

const DEFAULT_SIZE: Record<FlowKind, { width: number; height: number }> = {
  process: { width: 160, height: 80 },
  decision: { width: 140, height: 100 },
  terminator: { width: 150, height: 60 },
  database: { width: 130, height: 110 },
  document: { width: 150, height: 95 },
  io: { width: 165, height: 80 },
  manualInput: { width: 155, height: 85 },
  connector: { width: 60, height: 60 },
};

const LABELS: Record<FlowKind, { label: string; keywords: string[] }> = {
  process: { label: 'Process', keywords: ['step', 'action', 'box', 'rectangle'] },
  decision: { label: 'Decision', keywords: ['if', 'branch', 'condition', 'diamond', 'choice'] },
  terminator: { label: 'Terminator', keywords: ['start', 'end', 'begin', 'stop', 'pill'] },
  database: { label: 'Database', keywords: ['store', 'db', 'cylinder', 'storage', 'disk'] },
  document: { label: 'Document', keywords: ['page', 'report', 'file', 'paper', 'print'] },
  io: { label: 'Input / Output', keywords: ['data', 'parallelogram', 'read', 'write'] },
  manualInput: { label: 'Manual input', keywords: ['keyboard', 'entry', 'type', 'user'] },
  connector: { label: 'Connector', keywords: ['jump', 'link', 'circle', 'goto', 'reference'] },
};

const FlowIcon = ({ kind }: { kind: FlowKind }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <FlowIconPath kind={kind} />
  </svg>
);

function FlowIconPath({ kind }: { kind: FlowKind }) {
  const stroke = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'decision':
      return <path d="M10 3.6 16.4 10 10 16.4 3.6 10z" {...stroke} />;
    case 'terminator':
      return <rect x="2.6" y="6" width="14.8" height="8" rx="4" {...stroke} />;
    case 'database':
      return (
        <>
          <ellipse cx="10" cy="5.6" rx="6" ry="2.2" {...stroke} />
          <path d="M4 5.6v8.8c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5.6" {...stroke} />
        </>
      );
    case 'document':
      return <path d="M3.6 3.8h12.8v9.4c-2.1 2-4.3-1.4-6.4.4s-4.3-.4-6.4.4z" {...stroke} />;
    case 'io':
      return <path d="M6 4.6h11L14 15.4H3z" {...stroke} />;
    case 'manualInput':
      return <path d="M3.4 7.2 16.6 4.4v11.2H3.4z" {...stroke} />;
    case 'connector':
      return <circle cx="10" cy="10" r="6.2" {...stroke} />;
    default:
      return <rect x="3.4" y="5.4" width="13.2" height="9.2" rx="1.2" {...stroke} />;
  }
}

/**
 * One plugin per shape, generated from the table above.
 *
 * They differ only in geometry and copy, so writing eight near-identical files
 * would be eight places to fix the same bug. The registry does not care that
 * they share a factory — each is an independent registration.
 */
function makeFlowPlugin(kind: FlowKind): ElementPlugin<FlowData> {
  const meta = LABELS[kind];
  const size = DEFAULT_SIZE[kind];

  return {
    id: `flow-${kind}`,
    label: meta.label,
    category: 'diagram',
    description: 'Flowchart shape',
    keywords: ['flowchart', 'flow', 'diagram', ...meta.keywords],
    icon: <FlowIcon kind={kind} />,
    minSize: { width: 40, height: 30 },

    create({ at }) {
      return {
        x: at.x - size.width / 2,
        y: at.y - size.height / 2,
        width: size.width,
        height: size.height,
        data: { kind, label: '' },
      };
    },

    searchText: (element) => `${meta.label} ${element.data.label}`,

    // A flowchart shape without a label is just geometry; every one of these
    // wants a word in the middle.
    editing: {
      getText: (element) => element.data.label,
      setText: (element, label) => ({ ...element.data, label }),
      editorStyle: (element) => ({
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: 14,
        lineHeight: 1.3,
        color: element.strokeColor,
        // A generous inset keeps the caret clear of slanted edges — the
        // silhouette narrows toward the corners on a diamond.
        padding: {
          top: element.height * 0.3,
          right: element.width * 0.16,
          bottom: element.height * 0.3,
          left: element.width * 0.16,
        },
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
      }),
    },

    // Only the slanted silhouettes need refining; the core's box test is
    // already correct for the rest.
    hitTest: HIT_POLYGONS[kind]
      ? (element, local) => pointInPolygon(local, HIT_POLYGONS[kind]!(element.width, element.height))
      : undefined,

    render(element: CustomElement<FlowData>, { ctx, isEditing }: RenderContext) {
      const { width, height } = element;

      ctx.beginPath();
      PATHS[kind](width, height, ctx);

      if (element.backgroundColor !== 'transparent') {
        ctx.fillStyle = element.backgroundColor;
        ctx.fill();
      }
      ctx.strokeStyle = element.strokeColor;
      ctx.lineWidth = element.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // The overlay is already painting the label; the silhouette still draws.
      if (isEditing) return;

      const label = element.data.label.trim();
      if (label === '') return;

      ctx.fillStyle = element.strokeColor;
      ctx.font = `14px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Clipped to the silhouette, so a long label cannot spill outside a
      // diamond's slanted edges.
      ctx.save();
      ctx.beginPath();
      PATHS[kind](width, height, ctx);
      ctx.clip();
      ctx.fillText(label, width / 2, height / 2, width * 0.86);
      ctx.restore();
    },

    reviveData(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const data = raw as Partial<FlowData>;
      return {
        kind: data.kind && data.kind in PATHS ? data.kind : kind,
        label: typeof data.label === 'string' ? data.label : '',
      };
    },
  };
}

for (const kind of Object.keys(PATHS) as FlowKind[]) {
  registerPlugin(makeFlowPlugin(kind));
}
