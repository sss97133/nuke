// WiringWorkspace.tsx — Full-viewport SVG canvas for wiring layout
// Every electrical device positioned on a vehicle silhouette.
// Click → detail panel. Drag → reposition. Wire lines between endpoints.

import React, { useCallback, useRef, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useOverlayCompute } from './useOverlayCompute';
import type { ManifestDevice, WireSpec } from './overlayCompute';
import { WiringDeviceNode } from './WiringDeviceNode';
import { WiringWirePath } from './WiringWirePath';
import { WiringDetailPanel } from './WiringDetailPanel';
import { SILHOUETTES, type VehicleSilhouette, type VehicleLayer } from './vehicleSilhouettes';
import { placeLabels, type WireLabelRequest, type LabelPlacement } from './labelPlacer';
import { routeWires, type RouteRequest, type RoutedWire } from './orthogonalRouter';
import { computeTerminations, type TerminationRecord } from './terminationCompute';

// ── Constants ──────────────────────────────────────────────────────────
// Canvas matches the silhouette viewBox (1000x1000 for top-down, 1000x550 for side)
const CANVAS_INTERNAL_W = 1000;
const CANVAS_INTERNAL_H = 1000;

// ── Schematic Layout Computation ───────────────────────────────────────
// Groups devices into logical columns by electrical system
const SCHEMATIC_COLUMNS: { label: string; match: (d: ManifestDevice) => boolean; xPct: number }[] = [
  { label: 'POWER', xPct: 10, match: d => d.signal_type === 'power_source' || d.signal_type === 'ground' || d.device_name.includes('Battery') || d.device_name.includes('Alternator') || d.device_name.includes('Ground') },
  { label: 'ECU + SENSORS', xPct: 30, match: d => d.device_category === 'ecu' || d.device_category === 'sensors' || d.device_name.includes('ECU') || d.device_name.includes('PDM') || d.device_name.includes('CAN') },
  { label: 'ENGINE', xPct: 50, match: d => d.device_name.includes('Injector') || d.device_name.includes('Coil') || d.device_name.includes('Throttle') || d.device_name.includes('Pump') || d.device_category === 'engine_mgmt' },
  { label: 'BODY', xPct: 70, match: d => d.device_category === 'lighting' || d.device_category === 'body' || d.device_category === 'brakes' || d.device_category === 'drivetrain' || d.device_category === 'fuel' },
  { label: 'INTERIOR', xPct: 90, match: d => d.device_category === 'interior' || d.device_category === 'audio' || d.device_category === 'accessories' || d.device_category === 'safety' },
];

function computeSchematicPositions(devices: ManifestDevice[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const columnCounts: number[] = SCHEMATIC_COLUMNS.map(() => 0);

  for (const d of devices) {
    let colIdx = SCHEMATIC_COLUMNS.length - 1; // default to last column
    for (let i = 0; i < SCHEMATIC_COLUMNS.length; i++) {
      if (SCHEMATIC_COLUMNS[i].match(d)) { colIdx = i; break; }
    }
    const row = columnCounts[colIdx]++;
    const ySpacing = Math.min(5, 90 / Math.max(1, devices.filter(dd => {
      for (let i2 = 0; i2 < SCHEMATIC_COLUMNS.length; i2++) {
        if (SCHEMATIC_COLUMNS[i2].match(dd)) return i2 === colIdx;
      }
      return colIdx === SCHEMATIC_COLUMNS.length - 1;
    }).length));
    positions.set(d.id, {
      x: SCHEMATIC_COLUMNS[colIdx].xPct,
      y: 5 + row * ySpacing,
    });
  }
  return positions;
}

// ── Opacity Slider ────────────────────────────────────────────────────
function OpacitySlider({ label, value, color, onChange }: {
  label: string; value: number; color?: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 80 }}>
      <span style={{
        fontSize: '7px', textTransform: 'uppercase', letterSpacing: '0.5px',
        color: color || 'var(--text-secondary, #666)', fontWeight: 700, fontFamily: 'Arial',
        width: 28, textAlign: 'right',
      }}>{label}</span>
      <input
        type="range" min={0} max={100} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: 48, height: 3, appearance: 'none', background: 'var(--border, #bdbdbd)',
          outline: 'none', cursor: 'pointer',
        }}
      />
      <span style={{
        fontSize: '7px', fontFamily: '"Courier New", monospace', fontWeight: 700,
        color: 'var(--text-secondary, #666)', width: 20,
      }}>{value}%</span>
    </div>
  );
}

