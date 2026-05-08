// Vitest global setup.
//
// jsdom doesn't implement layout, so ProseMirror's `coordsAtPos` →
// `Range.getClientRects()` path throws "target.getClientRects is not a
// function" during selection-change handling. The error fires after
// banner dismiss restores focus to .ProseMirror (issue #158 save-flow
// test). The test itself completes successfully but the unhandled
// error trips Vitest's exit code.
//
// Stub both Range methods to return zero-rect lists so ProseMirror's
// scroll-to-selection no-ops in jsdom. Real layout still runs in the
// browser; this only affects the test environment.
const ZERO_RECT = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON() {
    return this;
  },
} as DOMRect;

if (typeof Range !== 'undefined') {
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = function () {
      return { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;
    };
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = function () {
      return ZERO_RECT;
    };
  }
}

export {};
