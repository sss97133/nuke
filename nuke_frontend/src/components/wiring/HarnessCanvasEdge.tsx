// HarnessCanvasEdge.tsx — SVG bezier wire between two endpoint nodes

import React from 'react';
import type { WiringConnection, HarnessEndpoint } from './harnessTypes';
import { NODE_WIDTH, NODE_HEIGHT } from './HarnessCanvasNode';

// Map wire color abbreviations to CSS colors for rendering
const WIRE_COLOR_MAP: Record<string, string> = {
  'RED': '#cc2222',
  'BLK': '#333333',
  'WHT': '#cccccc',
  'GRN': '#228b22',
  'BLU': '#2266cc',
  'YEL': '#ccaa00',
  'ORG': '#cc6600',
  'BRN': '#8b4513',
  'VIO': '#7744aa',
  'PNK': '#cc6699',
  'GRY': '#888888',
  'TAN': '#d2b48c',
  'LT GRN': '#66cc66',
  'DK GRN': '#226622',
  'LT BLU': '#6699cc',
  'DK BLU': '#224488',
};

function wireColorToCSS(color: string | null): string {
  if (!color) return 'var(--border, #bdbdbd)';
  // Check direct match
  if (WIRE_COLOR_MAP[color]) return WIRE_COLOR_MAP[color];
  // Check compound colors (RED/WHT → use first)
  const first = color.split('/')[0];
  if (WIRE_COLOR_MAP[first]) return WIRE_COLOR_MAP[first];
  return 'var(--border, #bdbdbd)';
}

// Map AWG to stroke width for visual weight
function gaugeToStrokeWidth(gauge: string | null): number {
  if (!gauge) return 1.5;
  const match = gauge.match(/(\d+)/);
  if (!match) return 1.5;
  const awg = parseInt(match[1], 10);
  // Inverse relationship: smaller AWG number = thicker wire
  if (awg >= 20) return 1;
  if (awg >= 16) return 1.5;
  if (awg >= 12) return 2;
  if (awg >= 8) return 2.5;
  if (awg >= 4) return 3;
  return 3.5;
}

interface Props {
  connection: WiringConnection;
  fromEndpoint: HarnessEndpoint | undefined;
  toEndpoint: HarnessEndpoint | undefined;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export function HarnessCanvasEdge({ connection, fromEndpoint, toEndpoint, isSelected, onSelect }: Props) {
  if (!fromEndpoint || !toEndpoint) return null;

  // Calculate port positions
  const fromX = fromEndpoint.canvas_x + NODE_WIDTH;
  const fromY = fromEndpoint.canvas_y + NODE_HEIGHT / 2;
  const toX = toEndpoint.canvas_x;
  const toY = toEndpoint.canvas_y + NODE_HEIGHT / 2;

  // Determine curve direction
  const dx = toX - fromX;
  const controlOffset = Math.max(Math.abs(dx) * 0.4, 50);

  // If target is to the left, route the wire around
  const curveFromX = fromX + controlOffset;
  const curveToX = toX - controlOffset;

  const pathD = `M ${fromX} ${fromY} C ${curveFromX} ${fromY}, ${curveToX} ${toY}, ${toX} ${toY}`;

  const cssColor = wireColorToCSS(connection.wire_color);
  const strokeWidth = gaugeToStrokeWidth(connection.wire_gauge || connection.calculated_gauge);

  // Midpoint for label
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const gauge = connection.wire_gauge || connection.calculated_gauge || '';
  const color = connection.wire_color || '';
  const label = [gauge, color].filter(Boolean).join(' / ');

  return (
    <g>
      {/* Invisible wide hit area for click targeting */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(strokeWidth + 8, 12)}
        style={{ cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onSelect(connection.id); }}
      />

      {/* Visible wire */}
      <path
        d={pathD}
        fill="none"
        stroke={isSelected ? 'var(--accent-bright, #0078d4)' : cssColor}
        strokeWidth={isSelected ? strokeWidth + 1 : strokeWidth}
        strokeLinecap="round"
        opacity={isSelected ? 1 : 0.8}
        style={{ cursor: 'pointer', transition: 'stroke 0.12s ease' }}
        onClick={(e) => { e.stopPropagation(); onSelect(connection.id); }}
      />

      {/* Wire label at midpoint */}
      {label && (
        <g transform={`translate(${midX}, ${midY - 6})`}>
          <rect
            x={-label.length * 2.5 - 4}
            y={-6}
            width={label.length * 5 + 8}
            height={12}
            fill="var(--bg, #f5f5f5)"
            stroke="none"
            opacity={0.85}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            style={{
              fontSize: '7px',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 600,
              fill: isSelected ? 'var(--accent-bright, #0078d4)' : 'var(--text-muted, #999)',
              userSelect: 'none',
            }}
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

// Temporary wire being drawn (follows cursor)
export function HarnessCanvasDrawingEdge({ fromX, fromY, toX, toY }: { fromX: number; fromY: number; toX: number; toY: number }) {
  const dx = toX - fromX;
  const controlOffset = Math.max(Math.abs(dx) * 0.4, 50);
  const pathD = `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`;

  return (
    <path
      d={pathD}
      fill="none"
      stroke="var(--accent, #2a2a2a)"
      strokeWidth={1.5}
      strokeDasharray="6 3"
      opacity={0.6}
      pointerEvents="none"
    />
  );
}
