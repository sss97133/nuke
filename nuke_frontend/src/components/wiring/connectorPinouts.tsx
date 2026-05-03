// Connector pinout library — real pin layouts keyed on connector_type slug.
// Each entry renders an SVG that matches the physical connector's mating face
// so a wiring guy can recognize it. Pin 1 is always indicated with a filled
// triangle marker and darker fill. Coordinates are in a 160×80 viewBox;
// callers scale as needed.
//
// Sources: manufacturer datasheets (Delphi Metri-Pack, TE Superseal, Deutsch
// DT series catalog, GM service manuals). When we grow this past 8 entries
// the source citations should live in docs/wiring/research/connectors.md
// per the wiring-receipt rule.

import React from 'react';

export interface ConnectorPinoutSpec {
  slug: string;          // matches device.connector_type
  displayName: string;   // human-readable
  pinCount: number;      // total pins
  family: string;        // 'Metri-Pack' | 'Weather Pack' | 'Deutsch DT' | 'GM' | 'ISO' | 'SuperSeal' | 'USCAR'
  viewLabel: string;     // 'MATING FACE' usually — which side we're drawing
  render: () => React.ReactElement;
}

// Shared primitives
const W = 160, H = 80;
const strokeColor = 'var(--text, #2a2a2a)';
const bgColor = 'var(--bg, #f5f5f5)';
const pinFill = '#e0e0e0';
const pin1Fill = '#b8b8b8';
const textColor = 'var(--text, #2a2a2a)';
const pinFont = { fontFamily: '"Courier New", monospace', fontSize: 8, fontWeight: 700, fill: textColor } as const;

function Pin({ cx, cy, n, r = 7, isPin1 = false }: { cx: number; cy: number; n: number | string; r?: number; isPin1?: boolean }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={isPin1 ? pin1Fill : pinFill} stroke={strokeColor} strokeWidth={1.5} />
      <text x={cx} y={cy + 2.8} textAnchor="middle" {...pinFont}>{n}</text>
    </g>
  );
}

function Pin1Triangle({ x, y }: { x: number; y: number }) {
  return <polygon points={`${x},${y - 5} ${x + 5},${y + 2} ${x - 5},${y + 2}`} fill={strokeColor} />;
}

// ── Metri-Pack 280 Series 3-pin ────────────────────────────────
// Rectangular shell with a raised locking ridge on top. Pins A/B/C in a row.
function MetriPack3PinSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* Shell with locking ridge on top */}
      <path
        d={`M 20 22 L 20 14 L 30 14 L 32 10 L 128 10 L 130 14 L 140 14 L 140 22 L 140 62 L 20 62 Z`}
        fill={bgColor} stroke={strokeColor} strokeWidth={2}
      />
      <Pin1Triangle x={44} y={20} />
      <Pin cx={44} cy={42} n={1} isPin1 />
      <Pin cx={80} cy={42} n={2} />
      <Pin cx={116} cy={42} n={3} />
    </svg>
  );
}

// ── Metri-Pack 280 Series 2-pin ────────────────────────────────
function MetriPack2PinSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <path
        d={`M 40 22 L 40 14 L 50 14 L 52 10 L 108 10 L 110 14 L 120 14 L 120 22 L 120 62 L 40 62 Z`}
        fill={bgColor} stroke={strokeColor} strokeWidth={2}
      />
      <Pin1Triangle x={62} y={20} />
      <Pin cx={62} cy={42} n={1} isPin1 />
      <Pin cx={98} cy={42} n={2} />
    </svg>
  );
}

// ── Weather Pack 2-pin ──────────────────────────────────────────
// Oval shell with index key on one side. Sealed silicone gasket.
function WeatherPack2PinSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <ellipse cx={80} cy={42} rx={42} ry={22} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      {/* Index key notch on top */}
      <rect x={76} y={19} width={8} height={4} fill={strokeColor} />
      <Pin1Triangle x={64} y={28} />
      <Pin cx={64} cy={46} n={'A'} isPin1 />
      <Pin cx={96} cy={46} n={'B'} />
    </svg>
  );
}

