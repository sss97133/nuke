// TopologyView.tsx — SVG-based harness topology node-link diagram
// Shows K5 trunk routing graph: junction nodes, trunk segments with wire counts,
// and device dots positioned near their nearest zone junction node.
// Camera: scroll-to-zoom on cursor, space+drag pan, dark background.

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { ManifestDevice, WireSpec, OverlayResult } from './overlayCompute';
import {
  K5_HARNESS_GRAPH,
  computeTrunkSegments,
  routeWiresAlongHarness,
} from './harnessRouting';
import type { TrunkRenderSegment } from './harnessRouting';

// ── Design tokens ─────────────────────────────────────────────────────
const C = {
  bg: '#1a1a2e',
  surface: '#1f1f35',
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  active: '#00ddff',
} as const;

const ZONE_COLORS: Record<string, string> = {
  engine_bay: '#cc2222',
  firewall: '#cc6600',
  dash: '#2266cc',
  doors: '#8822cc',
  rear: '#22aa44',
  underbody: '#666666',
};

// ── Types ─────────────────────────────────────────────────────────────

interface DRCDeviceResult {
  severity: 'pass' | 'warn' | 'fail';
  rules: { ruleId: string; label: string; message: string; severity: 'pass' | 'warn' | 'fail' }[];
}

interface Props {
  devices: ManifestDevice[];
  wires: WireSpec[];
  result: OverlayResult;
  selectedDeviceId: string | null;
  selectedDeviceIds: Set<string>;
  selectedWireId: number | null;
  onDeviceClick: (id: string, e: React.MouseEvent) => void;
  onWireClick: (wireNumber: number) => void;
  drcMap?: Map<string, DRCDeviceResult>;
}

