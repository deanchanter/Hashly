/* global React */
const { useMemo } = React;

/* ------------------------------------------------------------------ */
/* Mark 01 — Geometric Hash (precise, slightly tilted bars)           */
/* ------------------------------------------------------------------ */
function MarkGeometric({ size = 220, color = '#14201b', accent = '#c9a24b' }) {
  // Refined geometric # — built on a 100u grid, italic verticals (-9°),
  // bar weight 11u, accent on the right vertical only.
  // Verticals are rendered as paths so we can give them shaped terminals.
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="Hashly mark">
      {/* horizontals */}
      <rect x="6"  y="36" width="88" height="11" rx="2.5" fill={color} />
      <rect x="6"  y="56" width="88" height="11" rx="2.5" fill={color} />
      {/* italic verticals — slanted, slightly narrower at top */}
      <g transform="translate(0 0)">
        {/* left vertical */}
        <path
          d="M 41 4 L 49 4 L 36 100 L 28 100 Z"
          fill={color}
        />
        {/* right vertical — accent */}
        <path
          d="M 67 4 L 75 4 L 62 100 L 54 100 Z"
          fill={accent}
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Mark 02 — Stamp Hash (rough, hand-pressed)                          */
/* ------------------------------------------------------------------ */
function MarkStamp({ size = 220, color = '#14201b' }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="Hashly stamp">
      <defs>
        <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="1.6" />
        </filter>
      </defs>
      <g filter="url(#rough)" fill={color}>
        <rect x="6" y="34" width="88" height="10" rx="3" />
        <rect x="6" y="58" width="88" height="10" rx="3" />
        <rect x="34" y="6" width="10" height="88" rx="3" transform="rotate(-6 39 50)" />
        <rect x="58" y="6" width="10" height="88" rx="3" transform="rotate(-6 63 50)" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Mark 03 — Ribbon Hash (one continuous ribbon path)                  */
/* ------------------------------------------------------------------ */
function MarkRibbon({ size = 220, color = '#14201b', accent = '#c9a24b' }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="Hashly ribbon">
      {/* horizontals */}
      <path d="M10 40 Q50 33 90 40" stroke={color} strokeWidth="8" fill="none" strokeLinecap="round" />
      <path d="M10 64 Q50 57 90 64" stroke={accent} strokeWidth="8" fill="none" strokeLinecap="round" />
      {/* verticals — wavy */}
      <path d="M40 10 Q47 50 38 92" stroke={color} strokeWidth="8" fill="none" strokeLinecap="round" />
      <path d="M64 10 Q71 50 62 92" stroke={color} strokeWidth="8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Mark 04 — Block Hash (rounded chunky, friendly)                     */
/* ------------------------------------------------------------------ */
function MarkBlock({ size = 220, color = '#14201b' }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="Hashly block">
      <g fill={color}>
        <rect x="4" y="32" width="92" height="14" rx="7" />
        <rect x="4" y="54" width="92" height="14" rx="7" />
        <rect x="32" y="4" width="14" height="92" rx="7" />
        <rect x="54" y="4" width="14" height="92" rx="7" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Mark 05 — Page-corner Hash (hash inside a folded page)              */
/* ------------------------------------------------------------------ */
function MarkPage({ size = 220, color = '#14201b', paper = '#f0f1ec', accent = '#c9a24b' }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="Hashly page">
      {/* page silhouette with folded corner */}
      <path d="M14 6 H72 L92 26 V94 H14 Z" fill={paper} stroke={color} strokeWidth="3" strokeLinejoin="round" />
      <path d="M72 6 V26 H92" fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" />
      {/* hash centered */}
      <g transform="translate(50 56)">
        <g transform="translate(-22 -22) scale(0.44)">
          <rect x="8" y="36" width="84" height="9" rx="2" fill={color} />
          <rect x="8" y="58" width="84" height="9" rx="2" fill={color} />
          <rect x="34" y="8" width="9" height="92" rx="2" fill={color} />
          <rect x="58" y="8" width="9" height="92" rx="2" fill={accent} />
        </g>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Mark 06 — Serif Hash (editorial, Fraunces-flavored)                 */
/* ------------------------------------------------------------------ */
function MarkSerif({ size = 220, color = '#14201b' }) {
  // Drawn glyph-like # with bracketed terminals
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="Hashly serif">
      <g fill={color}>
        {/* horizontal 1 with slight serifs */}
        <path d="M6 38 H94 V44 H6 Z" />
        {/* horizontal 2 */}
        <path d="M6 58 H94 V64 H6 Z" />
        {/* italic vertical 1 with bracketed terminals */}
        <path d="M40 6 L46 6 L40 96 L34 96 Z" />
        <path d="M32 4 H48 V8 H32 Z" />
        <path d="M28 94 H44 V98 H28 Z" />
        {/* italic vertical 2 */}
        <path d="M64 6 L70 6 L64 96 L58 96 Z" />
        <path d="M56 4 H72 V8 H56 Z" />
        <path d="M52 94 H68 V98 H52 Z" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Mark 07 — Hash + Caret (cursor wink)                                */
/* ------------------------------------------------------------------ */
function MarkCaret({ size = 220, color = '#14201b', accent = '#c9a24b' }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="Hashly caret">
      <g>
        <rect x="8" y="36" width="64" height="9" rx="2" fill={color} />
        <rect x="8" y="58" width="64" height="9" rx="2" fill={color} />
        <g transform="skewX(-8)">
          <rect x="32" y="8" width="9" height="92" rx="2" fill={color} />
          <rect x="54" y="8" width="9" height="92" rx="2" fill={color} />
        </g>
        {/* blinking caret to the right */}
        <rect x="80" y="22" width="6" height="60" rx="2" fill={accent}>
          <animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.4;0.5;0.9;1" dur="1.1s" repeatCount="indefinite" />
        </rect>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Mark 08 — Sketched Hash (ink stroke, hand-drawn)                    */
/* ------------------------------------------------------------------ */
function MarkSketch({ size = 220, color = '#14201b' }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="Hashly sketch">
      <g fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 40 C 30 38, 60 42, 90 38" />
        <path d="M9 62 C 35 64, 62 60, 91 63" />
        <path d="M42 8 C 38 35, 41 65, 36 92" />
        <path d="M66 9 C 62 36, 65 66, 60 93" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Wordmark                                                            */
/* ------------------------------------------------------------------ */
function Wordmark({ size = 96, color = '#14201b', accent = '#c9a24b', plain = false }) {
  const baseStyle = {
    fontSize: size,
    lineHeight: 0.9,
    color,
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    letterSpacing: '-0.025em',
    fontVariationSettings: '"opsz" 144, "SOFT" 100',
  };
  if (plain) {
    return <span className="wordmark" style={baseStyle}>hashly</span>;
  }
  return (
    <span className="wordmark" style={{ ...baseStyle, display: 'inline-flex', alignItems: 'baseline' }}>
      <span style={{ color: accent, marginRight: size * 0.02, fontWeight: 700 }}>#</span>
      <span>hashly</span>
    </span>
  );
}

/* expose */
Object.assign(window, {
  MarkGeometric, MarkStamp, MarkRibbon, MarkBlock,
  MarkPage, MarkSerif, MarkCaret, MarkSketch,
  Wordmark,
});
