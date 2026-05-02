/* global React, ReactDOM, DesignCanvas, DCSection, DCArtboard,
   MarkGeometric, MarkStamp, Wordmark */

const { Fragment } = React;

// Palette
const PAPER = '#f0f1ec';
const PAPER_2 = '#e6e8e0';
const INK = '#14201b';
const INK_2 = '#36443d';
const FOREST = '#1e3a2f';
const GOLD = '#c9a24b';
const RULE = '#d2d6cb';
const MUTED = '#7c8479';

/* ----- Frame helper ---------------------------------------------- */
function Frame({ children, label, dark, tinted, grain = true, ticks = true, style }) {
  const cls = ['frame', dark && 'dark', tinted && 'tinted', grain && 'paper-grain']
    .filter(Boolean).join(' ');
  return (
    <div className={cls} style={style}>
      {ticks && <span className="tick tl" />}
      {ticks && <span className="tick tr" />}
      {ticks && <span className="tick bl" />}
      {ticks && <span className="tick br" />}
      <div className="center">{children}</div>
      {label && <span className={'label' + (dark || tinted ? ' on-dark' : '')}>{label}</span>}
    </div>
  );
}

/* ----- App icon (rounded squircle) ------------------------------- */
function AppIcon({ size = 220, bg = GOLD, mark, radius = 0.225 }) {
  const r = size * radius;
  return (
    <div style={{
      width: size, height: size, borderRadius: r,
      background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 18px 40px -16px rgba(0,0,0,0.35), 0 2px 0 rgba(255,255,255,0.18) inset',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: r,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(0,0,0,0) 40%, rgba(0,0,0,0.06))',
        pointerEvents: 'none',
      }} />
      {mark}
    </div>
  );
}

/* ----- Lockups --------------------------------------------------- */
function LockupHorizontal({ accent = GOLD, ink = INK, scale = 1 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22 * scale }}>
      <MarkGeometric size={104 * scale} color={ink} accent={accent} />
      <Wordmark size={104 * scale} color={ink} plain />
    </div>
  );
}
function LockupStacked({ accent = GOLD, ink = INK, scale = 1 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 * scale }}>
      <MarkGeometric size={156 * scale} color={ink} accent={accent} />
      <Wordmark size={84 * scale} color={ink} plain />
    </div>
  );
}

/* ----- Construction --------------------------------------------- */
function Construction() {
  return (
    <Frame label="construction" grain={false}>
      <div style={{ position: 'relative', width: 460, height: 460 }}>
        <svg viewBox="0 0 100 100" width={460} height={460} style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M5 0 H0 V5" fill="none" stroke={RULE} strokeWidth="0.2" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
          <rect x="2" y="2" width="96" height="96" fill="none" stroke="#c2c0b3" strokeWidth="0.3" strokeDasharray="1 1" />

          {/* construction guides */}
          <line x1="6" y1="36" x2="94" y2="36" stroke={GOLD} strokeWidth="0.25" strokeDasharray="0.8 0.8" />
          <line x1="6" y1="47" x2="94" y2="47" stroke={GOLD} strokeWidth="0.25" strokeDasharray="0.8 0.8" />
          <line x1="6" y1="56" x2="94" y2="56" stroke={GOLD} strokeWidth="0.25" strokeDasharray="0.8 0.8" />
          <line x1="6" y1="67" x2="94" y2="67" stroke={GOLD} strokeWidth="0.25" strokeDasharray="0.8 0.8" />

          {/* the mark */}
          <rect x="6" y="36" width="88" height="11" rx="2.5" fill={INK} />
          <rect x="6" y="56" width="88" height="11" rx="2.5" fill={INK} />
          <path d="M 41 4 L 49 4 L 36 100 L 28 100 Z" fill={INK} />
          <path d="M 67 4 L 75 4 L 62 100 L 54 100 Z" fill={GOLD} />
        </svg>
        {/* annotations */}
        <span className="annotate" style={{ position: 'absolute', top: 4, left: 4 }}>10×10 unit grid</span>
        <span className="annotate" style={{ position: 'absolute', top: 4, right: 4 }}>vert. slope ≈ −9°</span>
        <span className="annotate" style={{ position: 'absolute', bottom: 4, left: 4 }}>bar weight = 11u</span>
        <span className="annotate" style={{ position: 'absolute', bottom: 4, right: 4 }}>accent = right stem</span>
      </div>
    </Frame>
  );
}

/* ----- Color swatch --------------------------------------------- */
function Swatch({ name, hex, color = INK }) {
  return (
    <div style={{
      flex: 1, padding: 18, background: hex, color,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      minHeight: 220, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
      letterSpacing: '0.04em',
    }}>
      <div style={{ textTransform: 'uppercase', opacity: 0.85 }}>{name}</div>
      <div style={{ opacity: 0.85 }}>{hex}</div>
    </div>
  );
}