// ── Status Bar ─────────────────────────────────────────────────────────
function StatusBar({
  result, view, onToggleView, wiresVisible, onToggleWires, zonesVisible, onToggleZones,
  layers, layerOpacities, onLayerOpacity,
  layoutMode, onToggleLayout,
}: {
  result: ReturnType<typeof useOverlayCompute>['result'];
  view: string;
  onToggleView: () => void;
  wiresVisible: boolean;
  onToggleWires: () => void;
  zonesVisible: boolean;
  onToggleZones: () => void;
  layers: VehicleLayer[];
  layerOpacities: Map<string, number>;
  onLayerOpacity: (id: string, value: number) => void;
  layoutMode: 'vehicle' | 'schematic';
  onToggleLayout: () => void;
}) {
  const lb = { fontSize: '8px', textTransform: 'uppercase' as const, color: 'var(--text-secondary, #666)', letterSpacing: '0.5px' };
  const vl = { fontWeight: 700, fontSize: '11px', fontFamily: '"Courier New", monospace' };
  const btn = (active: boolean, color?: string): React.CSSProperties => ({
    fontSize: '8px', fontFamily: 'Arial', fontWeight: 700, padding: '3px 8px',
    border: `2px solid ${active ? (color || 'var(--text, #2a2a2a)') : 'var(--border, #bdbdbd)'}`,
    background: active ? (color || 'var(--text, #2a2a2a)') : 'var(--surface, #ebebeb)',
    color: active ? 'var(--bg, #f5f5f5)' : 'var(--text, #2a2a2a)',
    cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
  });

  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
      padding: '6px 12px',
      background: 'var(--surface, #ebebeb)',
      borderBottom: '2px solid var(--text, #2a2a2a)',
      fontFamily: 'Arial, sans-serif',
    }}>
      <div><span style={lb}>DEVICES </span><span style={vl}>{result.deviceCount}</span></div>
      <div><span style={lb}>WIRES </span><span style={vl}>{result.wireCount}</span></div>
      <div><span style={lb}>ECU </span><span style={vl}>{result.recommendedConfig.ecu.model}</span></div>
      <div><span style={lb}>PDM </span><span style={vl}>{result.recommendedConfig.pdm.config}</span></div>
      <div><span style={lb}>COST </span><span style={vl}>${Math.round(result.partsCost + result.recommendedConfig.totalCost).toLocaleString()}</span></div>
      {result.warnings.length > 0 && (
        <div style={{ color: 'var(--warning, #b05a00)' }}>
          <span style={lb}>WARNINGS </span><span style={vl}>{result.warnings.length}</span>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Layer opacity sliders */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...lb, marginRight: 2 }}>LAYERS</span>
        {layers.map(layer => (
          <OpacitySlider
            key={layer.id}
            label={layer.shortLabel}
            value={layerOpacities.get(layer.id) ?? Math.round((layer.defaultOpacity ?? 1) * 100)}
            color={layer.color}
            onChange={v => onLayerOpacity(layer.id, v)}
          />
        ))}
        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
        <button onClick={onToggleZones} style={btn(zonesVisible)}>ZONES</button>
        <button onClick={onToggleWires} style={btn(wiresVisible)}>WIRES</button>
      </div>

      <button onClick={onToggleLayout} style={btn(layoutMode === 'schematic')}>
        {layoutMode === 'vehicle' ? 'SCHEMATIC' : 'VEHICLE'}
      </button>
      <button onClick={onToggleView} style={btn(false)}>{view === 'top-down' ? 'SIDE' : 'TOP'}</button>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────
interface Props {
  initialDevices: ManifestDevice[];
  vehicleId?: string;
}

