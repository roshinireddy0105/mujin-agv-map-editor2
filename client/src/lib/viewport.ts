import type { Bounds } from '@agv/shared';

/**
 * Pan, zoom and rotate as one affine transform.
 *
 * A point in drawing units `p` maps to view pixels as `v = R(rotation)·p·scale + t`.
 * The same composition written as an SVG transform is
 * `translate(tx,ty) scale(scale) rotate(deg)`, since SVG applies the rightmost
 * operation to the point first.
 *
 * This lives apart from the components, and is built on plain arithmetic rather
 * than `getScreenCTM`, so the interaction maths can be tested without a browser.
 */
export interface Viewport {
  scale: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  tx: number;
  ty: number;
}

export interface ViewPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  sx: number;
  sy: number;
}

export const MIN_SCALE = 0.004;
export const MAX_SCALE = 1.2;

export const IDENTITY: Viewport = { scale: 0.05, rotation: 0, tx: 0, ty: 0 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function rotate(point: WorldPoint, radians: number): ViewPoint {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.sx * cos - point.sy * sin, y: point.sx * sin + point.sy * cos };
}

export function worldToView(point: WorldPoint, viewport: Viewport): ViewPoint {
  const rotated = rotate(point, viewport.rotation);
  return {
    x: rotated.x * viewport.scale + viewport.tx,
    y: rotated.y * viewport.scale + viewport.ty,
  };
}

export function viewToWorld(point: ViewPoint, viewport: Viewport): WorldPoint {
  const ux = (point.x - viewport.tx) / viewport.scale;
  const uy = (point.y - viewport.ty) / viewport.scale;
  const cos = Math.cos(viewport.rotation);
  const sin = Math.sin(viewport.rotation);
  return { sx: ux * cos + uy * sin, sy: -ux * sin + uy * cos };
}

/** Zoom by `factor`, keeping whatever sits under `anchor` pinned in place. */
export function zoomAt(viewport: Viewport, anchor: ViewPoint, factor: number): Viewport {
  const world = viewToWorld(anchor, viewport);
  const scale = clampScale(viewport.scale * factor);
  const rotated = rotate(world, viewport.rotation);
  return {
    ...viewport,
    scale,
    tx: anchor.x - rotated.x * scale,
    ty: anchor.y - rotated.y * scale,
  };
}

/** Rotate by `delta` radians about a fixed view point. */
export function rotateAbout(viewport: Viewport, anchor: ViewPoint, delta: number): Viewport {
  const world = viewToWorld(anchor, viewport);
  const rotation = viewport.rotation + delta;
  const rotated = rotate(world, rotation);
  return {
    ...viewport,
    rotation,
    tx: anchor.x - rotated.x * viewport.scale,
    ty: anchor.y - rotated.y * viewport.scale,
  };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, tx: viewport.tx + dx, ty: viewport.ty + dy };
}

/** Scale and centre so `bounds` fills the viewport, with rotation reset. */
export function fitBounds(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 24,
): Viewport {
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  const scale = clampScale(Math.min(usableWidth / contentWidth, usableHeight / contentHeight));

  const centre = { sx: (bounds.minX + bounds.maxX) / 2, sy: (bounds.minY + bounds.maxY) / 2 };
  return {
    scale,
    rotation: 0,
    tx: width / 2 - centre.sx * scale,
    ty: height / 2 - centre.sy * scale,
  };
}

export function transformString(viewport: Viewport): string {
  const degrees = (viewport.rotation * 180) / Math.PI;
  return `translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale}) rotate(${degrees})`;
}

/** Degrees, normalised to [0, 360), for display. */
export function rotationDegrees(viewport: Viewport): number {
  const degrees = (viewport.rotation * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/**
 * Millimetres per screen pixel. Used to keep hit targets and snap tolerances a
 * constant physical size on screen however far you have zoomed out.
 */
export function mmPerPixel(viewport: Viewport): number {
  return 1 / viewport.scale;
}