// ── Deutsch DT 3-pin ────────────────────────────────────────────
// D-shaped shell. Pins in triangle: 1 top-left, 2 top-right, 3 bottom-center.
function DeutschDT3PinSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* D-shape: flat top, rounded bottom */}
      <path
        d={`M 42 14 L 118 14 L 118 50 A 38 28 0 0 1 42 50 Z`}
        fill={bgColor} stroke={strokeColor} strokeWidth={2}
      />
      <Pin1Triangle x={64} y={22} />
      <Pin cx={64} cy={34} n={1} isPin1 />
      <Pin cx={96} cy={34} n={2} />
      <Pin cx={80} cy={56} n={3} />
    </svg>
  );
}

// ── Deutsch DT 2-pin ────────────────────────────────────────────
function DeutschDT2PinSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <path
        d={`M 50 18 L 110 18 L 110 42 A 30 22 0 0 1 50 42 Z`}
        fill={bgColor} stroke={strokeColor} strokeWidth={2}
      />
      <Pin1Triangle x={68} y={26} />
      <Pin cx={68} cy={38} n={1} isPin1 />
      <Pin cx={92} cy={38} n={2} />
    </svg>
  );
}

// ── GM Coil 4-pin (LS1/LS3 coil-near-plug) ─────────────────────
// Rectangular shell, 2x2 pin pattern. Pin 1 is IGN A (control).
function GMCoil4PinSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={36} y={14} width={88} height={52} rx={0} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      {/* Keying tab on top-right */}
      <rect x={114} y={10} width={6} height={4} fill={strokeColor} />
      <Pin1Triangle x={56} y={22} />
      <Pin cx={56} cy={32} n={1} isPin1 />
      <Pin cx={86} cy={32} n={2} />
      <Pin cx={56} cy={52} n={3} />
      <Pin cx={86} cy={52} n={4} />
    </svg>
  );
}

// ── EV6 / USCAR 2-pin (fuel injector) ──────────────────────────
// Small rectangular shell with offset latch. 2 pins side-by-side.
function EV6UscarSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={46} y={18} width={70} height={44} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      <rect x={74} y={12} width={14} height={6} fill={strokeColor} />
      <Pin1Triangle x={64} y={26} />
      <Pin cx={64} cy={40} n={1} isPin1 />
      <Pin cx={98} cy={40} n={2} />
    </svg>
  );
}

// ── Motec SuperSeal A — 34-pin (M130 primary, PDM30) ──────────
// TE AMP SuperSeal 1.5 34-way. 2 rows × 17 columns. Pins 1-17 top row, 18-34 bottom.
// Pin 1 is top-left. Source: Motec M130 Hardware Manual (pinout table).
// The grid reflects the shell; individual pin FUNCTIONS (e.g. AT1, AT2) come from the
// function map, not this diagram.
function SuperSeal34PinSVG() {
  const cols = 17, rows = 2;
  const padX = 8, padY = 14, step = 8, r = 2.8;
  const w = padX * 2 + (cols - 1) * step;
  const h = padY * 2 + (rows - 1) * 22 + 4;
  const pins: { cx: number; cy: number; n: number }[] = [];
  for (let c = 0; c < cols; c++) pins.push({ cx: padX + c * step, cy: padY, n: c + 1 });
  for (let c = 0; c < cols; c++) pins.push({ cx: padX + c * step, cy: padY + 22, n: c + 18 });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <rect x={2} y={2} width={w - 4} height={h - 4} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      <Pin1Triangle x={pins[0].cx} y={pins[0].cy - 7} />
      {pins.map(p => (
        <g key={p.n}>
          <circle cx={p.cx} cy={p.cy} r={r} fill={p.n === 1 ? pin1Fill : pinFill} stroke={strokeColor} strokeWidth={0.8} />
        </g>
      ))}
      <text x={padX} y={h - 3} fontFamily='"Courier New",monospace' fontSize={6} fontWeight={700} fill={textColor}>1</text>
      <text x={w - padX - 6} y={h - 3} fontFamily='"Courier New",monospace' fontSize={6} fontWeight={700} fill={textColor}>34</text>
    </svg>
  );
}