/* ----- Type specimen -------------------------------------------- */
function TypeSpecimen() {
  return (
    <Frame label="type" grain={false}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 32, padding: 36, width: '100%', height: '100%',
        boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
              display · fraunces
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 96, lineHeight: 0.95, letterSpacing: '-0.025em', fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>
              <span style={{ color: GOLD }}>#</span>hashly
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, color: INK_2, marginTop: 12, fontWeight: 400, fontStyle: 'italic' }}>
              Markdown, as it should be read.
            </div>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
            opsz 144 · soft 100<br/>weights 400 / 600 / 700
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
              mono · jetbrains mono
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: INK, lineHeight: 1.5 }}>
              # Heading<br/>
              ## Subheading<br/>
              **bold** · *italic*<br/>
              `inline code`<br/>
              [link](url)
            </div>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
            ui · code · annotations<br/>weights 400 / 500 / 700
          </div>
        </div>
      </div>
    </Frame>
  );
}

/* ----- Spec / measurements -------------------------------------- */
function SpecCard() {
  const Row = ({ k, v }) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: `1px solid ${RULE}`,
      fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
    }}>
      <span style={{ color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10 }}>{k}</span>
      <span style={{ color: INK }}>{v}</span>
    </div>
  );
  return (
    <Frame label="spec" grain={false}>
      <div style={{ width: '85%', maxWidth: 380 }}>
        <div style={{
          fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 24,
          marginBottom: 14, letterSpacing: '-0.01em',
        }}>
          Geometric mark
        </div>
        <Row k="grid" v="100 × 100u" />
        <Row k="bar weight" v="11u" />
        <Row k="bar gap" v="9u" />
        <Row k="vertical slope" v="−9°" />
        <Row k="vertical width" v="8u" />
        <Row k="corner radius" v="2.5u" />
        <Row k="clear space" v="≥ 1× cap" />
        <Row k="min size" v="14 px" />
      </div>
    </Frame>
  );
}

