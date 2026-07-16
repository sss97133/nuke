// SchematicView.tsx — SVG schematics, 5 sub-sheets
// Power Distribution | Engine Management | Lighting | Body Electronics | Audio
// LEFT-TO-RIGHT signal flow, Manhattan wire routing, dark/light toggle.

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { ManifestDevice, WireSpec, OverlayResult } from './overlayCompute';

// ── Design tokens ─────────────────────────────────────────────────────
const C = {
  bg: '#1a1a2e',
  bgLight: '#f0f0f4',
  surface: '#1f1f35',
  surfaceLight: '#ffffff',
  text: '#e0e0e8',
  textLight: '#222222',
  label: '#a0a0b0',
  labelLight: '#666666',
  muted: '#666680',
  border: '#333355',
  borderLight: '#cccccc',
  active: '#00ddff',
  wire: '#555577',
  wireLight: '#999999',
};

const ZONE_COLORS: Record<string, string> = {
  engine_bay: '#cc2222',
  firewall: '#cc6600',
  dash: '#2266cc',
  doors: '#8822cc',
  rear: '#22aa44',
  underbody: '#666666',
};

// ── Sheet definitions ─────────────────────────────────────────────────
type SheetId = 'power' | 'engine' | 'lighting' | 'body' | 'audio';

interface SheetDef {
  id: SheetId;
  label: string;
  categories: string[];
}

const SHEETS: SheetDef[] = [
  { id: 'power', label: 'POWER DISTRIBUTION', categories: ['power_distribution', 'power_source', 'grounds'] },
  { id: 'engine', label: 'ENGINE MANAGEMENT', categories: ['engine_mgmt', 'sensors', 'fuel_system'] },
  { id: 'lighting', label: 'LIGHTING', categories: ['lighting'] },
  { id: 'body', label: 'BODY ELECTRONICS', categories: ['body', 'doors', 'hvac', 'security', 'gauges'] },
  { id: 'audio', label: 'AUDIO', categories: ['audio'] },
];

interface CameraState { x: number; y: number; zoom: number; }

interface Props {
  devices: ManifestDevice[];
  result: OverlayResult;
  selectedDeviceId: string | null;
  selectedDeviceIds: Set<string>;
  selectedWireId: number | null;
  onDeviceClick: (id: string, shiftKey?: boolean) => void;
  onWireClick: (wireNumber: number) => void;
  onDeselect: () => void;
  fitRequested: number;
  zoneColors: Record<string, string>;
  cameraRef: CameraState;
}

// Layout constants
const SHEET_W = 1400;
const SHEET_H = 900;
const MARGIN = 60;
const DEVICE_H = 40;
const DEVICE_MIN_W = 120;
const DEVICE_PIN_W = 8;