// ── Motec SuperSeal B — 26-pin (M130 secondary) ────────────────
// 2 rows × 13 columns. Pins 1-13 top, 14-26 bottom.
function SuperSeal26PinSVG() {
  const cols = 13, rows = 2;
  const padX = 8, padY = 14, step = 8, r = 2.8;
  const w = padX * 2 + (cols - 1) * step;
  const h = padY * 2 + (rows - 1) * 22 + 4;
  const pins: { cx: number; cy: number; n: number }[] = [];
  for (let c = 0; c < cols; c++) pins.push({ cx: padX + c * step, cy: padY, n: c + 1 });
  for (let c = 0; c < cols; c++) pins.push({ cx: padX + c * step, cy: padY + 22, n: c + 14 });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <rect x={2} y={2} width={w - 4} height={h - 4} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      <Pin1Triangle x={pins[0].cx} y={pins[0].cy - 7} />
      {pins.map(p => (
        <circle key={p.n} cx={p.cx} cy={p.cy} r={r}
          fill={p.n === 1 ? pin1Fill : pinFill} stroke={strokeColor} strokeWidth={0.8} />
      ))}
      <text x={padX} y={h - 3} fontFamily='"Courier New",monospace' fontSize={6} fontWeight={700} fill={textColor}>1</text>
      <text x={w - padX - 6} y={h - 3} fontFamily='"Courier New",monospace' fontSize={6} fontWeight={700} fill={textColor}>26</text>
    </svg>
  );
}

// ── Motec M130 combined 34+26 ──────────────────────────────────
// M130 has both A and B connectors adjacent. Render them side-by-side.
function SuperSeal34plus26SVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* A connector shell (34-pin) */}
      <rect x={6} y={22} width={90} height={36} fill={bgColor} stroke={strokeColor} strokeWidth={1.5} />
      <text x={51} y={18} textAnchor="middle" fontFamily="Arial,sans-serif" fontSize={7} fontWeight={700} fill={textColor}>A · 34-pin</text>
      <Pin1Triangle x={14} y={26} />
      {Array.from({ length: 17 }).map((_, c) => (
        <React.Fragment key={`a-top-${c}`}>
          <circle cx={14 + c * 5} cy={32} r={1.6} fill={c === 0 ? pin1Fill : pinFill} stroke={strokeColor} strokeWidth={0.6} />
          <circle cx={14 + c * 5} cy={46} r={1.6} fill={pinFill} stroke={strokeColor} strokeWidth={0.6} />
        </React.Fragment>
      ))}
      {/* B connector shell (26-pin) */}
      <rect x={100} y={22} width={56} height={36} fill={bgColor} stroke={strokeColor} strokeWidth={1.5} />
      <text x={128} y={18} textAnchor="middle" fontFamily="Arial,sans-serif" fontSize={7} fontWeight={700} fill={textColor}>B · 26-pin</text>
      <Pin1Triangle x={107} y={26} />
      {Array.from({ length: 13 }).map((_, c) => (
        <React.Fragment key={`b-top-${c}`}>
          <circle cx={107 + c * 3.5} cy={32} r={1.4} fill={c === 0 ? pin1Fill : pinFill} stroke={strokeColor} strokeWidth={0.6} />
          <circle cx={107 + c * 3.5} cy={46} r={1.4} fill={pinFill} stroke={strokeColor} strokeWidth={0.6} />
        </React.Fragment>
      ))}
      <text x={8} y={72} fontFamily='"Courier New",monospace' fontSize={7} fontWeight={700} fill={textColor}>60-PIN ECU HEADER (A+B)</text>
    </svg>
  );
}

// ── Ring terminal (M8 or stud) ──────────────────────────────────
// Crimped ring for a bolt/stud. Single "pin" = the stud hole.
function RingTerminalSVG({ sizeLabel }: { sizeLabel: string }) {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* Wire barrel on the left */}
      <rect x={30} y={32} width={42} height={16} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      {/* Ring tongue */}
      <circle cx={100} cy={40} r={22} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      {/* Bolt hole */}
      <circle cx={100} cy={40} r={9} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      {/* Label */}
      <text x={100} y={43} textAnchor="middle" fontFamily='"Courier New",monospace' fontSize={8} fontWeight={700} fill={textColor}>{sizeLabel}</text>
    </svg>
  );
}

// ── H4 headlight 3-blade ────────────────────────────────────────
// 3 flat spade terminals in triangular arrangement. Pin 1 = LOW beam, 2 = HIGH beam, 3 = GND.
function H4ThreeBladeSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={40} y={14} width={80} height={52} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      {/* 3 flat blades arranged in triangle */}
      <rect x={54} y={26} width={14} height={6} fill={pin1Fill} stroke={strokeColor} strokeWidth={1.5} />
      <rect x={92} y={26} width={14} height={6} fill={pinFill} stroke={strokeColor} strokeWidth={1.5} />
      <rect x={73} y={50} width={14} height={6} fill={pinFill} stroke={strokeColor} strokeWidth={1.5} />
      <Pin1Triangle x={61} y={21} />
      <text x={61} y={42} textAnchor="middle" {...pinFont}>1</text>
      <text x={99} y={42} textAnchor="middle" {...pinFont}>2</text>
      <text x={80} y={66} textAnchor="middle" {...pinFont}>3</text>
    </svg>
  );
}

