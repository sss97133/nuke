// LoomTopologyView.tsx — Visual harness topology: nodes, segments, wire counts, zones
// Shows the physical loom layout as an interactive SVG schematic.
// Wire counts computed via Dijkstra routing through the trunk graph.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { K5_HARNESS_GRAPH, buildAdjacency, shortestPath, type HarnessGraph } from './harnessRouting';
import { ZONE_COLORS, ZONE_LABELS, segmentKey } from './harnessConstants';
import { supabase } from '../../lib/supabase';
import './LoomTopologyView.css';

// ── Types ──

interface WireData {
  circuit_code: string;
  from_component?: string;
  to_component: string;
  from_location_zone?: string;
  to_location_zone?: string;
  length_typical_ft: number;
  wire_gauge_awg: number;
  wire_color?: string;
  signal_type: string;
  routing_description: string;
  source?: string;
}

interface OverlayInfo {
  id: string;
  vehicle_id: string;
  factory_generation: string;
  wiring_tier: string;
  status: string;
  applied_upgrade_ids: string[];
  total_circuits: number;
  total_wire_length_ft: number;
  estimated_cost_min: number;
  estimated_cost_max: number;
  estimated_hours: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

type LayerKey = 'zones' | 'segments' | 'nodes' | 'labels' | 'wireCounts';

interface Props {
  vehicleId: string;
  /**
   * Wires + overlay info passed from parent (WiringPlan) so we share the
   * computed harness data with FORMBOARD/SCHEMATICS/DATA tabs. Avoids a
   * broken RPC call (`get_vehicle_wiring_circuits` was never created in
   * the DB) and removes a duplicate fetch path.
   */
  wires?: WireData[];
  overlayInfo?: OverlayInfo | null;
}

// Zoom limits: viewBox dimensions clamped
const MIN_VIEW = 200;
const MAX_VIEW = 3000;

export function LoomTopologyView({ vehicleId, wires: wiresProp, overlayInfo: overlayInfoProp }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [wiresLocal, setWiresLocal] = useState<WireData[]>([]);
  const [overlayInfoLocal, setOverlayInfoLocal] = useState<OverlayInfo | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefer wires/overlayInfo passed by parent (WiringPlan computes these
  // already via useOverlayCompute). Local state remains as a fallback for
  // standalone usage.
  const wires = wiresProp ?? wiresLocal;
  const overlayInfo = overlayInfoProp ?? overlayInfoLocal;

  // Layer visibility
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    zones: true,
    segments: true,
    nodes: true,
    labels: true,
    wireCounts: true,
  });

