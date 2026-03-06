// HarnessCanvas.tsx — SVG canvas with pan/zoom, renders nodes, edges, section groups

import React, { useCallback, useRef, useState } from 'react';
import type { HarnessState, HarnessEndpoint, WiringConnection, HarnessSection, DrawWireState } from './harnessTypes';
import { HarnessCanvasNode, NODE_WIDTH, NODE_HEIGHT } from './HarnessCanvasNode';
import { HarnessCanvasEdge, HarnessCanvasDrawingEdge } from './HarnessCanvasEdge';
import { HarnessCanvasSectionGroup } from './HarnessCanvasSectionGroup';

interface Props {
  state: HarnessState;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onDeselect: () => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onPortClick: (endpointId: string, x: number, y: number) => void;
  onCanvasClick: (x: number, y: number) => void;
  onViewportChange: (vp: { x: number; y: number; zoom: number }) => void;
}

export function HarnessCanvas({
  state, onSelectNode, onSelectEdge, onDeselect,
  onMoveNode, onPortClick, onCanvasClick, onViewportChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ startX: number; startY: number; vpX: number; vpY: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const { viewport, endpoints, connections, sections, selection, drawWire, mode } = state;

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewport.x) / viewport.zoom,
      y: (clientY - rect.top - viewport.y) / viewport.zoom,
    };
  }, [viewport]);

  // Pan: pointer down on background
  const handleBgPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Only pan in select mode, or always allow middle-click pan
    if (mode !== 'select' && mode !== 'draw_wire') return;

    // Check if we clicked on background (not a node)
    const target = e.target as SVGElement;
    if (target !== svgRef.current && target.tagName !== 'rect') return;

    onDeselect();

    // If in add_node mode, place node at click position
    if (mode === 'add_node') {
      const pos = screenToCanvas(e.clientX, e.clientY);
      onCanvasClick(pos.x, pos.y);
      return;
    }

    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      vpX: viewport.x,
      vpY: viewport.y,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [mode, viewport, onDeselect, onCanvasClick, screenToCanvas]);

  const handleBgPointerMove = useCallback((e: React.PointerEvent) => {
    // Track mouse for drawing wire
    if (drawWire) {
      const pos = screenToCanvas(e.clientX, e.clientY);
      setMousePos(pos);
    }

    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    onViewportChange({
      x: panRef.current.vpX + dx,
      y: panRef.current.vpY + dy,
      zoom: viewport.zoom,
    });
  }, [drawWire, viewport.zoom, onViewportChange, screenToCanvas]);

  const handleBgPointerUp = useCallback(() => {
    panRef.current = null;
  }, []);

  // Zoom: wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.15, Math.min(5, viewport.zoom * delta));

    // Zoom toward mouse position
    const newX = mouseX - (mouseX - viewport.x) * (newZoom / viewport.zoom);
    const newY = mouseY - (mouseY - viewport.y) * (newZoom / viewport.zoom);

    onViewportChange({ x: newX, y: newY, zoom: newZoom });
  }, [viewport, onViewportChange]);

  // Click on canvas background for add_node mode
  const handleSvgClick = useCallback((e: React.MouseEvent) => {
    if (mode === 'add_node') {
      const pos = screenToCanvas(e.clientX, e.clientY);
      onCanvasClick(pos.x, pos.y);
    }
  }, [mode, screenToCanvas, onCanvasClick]);

  // Group endpoints by section for section groups
  const endpointsBySection = new Map<string, HarnessEndpoint[]>();
  endpoints.forEach(ep => {
    if (ep.section_id) {
      const list = endpointsBySection.get(ep.section_id) || [];
      list.push(ep);
      endpointsBySection.set(ep.section_id, list);
    }
  });

  const cursorStyle = mode === 'add_node' ? 'crosshair'
    : mode === 'draw_wire' ? 'crosshair'
    : panRef.current ? 'grabbing'
    : 'grab';

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      style={{
        background: 'var(--bg, #f5f5f5)',
        cursor: cursorStyle,
        display: 'block',
        border: '2px solid var(--border)',
      }}
      onPointerDown={handleBgPointerDown}
      onPointerMove={handleBgPointerMove}
      onPointerUp={handleBgPointerUp}
      onWheel={handleWheel}
      onClick={handleSvgClick}
    >
      {/* Grid pattern */}
      <defs>
        <pattern id="harness-grid" width={20 * viewport.zoom} height={20 * viewport.zoom} patternUnits="userSpaceOnUse" x={viewport.x % (20 * viewport.zoom)} y={viewport.y % (20 * viewport.zoom)}>
          <circle cx={1} cy={1} r={0.5} fill="var(--border, #bdbdbd)" opacity={0.2} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#harness-grid)" pointerEvents="none" />

      {/* Transformed group for pan/zoom */}
      <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
        {/* Section groups (behind everything) */}
        {sections.map(section => {
          const sectionEps = endpointsBySection.get(section.id) || [];
          if (sectionEps.length === 0) return null;
          return (
            <HarnessCanvasSectionGroup
              key={section.id}
              section={section}
              endpoints={sectionEps}
            />
          );
        })}

        {/* Edges */}
        {connections.map(conn => (
          <HarnessCanvasEdge
            key={conn.id}
            connection={conn}
            fromEndpoint={endpoints.find(ep => ep.id === conn.from_endpoint_id)}
            toEndpoint={endpoints.find(ep => ep.id === conn.to_endpoint_id)}
            isSelected={selection.type === 'edge' && selection.id === conn.id}
            onSelect={onSelectEdge}
          />
        ))}

        {/* Drawing wire preview */}
        {drawWire && mousePos && (
          <HarnessCanvasDrawingEdge
            fromX={drawWire.fromX}
            fromY={drawWire.fromY}
            toX={mousePos.x}
            toY={mousePos.y}
          />
        )}

        {/* Nodes */}
        {endpoints.map(ep => (
          <HarnessCanvasNode
            key={ep.id}
            endpoint={ep}
            section={sections.find(s => s.id === ep.section_id) || null}
            isSelected={selection.type === 'node' && selection.id === ep.id}
            onSelect={onSelectNode}
            onMove={onMoveNode}
            onPortClick={onPortClick}
            canvasZoom={viewport.zoom}
          />
        ))}
      </g>

      {/* Canvas mode indicator */}
      <text
        x={8}
        y={16}
        style={{
          fontSize: '8px',
          fontFamily: 'Arial, sans-serif',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          fill: 'var(--text-muted, #999)',
          userSelect: 'none',
          opacity: 0.6,
        }}
      >
        {mode === 'add_node' ? 'CLICK TO PLACE ENDPOINT' : mode === 'draw_wire' ? 'CLICK PORT TO START WIRE' : ''}
      </text>
    </svg>
  );
}