// ── Dual battery post (SAE + GM side) ───────────────────────────
// Shows both positive and negative posts, with GM side-terminal studs.
function DualPostBatterySVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={14} y={14} width={132} height={52} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      {/* + post (tall, left) */}
      <circle cx={42} cy={32} r={10} fill={pin1Fill} stroke={strokeColor} strokeWidth={2} />
      <text x={42} y={35} textAnchor="middle" fontFamily="Arial,sans-serif" fontSize={10} fontWeight={700} fill={textColor}>+</text>
      {/* - post (tall, right) */}
      <circle cx={118} cy={32} r={10} fill={pinFill} stroke={strokeColor} strokeWidth={2} />
      <text x={118} y={35} textAnchor="middle" fontFamily="Arial,sans-serif" fontSize={10} fontWeight={700} fill={textColor}>−</text>
      {/* Side terminal studs (hex) */}
      <rect x={54} y={50} width={14} height={10} fill={pin1Fill} stroke={strokeColor} strokeWidth={1.5} />
      <rect x={92} y={50} width={14} height={10} fill={pinFill} stroke={strokeColor} strokeWidth={1.5} />
      <text x={80} y={72} textAnchor="middle" fontFamily="Arial,sans-serif" fontSize={7} fontWeight={700} fill={textColor}>SAE + GM SIDE</text>
    </svg>
  );
}

// ── GM alternator 4-pin rect + battery stud ─────────────────────
// Small 4-pin rectangular connector + separate battery output stud (B+).
function GMAlt4PlusStudSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* 4-pin rect connector */}
      <rect x={14} y={20} width={64} height={40} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      <Pin1Triangle x={28} y={28} />
      <Pin cx={28} cy={36} n={'P'} isPin1 />
      <Pin cx={50} cy={36} n={'L'} />
      <Pin cx={28} cy={50} n={'F'} />
      <Pin cx={50} cy={50} n={'S'} />
      {/* B+ output stud */}
      <circle cx={120} cy={40} r={18} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      <circle cx={120} cy={40} r={7} fill={pin1Fill} stroke={strokeColor} strokeWidth={1.5} />
      <text x={120} y={43} textAnchor="middle" fontFamily='"Courier New",monospace' fontSize={7} fontWeight={700} fill={textColor}>B+</text>
    </svg>
  );
}

// ── Blade terminal (1/4" flat spade) ────────────────────────────
function BladeTerminalSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* Wire barrel */}
      <rect x={30} y={34} width={40} height={12} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      {/* Flat spade */}
      <rect x={72} y={30} width={48} height={20} fill={pin1Fill} stroke={strokeColor} strokeWidth={2} />
      <text x={96} y={43} textAnchor="middle" fontFamily='"Courier New",monospace' fontSize={7} fontWeight={700} fill={textColor}>1/4"</text>
    </svg>
  );
}

// ── Speaker quick-connect 2-pin ─────────────────────────────────
// Standard 2-pin spade connector for car audio speakers. + on top.
function SpeakerQuickSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={40} y={20} width={80} height={40} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      <rect x={56} y={26} width={18} height={6} fill={pin1Fill} stroke={strokeColor} strokeWidth={1.5} />
      <rect x={56} y={46} width={18} height={6} fill={pinFill} stroke={strokeColor} strokeWidth={1.5} />
      <text x={92} y={32} fontFamily="Arial,sans-serif" fontSize={9} fontWeight={700} fill={textColor}>+</text>
      <text x={94} y={52} fontFamily="Arial,sans-serif" fontSize={10} fontWeight={700} fill={textColor}>−</text>
      <Pin1Triangle x={65} y={22} />
    </svg>
  );
}

