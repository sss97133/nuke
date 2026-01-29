'use client';

import React, { useEffect, useRef } from 'react';
import { getLinesForState } from './asciiGenerators';
import { MovingLogoCanvas } from './MovingLogoCanvas';
import type { VehicleAsciiSlice, AuctionPulseSlice } from './types';

/** Cursor-quality: match cursor.com/cli */
const CANVAS_SIZE = 216;
const BG = '#0a0a0a';
const FG = '#fafafa';
const FONT = '12px ui-monospace, "Cascadia Code", "JetBrains Mono", monospace';
const LINE_HEIGHT = 16;
const PADDING = 20;

function drawAsciiOnCanvas(
  canvas: HTMLCanvasElement,
  lines: string[],
  width: number,
  height: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio ?? 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.font = FONT;
  ctx.fillStyle = FG;
  ctx.textBaseline = 'top';
  const text = lines.join('\n');
  text.split('\n').forEach((line, i) => {
    ctx.fillText(line, PADDING, PADDING + i * LINE_HEIGHT);
  });
}

function SampleBlock({
  label,
  lines,
  size = CANVAS_SIZE,
}: {
  label: string;
  lines: string[];
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && lines.length) drawAsciiOnCanvas(ref.current, lines, size, size);
  }, [lines, size]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #64748b)' }}>
        {label}
      </div>
      <canvas
        ref={ref}
        aria-label={label}
        style={{
          width: size,
          height: size,
          background: BG,
          borderRadius: 6,
          border: '1px solid var(--border, #27272a)',
        }}
      />
      <pre
        style={{
          margin: 0,
          padding: 6,
          fontSize: 9,
          fontFamily: 'ui-monospace, monospace',
          background: '#18181b',
          color: '#a1a1aa',
          borderRadius: 4,
          maxWidth: size + 32,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {lines.join('\n') || '(empty)'}
      </pre>
    </div>
  );
}

const fmt = (n: number | null | undefined) =>
  n != null ? `$${Number(n).toLocaleString()}` : '—';

export function LivingVehicleAsciiSamples() {
  const samples = React.useMemo(() => {
    const camry: VehicleAsciiSlice = {
      year: 2024,
      make: 'Toyota',
      model: 'Camry',
      series: null,
    };
    const mustang: VehicleAsciiSlice = {
      year: 1967,
      make: 'Ford',
      model: 'Mustang',
      series: null,
    };
    const livePulse: AuctionPulseSlice = {
      current_bid: 42000,
      bid_count: 12,
      listing_status: 'active',
    };
    const soldPulse: AuctionPulseSlice = {
      current_bid: null,
      bid_count: null,
      listing_status: 'sold',
    };
    const camrySold: VehicleAsciiSlice = {
      ...camry,
      auction_outcome: 'sold',
      high_bid: 48500,
    };
    const camryRnm: VehicleAsciiSlice = {
      ...camry,
      auction_outcome: 'reserve_not_met',
    };
    return [
      { label: 'Shape (vehicle + texture)', lines: getLinesForState('shape', camry, null, fmt) },
      { label: 'Shape (truck)', lines: getLinesForState('shape', { ...camry, model: 'Tacoma' }, null, fmt) },
      { label: 'Identity', lines: getLinesForState('identity', camry) },
      { label: 'Identity (Mustang)', lines: getLinesForState('identity', mustang) },
      {
        label: 'Pulse: LIVE · $42,000 · 12 bids',
        lines: getLinesForState('pulse', camry, livePulse, fmt),
      },
      { label: 'Pulse: SOLD · $48,500', lines: getLinesForState('pulse', camrySold, soldPulse, fmt) },
      {
        label: 'Pulse: Reserve not met',
        lines: getLinesForState('pulse', camryRnm, null, fmt),
      },
    ];
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>
        LivingVehicleAscii
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
        3D wireframe cube (Cursor-style). Terminal + badge states below.
      </p>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>3D rotating cube</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
        Isometric projection, 32 frames, 56×28 character grid.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
        <MovingLogoCanvas kind="cursor" ariaLabel="3D rotating cube" />
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>3D rotating tire (torus)</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
        Wireframe torus: two rings + spokes, same isometric projection and grid.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
        <MovingLogoCanvas kind="tire" ariaLabel="3D rotating tire" />
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Terminal + badge states</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 24,
        }}
      >
        {samples.map((s) => (
          <SampleBlock key={s.label} label={s.label} lines={s.lines} />
        ))}
      </div>
    </div>
  );
}

export default LivingVehicleAsciiSamples;
