// WiringWorkspace.tsx — Two-panel data view: reference image + device table
// Left: zoomable reference images (harness plan, GM diagrams)
// Right: sortable/filterable device table from vehicle_build_manifest

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useOverlayCompute } from './useOverlayCompute';
import type { ManifestDevice, WireSpec } from './overlayCompute';
import { WiringDetailPanel } from './WiringDetailPanel';
import { useWireCatalog, type WireTier } from './useWireCatalog';
import { useComponentLibrary } from './useComponentLibrary';
import { WIRE_TIERS } from './harnessConstants';

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
}

export function WiringWorkspace({ initialDevices, vehicleId }: Props) {
  const { devices, result, terminations } = useOverlayCompute(initialDevices);
  const [tier, setTier] = useState<WireTier>('professional');
  const { products, gaugeConversions } = useWireCatalog(tier);
  const { findComponent } = useComponentLibrary();

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [activeImage, setActiveImage] = useState(0);

  // Image pan/zoom
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Selected device data
  const selectedDevice = useMemo(() => selectedDeviceId ? devices.find(d => d.id === selectedDeviceId) : null, [devices, selectedDeviceId]);
  const selectedWire = useMemo(() => selectedDevice ? result.wires.find(w => w.to === selectedDevice.device_name) : undefined, [selectedDevice, result.wires]);
  const selectedPdmChannel = useMemo(() => selectedDevice ? result.pdmChannels.find(ch => ch.devices.includes(selectedDevice.device_name)) : undefined, [selectedDevice, result.pdmChannels]);
  const selectedTermination = useMemo(() => selectedDevice ? terminations.find(t => t.deviceName === selectedDevice.device_name) : undefined, [selectedDevice, terminations]);
  const selectedLibraryComponent = useMemo(() => selectedDevice ? findComponent(selectedDevice.manufacturer || '', selectedDevice.part_number || '') : undefined, [selectedDevice, findComponent]);
  const selectedWireProduct = useMemo(() => selectedWire ? products.find(p => p.gauge_awg === selectedWire.gauge) : undefined, [selectedWire, products]);
  const selectedGaugeInfo = useMemo(() => selectedWire ? gaugeConversions.find(g => g.awg === selectedWire.gauge) : undefined, [selectedWire, gaugeConversions]);

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

  // Stats
  const totalCost = result.partsCost + result.recommendedConfig.totalCost;
  const totalLength = result.wires.reduce((s, w) => s + w.lengthFt, 0);

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
      {/* ── Status Bar ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: 36, background: C.surface, borderBottom: `1px solid ${C.border}`, gap: 2, flexShrink: 0 }}>
        <Stat label="DEVICES" value={String(devices.length)} />
        <Stat label="WIRES" value={String(result.wireCount)} />
        <Stat label="LENGTH" value={`${Math.round(totalLength)}ft`} />
        <Stat label="ECU" value={result.recommendedConfig.ecu.model} />
        <Stat label="PDM" value={result.recommendedConfig.pdm.config} />
        <Stat label="COST" value={`$${Math.round(totalCost).toLocaleString()}`} />

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '8px', color: C.textDim, fontWeight: 700, letterSpacing: '0.5px' }}>TIER</span>
          <select value={tier} onChange={e => setTier(e.target.value as WireTier)} style={{
            fontSize: '8px', fontFamily: '"Courier New", monospace', fontWeight: 700,
            padding: '2px 4px', border: `1px solid ${C.border}`, background: C.bg, color: C.text, cursor: 'pointer',
          }}>
            {WIRE_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

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
                  const isSelected = d.id === selectedDeviceId;
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedDeviceId(isSelected ? null : d.id)}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? C.surfaceSelected : undefined,
                        borderBottom: `1px solid ${C.border}`,
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.surfaceHover; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = ''; }}
                    >
                      <td style={{ padding: '5px 8px', fontWeight: 700 }}>{d.device_name}</td>
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

        {/* ── Detail Panel (overlay on right) ──────────────────────── */}
        {selectedDevice && (
          <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', zIndex: 10 }}>
            <WiringDetailPanel
              device={selectedDevice}
              wire={selectedWire}
              pdmChannel={selectedPdmChannel}
              ecuModel={result.recommendedConfig.ecu.model}
              termination={selectedTermination}
              onClose={() => setSelectedDeviceId(null)}
              onSavePosition={() => {}}
              positionDirty={false}
              libraryComponent={selectedLibraryComponent}
              wireProduct={selectedWireProduct}
              gaugeInfo={selectedGaugeInfo}
              tierLabel={WIRE_TIERS.find(t => t.value === tier)?.label}
              allWires={result.wires}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat chip ────────────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginRight: 6 }}>
      <span style={{ fontSize: '7px', fontWeight: 700, letterSpacing: '0.5px', color: C.textMuted }}>{label}</span>
      <span style={{ fontSize: '10px', fontFamily: '"Courier New", monospace', fontWeight: 700, color: C.text }}>{value}</span>
    </div>
  );
}
