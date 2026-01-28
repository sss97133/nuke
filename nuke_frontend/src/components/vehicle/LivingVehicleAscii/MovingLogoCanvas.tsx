'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  getMovingLogoFrames,
  inferMovingLogoKind,
  type MovingLogoKind,
} from './movingLogoFrames';

const CANVAS_SIZE = 431;
const DISPLAY_SIZE_PX = 215.984;
const BG = '#0a0a0a';
const FG = '#fafafa';
const FONT = '14px "JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace';
const LINE_HEIGHT = 20;
const CHAR_WIDTH_APPROX = 8.4;
const FPS = 12;

export type MovingLogoCanvasProps = {
  /** Logo to animate: cursor (cube), mustang, corvette, gm, plymouth. Default cursor. */
  kind?: MovingLogoKind;
  /** Infer kind from vehicle make when provided. */
  make?: string | null;
  /** ms per frame. Default 1000/12 ≈ 83. */
  frameIntervalMs?: number;
  /** aria-label for the canvas. Default "ASCII animation". */
  ariaLabel?: string;
  /** Class name. Default page_gridCanvas__GK3dR. */
  className?: string;
  /** Optional inline style. */
  style?: React.CSSProperties;
};

export function MovingLogoCanvas({
  kind: kindProp,
  make,
  frameIntervalMs = 1000 / FPS,
  ariaLabel = 'ASCII animation',
  className = 'page_gridCanvas__GK3dR',
  style = {},
}: MovingLogoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kind: MovingLogoKind = kindProp ?? (make ? inferMovingLogoKind(make) : 'cursor');
  const frames = getMovingLogoFrames(kind);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, frameIntervalMs);
    return () => clearInterval(id);
  }, [frames.length, frameIntervalMs]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !frames.length) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio ?? 1;
    el.width = CANVAS_SIZE * dpr;
    el.height = CANVAS_SIZE * dpr;
    el.style.width = `${DISPLAY_SIZE_PX}px`;
    el.style.height = `${DISPLAY_SIZE_PX}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.font = FONT;
    ctx.fillStyle = FG;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const lines = frames[frameIndex] ?? frames[0];
    const maxLen = Math.max(0, ...lines.map((l) => l.length));
    const blockW = maxLen * CHAR_WIDTH_APPROX;
    const blockH = lines.length * LINE_HEIGHT;
    const padX = Math.max(0, (CANVAS_SIZE - blockW) / 2);
    const padY = Math.max(0, (CANVAS_SIZE - blockH) / 2);

    lines.forEach((line, i) => {
      ctx.fillText(line, padX, padY + i * LINE_HEIGHT);
    });
  }, [frames, frameIndex]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={ariaLabel}
      className={className}
      style={{ width: DISPLAY_SIZE_PX, height: DISPLAY_SIZE_PX, ...style }}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
    />
  );
}

export default MovingLogoCanvas;
