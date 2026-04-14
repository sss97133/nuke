// WiringWorkspace.tsx — DATA tab: reference image viewer + sortable device table
// Now accepts cross-view selection state from WiringPlan parent.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useOverlayCompute } from './useOverlayCompute';
import type { ManifestDevice, WireSpec } from './overlayCompute';
import { WIRE_TIERS } from './harnessConstants';
import type { DRCDeviceResult } from './useDRC';

// ── Colors ───────────────────────────────────────────────────────────
const C = {
  bg: '#1e1e2e',
  surface: '#282840',
  surfaceHover: '#333355',
  surfaceSelected: '#3d3d6b',
  border: '#444466',
  borderLight: '#555577',
  text: '#e0e0e8',
  textDim: '#8888aa',
  textMuted: '#666688',
  accent: '#6c8cff',
  white: '#ffffff',
  engine_bay: '#e05555',
  dash: '#5588dd',
  rear: '#44aa77',
  doors: '#9966cc',
  underbody: '#cc8833',
  firewall: '#cc6699',
  interior: '#44bbcc',
  roof: '#669977',
};

const ZONE_ACCENT: Record<string, string> = {
  engine_bay: C.engine_bay, dash: C.dash, rear: C.rear, doors: C.doors,
  underbody: C.underbody, firewall: C.firewall, interior: C.interior, roof: C.roof,
};

const DRC_COLORS: Record<string, string> = {
  pass: '#22aa44', warn: '#ccaa00', fail: '#cc2222',
};

// ── Reference Images ─────────────────────────────────────────────────
const REFERENCE_IMAGES: { label: string; file: string }[] = [
  { label: 'Harness Routing Plan', file: 'K5_harness_routing_plan_view.png' },
  { label: 'Engine Bay LS3', file: 'K5_engine_bay_ls3_standalone.png' },
  { label: 'K5 Blazer 4-View', file: 'K5_blazer_1977_4view_orthographic.gif' },
  { label: 'Body Orthographic', file: 'K5_body_orthographic_rc4wd.jpg' },
  { label: 'GM Forward Lamp Wiring', file: 'elec_8A14_forward_lamp_wiring_CK_front.png' },
  { label: 'GM Rear Lighting', file: 'elec_8_12_rear_lighting_CK_all_models.png' },
  { label: 'GM Underbody Wiring', file: 'elec_8A16_auxiliary_wiring_underbody.png' },
  { label: 'Engine Compartment Wiring', file: 'engine_6D16D_compartment_wiring_3quarter.png' },
  { label: 'Headlamp / Front Lighting', file: 'elec_8_9_onvehicle_headlamp_front_lighting.png' },
  { label: 'Clearance / Interior Lamps', file: 'elec_8_14_clearance_lamps_light_switch_interior.png' },
  { label: 'Cab Clearance Service', file: 'elec_8A_onvehicle_service_cab_clearance.png' },
];

// ── Component ────────────────────────────────────────────────────────
interface Props {
  initialDevices: ManifestDevice[];
  vehicleId?: string;
  // Cross-view state from WiringPlan
  selectedDeviceId: string | null;
  selectedDeviceIds: Set<string>;
  selectedWireId: number | null;
  drcMap: Map<string, DRCDeviceResult>;
  onDeviceClick: (id: string, e: React.MouseEvent) => void;
  onWireClick: (wireNumber: number) => void;
}

