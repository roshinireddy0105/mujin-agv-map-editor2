import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  Viewport,
  fitBounds,
  mmPerPixel,
  panBy,
  rotateAbout,
  rotationDegrees,
  transformString,
  viewToWorld,
  worldToView,
  zoomAt,
} from '../lib/viewport';

const close = (a: number, b: number, tolerance = 1e-6) =>
  expect(Math.abs(a - b)).toBeLessThan(tolerance);

describe('worldToView / viewToWorld', () => {
  const cases: Viewport[] = [
    IDENTITY,
    { scale: 0.05, rotation: 0, tx: 120, ty: -40 },
    { scale: 0.3, rotation: Math.PI / 6, tx: 10, ty: 900 },
    { scale: 0.008, rotation: -1.9, tx: -300, ty: 55 },
  ];

  it('round-trips under pan, zoom and rotation together', () => {
    for (const viewport of cases) {
      const world = { sx: 4778, sy: -12910 };
      const back = viewToWorld(worldToView(world, viewport), viewport);
      close(back.sx, world.sx, 1e-6);
      close(back.sy, world.sy, 1e-6);
    }
  });

  it('rotates clockwise on screen for a positive angle', () => {
    const viewport: Viewport = { scale: 1, rotation: Math.PI / 2, tx: 0, ty: 0 };
    const view = worldToView({ sx: 100, sy: 0 }, viewport);
    close(view.x, 0);
    close(view.y, 100);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const viewport: Viewport = { scale: 0.05, rotation: 0.4, tx: 33, ty: -12 };
    const anchor = { x: 640, y: 300 };
    const before = viewToWorld(anchor, viewport);

    const zoomed = zoomAt(viewport, anchor, 2.5);
    const after = viewToWorld(anchor, zoomed);

    close(after.sx, before.sx, 1e-5);
    close(after.sy, before.sy, 1e-5);
    close(zoomed.scale, 0.125, 1e-9);
  });

  it('clamps at both ends of the scale range', () => {
    const wayIn = zoomAt(IDENTITY, { x: 0, y: 0 }, 10_000);
    expect(wayIn.scale).toBe(MAX_SCALE);
    const wayOut = zoomAt(IDENTITY, { x: 0, y: 0 }, 1 / 10_000);
    expect(wayOut.scale).toBe(MIN_SCALE);
  });

  it('leaves the anchor pinned even at the clamp', () => {
    const anchor = { x: 400, y: 250 };
    const before = viewToWorld(anchor, IDENTITY);
    const clamped = zoomAt(IDENTITY, anchor, 10_000);
    const after = viewToWorld(anchor, clamped);
    close(after.sx, before.sx, 1e-4);
    close(after.sy, before.sy, 1e-4);
  });
});

describe('rotateAbout', () => {
  it('keeps the anchor point fixed', () => {
    const viewport: Viewport = { scale: 0.07, rotation: 0, tx: 100, ty: 100 };
    const anchor = { x: 500, y: 400 };
    const before = viewToWorld(anchor, viewport);

    const rotated = rotateAbout(viewport, anchor, Math.PI / 5);
    const after = viewToWorld(anchor, rotated);

    close(after.sx, before.sx, 1e-5);
    close(after.sy, before.sy, 1e-5);
    close(rotated.rotation, Math.PI / 5);
    expect(rotated.scale).toBe(viewport.scale);
  });

  it('accumulates and normalises for display', () => {
    let viewport = { scale: 0.1, rotation: 0, tx: 0, ty: 0 };
    for (let i = 0; i < 5; i += 1) {
      viewport = rotateAbout(viewport, { x: 0, y: 0 }, Math.PI / 2);
    }
    expect(Math.round(rotationDegrees(viewport))).toBe(90);
  });
});

describe('panBy', () => {
  it('shifts the translation without touching scale or rotation', () => {
    const viewport: Viewport = { scale: 0.2, rotation: 1, tx: 5, ty: 5 };
    const panned = panBy(viewport, -15, 30);
    expect(panned).toEqual({ scale: 0.2, rotation: 1, tx: -10, ty: 35 });
  });
});

describe('fitBounds', () => {
  const bounds = { minX: 0, maxX: 1000, minY: 0, maxY: 500 };

  it('centres the content and resets rotation', () => {
    const viewport = fitBounds(bounds, 800, 600, 0);
    expect(viewport.rotation).toBe(0);

    const centre = worldToView({ sx: 500, sy: 250 }, viewport);
    close(centre.x, 400, 1e-6);
    close(centre.y, 300, 1e-6);
  });

  it('fits the limiting axis', () => {
    const viewport = fitBounds(bounds, 800, 600, 0);
    // 800/1000 = 0.8 versus 600/500 = 1.2, so width limits, then clamps to MAX.
    expect(viewport.scale).toBe(Math.min(0.8, MAX_SCALE));
  });

  it('survives a degenerate single-point bound', () => {
    const viewport = fitBounds({ minX: 7, maxX: 7, minY: 7, maxY: 7 }, 400, 400);
    expect(Number.isFinite(viewport.scale)).toBe(true);
    expect(Number.isFinite(viewport.tx)).toBe(true);
  });
});

describe('transformString', () => {
  it('matches the composition order the maths assumes', () => {
    // SVG applies the rightmost operation first, so rotate then scale then
    // translate, which is exactly v = R(theta) * p * k + t.
    const text = transformString({ scale: 2, rotation: 0, tx: 3, ty: 4 });
    expect(text).toBe('translate(3 4) scale(2) rotate(0)');
  });
});

describe('mmPerPixel', () => {
  it('is the reciprocal of scale', () => {
    expect(mmPerPixel({ scale: 0.05, rotation: 0, tx: 0, ty: 0 })).toBe(20);
  });
});