export function SchematicView({
  devices, result, selectedDeviceId, selectedWireId,
  onDeviceClick, onWireClick, onDeselect, fitRequested, cameraRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeSheet, setActiveSheet] = useState<SheetId>('power');
  const [darkMode, setDarkMode] = useState(true);

  // Camera state
  const [cam, setCam] = useState<CameraState>({ ...cameraRef });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const spaceDown = useRef(false);

  // Sync camera back to parent ref
  useEffect(() => {
    cameraRef.x = cam.x;
    cameraRef.y = cam.y;
    cameraRef.zoom = cam.zoom;
  }, [cam, cameraRef]);

  const theme = darkMode ? {
    bg: C.bg, surface: C.surface, text: C.text, label: C.label,
    border: C.border, wire: C.wire, muted: C.muted,
  } : {
    bg: C.bgLight, surface: C.surfaceLight, text: C.textLight, label: C.labelLight,
    border: C.borderLight, wire: C.wireLight, muted: '#aaa',
  };

  // ── Filter devices for active sheet ──
  const sheetDef = SHEETS.find(s => s.id === activeSheet)!;

  const sheetDevices = useMemo(() => {
    // For engine sheet, include sensors connected to ECU
    if (activeSheet === 'engine') {
      return devices.filter(d =>
        sheetDef.categories.includes(d.device_category) ||
        d.signal_type === 'analog_5v' || d.signal_type === 'analog_temp' ||
        d.signal_type === 'piezoelectric' || d.signal_type === 'wideband_lambda' ||
        d.signal_type === 'h_bridge_motor' || d.signal_type === 'can_bus' ||
        d.device_name.startsWith('Fuel Injector') || d.device_name.startsWith('Ignition Coil')
      );
    }
    return devices.filter(d => sheetDef.categories.includes(d.device_category));
  }, [devices, sheetDef, activeSheet]);

  // ── Layout: left-to-right signal flow ──
  const layout = useMemo(() => {
    // Group into columns: Source (left) → Distribution (center) → Load (right)
    const sources: ManifestDevice[] = [];
    const distribution: ManifestDevice[] = [];
    const loads: ManifestDevice[] = [];
    const grounds: ManifestDevice[] = [];

    for (const d of sheetDevices) {
      if (d.signal_type === 'ground' || d.device_name.includes('Ground')) {
        grounds.push(d);
      } else if (d.signal_type === 'power_source' || d.device_name.includes('Battery') || d.device_name.includes('Alternator')) {
        sources.push(d);
      } else if (d.device_name.includes('PDM') || d.device_name.includes('Fuse') || d.device_name.includes('Relay')) {
        distribution.push(d);
      } else if (activeSheet === 'engine' && (d.device_name.includes('ECU') || d.device_name.includes('M130') || d.device_name.includes('M150'))) {
        distribution.push(d);
      } else {
        loads.push(d);
      }
    }

    // If no sources/distribution, treat first few as sources
    if (sources.length === 0 && distribution.length === 0) {
      // PDM is always a source in non-power sheets
      const pdm = devices.find(d => d.device_name.includes('PDM30'));
      if (pdm) sources.push(pdm);
    }

    const positions = new Map<string, { x: number; y: number; w: number; h: number }>();

    const placeColumn = (col: ManifestDevice[], colX: number) => {
      const spacing = Math.max(DEVICE_H + 10, (SHEET_H - 2 * MARGIN) / Math.max(col.length, 1));
      col.forEach((d, i) => {
        const w = Math.max(DEVICE_MIN_W, (d.pin_count || 2) * DEVICE_PIN_W + 40);
        const y = MARGIN + i * spacing;
        positions.set(d.id, { x: colX, y, w, h: DEVICE_H });
      });
    };

    placeColumn(sources, MARGIN);
    placeColumn(distribution, SHEET_W * 0.35);
    placeColumn(loads, SHEET_W * 0.65);

    // Grounds at bottom
    grounds.forEach((d, i) => {
      const w = Math.max(DEVICE_MIN_W, (d.pin_count || 2) * DEVICE_PIN_W + 40);
      positions.set(d.id, {
        x: MARGIN + i * (w + 20),
        y: SHEET_H - MARGIN - DEVICE_H,
        w, h: DEVICE_H,
      });
    });

    return positions;
  }, [sheetDevices, devices, activeSheet]);

  // ── Wires for this sheet ──
  const sheetWires = useMemo(() => {
    const deviceNames = new Set(sheetDevices.map(d => d.device_name));
    return result.wires.filter(w =>
      deviceNames.has(w.to) || deviceNames.has(w.from.split(':')[0])
    );
  }, [sheetDevices, result.wires]);

  // ── Wire paths (Manhattan routing) ──
  const wirePaths = useMemo(() => {
    const deviceMap = new Map(devices.map(d => [d.device_name, d]));
    const paths: { wire: WireSpec; path: string }[] = [];
    const usedYOffsets = new Map<number, number>(); // track vertical offsets

    for (const w of sheetWires) {
      const fromName = w.from.split(':')[0];
      const fromDev = deviceMap.get(fromName);
      const toDev = deviceMap.get(w.to);
      const fromPos = fromDev ? layout.get(fromDev.id) : null;
      const toPos = toDev ? layout.get(toDev.id) : null;

      if (!fromPos || !toPos) continue;

      // Manhattan: horizontal then vertical
      const x1 = fromPos.x + fromPos.w;
      const y1 = fromPos.y + fromPos.h / 2;
      const x2 = toPos.x;
      const y2 = toPos.y + toPos.h / 2;

      // Add jog offset to avoid overlaps
      const jogKey = Math.round(y1);
      const jogOffset = (usedYOffsets.get(jogKey) || 0) * 3;
      usedYOffsets.set(jogKey, (usedYOffsets.get(jogKey) || 0) + 1);

      const midX = (x1 + x2) / 2 + jogOffset;
      const path = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;

      paths.push({ wire: w, path });
    }

    return paths;
  }, [sheetWires, layout, devices]);

  // ── Scroll-to-zoom ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const factor = e.ctrlKey ? (1 - e.deltaY * 0.01) : (e.deltaY > 0 ? 0.92 : 1.08);
        setCam(prev => {
          const newZoom = Math.max(0.3, Math.min(15, prev.zoom * factor));
          const rect = el.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const scale = newZoom / prev.zoom;
          return {
            zoom: newZoom,
            x: mx - (mx - prev.x) * scale,
            y: my - (my - prev.y) * scale,
          };
        });
      } else {
        setCam(prev => ({ ...prev, x: prev.x - e.deltaX }));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // ── Fit to view ──
  useEffect(() => {
    if (fitRequested <= 0) return;
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const padding = 40;
    const zx = (w - padding * 2) / SHEET_W;
    const zy = (h - padding * 2) / SHEET_H;
    const z = Math.min(zx, zy, 1);
    setCam({ zoom: z, x: (w - SHEET_W * z) / 2, y: (h - SHEET_H * z) / 2 });
  }, [fitRequested]);

  // Initial fit
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const padding = 40;
    const zx = (w - padding * 2) / SHEET_W;
    const zy = (h - padding * 2) / SHEET_H;
    const z = Math.min(zx, zy, 1);
    setCam({ zoom: z, x: (w - SHEET_W * z) / 2, y: (h - SHEET_H * z) / 2 });
  }, []);

  // ── Pan handlers ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || spaceDown.current) {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      setCam(prev => ({
        ...prev,
        x: prev.x + e.clientX - lastMouse.current.x,
        y: prev.y + e.clientY - lastMouse.current.y,
      }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);

  // Space key
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input, textarea')) {
        e.preventDefault(); spaceDown.current = true;
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDown.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: theme.bg, overflow: 'hidden',
    }}>
      {/* ── Sheet tabs + controls ── */}
      <div style={{
        display: 'flex', alignItems: 'center', height: 26,
        padding: '0 8px', borderBottom: `2px solid ${theme.border}`,
        flexShrink: 0,
      }}>
        {SHEETS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSheet(s.id)}
            style={{
              background: activeSheet === s.id ? theme.surface : 'transparent',
              color: activeSheet === s.id ? C.active : theme.label,
              border: 'none',
              borderBottom: activeSheet === s.id ? `2px solid ${C.active}` : '2px solid transparent',
              padding: '0 10px', height: '100%',
              fontFamily: 'Arial', fontSize: 8, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.5,
              cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setDarkMode(!darkMode)}
          style={{
            background: 'transparent', border: `1px solid ${theme.border}`,
            color: theme.label, padding: '2px 8px',
            fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {darkMode ? 'LIGHT' : 'DARK'}
        </button>
        <span style={{
          marginLeft: 8, fontFamily: "'Courier New', monospace",
          fontSize: 8, color: theme.muted,
        }}>
          {sheetDevices.length} DEVICES / {sheetWires.length} WIRES
        </span>
      </div>

      {/* ── SVG viewport ── */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', cursor: spaceDown.current ? 'grab' : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          width="100%"
          height="100%"
          style={{ display: 'block' }}
          onClick={(e) => {
            if ((e.target as SVGElement).tagName === 'svg') onDeselect();
          }}
        >
          <g transform={`translate(${cam.x}, ${cam.y}) scale(${cam.zoom})`}>
            {/* Sheet border */}
            <rect x={0} y={0} width={SHEET_W} height={SHEET_H}
              fill="none" stroke={theme.border} strokeWidth={2} />

            {/* Sheet title */}
            <text x={SHEET_W / 2} y={30}
              fill={theme.label}
              fontFamily="Arial" fontSize={10} fontWeight={700}
              textAnchor="middle" style={{ textTransform: 'uppercase' as const, letterSpacing: 2 }}
            >
              {sheetDef.label}
            </text>

            {/* Column labels */}
            <text x={MARGIN} y={MARGIN - 10} fill={theme.muted}
              fontFamily="Arial" fontSize={7} fontWeight={700}>SOURCE</text>
            <text x={SHEET_W * 0.35} y={MARGIN - 10} fill={theme.muted}
              fontFamily="Arial" fontSize={7} fontWeight={700}>DISTRIBUTION</text>
            <text x={SHEET_W * 0.65} y={MARGIN - 10} fill={theme.muted}
              fontFamily="Arial" fontSize={7} fontWeight={700}>LOAD</text>

            {/* ── Wires ── */}
            {wirePaths.map(({ wire: w, path }) => {
              const isSelected = w.wireNumber === selectedWireId;
              const hasSelection = selectedWireId != null;
              return (
                <path
                  key={w.wireNumber}
                  d={path}
                  fill="none"
                  stroke={isSelected ? C.active : (hasSelection ? theme.wire + '30' : theme.wire)}
                  strokeWidth={isSelected ? 2 : 1}
                  style={{ cursor: 'pointer', transition: 'stroke 200ms' }}
                  onClick={(e) => { e.stopPropagation(); onWireClick(w.wireNumber); }}
                />
              );
            })}

            {/* ── Device boxes ── */}
            {sheetDevices.map(d => {
              const pos = layout.get(d.id);
              if (!pos) return null;
              const isSelected = d.id === selectedDeviceId;
              const hasSelection = selectedDeviceId !== null;
              const zoneColor = ZONE_COLORS[d.location_zone || ''] || '#666';

              return (
                <g key={d.id}
                  style={{
                    cursor: 'pointer',
                    opacity: hasSelection && !isSelected ? 0.4 : 1,
                    transition: 'opacity 200ms',
                  }}
                  onClick={(e) => { e.stopPropagation(); onDeviceClick(d.id, e.shiftKey); }}
                >
                  <rect
                    x={pos.x} y={pos.y} width={pos.w} height={pos.h}
                    fill={isSelected ? C.active + '15' : theme.surface}
                    stroke={isSelected ? C.active : zoneColor}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                  {/* Device name */}
                  <text
                    x={pos.x + pos.w / 2} y={pos.y + 14}
                    fill={isSelected ? C.active : theme.text}
                    fontFamily="Arial" fontSize={8} fontWeight={700}
                    textAnchor="middle"
                    style={{ textTransform: 'uppercase' as const }}
                  >
                    {d.device_name.length > 20 ? d.device_name.substring(0, 18) + '...' : d.device_name}
                  </text>
                  {/* Specs line */}
                  <text
                    x={pos.x + pos.w / 2} y={pos.y + 26}
                    fill={theme.muted}
                    fontFamily="'Courier New', monospace" fontSize={7} fontWeight={700}
                    textAnchor="middle"
                  >
                    {[
                      d.pin_count ? `${d.pin_count}P` : null,
                      d.power_draw_amps ? `${d.power_draw_amps}A` : null,
                      d.wire_gauge_recommended ? `${d.wire_gauge_recommended}AWG` : null,
                    ].filter(Boolean).join(' · ')}
                  </text>
                  {/* Pin dots along left and right edges */}
                  {Array.from({ length: Math.min(d.pin_count || 0, 10) }).map((_, i) => {
                    const pinY = pos.y + 8 + i * (pos.h - 16) / Math.max((d.pin_count || 2) - 1, 1);
                    return (
                      <React.Fragment key={i}>
                        <circle cx={pos.x} cy={pinY} r={2} fill={zoneColor} />
                        <circle cx={pos.x + pos.w} cy={pinY} r={2} fill={zoneColor} />
                      </React.Fragment>
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
