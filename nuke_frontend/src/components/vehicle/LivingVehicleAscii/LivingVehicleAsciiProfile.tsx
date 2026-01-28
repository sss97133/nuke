'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { VehicleAsciiSlice, AuctionPulseSlice } from './types';
import {
  type LivingAsciiState,
  getLinesForState,
} from './asciiGenerators';

const LIVING_STATES: LivingAsciiState[] = ['shape', 'identity', 'pulse'];

export type LivingVehicleAsciiProfileProps = {
  /** Vehicle slice driving the ASCII content */
  vehicle: VehicleAsciiSlice;
  /** Auction/listing pulse for live/sold/ended line */
  auctionPulse?: AuctionPulseSlice | null;
  /** Format currency for pulse line (e.g. LIVE · $12,000 · 5 bids) */
  formatCurrency?: (n: number | null | undefined) => string;
  /** Which state to show (controlled). If set, display follows this when not auto-rotating. */
  state?: LivingAsciiState;
  /** Callback when state changes */
  onStateChange?: (state: LivingAsciiState) => void;
  /** Auto-rotate through shape → identity → pulse. Default true. */
  autoRotate?: boolean;
  /** Ms per state when auto-rotating. Default 3000. */
  rotateIntervalMs?: number;
  /** Transition duration in ms. Default 400. */
  transitionMs?: number;
  /** Use canvas (431×431) or pre. Default 'canvas' to match page grid. */
  renderMode?: 'canvas' | 'pre';
  /** aria-label for the canvas. Default "ASCII animation". */
  ariaLabel?: string;
  /** Optional class name for the wrapper/canvas. Default page_gridCanvas__GK3dR. */
  className?: string;
};

/** Logical size 431×431; display via CSS at ~216px for 2x (cursor.com/cli). */
const DEFAULT_CANVAS_SIZE = 431;

export function LivingVehicleAsciiProfile({
  vehicle,
  auctionPulse = null,
  formatCurrency,
  state: controlledState,
  onStateChange,
  autoRotate = true,
  rotateIntervalMs = 3000,
  transitionMs = 400,
  renderMode = 'canvas',
  ariaLabel = 'ASCII animation',
  className = 'page_gridCanvas__GK3dR',
}: LivingVehicleAsciiProfileProps) {
  const [internalState, setInternalState] = useState<LivingAsciiState>('shape');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const effectiveState = controlledState ?? internalState;
  const setState = useCallback(
    (next: LivingAsciiState) => {
      if (controlledState == null) setInternalState(next);
      onStateChange?.(next);
    },
    [controlledState, onStateChange]
  );

  const lines = useMemo(
    () => getLinesForState(effectiveState, vehicle, auctionPulse, formatCurrency),
    [effectiveState, vehicle, auctionPulse, formatCurrency]
  );

  useEffect(() => {
    if (!autoRotate) return;
    const id = setInterval(() => {
      setIsTransitioning(true);
      const i = LIVING_STATES.indexOf(effectiveState);
      const next = LIVING_STATES[(i + 1) % LIVING_STATES.length];
      setState(next);
      setTimeout(() => setIsTransitioning(false), transitionMs);
    }, rotateIntervalMs);
    return () => clearInterval(id);
  }, [
    autoRotate,
    rotateIntervalMs,
    transitionMs,
    effectiveState,
    setState,
  ]);

  const text = lines.join('\n');

  const shared = {
    'aria-label': ariaLabel,
    className: [
      'living-vehicle-ascii-profile',
      isTransitioning ? 'living-vehicle-ascii-profile--transitioning' : '',
      className,
    ]
      .filter(Boolean)
      .join(' '),
    style: {
      transition: `opacity ${transitionMs}ms ease`,
      opacity: isTransitioning ? 0.6 : 1,
    } as React.CSSProperties,
  };

  if (renderMode === 'canvas') {
    return (
      <LivingVehicleAsciiCanvas
        text={text}
        width={DEFAULT_CANVAS_SIZE}
        height={DEFAULT_CANVAS_SIZE}
        {...shared}
        displaySizePx={215.984}
      />
    );
  }

  return (
    <pre
      {...shared}
      style={{
        ...shared.style,
        fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
        fontSize: 'clamp(10px, 2.5vw, 14px)',
        lineHeight: 1.2,
        margin: 0,
        padding: '1rem',
        overflow: 'auto',
        background: '#0f0f0f',
        color: '#c0c0c0',
        borderRadius: 4,
      }}
    >
      {text}
    </pre>
  );
}

type CanvasProps = {
  text: string;
  width: number;
  height: number;
  'aria-label': string;
  className: string;
  style: React.CSSProperties;
  displaySizePx?: number;
};

/** Cursor-quality: dark bg, light mono, crisp centering. */
const CANVAS_BG = '#0a0a0a';
const CANVAS_FG = '#fafafa';
const CANVAS_FONT = '14px "JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace';
const LINE_HEIGHT = 20;
const CHAR_W = 8.4;
const PADDING = 28;

function LivingVehicleAsciiCanvas({
  text,
  width,
  height,
  'aria-label': ariaLabel,
  className,
  style,
  displaySizePx = 215.984,
}: CanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio ?? 1;
    el.width = width * dpr;
    el.height = height * dpr;
    el.style.width = `${displaySizePx}px`;
    el.style.height = `${displaySizePx}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, width, height);
    ctx.font = CANVAS_FONT;
    ctx.fillStyle = CANVAS_FG;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const allLines = text.split('\n').filter((l) => l.length > 0);
    const maxLen = Math.max(0, ...allLines.map((l) => l.length));
    const blockW = maxLen * CHAR_W;
    const blockH = allLines.length * LINE_HEIGHT;
    const padX = Math.max(PADDING, (width - blockW) / 2);
    const padY = Math.max(PADDING, (height - blockH) / 2);

    allLines.forEach((line, i) => {
      ctx.fillText(line, padX, padY + i * LINE_HEIGHT);
    });
  }, [text, width, height, displaySizePx]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={ariaLabel}
      className={className}
      style={{ ...style, width: displaySizePx, height: displaySizePx }}
      width={width}
      height={height}
    />
  );
}

export default LivingVehicleAsciiProfile;
