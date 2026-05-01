import { describe, it, expect, beforeEach } from 'vitest';
import { roundTrip } from './fidelity/round-trip';

// Issue #45 — Milkdown round-trip fidelity gate.
//
// Drives a markdown corpus through Milkdown's parse → edit → serialize cycle
// and asserts AST-equality (not byte-equality) against the source. The point
// is to discover, BEFORE save (#7) lands, which markdown shapes survive a
// round-trip cleanly and which do not — so #7 ships with a known disposition
// (fix / flag-out / accept) for every lossy form rather than discovering loss
// in production.
//
// Why AST-equality, not byte-equality: markdown allows multiple syntactic
// forms for the same semantic (`*foo*` and `_foo_` both render to the same
// emphasis AST). A byte-equality oracle would flag those as failures and
// drown the report in noise. The oracle here parses BOTH the source and
// the serialized output through Milkdown's own parser and compares the
// resulting ProseMirror documents via `Node.eq()` — so any divergence
// flagged is a real loss of meaning, not a normalization choice.

describe('Milkdown round-trip fidelity gate (Issue #45 — AC1)', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('round-trips `# Hello` through the editor with AST-equality', async () => {
    // The minimal smoke case for AC1: a single ATX heading. If the harness
    // returns `equal: false` for `# Hello`, either the harness is broken or
    // Milkdown's commonmark preset has regressed — both are loud failures
    // worth catching at the earliest possible point in the corpus.
    const result = await roundTrip(host, '# Hello');

    expect(
      result.equal,
      `expected AST-equality for the trivial heading case.\nsource:\n${result.source}\nserialized:\n${result.serialized}`,
    ).toBe(true);
  });
});
