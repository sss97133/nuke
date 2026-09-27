// planGeometry.tsx — the K5 top-down plan projection and body outline, shared by the WORKBENCH plan view
// (PlanView2D) and the MAP tab (map/WiringMap). One drawing of the truck, so both screens agree.
//
// World: digital-twin coords in meters (x driver+, y front−, z up+), K5_landmarks_blender_derived.yaml
// (wheelbase 2.703m, envelope 4.7m x 2.0m, firewall y=-1.46, tail lights y=+1.78).
// Plan projection: front = −Y at LEFT, driver (+x) at BOTTOM. Flat — no gradients, shadows or radius.

import React from 'react';

export const SC = 150;                 // px per meter
export const PAD = 26;
export const WY0 = -2.97, WY1 = 1.86;  // drawn world-y range (envelope + margin)
export const VBW = Math.round((WY1 - WY0) * SC + PAD * 2);  // ~751
export const VBH = Math.round(2.1 * SC + PAD * 2);          // ~367
export const sx = (wy: number) => PAD + (wy - WY0) * SC;
export const sy = (wx: number) => PAD + (wx + 1.05) * SC;

export const STATIONS: [number, string][] = [[-1.46, 'FIREWALL'], [-0.99, 'DASH'], [0.1, 'CAB'], [1.7, 'GATE']];

/** Body envelope, frame rails, axles + wheels, stations and side labels. Colors come from the caller. */
export function PlanEnvelope({ body, border, muted, font = 'Arial' }: { body: string; border: string; muted: string; font?: string }) {
  return (
    <g>
      {/* ── Vehicle envelope (4.7m x 2.0m, chamfered nose) ── */}
      <path
        d={`M ${sx(-2.62)} ${sy(-1.0)} L ${sx(1.7)} ${sy(-1.0)} L ${sx(1.78)} ${sy(-0.92)}
            L ${sx(1.78)} ${sy(0.92)} L ${sx(1.7)} ${sy(1.0)} L ${sx(-2.62)} ${sy(1.0)}
            L ${sx(-2.92)} ${sy(0.78)} L ${sx(-2.92)} ${sy(-0.78)} Z`}
        fill="none" stroke={body} strokeWidth={2}
      />
      {/* frame rails */}
      <line x1={sx(-2.7)} y1={sy(-0.4)} x2={sx(1.7)} y2={sy(-0.4)} stroke={border} strokeWidth={1} strokeDasharray="6 4" />
      <line x1={sx(-2.7)} y1={sy(0.4)} x2={sx(1.7)} y2={sy(0.4)} stroke={border} strokeWidth={1} strokeDasharray="6 4" />
      {/* axles + wheels (wheelbase 2.703m: front -1.853, rear +0.85) */}
      {[-1.853, 0.85].map(ay => (
        <g key={ay}>
          <line x1={sx(ay)} y1={sy(-0.95)} x2={sx(ay)} y2={sy(0.95)} stroke={border} strokeWidth={1} />
          <rect x={sx(ay - 0.38)} y={sy(-0.98)} width={0.76 * SC} height={0.26 * SC} fill="none" stroke={body} strokeWidth={1.5} />
          <rect x={sx(ay - 0.38)} y={sy(0.72)} width={0.76 * SC} height={0.26 * SC} fill="none" stroke={body} strokeWidth={1.5} />
        </g>
      ))}
      {/* firewall / dash rear / cab rear / tailgate stations */}
      {STATIONS.map(([wy, lbl]) => (
        <g key={lbl}>
          <line x1={sx(wy)} y1={sy(-1.0)} x2={sx(wy)} y2={sy(1.0)} stroke={border} strokeWidth={1} strokeDasharray="3 3" />
          <text x={sx(wy)} y={sy(-1.0) - 4} fontFamily={font} fontSize={6} fill={muted} textAnchor="middle">{lbl}</text>
        </g>
      ))}
      <text x={sx(-2.9)} y={sy(0) + 3} fontFamily={font} fontSize={7} fontWeight={700} fill={muted}>FRONT</text>
      <text x={sx(0)} y={sy(1.0) + 12} fontFamily={font} fontSize={6} fill={muted} textAnchor="middle">DRIVER SIDE</text>
      <text x={sx(0)} y={sy(-1.0) - 12} fontFamily={font} fontSize={6} fill={muted} textAnchor="middle">PASSENGER SIDE</text>
    </g>
  );
}
