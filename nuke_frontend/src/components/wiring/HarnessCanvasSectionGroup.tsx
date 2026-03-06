// HarnessCanvasSectionGroup.tsx — Colored bounding box for a harness section

import React, { useMemo } from 'react';
import type { HarnessSection, HarnessEndpoint } from './harnessTypes';
import { NODE_WIDTH, NODE_HEIGHT } from './HarnessCanvasNode';

const PADDING = 20;

interface Props {
  section: HarnessSection;
  endpoints: HarnessEndpoint[];
}

export function HarnessCanvasSectionGroup({ section, endpoints }: Props) {
  const bounds = useMemo(() => {
    if (endpoints.length === 0) return null;
    const xs = endpoints.map(ep => ep.canvas_x);
    const ys = endpoints.map(ep => ep.canvas_y);
    return {
      x: Math.min(...xs) - PADDING,
      y: Math.min(...ys) - PADDING - 14, // extra space for label
      w: Math.max(...xs) - Math.min(...xs) + NODE_WIDTH + PADDING * 2,
      h: Math.max(...ys) - Math.min(...ys) + NODE_HEIGHT + PADDING * 2 + 14,
    };
  }, [endpoints]);

  if (!bounds) return null;

  const color = section.color || '#767676';

  return (
    <g>
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.w}
        height={bounds.h}
        fill={color}
        fillOpacity={0.04}
        stroke={color}
        strokeWidth={1}
        strokeDasharray="6 4"
        rx={0}
      />
      <text
        x={bounds.x + 6}
        y={bounds.y + 10}
        style={{
          fontSize: '8px',
          fontFamily: 'Arial, sans-serif',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.8px',
          fill: color,
          userSelect: 'none',
          opacity: 0.7,
        }}
      >
        {section.name.toUpperCase()}
      </text>
    </g>
  );
}