/* ----- DO / DON'T ----------------------------------------------- */
function DoDont() {
  return (
    <Frame label="usage" grain={false}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18,
        width: '100%', height: '100%', padding: 24, boxSizing: 'border-box',
      }}>
        {[
          { ok: true,  label: 'on paper',         bg: PAPER,   color: INK,    accent: GOLD },
          { ok: true,  label: 'on ink',           bg: INK,     color: PAPER,  accent: GOLD },
          { ok: false, label: 'no recolor',       bg: '#7a4ec9', color: '#ff5e5e', accent: '#1ad27a' },
          { ok: false, label: 'no rotation',      bg: PAPER,   color: INK,    accent: GOLD, rotate: 22 },
        ].map((s, i) => (
          <div key={i} style={{
            background: s.bg, position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${RULE}`, overflow: 'hidden',
          }}>
            <div style={{ transform: s.rotate ? `rotate(${s.rotate}deg)` : 'none' }}>
              <MarkGeometric size={90} color={s.color} accent={s.accent} />
            </div>
            <div style={{
              position: 'absolute', top: 8, left: 8,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              color: s.ok ? '#4a6b3a' : '#b14747',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 14, height: 14, borderRadius: 999,
                background: s.ok ? '#4a6b3a' : '#b14747',
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700,
              }}>{s.ok ? '✓' : '×'}</span>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ============================================================== */
/*                          APP                                    */
/* ============================================================== */
function App() {
  return (
    <DesignCanvas
      title="Hashly — Brand sheet"
      subtitle="Geometric mark · forest + gold · Fraunces / JetBrains Mono"
      defaultZoom={0.55}
    >

      {/* HERO --------------------------------------------------- */}
      <DCSection id="hero" title="The mark" subtitle="Geometric # — italic verticals, gold accent stem">
        <DCArtboard id="hero-light" label="Primary, paper" width={640} height={520}>
          <Frame label="primary · paper">
            <MarkGeometric size={320} color={INK} accent={GOLD} />
          </Frame>
        </DCArtboard>

        <DCArtboard id="hero-dark" label="Primary, ink" width={640} height={520}>
          <Frame label="primary · ink" dark>
            <MarkGeometric size={320} color={PAPER} accent={GOLD} />
          </Frame>
        </DCArtboard>

        <DCArtboard id="hero-forest" label="Primary, forest" width={640} height={520}>
          <Frame label="primary · forest" tinted style={{ background: FOREST }}>
            <MarkGeometric size={320} color={PAPER} accent={GOLD} />
          </Frame>
        </DCArtboard>

        <DCArtboard id="construction" label="Construction" width={520} height={520}>
          <Construction />
        </DCArtboard>

        <DCArtboard id="spec" label="Spec" width={460} height={520}>
          <SpecCard />
        </DCArtboard>
      </DCSection>

      {/* WORDMARK + LOCKUPS ------------------------------------- */}
      <DCSection id="wm" title="Wordmark & lockups" subtitle="Fraunces, lowercase, gold hash prefix">
        <DCArtboard id="wm-1" label="Wordmark" width={760} height={300}>
          <Frame label="#hashly">
            <Wordmark size={156} color={INK} accent={GOLD} />
          </Frame>
        </DCArtboard>

        <DCArtboard id="wm-2" label="Wordmark · ink" width={760} height={300}>
          <Frame label="#hashly · ink" dark>
            <Wordmark size={156} color={PAPER} accent={GOLD} />
          </Frame>
        </DCArtboard>

        <DCArtboard id="lk-h" label="Horizontal lockup" width={760} height={300}>
          <Frame label="horizontal lockup">
            <LockupHorizontal />
          </Frame>
        </DCArtboard>

        <DCArtboard id="lk-s" label="Stacked lockup" width={460} height={500}>
          <Frame label="stacked lockup">
            <LockupStacked />
          </Frame>
        </DCArtboard>

        <DCArtboard id="lk-d" label="Lockup · ink" width={760} height={300}>
          <Frame label="horizontal · ink" dark>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <MarkGeometric size={104} color={PAPER} accent={GOLD} />
              <Wordmark size={104} color={PAPER} plain />
            </div>
          </Frame>
        </DCArtboard>
      </DCSection>

      {/* PALETTE + TYPE ----------------------------------------- */}
      <DCSection id="system" title="System" subtitle="Color & type">
        <DCArtboard id="palette" label="Palette" width={760} height={260}>
          <div style={{
            display: 'flex', width: '100%', height: '100%',
            border: `1px solid ${RULE}`, boxSizing: 'border-box',
          }}>
            <Swatch name="paper" hex={PAPER} color={INK} />
            <Swatch name="paper-2" hex={PAPER_2} color={INK} />
            <Swatch name="forest" hex={FOREST} color={PAPER} />
            <Swatch name="gold" hex={GOLD} color={INK} />
            <Swatch name="ink" hex={INK} color={PAPER} />
          </div>
        </DCArtboard>

        <DCArtboard id="type" label="Type" width={1040} height={460}>
          <TypeSpecimen />
        </DCArtboard>

        <DCArtboard id="usage" label="Usage" width={760} height={460}>
          <DoDont />
        </DCArtboard>
      </DCSection>

      {/* APP ICONS ---------------------------------------------- */}
      <DCSection id="appicons" title="macOS app icon" subtitle="Squircle, three official treatments">
        <DCArtboard id="ai-gold" label="Gold · primary" width={420} height={420}>
          <Frame ticks={false} grain={false}>
            <AppIcon size={280} bg={GOLD} mark={
              <MarkGeometric size={180} color={INK} accent={INK} />
            } />
          </Frame>
        </DCArtboard>

        <DCArtboard id="ai-forest" label="Forest" width={420} height={420}>
          <Frame ticks={false} grain={false}>
            <AppIcon size={280} bg={FOREST} mark={
              <MarkGeometric size={180} color={PAPER} accent={GOLD} />
            } />
          </Frame>
        </DCArtboard>

        <DCArtboard id="ai-paper" label="Paper" width={420} height={420}>
          <Frame ticks={false} grain={false} style={{ background: INK }}>
            <AppIcon size={280} bg={PAPER} mark={
              <MarkGeometric size={180} color={INK} accent={GOLD} />
            } />
          </Frame>
        </DCArtboard>

        <DCArtboard id="ai-cascade" label="Size cascade · 256 → 32 px" width={760} height={300}>
          <Frame ticks={false} grain={false}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <AppIcon size={220} bg={GOLD} mark={<MarkGeometric size={140} color={INK} accent={INK} />} />
              <AppIcon size={140} bg={GOLD} mark={<MarkGeometric size={92} color={INK} accent={INK} />} />
              <AppIcon size={88} bg={GOLD} mark={<MarkGeometric size={58} color={INK} accent={INK} />} />
              <AppIcon size={56} bg={GOLD} mark={<MarkGeometric size={36} color={INK} accent={INK} />} />
              <AppIcon size={32} bg={GOLD} mark={<MarkGeometric size={22} color={INK} accent={INK} />} />
            </div>
          </Frame>
        </DCArtboard>

        <DCArtboard id="fv" label="Favicon · 32 / 16 px" width={520} height={300}>
          <Frame ticks={false} grain={false}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 7, background: GOLD,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <MarkGeometric size={22} color={INK} accent={INK} />
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: MUTED }}>32 px</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 4, background: GOLD,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <MarkGeometric size={11} color={INK} accent={INK} />
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: MUTED }}>16 px</span>
              </div>
            </div>
          </Frame>
        </DCArtboard>
      </DCSection>

      {/* IN CONTEXT --------------------------------------------- */}
      <DCSection id="context" title="In context" subtitle="Where the mark lives">
        <DCArtboard id="ctx-app" label="Editor titlebar" width={840} height={520}>
          <Frame ticks={false} grain={false} style={{ background: '#0e1815' }}>
            <div style={{
              width: 720, height: 420, borderRadius: 12,
              background: PAPER, boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderBottom: `1px solid ${PAPER_2}`,
                background: PAPER_2,
              }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 999, background: '#e15c4f' }} />
                  <span style={{ width: 11, height: 11, borderRadius: 999, background: '#e9a32a' }} />
                  <span style={{ width: 11, height: 11, borderRadius: 999, background: '#54b148' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MarkGeometric size={16} color={INK} accent={GOLD} />
                  <span style={{ fontFamily: "'Fraunces', serif", fontSize: 13, fontWeight: 600 }}>hashly</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: MUTED, marginLeft: 6 }}>readme.md</span>
                </div>
                <div style={{ width: 44 }} />
              </div>
              <div style={{ padding: '28px 36px', flex: 1, fontFamily: "'Fraunces', serif" }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
                  <span style={{ color: GOLD, fontWeight: 700, fontSize: 32, fontFamily: "'JetBrains Mono', monospace" }}>#</span>
                  <span style={{ fontWeight: 700, fontSize: 32, letterSpacing: '-0.01em' }}>Hashly</span>
                </div>
                <p style={{ fontSize: 15, color: INK_2, maxWidth: 540, lineHeight: 1.55, margin: 0 }}>
                  A WYSIWYG markdown reader for macOS. Open a file, see it as it should be —
                  without the brackets and pipes getting in the way.
                </p>
                <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ height: 8, width: 360, borderRadius: 4, background: RULE }} />
                  <span style={{ height: 8, width: 280, borderRadius: 4, background: RULE }} />
                  <span style={{ height: 8, width: 200, borderRadius: 4, background: RULE }} />
                </div>
              </div>
            </div>
          </Frame>
        </DCArtboard>

        <DCArtboard id="ctx-card" label="Business card · 3.5 × 2 in" width={560} height={400}>
          <Frame ticks={false} grain={false}>
            <div style={{
              width: 440, height: 252, borderRadius: 6,
              background: PAPER, padding: 24,
              boxShadow: '0 14px 30px -12px rgba(0,0,0,0.25)',
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <MarkGeometric size={48} color={INK} accent={GOLD} />
                <Wordmark size={40} color={INK} plain />
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: INK_2, lineHeight: 1.6 }}>
                <div>a wysiwyg markdown reader</div>
                <div style={{ color: MUTED }}>hashly.app · @hashly</div>
              </div>
              <div style={{
                position: 'absolute', right: -36, bottom: -36, width: 130, height: 130,
                borderRadius: '50%', background: GOLD, opacity: 0.16,
              }} />
            </div>
          </Frame>
        </DCArtboard>

        <DCArtboard id="ctx-dock" label="In the macOS dock" width={760} height={260}>
          <Frame ticks={false} grain={false} style={{ background: 'linear-gradient(180deg,#a8b3a0,#7e8c75)' }}>
            <div style={{
              padding: '10px 14px', borderRadius: 22,
              background: 'rgba(255,255,255,0.35)',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 14px 30px -10px rgba(0,0,0,0.35)',
              display: 'flex', alignItems: 'flex-end', gap: 12,
            }}>
              {[
                { bg: '#3478f6', label: 'F' },
                { bg: '#1d1d1f', label: 'X' },
                { bg: GOLD, mark: true },
                { bg: '#34c759', label: 'M' },
                { bg: '#ff9500', label: 'C' },
              ].map((d, i) => (
                <div key={i} style={{
                  width: 60, height: 60, borderRadius: 14, background: d.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 28,
                  boxShadow: '0 6px 12px -4px rgba(0,0,0,0.35)',
                }}>
                  {d.mark ? <MarkGeometric size={42} color={INK} accent={INK} /> : d.label}
                </div>
              ))}
            </div>
          </Frame>
        </DCArtboard>
      </DCSection>

    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
