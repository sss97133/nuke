// WiringWirePath.tsx — Orthogonal SVG wire paths between device nodes
// H/V segments only, 90° corners, miter joins. Uses pre-computed routes from workspace.

import React from 'react';
import type { WireSpec } from './overlayCompute';
import type { PathSegment } from './orthogonalRouter';
import type { LabelPlacement } from './labelPlacer';

// Wire color abbreviation → CSS
const WIRE_COLOR_CSS: Record<string, string> = {
  'RED': '#cc2222', 'BLK': '#2a2a2a', 'WHT': '#bdbdbd', 'GRN': '#228b22',
  'BLU': '#2266cc', 'YEL': '#ccaa00', 'ORG': '#cc6600', 'BRN': '#8b4513',
  'VIO': '#7744aa', 'PNK': '#cc6699', 'GRY': '#999', 'TAN': '#d2b48c',
  'LT GRN': '#66cc66', 'DK GRN': '#226622', 'LT BLU': '#6699cc', 'DK BLU': '#224488',
  'PPL': '#7744aa',
};

function wireColorToCSS(color: string): string {
  if (WIRE_COLOR_CSS[color]) return WIRE_COLOR_CSS[color];
  const first = color.split('/')[0];
  return WIRE_COLOR_CSS[first] || '#bdbdbd';
}

function gaugeToStrokeWidth(gauge: number, zoom: number): number {
  if (zoom < 0.3) return 1;
  if (gauge >= 20) return 0.8;
  if (gauge >= 16) return 1.2;
  if (gauge >= 12) return 1.6;
  if (gauge >= 8) return 2;
  if (gauge >= 4) return 2.5;
  return 3;
}

function segmentsToPoints(segments: PathSegment[]): string {
  if (segments.length === 0) return '';
  const points: string[] = [`${segments[0].x1},${segments[0].y1}`];
  for (const s of segments) {
    points.push(`${s.x2},${s.y2}`);
  }
  return points.join(' ');
}

interface Props {
  wire: WireSpec;
  segments: PathSegment[];  // Pre-computed by workspace batch router
  zoom: number;
  isSelected: boolean;
  onSelect: (wireNumber: number) => void;
  label?: LabelPlacement;
}

export function WiringWirePath({
  wire, segments, zoom, isSelected, onSelect, label,
}: Props) {
  const pointsStr = segmentsToPoints(segments);
  if (!pointsStr) return null;

  const cssColor = wireColorToCSS(wire.color);
  const strokeWidth = gaugeToStrokeWidth(wire.gauge, zoom);

  const showLabel = label && zoom >= 0.5;
  const labelText = label
    ? (zoom >= 0.8 ? label.text : label.shortText)
    : '';

  return (
    <g data-wire={wire.wireNumber}>
      {/* Invisible wide hit area */}
      <polyline
        points={pointsStr}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(strokeWidth + 6, 8)}
        strokeLinejoin="miter"
        style={{ cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onSelect(wire.wireNumber); }}
      />

      {/* Visible wire — orthogonal polyline */}
      <polyline
        points={pointsStr}
        fill="none"
        stroke={isSelected ? 'var(--text, #2a2a2a)' : cssColor}
        strokeWidth={isSelected ? strokeWidth + 0.5 : strokeWidth}
        strokeLinejoin="miter"
        strokeLinecap="square"
        strokeDasharray={wire.isShielded ? '4 2' : undefined}
        opacity={isSelected ? 1 : 0.25}
        style={{ cursor: 'pointer', transition: 'opacity 0.12s ease' }}
        onClick={(e) => { e.stopPropagation(); onSelect(wire.wireNumber); }}
      />

      {/* Wire label */}
      {showLabel && label && (
        <text
          x={label.x}
          y={label.y}
          textAnchor={label.anchor}
          transform={label.rotation !== 0 ? `rotate(${label.rotation}, ${label.x}, ${label.y})` : undefined}
          style={{
            fontSize: '6px',
            fontFamily: '"Courier New", monospace',
            fontWeight: 700,
            fill: isSelected ? 'var(--text, #2a2a2a)' : 'var(--text-secondary, #666)',
            userSelect: 'none',
            pointerEvents: 'none',
            opacity: isSelected ? 1 : 0.7,
          }}
        >
          {labelText}
        </text>
      )}
    </g>
  );
}