// ── ISO DIN plug A/B (car audio head unit) ──────────────────────
// Two 8-pin blocks (ISO A = power/speakers, ISO B = speakers). Standard head unit.
function ISODinPlugSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* Block A */}
      <rect x={10} y={22} width={70} height={40} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      <text x={45} y={18} textAnchor="middle" fontFamily="Arial,sans-serif" fontSize={7} fontWeight={700} fill={textColor}>A · POWER</text>
      {Array.from({ length: 8 }).map((_, i) => (
        <circle key={`a${i}`} cx={18 + (i % 4) * 16} cy={34 + Math.floor(i / 4) * 18} r={3}
          fill={i === 0 ? pin1Fill : pinFill} stroke={strokeColor} strokeWidth={1} />
      ))}
      <Pin1Triangle x={18} y={27} />
      {/* Block B */}
      <rect x={84} y={22} width={70} height={40} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      <text x={119} y={18} textAnchor="middle" fontFamily="Arial,sans-serif" fontSize={7} fontWeight={700} fill={textColor}>B · SPEAKERS</text>
      {Array.from({ length: 8 }).map((_, i) => (
        <circle key={`b${i}`} cx={92 + (i % 4) * 16} cy={34 + Math.floor(i / 4) * 18} r={3}
          fill={pinFill} stroke={strokeColor} strokeWidth={1} />
      ))}
    </svg>
  );
}

// ── Twisted pair (CAN) — not a connector, just a 2-wire routing concept ──
function TwistedPairSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* Two wires crossing in an X pattern across the view */}
      <path d={`M 10 30 Q 40 50, 70 30 T 130 30 L 150 30`} fill="none" stroke="#e8b307" strokeWidth={3} />
      <path d={`M 10 50 Q 40 30, 70 50 T 130 50 L 150 50`} fill="none" stroke="#16825d" strokeWidth={3} />
      <text x={80} y={72} textAnchor="middle" fontFamily="Arial,sans-serif" fontSize={7} fontWeight={700} fill={textColor}>
        CAN-H / CAN-L — NO CONNECTOR, TWIST PAIR ONLY
      </text>
    </svg>
  );
}

// ── ISO Mini Relay 5-pin ───────────────────────────────────────
// Standard automotive relay pinout (85/86 coil, 30 common, 87/87a contacts).
// Pin layout on the bottom of the relay: 30 + 87 on top row, 85/86/87a offset.
function ISOMini5PinSVG() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={30} y={10} width={100} height={62} fill={bgColor} stroke={strokeColor} strokeWidth={2} />
      {/* Standard ISO layout: 30 top-right, 87 top-left, 87a mid-left, 85/86 bottom */}
      <Pin cx={52} cy={24} n={'87'} />
      <Pin cx={108} cy={24} n={'30'} isPin1 />
      <Pin1Triangle x={108} y={14} />
      <Pin cx={52} cy={44} n={'87a'} />
      <Pin cx={68} cy={62} n={'85'} />
      <Pin cx={92} cy={62} n={'86'} />
    </svg>
  );
}

