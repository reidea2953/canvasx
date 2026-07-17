/**
 * Line icons drawn on a 20x20 grid.
 *
 * Every stroke is `currentColor`, so an icon is exactly as visible as the text
 * around it and inverts with the theme for free. The previous emoji glyphs
 * (✋ ▭ ✎ …) were colour bitmaps rendered by the OS — CSS cannot recolour them,
 * which is why they turned to mud on a dark panel.
 */
interface IconProps {
  /** Filled variants use this; stroke-only icons ignore it. */
  className?: string;
}

const BASE = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const HandIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M7 9V4.6a1.1 1.1 0 0 1 2.2 0V9" />
    <path d="M9.2 8.6V3.8a1.1 1.1 0 0 1 2.2 0V9" />
    <path d="M11.4 9V4.9a1.1 1.1 0 0 1 2.2 0V11" />
    <path d="M4.8 10.2V8.4a1.1 1.1 0 0 1 2.2 0V11" />
    <path d="M4.8 10.2c0 3.5 2.3 6.2 5.5 6.2s3.3-2 3.3-5.4" />
  </svg>
);

export const SelectionIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M4.5 3.2 15 9.4l-4.6 1.3-1.9 4.5z" />
  </svg>
);

export const RectangleIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <rect x="3.5" y="5" width="13" height="10" rx="1.6" />
  </svg>
);

export const DiamondIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M10 3.4 16.6 10 10 16.6 3.4 10z" />
  </svg>
);

export const EllipseIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <circle cx="10" cy="10" r="6.6" />
  </svg>
);

export const ArrowIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M4 16 16 4" />
    <path d="M9.5 4H16v6.5" />
  </svg>
);

export const LineIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M4 16 16 4" />
  </svg>
);

export const DrawIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M14.2 3.6a1.7 1.7 0 0 1 2.4 2.4L7.4 15.2 4 16.4l1.2-3.4z" />
    <path d="M12.8 5 15.4 7.6" />
  </svg>
);

export const TextIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M4.5 4.5h11" />
    <path d="M10 4.5v11" />
    <path d="M7.6 15.5h4.8" />
  </svg>
);

export const EraserIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M9.4 15.5 4.6 10.7a1.4 1.4 0 0 1 0-2l5-5a1.4 1.4 0 0 1 2 0l3.8 3.8a1.4 1.4 0 0 1 0 2l-6 6z" />
    <path d="M8 16.4h7.6" />
  </svg>
);

export const LaserIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <circle cx="10" cy="10" r="2.2" fill="currentColor" stroke="none" />
    <path d="M10 2.6v2.4M10 15v2.4M2.6 10H5M15 10h2.4" />
    <path d="M4.9 4.9 6.6 6.6M13.4 13.4l1.7 1.7M15.1 4.9l-1.7 1.7M6.6 13.4l-1.7 1.7" />
  </svg>
);

export const ImageIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <rect x="3.2" y="4.4" width="13.6" height="11.2" rx="1.6" />
    <circle cx="7.4" cy="8.4" r="1.2" />
    <path d="m3.6 13.4 3.6-3.2a1.4 1.4 0 0 1 1.9 0l4 3.6" />
    <path d="m12 11.4 1.4-1.2a1.4 1.4 0 0 1 1.9 0l1.5 1.3" />
  </svg>
);

export const LockIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <rect x="4.6" y="8.8" width="10.8" height="7.2" rx="1.6" />
    <path d="M7.2 8.8V6.6a2.8 2.8 0 0 1 5.6 0v2.2" />
  </svg>
);

export const UnlockIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <rect x="4.6" y="8.8" width="10.8" height="7.2" rx="1.6" />
    <path d="M7.2 8.8V6.6a2.8 2.8 0 0 1 5.4-1" />
  </svg>
);

export const UndoIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M7.4 5.6 3.8 9.2l3.6 3.6" />
    <path d="M3.8 9.2h7.4a4.6 4.6 0 0 1 0 9.2H8.6" />
  </svg>
);

export const RedoIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M12.6 5.6l3.6 3.6-3.6 3.6" />
    <path d="M16.2 9.2H8.8a4.6 4.6 0 0 0 0 9.2h2.6" />
  </svg>
);

export const GridIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M3.4 7.8h13.2M3.4 12.2h13.2M7.8 3.4v13.2M12.2 3.4v13.2" />
  </svg>
);

export const SnapIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <circle cx="10" cy="10" r="3" />
    <path d="M10 1.8v3.4M10 14.8v3.4M1.8 10h3.4M14.8 10h3.4" />
  </svg>
);

export const SearchIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <circle cx="8.8" cy="8.8" r="5.2" />
    <path d="m12.6 12.6 4 4" />
  </svg>
);

export const MenuIcon = ({ className }: IconProps) => (
  <svg {...BASE} className={className} aria-hidden="true">
    <path d="M3.6 6h12.8M3.6 10h12.8M3.6 14h12.8" />
  </svg>
);
