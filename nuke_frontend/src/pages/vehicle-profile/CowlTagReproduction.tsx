import React, { useId } from 'react';
import './cowl-tag-reproduction.css';

/** A transcription set against the 1973 Norwood Body by Fisher plate layout.
 * Only reviewed, public fields belong here. Serial and sequence have no props. */
export type Fisher1973NorwoodCodes = {
  modelYear?: string | null;
  style?: string | null;
  plant?: string | null;
  trim?: string | null;
  seat?: string | null;
  paintLower?: string | null;
  paintUpper?: string | null;
  buildDate?: string | null;
};

const shown = (value?: string | null) => value?.trim() || '—';

function Stamp({ x, y, children, className = '' }: { x: number; y: number; children: React.ReactNode; className?: string }) {
  return <text x={x} y={y} className={`cowl-repro__stamp ${className}`}>
    {children}
  </text>;
}

/** Vector reconstruction, not a photograph or an original document. */
export default function CowlTagReproduction(codes: Fisher1973NorwoodCodes) {
  const id = useId().replace(/:/g, '');
  return <svg className="cowl-repro" viewBox="0 0 1480 850" role="img"
    aria-label={`Digital Fisher body plate reproduction. Style ${shown(codes.style)}; plant ${shown(codes.plant)}; trim ${shown(codes.trim)}; lower paint ${shown(codes.paintLower)}; upper paint ${shown(codes.paintUpper)}. Serial and sequence redacted.`}>
    <defs>
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#303237" /><stop offset=".12" stopColor="#111316" />
        <stop offset=".48" stopColor="#26292c" /><stop offset=".72" stopColor="#101214" />
        <stop offset="1" stopColor="#303134" />
      </linearGradient>
      <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#a5a7a7" /><stop offset=".2" stopColor="#383b3e" />
        <stop offset=".65" stopColor="#0a0b0d" /><stop offset="1" stopColor="#858888" />
      </linearGradient>
      <radialGradient id={`${id}-rivet`} cx=".35" cy=".3" r=".72">
        <stop offset="0" stopColor="#a3a5a6" /><stop offset=".35" stopColor="#4b4e51" />
        <stop offset=".7" stopColor="#17191c" /><stop offset="1" stopColor="#a9abad" />
      </radialGradient>
      <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".24 .7" numOctaves="2" seed="7" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer><feFuncA type="linear" slope=".075" /></feComponentTransfer>
      </filter>
    </defs>

    <path className="cowl-repro__shadow" d="M48 32 L1410 20 Q1435 23 1441 47 L1450 784 Q1449 813 1419 819 L63 829 Q35 824 32 794 L20 77 Q20 45 48 32Z" />
    <path d="M45 26 L1411 13 Q1432 18 1438 45 L1447 782 Q1447 809 1417 814 L66 822 Q39 817 36 789 L24 72 Q24 39 45 26Z"
      fill={`url(#${id}-rim)`} stroke="#1a1c20" strokeWidth="10" />
    <path d="M59 60 L1394 46 Q1413 50 1417 68 L1428 767 Q1426 786 1407 791 L79 799 Q59 795 57 774 L47 86 Q48 65 59 60Z"
      fill={`url(#${id}-body)`} stroke="#080a0c" strokeWidth="8" />
    <path d="M59 60 L1394 46 Q1413 50 1417 68 L1428 767 Q1426 786 1407 791 L79 799 Q59 795 57 774 L47 86 Q48 65 59 60Z"
      fill="#9fa3a5" filter={`url(#${id}-grain)`} />
    <path d="M61 64 L1394 49 M71 797 L1405 788" fill="none" stroke="#a2a5a6" strokeOpacity=".48" strokeWidth="5" />

    <g className="cowl-repro__rivet" transform="translate(142 414)">
      <circle r="66" fill="#070809" stroke="#7f8385" strokeWidth="8" /><circle r="52" fill={`url(#${id}-rivet)`} />
      <circle r="29" fill="#141619" stroke="#b4b7b7" strokeWidth="5" /><path d="M-16 -9 L17 11" stroke="#090a0c" strokeWidth="8" />
    </g>
    <g className="cowl-repro__rivet" transform="translate(1348 414)">
      <circle r="66" fill="#070809" stroke="#7f8385" strokeWidth="8" /><circle r="52" fill={`url(#${id}-rivet)`} />
      <circle r="29" fill="#141619" stroke="#b4b7b7" strokeWidth="5" /><path d="M-16 -9 L17 11" stroke="#090a0c" strokeWidth="8" />
    </g>

    <Stamp x={448} y={112} className="cowl-repro__heading">BODY BY FISHER</Stamp>
    <Stamp x={73} y={198}>ST</Stamp><Stamp x={210} y={198}>{shown(codes.modelYear)}</Stamp>
    <Stamp x={378} y={198}>{shown(codes.style)}</Stamp><Stamp x={672} y={198}>{shown(codes.plant)}</Stamp>
    <rect className="cowl-repro__redaction" x="864" y="146" width="343" height="70" rx="3" />
    <Stamp x={1237} y={198}>BDY</Stamp>
    <Stamp x={77} y={300}>TR</Stamp><Stamp x={350} y={300}>{shown(codes.trim)}</Stamp>
    <Stamp x={613} y={300}>{shown(codes.seat)}</Stamp>
    <Stamp x={935} y={300}>{shown(codes.paintLower)}</Stamp><Stamp x={1067} y={300}>{shown(codes.paintUpper)}</Stamp>
    <Stamp x={1243} y={300}>PNT</Stamp>
    <Stamp x={276} y={389}>{shown(codes.buildDate)}</Stamp>
    <rect className="cowl-repro__redaction" x="315" y="429" width="370" height="66" rx="3" />

    <g className="cowl-repro__certification">
      <Stamp x={314} y={566}>GENERAL MOTORS CORPORATION</Stamp>
      <Stamp x={271} y={620}>CERTIFIES TO THE DEALER THAT THIS</Stamp>
      <Stamp x={246} y={674}>VEHICLE CONFORMS TO ALL U.S. FEDERAL</Stamp>
      <Stamp x={250} y={728}>MOTOR VEHICLE SAFETY STANDARDS</Stamp>
      <Stamp x={255} y={782}>APPLICABLE AT TIME OF MANUFACTURE</Stamp>
    </g>
  </svg>;
}