// Registry — slug → spec
const PINOUTS: Record<string, ConnectorPinoutSpec> = {
  metri_pack_3pin: {
    slug: 'metri_pack_3pin', displayName: 'Metri-Pack 280 / 3-pin',
    pinCount: 3, family: 'Metri-Pack', viewLabel: 'MATING FACE',
    render: () => <MetriPack3PinSVG />,
  },
  metri_pack_2pin: {
    slug: 'metri_pack_2pin', displayName: 'Metri-Pack 280 / 2-pin',
    pinCount: 2, family: 'Metri-Pack', viewLabel: 'MATING FACE',
    render: () => <MetriPack2PinSVG />,
  },
  weatherpack_2pin: {
    slug: 'weatherpack_2pin', displayName: 'Weather Pack / 2-pin',
    pinCount: 2, family: 'Weather Pack', viewLabel: 'MATING FACE',
    render: () => <WeatherPack2PinSVG />,
  },
  deutsch_dt_3pin: {
    slug: 'deutsch_dt_3pin', displayName: 'Deutsch DT / 3-pin',
    pinCount: 3, family: 'Deutsch DT', viewLabel: 'MATING FACE',
    render: () => <DeutschDT3PinSVG />,
  },
  deutsch_dt_2pin: {
    slug: 'deutsch_dt_2pin', displayName: 'Deutsch DT / 2-pin',
    pinCount: 2, family: 'Deutsch DT', viewLabel: 'MATING FACE',
    render: () => <DeutschDT2PinSVG />,
  },
  gm_coil_4pin: {
    slug: 'gm_coil_4pin', displayName: 'GM LS Coil / 4-pin',
    pinCount: 4, family: 'GM', viewLabel: 'MATING FACE',
    render: () => <GMCoil4PinSVG />,
  },
  ev6_uscar_2pin: {
    slug: 'ev6_uscar_2pin', displayName: 'EV6 / USCAR / 2-pin',
    pinCount: 2, family: 'USCAR', viewLabel: 'MATING FACE',
    render: () => <EV6UscarSVG />,
  },
  iso_mini_relay_5pin: {
    slug: 'iso_mini_relay_5pin', displayName: 'ISO Mini Relay / 5-pin',
    pinCount: 5, family: 'ISO', viewLabel: 'BOTTOM (PIN SIDE)',
    render: () => <ISOMini5PinSVG />,
  },
  superseal_34pin: {
    slug: 'superseal_34pin', displayName: 'TE SuperSeal 1.5 / 34-pin',
    pinCount: 34, family: 'SuperSeal', viewLabel: 'MATING FACE',
    render: () => <SuperSeal34PinSVG />,
  },
  superseal_26pin: {
    slug: 'superseal_26pin', displayName: 'TE SuperSeal 1.5 / 26-pin',
    pinCount: 26, family: 'SuperSeal', viewLabel: 'MATING FACE',
    render: () => <SuperSeal26PinSVG />,
  },
  'superseal_34pin+26pin': {
    slug: 'superseal_34pin+26pin', displayName: 'Motec M130 · A (34) + B (26)',
    pinCount: 60, family: 'SuperSeal', viewLabel: 'MATING FACE — ECU HEADER',
    render: () => <SuperSeal34plus26SVG />,
  },
  ring_terminal_m8: {
    slug: 'ring_terminal_m8', displayName: 'Ring Terminal / M8 stud',
    pinCount: 1, family: 'Terminal', viewLabel: 'FACE VIEW',
    render: () => <RingTerminalSVG sizeLabel="M8" />,
  },
  ring_terminal_stud: {
    slug: 'ring_terminal_stud', displayName: 'Ring Terminal / battery stud',
    pinCount: 1, family: 'Terminal', viewLabel: 'FACE VIEW',
    render: () => <RingTerminalSVG sizeLabel="STUD" />,
  },
  h4_3blade: {
    slug: 'h4_3blade', displayName: 'H4 Headlight / 3-blade',
    pinCount: 3, family: 'Headlight', viewLabel: 'MATING FACE',
    render: () => <H4ThreeBladeSVG />,
  },
  'dual_post_sae+gm': {
    slug: 'dual_post_sae+gm', displayName: 'Battery / dual SAE + GM side',
    pinCount: 4, family: 'Battery', viewLabel: 'TOP VIEW',
    render: () => <DualPostBatterySVG />,
  },
  'gm_4pin_rect+bat_stud': {
    slug: 'gm_4pin_rect+bat_stud', displayName: 'GM Alternator · 4-pin + B+ stud',
    pinCount: 5, family: 'GM', viewLabel: 'REAR VIEW',
    render: () => <GMAlt4PlusStudSVG />,
  },
  blade_terminal: {
    slug: 'blade_terminal', displayName: 'Blade Terminal / 1/4" spade',
    pinCount: 1, family: 'Terminal', viewLabel: 'SIDE VIEW',
    render: () => <BladeTerminalSVG />,
  },
  speaker_quick_connect: {
    slug: 'speaker_quick_connect', displayName: 'Speaker Quick-Connect / 2-pin',
    pinCount: 2, family: 'Audio', viewLabel: 'MATING FACE',
    render: () => <SpeakerQuickSVG />,
  },
  iso_din_plug_a_b: {
    slug: 'iso_din_plug_a_b', displayName: 'ISO DIN Plug A (power) + B (speakers)',
    pinCount: 16, family: 'Audio', viewLabel: 'MATING FACE',
    render: () => <ISODinPlugSVG />,
  },
  twisted_pair: {
    slug: 'twisted_pair', displayName: 'Twisted Pair · CAN-H/CAN-L',
    pinCount: 2, family: 'Routing', viewLabel: 'ROUTING SCHEMATIC',
    render: () => <TwistedPairSVG />,
  },
};

export function getConnectorPinout(slug?: string): ConnectorPinoutSpec | null {
  if (!slug) return null;
  return PINOUTS[slug] || null;
}

export function hasConnectorPinout(slug?: string): boolean {
  return !!getConnectorPinout(slug);
}
