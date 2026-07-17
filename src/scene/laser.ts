import { invalidateInteractive } from './render';

interface LaserPoint {
  x: number;
  y: number;
  t: number;
}

const DECAY_MS = 1000;
const GLOW_WIDTH = 13;
const CORE_WIDTH = 4.5;

/**
 * Deep red. A white core reads as a highlight rather than a pointer, and washes
 * out entirely against a light canvas — the core carries the colour instead,
 * with a softer halo behind it for presence.
 */
const CORE_COLOR = '#8b0000';
const GLOW_COLOR = '#e03131';

/**
 * The laser is ephemeral: it never enters the scene, never enters history and
 * never exports. It lives entirely on the interactive layer.
 */
const trail: LaserPoint[] = [];

export function addLaserPoint(sceneX: number, sceneY: number): void {
  trail.push({ x: sceneX, y: sceneY, t: performance.now() });
  invalidateInteractive();
}

export function clearLaser(): void {
  trail.length = 0;
}

/** Keeps the RAF loop alive so the tail fades out after the pointer stops. */
export const laserHasTrail = (): boolean => trail.length > 0;

export function drawLaser(ctx: CanvasRenderingContext2D, now: number, zoom: number): void {
  while (trail.length > 0 && now - trail[0].t > DECAY_MS) trail.shift();
  if (trail.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < trail.length; i++) {
    const life = 1 - (now - trail[i].t) / DECAY_MS;
    if (life <= 0) continue;

    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);

    // Widths are divided by zoom so the beam stays constant on screen.
    ctx.globalAlpha = life * 0.35;
    ctx.strokeStyle = GLOW_COLOR;
    ctx.lineWidth = (GLOW_WIDTH * life) / zoom;
    ctx.stroke();

    ctx.globalAlpha = life;
    ctx.strokeStyle = CORE_COLOR;
    ctx.lineWidth = (CORE_WIDTH * life) / zoom;
    ctx.stroke();
  }
  ctx.restore();
}
