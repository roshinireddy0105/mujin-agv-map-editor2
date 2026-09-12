import '@testing-library/jest-dom/vitest';

/**
 * jsdom implements neither of these, and both are load-bearing in the canvas:
 * ResizeObserver drives fit-to-view, and setPointerCapture is how a drag keeps
 * receiving events once the pointer leaves the node it started on.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

if (typeof Element !== 'undefined') {
  Element.prototype.setPointerCapture ??= function setPointerCapture() {};
  Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
    return false;
  };
}