// ── Camera state ──────────────────────────────────────────────────────
interface Camera {
  x: number;
  y: number;
  zoom: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

// Map each device to its nearest trunk node based on zone
function mapDevicesToNodes(devices: ManifestDevice[]): Map<string, { x: number; y: number; nodeId: string }> {
  const result = new Map<string, { x: number; y: number; nodeId: string }>();
  const nodes = K5_HARNESS_GRAPH.nodes;

  // Group nodes by zone
  const nodesByZone = new Map<string, typeof nodes>();
  for (const n of nodes) {
    if (!nodesByZone.has(n.zone)) nodesByZone.set(n.zone, []);
    nodesByZone.get(n.zone)!.push(n);
  }

  // Distribute devices around their nearest zone node
  const nodeDeviceCounts = new Map<string, number>();

  for (const d of devices) {
    const zone = d.location_zone || 'engine_bay';
    const zoneNodes = nodesByZone.get(zone) || nodesByZone.get('engine_bay') || [nodes[0]];

    // Find nearest node in zone
    let best = zoneNodes[0];
    let bestDist = Infinity;
    // Use device pos if available, otherwise hash device name for stable position
    const px = d.pos_x_pct != null ? (d.pos_x_pct / 200) * 1000 : hashCode(d.device_name) % 1000;
    const py = d.pos_y_pct != null ? (d.pos_y_pct / 96) * 1000 : (hashCode(d.id) % 1000);

    for (const n of zoneNodes) {
      const dist = Math.sqrt((n.x - px) ** 2 + (n.y - py) ** 2);
      if (dist < bestDist) { bestDist = dist; best = n; }
    }

    // Offset from node to avoid overlap
    const count = nodeDeviceCounts.get(best.id) || 0;
    nodeDeviceCounts.set(best.id, count + 1);

    // Arrange devices in a circle around the node
    const angle = (count * 2.4) % (Math.PI * 2); // golden angle distribution
    const radius = 22 + Math.floor(count / 8) * 14;
    const ox = Math.cos(angle) * radius;
    const oy = Math.sin(angle) * radius;

    result.set(d.id, { x: best.x + ox, y: best.y + oy, nodeId: best.id });
  }

  return result;
}

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ── Component ─────────────────────────────────────────────────────────

export function TopologyView({
  devices, result, selectedDeviceId, selectedDeviceIds,
  selectedWireId, onDeviceClick, onWireClick, drcMap,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>({ x: 500, y: 480, zoom: 0.8 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const panStart = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  // Build trunk segments with wire count data
  const trunkSegments = useMemo((): TrunkRenderSegment[] => {
    // Route wires through the harness graph to get segment usage
    const requests = result.wires.map(w => {
      const fromDevice = devices.find(d => d.device_name === w.from.split(':')[0]);
      const toDevice = devices.find(d => d.device_name === w.to);
      return {
        wireNumber: w.wireNumber,
        fromX: fromDevice?.pos_x_pct != null ? (fromDevice.pos_x_pct / 200) * 1000 : 500,
        fromY: fromDevice?.pos_y_pct != null ? (fromDevice.pos_y_pct / 96) * 1000 : 300,
        toX: toDevice?.pos_x_pct != null ? (toDevice.pos_x_pct / 200) * 1000 : 500,
        toY: toDevice?.pos_y_pct != null ? (toDevice.pos_y_pct / 96) * 1000 : 500,
      };
    });

    const routed = routeWiresAlongHarness(requests);
    return computeTrunkSegments(routed);
  }, [result.wires, devices]);

  // Map all trunk segments (even with 0 wires) for display
  const allSegments = useMemo(() => {
    const nodes = K5_HARNESS_GRAPH.nodes;
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    return K5_HARNESS_GRAPH.segments.map(seg => {
      const from = nodeMap.get(seg.from)!;
      const to = nodeMap.get(seg.to)!;
      const trunkSeg = trunkSegments.find(ts =>
        (Math.abs(ts.x1 - from.x) < 1 && Math.abs(ts.y1 - from.y) < 1 &&
         Math.abs(ts.x2 - to.x) < 1 && Math.abs(ts.y2 - to.y) < 1) ||
        (Math.abs(ts.x1 - to.x) < 1 && Math.abs(ts.y1 - to.y) < 1 &&
         Math.abs(ts.x2 - from.x) < 1 && Math.abs(ts.y2 - from.y) < 1)
      );
      return {
        x1: from.x, y1: from.y,
        x2: to.x, y2: to.y,
        wireCount: trunkSeg?.wireCount ?? 0,
        zone: seg.zone,
      };
    });
  }, [trunkSegments]);

  // Device positions on the graph
  const devicePositions = useMemo(() => mapDevicesToNodes(devices), [devices]);

  // ── Camera controls ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    setCamera(prev => {
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const newZoom = Math.max(0.3, Math.min(15, prev.zoom * factor));
      const ratio = newZoom / prev.zoom;

      // Zoom centered on cursor
      const wx = prev.x + (mx - rect.width / 2) / prev.zoom;
      const wy = prev.y + (my - rect.height / 2) / prev.zoom;
      const nx = wx - (wx - prev.x) / ratio;
      const ny = wy - (wy - prev.y) / ratio;

      return { x: nx, y: ny, zoom: newZoom };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (spaceDown || e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
    }
  }, [spaceDown, camera.x, camera.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning && panStart.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setCamera(prev => ({
        ...prev,
        x: panStart.current!.cx - dx / prev.zoom,
        y: panStart.current!.cy - dy / prev.zoom,
      }));
    }
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    panStart.current = null;
  }, []);

  // Space key for pan mode
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); setSpaceDown(true); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { setSpaceDown(false); setIsPanning(false); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // ── Render ──
  const rect = containerRef.current?.getBoundingClientRect();
  const vw = rect?.width ?? 1200;
  const vh = rect?.height ?? 800;

  // SVG viewBox based on camera
  const halfW = vw / (2 * camera.zoom);
  const halfH = vh / (2 * camera.zoom);
  const viewBox = `${camera.x - halfW} ${camera.y - halfH} ${halfW * 2} ${halfH * 2}`;

  const hasSelection = selectedDeviceId != null;

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        width: '100%', height: '100%',
        background: C.bg,
        cursor: isPanning ? 'grabbing' : spaceDown ? 'grab' : 'default',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        style={{ display: 'block' }}
      >
        {/* ── Zone background regions ── */}
        <ZoneRegions />

        {/* ── Trunk segments ── */}
        {allSegments.map((seg, i) => {
          const thickness = seg.wireCount > 0
            ? Math.max(2, Math.min(12, 1 + seg.wireCount * 0.3))
            : 1;
          const zoneColor = ZONE_COLORS[seg.zone] || '#555577';
          const opacity = seg.wireCount > 0 ? 0.7 : 0.2;

          return (
            <g key={`seg-${i}`}>
              <line
                x1={seg.x1} y1={seg.y1}
                x2={seg.x2} y2={seg.y2}
                stroke={zoneColor}
                strokeWidth={thickness}
                strokeOpacity={opacity}
                strokeLinecap="square"
              />
              {/* Wire count label on segment midpoint */}
              {seg.wireCount > 0 && camera.zoom > 0.6 && (
                <text
                  x={(seg.x1 + seg.x2) / 2}
                  y={(seg.y1 + seg.y2) / 2 - 4}
                  fill={C.label}
                  fontSize={8 / camera.zoom}
                  fontFamily="'Courier New', monospace"
                  fontWeight={700}
                  textAnchor="middle"
                >
                  {seg.wireCount}W
                </text>
              )}
            </g>
          );
        })}

        {/* ── Junction nodes ── */}
        {K5_HARNESS_GRAPH.nodes.map(node => {
          const zoneColor = ZONE_COLORS[node.zone] || '#555577';
          return (
            <g key={node.id}>
              <rect
                x={node.x - 6}
                y={node.y - 6}
                width={12}
                height={12}
                fill={zoneColor}
                fillOpacity={0.5}
                stroke={zoneColor}
                strokeWidth={2}
              />
              {/* Node label at higher zoom */}
              {camera.zoom > 1.0 && (
                <text
                  x={node.x}
                  y={node.y - 10}
                  fill={C.label}
                  fontSize={7 / camera.zoom}
                  fontFamily="Arial, sans-serif"
                  fontWeight={700}
                  textAnchor="middle"
                  style={{ textTransform: 'uppercase' } as React.CSSProperties}
                >
                  {node.label}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Device dots ── */}
        {devices.map(d => {
          const pos = devicePositions.get(d.id);
          if (!pos) return null;

          const isSelected = d.id === selectedDeviceId || selectedDeviceIds.has(d.id);
          const zoneColor = ZONE_COLORS[d.location_zone || ''] || '#555577';
          const dimmed = hasSelection && !isSelected;

          // DRC indicator
          const drc = drcMap?.get(d.id);
          const drcColor = drc?.severity === 'fail' ? '#ef4444'
            : drc?.severity === 'warn' ? '#eab308'
            : drc ? '#22c55e' : undefined;

          return (
            <g
              key={d.id}
              onClick={(e) => onDeviceClick(d.id, e)}
              style={{ cursor: 'pointer' }}
              opacity={dimmed ? 0.4 : 1}
            >
              {/* Connection line from device dot to its junction node */}
              {(() => {
                const node = K5_HARNESS_GRAPH.nodes.find(n => n.id === pos.nodeId);
                if (!node) return null;
                return (
                  <line
                    x1={pos.x} y1={pos.y}
                    x2={node.x} y2={node.y}
                    stroke={zoneColor}
                    strokeWidth={0.5}
                    strokeOpacity={0.3}
                    strokeDasharray="2,2"
                  />
                );
              })()}

              {/* Device dot */}
              <rect
                x={pos.x - 4}
                y={pos.y - 4}
                width={8}
                height={8}
                fill={zoneColor}
                stroke={isSelected ? C.active : zoneColor}
                strokeWidth={isSelected ? 2 : 1}
              />

              {/* Selection highlight */}
              {isSelected && (
                <rect
                  x={pos.x - 7}
                  y={pos.y - 7}
                  width={14}
                  height={14}
                  fill="none"
                  stroke={C.active}
                  strokeWidth={2}
                />
              )}

              {/* DRC dot */}
              {drcColor && (
                <rect
                  x={pos.x + 4}
                  y={pos.y - 7}
                  width={5}
                  height={5}
                  fill={drcColor}
                />
              )}

              {/* Device label at higher zoom */}
              {camera.zoom > 1.2 && (
                <text
                  x={pos.x}
                  y={pos.y + 12}
                  fill={isSelected ? C.active : C.text}
                  fontSize={6 / camera.zoom}
                  fontFamily="Arial, sans-serif"
                  fontWeight={700}
                  textAnchor="middle"
                  style={{ textTransform: 'uppercase' } as React.CSSProperties}
                >
                  {d.device_name.length > 16 ? d.device_name.slice(0, 14) + '..' : d.device_name}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Legend ── */}
        <Legend zoom={camera.zoom} viewBox={{ x: camera.x - halfW, y: camera.y - halfH, w: halfW * 2, h: halfH * 2 }} />
      </svg>
    </div>
  );
}

// ── Zone background regions ───────────────────────────────────────────
function ZoneRegions() {
  // Approximate zone boundaries on the 1000x1000 grid
  const zones = [
    { zone: 'engine_bay', x: 140, y: 30, w: 720, h: 270, label: 'ENGINE BAY' },
    { zone: 'firewall', x: 280, y: 290, w: 460, h: 50, label: 'FIREWALL' },
    { zone: 'dash', x: 220, y: 340, w: 560, h: 180, label: 'DASH' },
    { zone: 'doors', x: 120, y: 400, w: 760, h: 100, label: 'DOORS' },
    { zone: 'rear', x: 160, y: 560, w: 680, h: 400, label: 'REAR' },
  ];

  return (
    <g>
      {zones.map(z => (
        <g key={z.zone}>
          <rect
            x={z.x} y={z.y} width={z.w} height={z.h}
            fill={ZONE_COLORS[z.zone] || '#555577'}
            fillOpacity={0.04}
            stroke={ZONE_COLORS[z.zone] || '#555577'}
            strokeWidth={1}
            strokeOpacity={0.15}
            strokeDasharray="4,4"
          />
          <text
            x={z.x + 6} y={z.y + 12}
            fill={ZONE_COLORS[z.zone] || '#555577'}
            fillOpacity={0.25}
            fontSize={9}
            fontFamily="Arial, sans-serif"
            fontWeight={700}
            letterSpacing={1}
          >
            {z.label}
          </text>
        </g>
      ))}
    </g>
  );
}

// ── Legend ─────────────────────────────────────────────────────────────
function Legend({ zoom, viewBox }: { zoom: number; viewBox: { x: number; y: number; w: number; h: number } }) {
  const s = 1 / zoom; // scale factor so legend stays fixed-size on screen
  const lx = viewBox.x + viewBox.w - 180 * s;
  const ly = viewBox.y + 12 * s;

  const entries = [
    { zone: 'engine_bay', label: 'ENGINE' },
    { zone: 'firewall', label: 'FIREWALL' },
    { zone: 'dash', label: 'DASH' },
    { zone: 'doors', label: 'DOORS' },
    { zone: 'rear', label: 'REAR' },
    { zone: 'underbody', label: 'UNDERBODY' },
  ];

  return (
    <g>
      <rect
        x={lx} y={ly}
        width={170 * s} height={(entries.length * 14 + 8) * s}
        fill="#1a1a2e"
        fillOpacity={0.85}
        stroke="#333355"
        strokeWidth={s}
      />
      {entries.map((e, i) => (
        <g key={e.zone}>
          <rect
            x={lx + 6 * s}
            y={ly + (6 + i * 14) * s}
            width={8 * s}
            height={8 * s}
            fill={ZONE_COLORS[e.zone]}
          />
          <text
            x={lx + 20 * s}
            y={ly + (13 + i * 14) * s}
            fill="#a0a0b0"
            fontSize={8 * s}
            fontFamily="Arial, sans-serif"
            fontWeight={700}
          >
            {e.label}
          </text>
        </g>
      ))}
    </g>
  );
}