export function WiringWorkspace({ initialDevices, vehicleId }: Props) {
  const {
    devices, result, updateDevice,
    ecuModel, pdmChannels,
  } = useOverlayCompute(initialDevices);

  // ── View State ──
  const [viewId, setViewId] = useState<'top-down' | 'side'>('top-down');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedWireNum, setSelectedWireNum] = useState<number | null>(null);
  const [wiresVisible, setWiresVisible] = useState(true);
  const [zonesVisible, setZonesVisible] = useState(true);
  const [dirtyPositions, setDirtyPositions] = useState<Set<string>>(new Set());
  const [layoutMode, setLayoutMode] = useState<'vehicle' | 'schematic'>('vehicle');

  // ── Layer Opacities (0-100) ──
  const silhouetteForLayers = SILHOUETTES[viewId];
  const [layerOpacities, setLayerOpacities] = useState<Map<string, number>>(() => {
    const initial = new Map<string, number>();
    silhouetteForLayers.layers.forEach(l => {
      // All layers start at their defined opacity; defaultVisible just picks a reasonable initial
      initial.set(l.id, l.defaultVisible
        ? Math.round((l.defaultOpacity ?? 0.5) * 100)
        : Math.round((l.defaultOpacity ?? 0.15) * 100));
    });
    return initial;
  });
  const handleLayerOpacity = useCallback((id: string, value: number) => {
    setLayerOpacities(prev => new Map(prev).set(id, value));
  }, []);

  // ── Schematic positions (view-only, computed) ──
  const schematicPositions = useMemo(() =>
    layoutMode === 'schematic' ? computeSchematicPositions(devices) : null,
  [layoutMode, devices]);

  // Effective device positions: schematic overrides spatial
  const effectiveDevices = useMemo(() => {
    if (!schematicPositions) return devices;
    return devices.map(d => {
      const pos = schematicPositions.get(d.id);
      return pos ? { ...d, pos_x_pct: pos.x, pos_y_pct: pos.y } : d;
    });
  }, [devices, schematicPositions]);

  // ── Batch wire routing (channel grouping + parallel offsets) ──
  const { routedWireMap, wireLabels } = useMemo(() => {
    const ecuDev = effectiveDevices.find(d =>
      d.device_category === 'ecu' || d.device_name.toLowerCase().includes('ecu'));
    const pdmDev = effectiveDevices.find(d =>
      d.device_category === 'pdm' || d.device_name.toLowerCase().includes('pdm'));

    const routeRequests: RouteRequest[] = [];
    const wireGaugeMap = new Map<number, { gauge: number; color: string; name: string }>();

    for (const wire of result.wires) {
      const toDevice = effectiveDevices.find(d => d.device_name === wire.to || d.device_name === wire.label);
      if (!toDevice) continue;
      const toX = (toDevice.pos_x_pct || 50) / 100 * CANVAS_INTERNAL_W;
      const toY = (toDevice.pos_y_pct || 50) / 100 * CANVAS_INTERNAL_H;
      const srcDevice = wire.from.startsWith('PDM') ? pdmDev : ecuDev;
      let fromX = srcDevice ? (srcDevice.pos_x_pct || 50) / 100 * CANVAS_INTERNAL_W : toX;
      let fromY = srcDevice ? (srcDevice.pos_y_pct || 50) / 100 * CANVAS_INTERNAL_H : toY;
      if (fromX === toX && fromY === toY) continue;
      // Per-wire jitter at source to spread wires from same hub (±30px range)
      const jitterScale = 2;
      const jitterIdx = wire.wireNumber - 1;
      const jitterCount = result.wires.length;
      fromX += (jitterIdx - jitterCount / 2) * jitterScale;
      fromY += ((jitterIdx % 7) - 3) * jitterScale;
      routeRequests.push({ wireNumber: wire.wireNumber, fromX, fromY, toX, toY, gauge: wire.gauge });
      wireGaugeMap.set(wire.wireNumber, { gauge: wire.gauge, color: wire.color, name: wire.to });
    }

    // Batch route with channel grouping and parallel offsets
    const routed = routeWires(routeRequests, [], 4);
    const routedMap = new Map<number, RoutedWire>();
    const labelRequests: WireLabelRequest[] = [];
    for (const r of routed) {
      routedMap.set(r.wireNumber, r);
      const info = wireGaugeMap.get(r.wireNumber);
      if (info && r.segments.length > 0) {
        labelRequests.push({ wireNumber: r.wireNumber, segments: r.segments, gauge: info.gauge, color: info.color, deviceName: info.name });
      }
    }
    const placements = placeLabels(labelRequests);
    const labelMap = new Map<number, LabelPlacement>();
    for (const p of placements) labelMap.set(p.wireNumber, p);
    return { routedWireMap: routedMap, wireLabels: labelMap };
  }, [result.wires, effectiveDevices]);

  // ── Termination records ──
  const terminations = useMemo(
    () => computeTerminations(result.wires, devices),
    [result.wires, devices],
  );
  const terminationMap = useMemo(() => {
    const m = new Map<number, TerminationRecord>();
    terminations.forEach(t => m.set(t.wireNumber, t));
    return m;
  }, [terminations]);

  // ── Viewport (pan/zoom) ──
  // Initial zoom to fit vehicle in viewport with padding
  const [viewport, setViewport] = useState({ x: 40, y: 20, zoom: 0.7 });
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ startX: number; startY: number; vpX: number; vpY: number } | null>(null);

  const silhouette = SILHOUETTES[viewId];

  // ── Device Maps ──
  const deviceMap = useMemo(() => {
    const m = new Map<string, ManifestDevice>();
    devices.forEach(d => m.set(d.id, d));
    return m;
  }, [devices]);

  // Build wire → device lookup. ECU and PDM are virtual nodes.
  // Find the ECU device and PDM device from the manifest (use effectiveDevices for position)
  const ecuDevice = useMemo(() => effectiveDevices.find(d =>
    d.device_category === 'ecu' || d.device_name.toLowerCase().includes('ecu')
  ), [effectiveDevices]);
  const pdmDevice = useMemo(() => effectiveDevices.find(d =>
    d.device_category === 'pdm' || d.device_name.toLowerCase().includes('pdm')
  ), [effectiveDevices]);

  // ── Wire for selected device ──
  const selectedDevice = selectedDeviceId ? deviceMap.get(selectedDeviceId) : undefined;
  const selectedWire = selectedDevice
    ? result.wires.find(w => w.to === selectedDevice.device_name || w.label === selectedDevice.device_name)
    : selectedWireNum != null
      ? result.wires.find(w => w.wireNumber === selectedWireNum)
      : undefined;

  // If a wire is selected, show the target device in the detail panel
  const detailDevice = selectedDevice || (selectedWire
    ? devices.find(d => d.device_name === selectedWire.to || d.device_name === selectedWire.label)
    : undefined);

  const detailPdmChannel = detailDevice
    ? result.pdmChannels.find(c => c.devices.includes(detailDevice.device_name))
    : undefined;

  // Termination record for selected wire
  const detailTermination = selectedWire
    ? terminationMap.get(selectedWire.wireNumber)
    : detailDevice
      ? terminationMap.get(result.wires.find(w => w.to === detailDevice.device_name || w.label === detailDevice.device_name)?.wireNumber ?? -1)
      : undefined;

  // ── URL swap handler ──
  const handleUrlSwap = useCallback(async (url: string) => {
    if (!detailDevice || !vehicleId) return;
    try {
      const { data } = await supabase
        .from('catalog_parts')
        .select('id, name, part_number, price_current, product_image_url')
        .or(`product_url.eq.${url},source_url.eq.${url}`)
        .limit(1)
        .single();
      if (data) {
        updateDevice(detailDevice.id, {
          part_number: data.part_number || detailDevice.part_number,
          price: data.price_current || detailDevice.price,
          product_image_url: data.product_image_url || detailDevice.product_image_url,
        });
      }
    } catch (e) {
      console.error('URL swap failed:', e);
    }
  }, [detailDevice, vehicleId, updateDevice]);

  // ── Pan Handlers ──
  const handleBgPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as SVGElement;
    // Only start pan on background elements
    if (target.closest('[data-device]') || target.closest('[data-wire]')) return;

    setSelectedDeviceId(null);
    setSelectedWireNum(null);

    panRef.current = {
      startX: e.clientX, startY: e.clientY,
      vpX: viewport.x, vpY: viewport.y,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [viewport]);

  const handleBgPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    setViewport(v => ({ ...v, x: panRef.current!.vpX + dx, y: panRef.current!.vpY + dy }));
  }, []);

  const handleBgPointerUp = useCallback(() => {
    panRef.current = null;
  }, []);

  // ── Zoom ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.97 : 1.03;  // 3% per tick — smooth, single-digit increments
    setViewport(v => {
      const newZoom = Math.max(0.2, Math.min(4, v.zoom * delta));
      return {
        x: mouseX - (mouseX - v.x) * (newZoom / v.zoom),
        y: mouseY - (mouseY - v.y) * (newZoom / v.zoom),
        zoom: newZoom,
      };
    });
  }, []);

  // ── Device Selection ──
  const handleSelectDevice = useCallback((id: string) => {
    setSelectedDeviceId(id);
    setSelectedWireNum(null);
  }, []);

  // ── Wire Selection ──
  const handleSelectWire = useCallback((wireNum: number) => {
    setSelectedWireNum(wireNum);
    setSelectedDeviceId(null);
  }, []);

  // ── Device Drag ──
  const handleDragEnd = useCallback((id: string, xPct: number, yPct: number) => {
    updateDevice(id, { pos_x_pct: xPct, pos_y_pct: yPct });
    setDirtyPositions(prev => new Set(prev).add(id));
  }, [updateDevice]);

  // ── Save Position to DB ──
  const handleSavePosition = useCallback(async () => {
    if (!detailDevice || !vehicleId) return;
    try {
      await supabase
        .from('vehicle_build_manifest')
        .update({
          pos_x_pct: detailDevice.pos_x_pct,
          pos_y_pct: detailDevice.pos_y_pct,
        })
        .eq('id', detailDevice.id);
      setDirtyPositions(prev => {
        const next = new Set(prev);
        next.delete(detailDevice.id);
        return next;
      });
    } catch (e) {
      console.error('Failed to save position:', e);
    }
  }, [detailDevice, vehicleId]);

  // ── Toggle View ──
  const toggleView = useCallback(() => {
    setViewId(v => v === 'top-down' ? 'side' : 'top-down');
  }, []);

  const cursorStyle = panRef.current ? 'grabbing' : 'grab';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: 'Arial, sans-serif', color: 'var(--text, #2a2a2a)',
    }}>
      {/* Status Bar */}
      <StatusBar
        result={result}
        view={viewId}
        onToggleView={toggleView}
        wiresVisible={wiresVisible}
        onToggleWires={() => setWiresVisible(v => !v)}
        zonesVisible={zonesVisible}
        onToggleZones={() => setZonesVisible(v => !v)}
        layers={silhouette.layers}
        layerOpacities={layerOpacities}
        onLayerOpacity={handleLayerOpacity}
        layoutMode={layoutMode}
        onToggleLayout={() => setLayoutMode(m => m === 'vehicle' ? 'schematic' : 'vehicle')}
      />

      {/* Main area: Canvas + Detail Panel */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* SVG Canvas */}
        <svg
          ref={svgRef}
          style={{
            flex: 1, display: 'block',
            background: 'var(--bg, #f5f5f5)',
            cursor: cursorStyle,
            minWidth: 0,
          }}
          onPointerDown={handleBgPointerDown}
          onPointerMove={handleBgPointerMove}
          onPointerUp={handleBgPointerUp}
          onWheel={handleWheel}
        >
          {/* Grid pattern */}
          <defs>
            <pattern
              id="wiring-grid"
              width={20 * viewport.zoom}
              height={20 * viewport.zoom}
              patternUnits="userSpaceOnUse"
              x={viewport.x % (20 * viewport.zoom)}
              y={viewport.y % (20 * viewport.zoom)}
            >
              <circle cx={1} cy={1} r={0.5} fill="var(--border, #bdbdbd)" opacity={0.15} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wiring-grid)" pointerEvents="none" />

          {/* Transformed group */}
          <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>

            {/* Vehicle Layers (rendered in zIndex order, opacity from sliders) */}
            {[...silhouette.layers]
              .sort((a, b) => a.zIndex - b.zIndex)
              .map(layer => {
                const opacity = (layerOpacities.get(layer.id) ?? 0) / 100;
                if (opacity <= 0) return null;
                return (
                  <g key={layer.id} opacity={opacity} style={{ pointerEvents: 'none' }}>
                    {layer.paths.map((p, i) => (
                      <path key={i} d={p.d}
                        fill={p.fill || 'none'}
                        stroke={p.stroke || layer.color}
                        strokeWidth={p.strokeWidth || 1.5}
                      />
                    ))}
                  </g>
                );
              })}

            {/* Zone overlays */}
            {zonesVisible && silhouette.zones.map(zone => (
              <g key={zone.id}>
                <path
                  d={zone.path}
                  fill={zone.color}
                  opacity={0.05}
                  stroke={zone.color}
                  strokeWidth={0.5}
                  strokeDasharray="4 4"
                  style={{ pointerEvents: 'none' }}
                />
                {/* Zone label — positioned at center of zone bounds */}
                <text
                  x={(zone.xMin + zone.xMax) / 2 / 100 * CANVAS_INTERNAL_W}
                  y={(zone.yMin + zone.yMax) / 2 / 100 * CANVAS_INTERNAL_H}
                  style={{
                    fontSize: '10px', fontFamily: 'Arial', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '1px',
                    fill: zone.color, opacity: 0.3, userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                  textAnchor="middle"
                >
                  {zone.label}
                </text>
              </g>
            ))}

            {/* Schematic column headers (only in schematic mode) */}
            {layoutMode === 'schematic' && SCHEMATIC_COLUMNS.map(col => (
              <text key={col.label}
                x={col.xPct / 100 * CANVAS_INTERNAL_W}
                y={20}
                textAnchor="middle"
                style={{
                  fontSize: '8px', fontFamily: 'Arial', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '1px',
                  fill: 'var(--text-secondary, #666)', opacity: 0.6,
                  userSelect: 'none', pointerEvents: 'none',
                }}
              >{col.label}</text>
            ))}

            {/* Wire paths (behind devices) — using batch-routed segments */}
            {wiresVisible && result.wires.map(wire => {
              const routed = routedWireMap.get(wire.wireNumber);
              if (!routed || routed.segments.length === 0) return null;
              return (
                <WiringWirePath
                  key={wire.wireNumber}
                  wire={wire}
                  segments={routed.segments}
                  zoom={viewport.zoom}
                  isSelected={selectedWireNum === wire.wireNumber}
                  onSelect={handleSelectWire}
                  label={wireLabels.get(wire.wireNumber)}
                />
              );
            })}

            {/* Device nodes */}
            {effectiveDevices.map(device => {
              const wire = result.wires.find(w => w.to === device.device_name || w.label === device.device_name);
              return (
                <WiringDeviceNode
                  key={device.id}
                  device={device}
                  wire={wire}
                  isSelected={selectedDeviceId === device.id}
                  canvasWidth={CANVAS_INTERNAL_W}
                  canvasHeight={CANVAS_INTERNAL_H}
                  canvasZoom={viewport.zoom}
                  onSelect={handleSelectDevice}
                  onDragEnd={layoutMode === 'vehicle' ? handleDragEnd : () => {}}
                />
              );
            })}
          </g>

          {/* View label */}
          <text x={8} y={16} style={{
            fontSize: '8px', fontFamily: 'Arial', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '1px',
            fill: 'var(--text-muted, #999)', userSelect: 'none', opacity: 0.5,
          }}>
            {silhouette.label} — {devices.length} DEVICES
          </text>
        </svg>

        {/* Detail Panel */}
        {detailDevice && (
          <WiringDetailPanel
            device={detailDevice}
            wire={selectedWire}
            pdmChannel={detailPdmChannel}
            ecuModel={ecuModel}
            termination={detailTermination}
            onClose={() => { setSelectedDeviceId(null); setSelectedWireNum(null); }}
            onSavePosition={handleSavePosition}
            onUrlSwap={handleUrlSwap}
            positionDirty={dirtyPositions.has(detailDevice.id)}
          />
        )}
      </div>
    </div>
  );
}

