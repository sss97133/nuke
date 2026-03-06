// HarnessCanvasNode.tsx — A single endpoint "sticky note" on the SVG canvas

import React, { useCallback, useRef } from 'react';
import type { HarnessEndpoint, HarnessSection } from './harnessTypes';
import { ENDPOINT_TYPE_LABELS, SECTION_COLORS } from './harnessConstants';

export const NODE_WIDTH = 148;
export const NODE_HEIGHT = 72;
export const PORT_RADIUS = 5;

interface Props {
  endpoint: HarnessEndpoint;
  section: HarnessSection | null;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPortClick: (endpointId: string, x: number, y: number) => void;
  canvasZoom: number;
}

export function HarnessCanvasNode({ endpoint, section, isSelected, onSelect, onMove, onPortClick, canvasZoom }: Props) {
  const dragRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);

  const sectionColor = section?.color || SECTION_COLORS[section?.section_type || ''] || '#767676';
  const typeLabel = ENDPOINT_TYPE_LABELS[endpoint.endpoint_type] || endpoint.endpoint_type.toUpperCase();

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect(endpoint.id);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      nodeX: endpoint.canvas_x,
      nodeY: endpoint.canvas_y,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [endpoint.id, endpoint.canvas_x, endpoint.canvas_y, onSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / canvasZoom;
    const dy = (e.clientY - dragRef.current.startY) / canvasZoom;
    onMove(endpoint.id, dragRef.current.nodeX + dx, dragRef.current.nodeY + dy);
  }, [endpoint.id, canvasZoom, onMove]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handlePortLeftClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPortClick(endpoint.id, endpoint.canvas_x, endpoint.canvas_y + NODE_HEIGHT / 2);
  }, [endpoint.id, endpoint.canvas_x, endpoint.canvas_y, onPortClick]);

  const handlePortRightClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPortClick(endpoint.id, endpoint.canvas_x + NODE_WIDTH, endpoint.canvas_y + NODE_HEIGHT / 2);
  }, [endpoint.id, endpoint.canvas_x, endpoint.canvas_y, onPortClick]);

  return (
    <g transform={`translate(${endpoint.canvas_x}, ${endpoint.canvas_y})`}>
      {/* Node body — foreignObject for HTML styling */}
      <foreignObject
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: 'grab' }}
      >
        <div
          style={{
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            background: isSelected ? 'var(--surface-hover, #e0e0e0)' : 'var(--surface, #ebebeb)',
            border: `2px solid ${isSelected ? sectionColor : 'var(--border, #bdbdbd)'}`,
            padding: '4px 6px',
            fontFamily: 'Arial, sans-serif',
            overflow: 'hidden',
            boxSizing: 'border-box',
            userSelect: 'none',
          }}
        >
          {/* Section color dot + type label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
            <div style={{
              width: 6, height: 6, minWidth: 6,
              background: sectionColor,
              border: '1px solid var(--border)',
            }} />
            <span style={{
              fontSize: '8px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: 'var(--text-muted, #999)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {typeLabel}
            </span>
          </div>

          {/* Name */}
          <div style={{
            fontSize: '10px',
            fontWeight: 700,
            color: 'var(--text, #2a2a2a)',
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: '2px',
          }}>
            {endpoint.name}
          </div>

          {/* Amps + location */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            {endpoint.amperage_draw != null && endpoint.amperage_draw > 0 ? (
              <span style={{
                fontSize: '9px',
                fontFamily: '"Courier New", monospace',
                fontWeight: 700,
                color: 'var(--text, #2a2a2a)',
              }}>
                {endpoint.amperage_draw}A
              </span>
            ) : (
              <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>—</span>
            )}
            {endpoint.location_zone && (
              <span style={{
                fontSize: '7px',
                textTransform: 'uppercase',
                color: 'var(--text-muted, #999)',
                letterSpacing: '0.3px',
              }}>
                {endpoint.location_zone.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>
      </foreignObject>

      {/* Left port */}
      <circle
        cx={0}
        cy={NODE_HEIGHT / 2}
        r={PORT_RADIUS}
        fill="var(--surface, #ebebeb)"
        stroke="var(--border, #bdbdbd)"
        strokeWidth={2}
        style={{ cursor: 'crosshair' }}
        onClick={handlePortLeftClick}
      />

      {/* Right port */}
      <circle
        cx={NODE_WIDTH}
        cy={NODE_HEIGHT / 2}
        r={PORT_RADIUS}
        fill="var(--surface, #ebebeb)"
        stroke="var(--border, #bdbdbd)"
        strokeWidth={2}
        style={{ cursor: 'crosshair' }}
        onClick={handlePortRightClick}
      />
    </g>
  );
}