  // Pan/zoom state
  const [viewBox, setViewBox] = useState({ x: 50, y: 0, w: 900, h: 1000 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const graph = K5_HARNESS_GRAPH;
  const nodeMap = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);

  // ── Data loading ──

  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // If parent passed wires, skip the fetch entirely. The parent is
    // responsible for keeping them fresh.
    if (wiresProp && wiresProp.length > 0) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Pull the overlay record (rate limit + status). The wire schedule
        // is computed client-side from vehicle_build_manifest by parent
        // pages — there's no `get_vehicle_wiring_circuits` RPC in the DB.
        const overlayRes = await supabase
          .from('vehicle_wiring_overlays')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .maybeSingle();
        if (cancelled) return;
        if (overlayRes.error) throw new Error(overlayRes.error.message);
        if (overlayRes.data) setOverlayInfoLocal(overlayRes.data as OverlayInfo);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load wiring overlay');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicleId, retryCount, wiresProp]);

  const handleRetry = useCallback(() => setRetryCount(c => c + 1), []);

  // ── Dijkstra-based segment wire counts ──

  const { segmentWireCounts, wireRoutes } = useMemo(() => {
    return computeSegmentCountsDijkstra(wires, graph);
  }, [wires, graph]);

  // Wire count at each node (max of adjacent segments)
  const nodeWireCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const seg of graph.segments) {
      const key = segmentKey(seg.from, seg.to);
      const count = segmentWireCounts.get(key) ?? 0;
      counts.set(seg.from, Math.max(counts.get(seg.from) ?? 0, count));
      counts.set(seg.to, Math.max(counts.get(seg.to) ?? 0, count));
    }
    return counts;
  }, [graph, segmentWireCounts]);

  // Wires through selected node (from routing paths)
  const selectedWires = useMemo(() => {
    if (!selectedNode) return [];
    return getWiresForNodeFromRoutes(selectedNode, wires, wireRoutes);
  }, [selectedNode, wires, wireRoutes]);

  // ── Wheel handler (passive: false) ──

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      setViewBox(v => {
        const cx = v.x + v.w / 2;
        const cy = v.y + v.h / 2;
        const nw = Math.max(MIN_VIEW, Math.min(v.w * factor, MAX_VIEW));
        const nh = Math.max(MIN_VIEW, Math.min(v.h * factor, MAX_VIEW));
        return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
      });
    }

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // ── Pan handlers ──

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = viewBox.w / rect.width;
    const dx = (e.clientX - panStartRef.current.x) * scale;
    const dy = (e.clientY - panStartRef.current.y) * scale;
    setViewBox(v => ({ ...v, x: v.x - dx, y: v.y - dy }));
    panStartRef.current = { x: e.clientX, y: e.clientY };
  }, [isPanning, viewBox.w]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const toggleLayer = useCallback((key: LayerKey) => {
    setLayers(l => ({ ...l, [key]: !l[key] }));
  }, []);

  // ── Loading / Error states ──

  if (loading) {
    return <div className="topo-loading">LOADING WIRING DATA...</div>;
  }

  if (error) {
    return (
      <div className="topo-error">
        <div className="topo-error-msg">{error}</div>
        <button className="topo-retry-btn" onClick={handleRetry}>RETRY</button>
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="topo-root">
      {/* SVG Canvas */}
      <div className="topo-canvas">
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="topo-svg"
          style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Zone backgrounds */}
          {layers.zones && renderZoneBackgrounds(graph)}

          {/* Segments — thickness = wire count */}
          {layers.segments && graph.segments.map((seg, i) => {
            const from = nodeMap.get(seg.from);
            const to = nodeMap.get(seg.to);
            if (!from || !to) return null;
            const key = segmentKey(seg.from, seg.to);
            const count = segmentWireCounts.get(key) ?? 0;
            const thickness = Math.max(2, Math.min(count / 2, 20));
            const color = ZONE_COLORS[seg.zone] ?? '#666';
            const isHighlighted = selectedNode && (seg.from === selectedNode || seg.to === selectedNode);

            return (
              <g key={i}>
                <line
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke={isHighlighted ? 'var(--text, #fff)' : color}
                  strokeWidth={thickness}
                  strokeOpacity={isHighlighted ? 0.9 : 0.5}
                  strokeLinecap="round"
                />
                {/* Wire count label on segment */}
                {layers.wireCounts && count > 0 && (
                  <text
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2 - thickness / 2 - 4}
                    fill={color}
                    fontSize="16"
                    fontFamily="Courier New"
                    fontWeight="bold"
                    textAnchor="middle"
                    opacity={0.8}
                  >
                    {count}w
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {layers.nodes && graph.nodes.map(node => {
            const wireCount = nodeWireCounts.get(node.id) ?? 0;
            const radius = Math.max(8, Math.min(wireCount / 3 + 6, 24));
            const color = ZONE_COLORS[node.zone] ?? '#666';
            const isSelected = selectedNode === node.id;
            const isHovered = hoveredNode === node.id;

            return (
              <g
                key={node.id}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedNode(isSelected ? null : node.id)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Outer ring */}
                <circle
                  cx={node.x} cy={node.y} r={radius + 2}
                  fill="none"
                  stroke={isSelected ? 'var(--text, #fff)' : isHovered ? 'var(--text, #ccc)' : color}
                  strokeWidth={isSelected ? 3 : 2}
                />
                {/* Inner fill */}
                <circle
                  cx={node.x} cy={node.y} r={radius}
                  fill={isSelected ? color : 'var(--surface, #1a1a2e)'}
                  opacity={0.9}
                />
                {/* Node ID label */}
                <text
                  x={node.x} y={node.y + 3}
                  fill={isSelected ? 'var(--bg, #fff)' : color}
                  fontSize="14"
                  fontFamily="Courier New"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {node.id}
                </text>
                {/* Label below node */}
                {layers.labels && (
                  <text
                    x={node.x}
                    y={node.y + radius + 14}
                    fill="var(--text, #888)"
                    fontSize="8"
                    fontFamily="Arial"
                    textAnchor="middle"
                    fontWeight="bold"
                    opacity={0.5}
                  >
                    {node.label.replace(/^R\d+ — /, '')}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Zone legend */}
        <div className="topo-legend">
          {Object.entries(ZONE_LABELS).map(([zone, label]) => (
            <span
              key={zone}
              className="topo-legend-item"
              style={{ color: ZONE_COLORS[zone], borderColor: `${ZONE_COLORS[zone]}44` }}
            >
              {label}
            </span>
          ))}
        </div>

        {/* Layer toggles */}
        <div className="topo-layers">
          {(['zones', 'segments', 'nodes', 'labels', 'wireCounts'] as LayerKey[]).map(key => (
            <button
              key={key}
              className="topo-layer-btn"
              data-active={String(layers[key])}
              onClick={() => toggleLayer(key)}
            >
              {key === 'wireCounts' ? 'COUNTS' : key.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Stats bar */}
        <div className="topo-stats">
          <span>{graph.nodes.length} NODES</span>
          <span>{graph.segments.length} SEGMENTS</span>
          <span>{overlayInfo?.total_circuits ?? '—'} CIRCUITS</span>
          <span>{overlayInfo?.total_wire_length_ft ?? '—'} FT TOTAL</span>
          <span>STATUS: {overlayInfo?.status?.toUpperCase() ?? '—'}</span>
          <span className="topo-stats-hint">SCROLL=ZOOM  SHIFT+DRAG=PAN  CLICK NODE=INSPECT</span>
        </div>
      </div>

      {/* Detail Panel */}
      <div className="topo-detail">
        {selectedNode ? (
          <>
            <div
              className="topo-detail-zone"
              style={{ color: ZONE_COLORS[nodeMap.get(selectedNode)?.zone ?? ''] ?? 'var(--text)' }}
            >
              {nodeMap.get(selectedNode)?.zone}
            </div>
            <div className="topo-detail-id">{selectedNode}</div>
            <div className="topo-detail-label">{nodeMap.get(selectedNode)?.label}</div>

            {/* Connected segments */}
            <div className="topo-section-header">CONNECTED SEGMENTS</div>
            {graph.segments
              .filter(s => s.from === selectedNode || s.to === selectedNode)
              .map((seg, i) => {
                const other = seg.from === selectedNode ? seg.to : seg.from;
                const key = segmentKey(seg.from, seg.to);
                const count = segmentWireCounts.get(key) ?? 0;
                return (
                  <div
                    key={i}
                    className="topo-segment-row"
                    onClick={() => setSelectedNode(other)}
                  >
                    → {other} <span style={{ color: ZONE_COLORS[seg.zone] }}>{count}w</span>
                  </div>
                );
              })}

            {/* Wires through this node */}
            <div className="topo-section-header-mt">WIRES ({selectedWires.length})</div>
            <div className="topo-wire-list">
              {selectedWires.map((w, i) => (
                <div key={i} className="topo-wire-row">
                  <span className="topo-wire-code">{w.circuit_code}</span>
                  <br />
                  <span className="topo-wire-detail">
                    {w.from_component ? `${w.from_component} → ` : ''}{w.to_component} — {w.wire_gauge_awg}AWG {w.length_typical_ft.toFixed(1)}ft
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="topo-empty">
            Click a node to inspect wires and connections.
            <br /><br />
            Node size = wire count passing through.
            <br />
            Segment thickness = bundle size.
            <br />
            Numbers on segments = wire count.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function renderZoneBackgrounds(graph: HarnessGraph) {
  const zones = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const n of graph.nodes) {
    const z = zones.get(n.zone) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    z.minX = Math.min(z.minX, n.x);
    z.minY = Math.min(z.minY, n.y);
    z.maxX = Math.max(z.maxX, n.x);
    z.maxY = Math.max(z.maxY, n.y);
    zones.set(n.zone, z);
  }

  return Array.from(zones).map(([zone, bounds]) => {
    const pad = 40;
    return (
      <g key={zone}>
        <rect
          x={bounds.minX - pad} y={bounds.minY - pad}
          width={bounds.maxX - bounds.minX + pad * 2}
          height={bounds.maxY - bounds.minY + pad * 2}
          fill={ZONE_COLORS[zone] ?? '#666'}
          fillOpacity={0.04}
          stroke={ZONE_COLORS[zone] ?? '#666'}
          strokeOpacity={0.15}
          strokeWidth={1}
          rx={0}
        />
        <text
          x={bounds.minX - pad + 6} y={bounds.minY - pad + 12}
          fill={ZONE_COLORS[zone] ?? '#666'}
          fontSize="8"
          fontFamily="Arial"
          fontWeight="bold"
          opacity={0.4}
        >
          {ZONE_LABELS[zone] ?? zone}
        </text>
      </g>
    );
  });
}

// ── Dijkstra-based segment counting ──
// Routes each wire through the trunk graph and counts wires per segment.

function findNodeForComponent(
  component: string | null | undefined,
  zone: string | null | undefined,
  circuitCode: string | null | undefined,
  routingDesc: string | null | undefined,
): string {
  const text = [component, circuitCode, routingDesc].filter(Boolean).join(' ').toLowerCase();

  // Component-specific matches (most specific first)
  if (text.includes('m150') || text.includes('ecu')) return 'grommet-h3';
  if (text.includes('pdm15') || text.includes('pdm 15')) return 'R4';
  if (text.includes('pdm30') || text.includes('pdm 30')) return 'under-dash';
  if (text.includes('dakota digital') || text.includes('vhx')) return 'dash-c';
  if (text.includes('head unit') || text.includes('radio')) return 'dash-c';
  if (text.includes('turn signal switch')) return 'dash-l';
  if (text.includes('hazard')) return 'dash-l';
  if (text.includes('alternator')) return 'acc-drive';
  if (text.includes('battery')) return 'eng-lower-r';
  if (text.includes('starter')) return 'eng-lower-r';
  if (text.includes('reverse light switch') || text.includes('brake light switch')) return 'dash-cl';
  if (text.includes('ignition switch')) return 'dash-l';
  if (text.includes('dimmer switch')) return 'dash-l';
  if (text.includes('wiper')) return 'grommet-h2';
  if (text.includes('e-stopp controller')) return 'dash-c';

  // Headlights / front
  if (text.includes('headlight left') || text.includes('horn left') || text.includes('front left')) return 'front-l';
  if (text.includes('headlight right') || text.includes('horn right') || text.includes('front right')) return 'front-r';
  if (text.includes('headlight') || text.includes('horn')) return 'front-c';
  if (text.includes('radiator') || text.includes('fan ')) return 'front-c';

  // Rear sub-routing by component/circuit patterns
  if (zone === 'rear' || text.includes('rear-') || text.includes('trailer-') || text.includes('audio-')) {
    if (text.includes('tail') && text.includes('left')) return 'R5L';
    if (text.includes('tail') && text.includes('right')) return 'R5R';
    if (text.includes('marker') && text.includes('left')) return 'R5L';
    if (text.includes('marker') && text.includes('right')) return 'R5R';
    if (text.includes('backup') && text.includes('left')) return 'R5L';
    if (text.includes('backup') && text.includes('right')) return 'R5R';
    if (text.includes('fuel pump') || text.includes('fuel sender') || text.includes('fuel level')) return 'R3';
    if (text.includes('e-stopp actuator') || text.includes('e-brake')) return 'R2';
    if (text.includes('trailer') || text.includes('7-way')) return 'R6';
    if (text.includes('license')) return 'R6';
    if (text.includes('camera')) return 'R6';
    if (text.includes('3rd brake') || text.includes('third brake')) return 'R6';
    if (text.includes('cargo') || text.includes('bed light')) return 'R6';
    if (text.includes('light bar')) return 'R6';
    if (text.includes('amp') || text.includes('kicker') || text.includes('speaker') || text.includes('subwoofer')) return 'R7';
    if (text.includes('audio') || text.includes('rca')) return 'R7';
    if (text.includes('12v') || text.includes('usb')) return 'R4';
    if (text.includes('roof')) return 'R4';
    if (text.includes('spare')) return 'R4';
    if (text.includes('data')) return 'R4';
    return 'R4'; // default rear
  }

  // Door routing
  if (zone === 'doors' || text.includes('door')) {
    if (text.includes('left') || text.includes('driver')) return 'door-l';
    if (text.includes('right') || text.includes('passenger')) return 'door-r';
    return 'door-l';
  }

  // Engine sub-routing
  if (zone === 'engine_bay') {
    if (text.includes('coil') || text.includes('injector') || text.includes('sensor')) return 'eng-mid-r';
    if (text.includes('intake') || text.includes('throttle')) return 'eng-center';
    if (text.includes('oil') || text.includes('coolant temp')) return 'eng-lower-r';
    return 'eng-center';
  }

  // Zone-based fallback
  const zoneNodes: Record<string, string> = {
    engine_bay: 'eng-center',
    firewall: 'grommet-h2',
    dash: 'dash-c',
    doors: 'door-l',
    rear: 'R4',
    underbody: 'grommet-h4',
    roof: 'R4',
  };

  return zoneNodes[zone ?? ''] ?? 'dash-c';
}

interface RouteResult {
  segmentWireCounts: Map<string, number>;
  wireRoutes: Map<number, string[]>; // wire index → path through nodes
}

function computeSegmentCountsDijkstra(wires: WireData[], graph: HarnessGraph): RouteResult {
  const adj = buildAdjacency(graph);
  const counts = new Map<string, number>();
  const routes = new Map<number, string[]>();

  for (let i = 0; i < wires.length; i++) {
    const w = wires[i];
    const fromNode = findNodeForComponent(
      w.from_component, w.from_location_zone, w.circuit_code, w.routing_description,
    );
    const toNode = findNodeForComponent(
      w.to_component, w.to_location_zone, w.circuit_code, w.routing_description,
    );

    if (fromNode === toNode) {
      routes.set(i, [fromNode]);
      continue;
    }

    const path = shortestPath(adj, fromNode, toNode);
    if (!path) {
      routes.set(i, [fromNode, toNode]);
      continue;
    }

    routes.set(i, path);
    for (let j = 0; j < path.length - 1; j++) {
      const key = segmentKey(path[j], path[j + 1]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  // Ground wires (chassis ground) don't route through the trunk — they terminate locally.
  // Filter them out of segment counts (they inflate trunk numbers).
  // A ground wire has from or to matching "Chassis Ground" and length <= 2ft.
  for (let i = 0; i < wires.length; i++) {
    const w = wires[i];
    const isGround = (w.to_component ?? '').toLowerCase().includes('chassis ground')
      || (w.from_component ?? '').toLowerCase().includes('chassis ground');
    if (isGround && (w.length_typical_ft ?? 99) <= 2) {
      // Remove this wire's contribution from segment counts
      const path = routes.get(i);
      if (path) {
        for (let j = 0; j < path.length - 1; j++) {
          const key = segmentKey(path[j], path[j + 1]);
          const current = counts.get(key) ?? 0;
          if (current > 0) counts.set(key, current - 1);
        }
      }
    }
  }

  return { segmentWireCounts: counts, wireRoutes: routes };
}

// Get wires that route through a specific node (from Dijkstra paths)
function getWiresForNodeFromRoutes(
  nodeId: string,
  wires: WireData[],
  wireRoutes: Map<number, string[]>,
): WireData[] {
  const result: WireData[] = [];
  for (let i = 0; i < wires.length; i++) {
    const path = wireRoutes.get(i);
    if (path && path.includes(nodeId)) {
      result.push(wires[i]);
    }
  }
  return result;
}