export function WiringWorkspace({
  initialDevices, vehicleId,
  selectedDeviceId, selectedDeviceIds, selectedWireId, drcMap,
  onDeviceClick, onWireClick,
}: Props) {
  const { devices, result } = useOverlayCompute(initialDevices);

  const [filter, setFilter] = useState('');
  const [activeImage, setActiveImage] = useState(0);

  // Image pan/zoom
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Pan/zoom handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale(s => Math.max(0.15, Math.min(5, s * (e.deltaY < 0 ? 1.1 : 0.91))));
  }, []);
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }, [offset]);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setOffset({ x: panStart.current.ox + (e.clientX - panStart.current.x), y: panStart.current.oy + (e.clientY - panStart.current.y) });
  }, [isPanning]);
  const handleMouseUp = useCallback(() => setIsPanning(false), []);
  const resetView = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

  // Table sort
  const [sortKey, setSortKey] = useState<string>('device_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const sortedDevices = useMemo(() => {
    let list = [...devices];
    if (filter) {
      const f = filter.toLowerCase();
      list = list.filter(d =>
        d.device_name.toLowerCase().includes(f) ||
        (d.device_category || '').toLowerCase().includes(f) ||
        (d.location_zone || '').toLowerCase().includes(f),
      );
    }
    return list.sort((a, b) => {
      const av = (a as any)[sortKey] ?? '';
      const bv = (b as any)[sortKey] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [devices, filter, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Arial, sans-serif', background: C.bg, color: C.text }}>
      {/* ── Two-Panel Layout ──────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {/* ═══ LEFT: Reference Image Viewer ═══ */}
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${C.border}` }}>
          {/* Image selector bar */}
          <div style={{ display: 'flex', gap: 4, padding: '6px 12px', borderBottom: `1px solid ${C.border}`, background: C.surface, overflowX: 'auto', flexShrink: 0, alignItems: 'center' }}>
            <select
              value={activeImage}
              onChange={e => { setActiveImage(Number(e.target.value)); resetView(); }}
              style={{
                fontSize: '8px', fontWeight: 700, fontFamily: 'Arial', textTransform: 'uppercase', letterSpacing: '0.5px',
                padding: '3px 6px', border: `1px solid ${C.border}`, background: C.bg, color: C.text, cursor: 'pointer', flex: 1,
              }}
            >
              {REFERENCE_IMAGES.map((img, i) => (
                <option key={img.file} value={i}>{img.label}</option>
              ))}
            </select>
            <button onClick={resetView} style={{
              fontSize: '7px', fontFamily: 'Arial', fontWeight: 700, padding: '3px 8px',
              background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.3px',
            }}>RESET</button>
            <span style={{ fontSize: '7px', fontFamily: '"Courier New"', fontWeight: 700, color: C.textDim }}>
              {Math.round(scale * 100)}%
            </span>
          </div>

          {/* Image viewport */}
          <div
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              flex: 1, overflow: 'hidden', cursor: isPanning ? 'grabbing' : 'grab',
              display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111',
            }}
          >
            <img
              src={`/wiring/${REFERENCE_IMAGES[activeImage].file}`}
              alt={REFERENCE_IMAGES[activeImage].label}
              draggable={false}
              style={{
                maxWidth: 'none',
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transformOrigin: 'center center',
                transition: isPanning ? 'none' : 'transform 0.1s ease-out',
                userSelect: 'none',
              }}
            />
          </div>
        </div>

        {/* ═══ RIGHT: Device Table ═══ */}
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column' }}>
          {/* Filter bar */}
          <div style={{ padding: '6px 12px', borderBottom: `1px solid ${C.border}`, background: C.surface }}>
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="FILTER DEVICES..."
              style={{
                width: '100%', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                padding: '4px 8px', border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: 'none', fontFamily: 'Arial',
              }}
            />
          </div>

          {/* Table */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px', fontFamily: 'Arial' }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 2, background: C.surface, borderBottom: `2px solid ${C.accent}` }}>
                  {/* DRC column */}
                  <th style={{
                    padding: '6px 4px', textAlign: 'center', fontSize: '7px',
                    fontWeight: 700, color: C.textDim, letterSpacing: '0.5px', width: 28,
                  }}>
                    DRC
                  </th>
                  {[
                    ['NAME', 'device_name'],
                    ['ZONE', 'location_zone'],
                    ['CATEGORY', 'device_category'],
                    ['AWG', 'wire_gauge_recommended'],
                    ['AMPS', 'power_draw_amps'],
                    ['PART #', 'part_number'],
                    ['COST', 'price'],
                  ].map(([lbl, key]) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      style={{
                        padding: '6px 8px', textAlign: 'left', cursor: 'pointer',
                        fontSize: '7px', textTransform: 'uppercase', letterSpacing: '0.5px',
                        fontWeight: 700, color: sortKey === key ? C.accent : C.textDim, userSelect: 'none',
                      }}
                    >
                      {lbl}{sortKey === key ? (sortDir === 'asc' ? ' \u25B4' : ' \u25BE') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDevices.map(d => {
                  const wire = result.wires.find(w => w.to === d.device_name);
                  const isSelected = d.id === selectedDeviceId || selectedDeviceIds.has(d.id);
                  const isDimmed = (selectedWireId != null) && !wire?.wireNumber;
                  const isWireHighlighted = selectedWireId != null && wire?.wireNumber === selectedWireId;
                  const drc = drcMap.get(d.id);
                  return (
                    <tr
                      key={d.id}
                      onClick={(e) => onDeviceClick(d.id, e)}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? C.surfaceSelected : undefined,
                        borderBottom: `1px solid ${C.border}`,
                        opacity: isDimmed && !isWireHighlighted ? 0.3 : 1,
                        transition: 'opacity 200ms',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.surfaceHover; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = ''; }}
                    >
                      {/* DRC dot */}
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        {drc && (
                          <span style={{
                            display: 'inline-block', width: 6, height: 6,
                            background: DRC_COLORS[drc.severity],
                          }} title={drc.rules.filter(r => r.severity !== 'pass').map(r => r.message).join('\n') || 'All checks pass'} />
                        )}
                      </td>
                      <td style={{ padding: '5px 8px', fontWeight: 700 }}>
                        {d.device_name}
                        {isWireHighlighted && (
                          <span style={{ marginLeft: 6, fontSize: '7px', color: '#00ddff', fontWeight: 700 }}>NET</span>
                        )}
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={{
                          fontSize: '7px', fontWeight: 700, padding: '1px 5px',
                          background: ZONE_ACCENT[d.location_zone || ''] || C.textMuted,
                          color: '#fff', textTransform: 'uppercase', letterSpacing: '0.3px',
                        }}>
                          {(d.location_zone || '\u2014').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '5px 8px', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                        {d.device_category}
                      </td>
                      <td style={{ padding: '5px 8px', fontFamily: '"Courier New"', fontWeight: 700, textAlign: 'right', color: C.textDim }}>
                        {wire?.gauge || d.wire_gauge_recommended || '\u2014'}
                      </td>
                      <td style={{ padding: '5px 8px', fontFamily: '"Courier New"', fontWeight: 700, textAlign: 'right' }}>
                        {d.power_draw_amps != null ? `${d.power_draw_amps}A` : '\u2014'}
                      </td>
                      <td style={{ padding: '5px 8px', fontFamily: '"Courier New"', fontSize: '8px', color: C.textDim }}>
                        {d.part_number || '\u2014'}
                      </td>
                      <td style={{ padding: '5px 8px', fontFamily: '"Courier New"', fontWeight: 700, textAlign: 'right' }}>
                        {d.price ? `$${d.price.toLocaleString()}` : '\u2014'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
