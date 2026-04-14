// DeviceDetailPanel.tsx — THE one detail panel used by ALL views.
// Slides in from the right (320px). Shows everything about a device:
// product photo, procurement, electrical specs, every pin/wire,
// connector face link, related parts with system total cost.

import React, { useMemo } from 'react';
import type { ManifestDevice, WireSpec, OverlayResult, PDMChannel } from './overlayCompute';

// ── Design tokens ─────────────────────────────────────────────────────
const C = {
  bg: '#1a1a2e',
  surface: '#1f1f35',
  elevated: '#252540',
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  active: '#00ddff',
  pass: '#22c55e',
  warn: '#eab308',
  fail: '#ef4444',
} as const;

const ZONE_LABELS: Record<string, string> = {
  engine_bay: 'ENGINE BAY',
  firewall: 'FIREWALL',
  dash: 'DASH',
  doors: 'DOORS',
  rear: 'REAR',
  underbody: 'UNDERBODY',
  roof: 'ROOF',
};

// ── Pin map row type ──────────────────────────────────────────────────
interface PinMapRow {
  pin_number: string;
  pin_function: string;
  signal_type: string;
  max_current_amps: number;
  default_wire_color: string;
  default_wire_gauge_awg: number;
  connected_to_device: string;
  connected_to_pin: string;
  requires_shielding: boolean;
  connector_name: string;
  device_model: string;
}

interface PartsReceptionRow {
  part_number: string;
  quantity_ordered: number;
  quantity_received: number;
  status: string;
  unit_cost: number;
  total_cost: number;
  order_date: string;
  actual_delivery_date: string;
}

interface WorkOrderPartRow {
  part_name: string;
  part_number: string;
  brand: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  status: string;
  image_url: string;
}

// ── Props ─────────────────────────────────────────────────────────────
interface Props {
  device: ManifestDevice | null;
  wire: WireSpec | null;
  result: OverlayResult;
  devices: ManifestDevice[];
  pinMaps: Record<string, unknown[]>;
  partsReception: unknown[];
  workOrderParts: unknown[];
  zoneColors: Record<string, string>;
  onClose: () => void;
  onShowOnFormboard: (deviceId: string) => void;
}

export function DeviceDetailPanel({
  device, wire, result, devices, pinMaps, partsReception, workOrderParts,
  zoneColors, onClose, onShowOnFormboard,
}: Props) {
  // ── Device wires from overlay ──
  const deviceWires = useMemo(() => {
    if (!device) return [];
    return result.wires.filter(w => w.to === device.device_name || w.from.includes(device.device_name));
  }, [device, result.wires]);

  // ── PDM channel for this device ──
  const pdmChannel = useMemo((): PDMChannel | null => {
    if (!device) return null;
    return result.pdmChannels.find(ch => ch.devices.includes(device.device_name)) ?? null;
  }, [device, result.pdmChannels]);

  // ── Pin maps for this device ──
  const devicePins = useMemo((): PinMapRow[] => {
    if (!device?.model_number) return [];
    return (pinMaps[device.model_number] ?? []) as PinMapRow[];
  }, [device, pinMaps]);

  // ── Procurement data ──
  const procurementData = useMemo((): PartsReceptionRow | null => {
    if (!device?.part_number) return null;
    return (partsReception as PartsReceptionRow[]).find(
      p => p.part_number === device.part_number
    ) ?? null;
  }, [device, partsReception]);

  const workOrderData = useMemo((): WorkOrderPartRow[] => {
    if (!device?.part_number) return [];
    return (workOrderParts as WorkOrderPartRow[]).filter(
      p => p.part_number === device.part_number
    );
  }, [device, workOrderParts]);

  // ── Related devices (same category or same zone) ──
  const relatedDevices = useMemo(() => {
    if (!device) return [];
    return devices.filter(d =>
      d.id !== device.id && (
        d.device_category === device.device_category ||
        d.location_zone === device.location_zone
      )
    ).slice(0, 8);
  }, [device, devices]);

  // ── System total cost (same category) ──
  const systemCost = useMemo(() => {
    if (!device) return 0;
    return devices
      .filter(d => d.device_category === device.device_category)
      .reduce((sum, d) => sum + (d.price || 0), 0);
  }, [device, devices]);

  const categoryLabel = useMemo(() => {
    if (!device) return '';
    return device.device_category.replace(/_/g, ' ').toUpperCase();
  }, [device]);

  // ── Slide in/out ──
  const isOpen = device !== null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 320,
        background: C.bg,
        borderLeft: `2px solid ${C.border}`,
        transform: isOpen ? 'translateX(0)' : 'translateX(320px)',
        transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
    >
      {device && (
        <>
          {/* ── Header ── */}
          <div style={{
            padding: '10px 12px 8px',
            borderBottom: `2px solid ${C.border}`,
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{
                  fontFamily: "'Courier New', monospace", fontSize: 12, fontWeight: 700,
                  color: C.text, lineHeight: 1.2,
                }}>
                  {device.device_name}
                </div>
                <div style={{
                  fontFamily: 'Arial', fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: 1, color: C.label, marginTop: 2,
                }}>
                  {device.manufacturer} {device.model_number}
                </div>
              </div>
              <button onClick={onClose} style={{
                background: 'transparent', border: `1px solid ${C.border}`,
                color: C.muted, cursor: 'pointer', padding: '2px 6px',
                fontFamily: "'Courier New', monospace", fontSize: 10,
              }}>
                ESC
              </button>
            </div>
            {/* Zone chip */}
            {device.location_zone && (
              <span style={{
                display: 'inline-block', marginTop: 4,
                padding: '1px 6px',
                border: `1px solid ${zoneColors[device.location_zone] || C.border}`,
                color: zoneColors[device.location_zone] || C.label,
                fontFamily: 'Arial', fontSize: 7, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {ZONE_LABELS[device.location_zone] || device.location_zone}
              </span>
            )}
          </div>

          {/* ── Scrollable body ── */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            {/* ── Product Photo ── */}
            {device.product_image_url && (
              <div style={{ padding: 12, borderBottom: `1px solid ${C.border}` }}>
                <img
                  src={device.product_image_url}
                  alt={device.device_name}
                  style={{
                    width: '100%', height: 'auto', maxHeight: 200,
                    objectFit: 'contain', background: '#111',
                    border: `1px solid ${C.border}`,
                  }}
                />
              </div>
            )}

            {/* ── Procurement Status ── */}
            <Section title="PROCUREMENT">
              <Row label="PRICE" value={device.price ? `$${device.price.toFixed(2)}` : '—'} color={device.price ? C.text : C.muted} />
              <Row
                label="STATUS"
                value={device.purchased ? 'PURCHASED' : 'NOT PURCHASED'}
                color={device.purchased ? C.pass : C.fail}
              />
              {procurementData && (
                <>
                  <Row label="ORDERED" value={String(procurementData.quantity_ordered)} />
                  <Row label="RECEIVED" value={String(procurementData.quantity_received)}
                    color={procurementData.quantity_received >= procurementData.quantity_ordered ? C.pass : C.warn} />
                  <Row label="PROCUREMENT" value={procurementData.status?.toUpperCase() || '—'} />
                </>
              )}
              {workOrderData.length > 0 && workOrderData.map((wo, i) => (
                <Row key={i} label={`WO PART ${i + 1}`} value={`${wo.quantity}× $${wo.unit_price}`} />
              ))}
            </Section>

            {/* ── Electrical Specs ── */}
            <Section title="ELECTRICAL">
              <Row label="PIN COUNT" value={String(device.pin_count || '—')} />
              <Row label="POWER DRAW" value={device.power_draw_amps ? `${device.power_draw_amps}A` : '—'} />
              <Row label="SIGNAL TYPE" value={device.signal_type?.replace(/_/g, ' ').toUpperCase() || '—'} />
              <Row label="CONNECTOR" value={device.connector_type?.replace(/_/g, ' ').toUpperCase() || '—'} />
              <Row label="WIRE GAUGE" value={device.wire_gauge_recommended ? `${device.wire_gauge_recommended} AWG` : '—'} />
              {device.requires_shielding && <Row label="SHIELDING" value="REQUIRED" color={C.warn} />}
              {device.pdm_controlled && <Row label="PDM CONTROLLED" value="YES" color={C.active} />}
              {pdmChannel && (
                <>
                  <Row label="PDM CHANNEL" value={`OUT${pdmChannel.channel}`} color={C.active} />
                  <Row label="PDM MAX" value={`${pdmChannel.maxAmps}A`} />
                  <Row
                    label="PDM LOAD"
                    value={`${pdmChannel.totalAmps.toFixed(1)}A`}
                    color={pdmChannel.totalAmps > pdmChannel.maxAmps ? C.fail : C.pass}
                  />
                </>
              )}
            </Section>

            {/* ── Wiring ── */}
            {deviceWires.length > 0 && (
              <Section title={`WIRING (${deviceWires.length} WIRES)`}>
                {deviceWires.map(w => (
                  <div key={w.wireNumber} style={{
                    padding: '3px 0',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={valStyle}>W{w.wireNumber}</span>
                      <span style={{ ...valStyle, color: C.active }}>{w.from} → {w.to}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 1 }}>
                      <span style={miniStyle}>{w.gauge} AWG</span>
                      <span style={miniStyle}>{w.color}</span>
                      <span style={miniStyle}>{w.lengthFt.toFixed(1)} FT</span>
                      {w.voltageDrop > 0 && (
                        <span style={{
                          ...miniStyle,
                          color: w.voltageDropPct > 3 ? C.fail : w.voltageDropPct > 2 ? C.warn : C.muted,
                        }}>
                          {w.voltageDropPct.toFixed(1)}% VDROP
                        </span>
                      )}
                      {w.isShielded && <span style={{ ...miniStyle, color: C.warn }}>SH</span>}
                      {w.isTwistedPair && <span style={{ ...miniStyle, color: C.warn }}>TP</span>}
                      {w.fuseRating && <span style={miniStyle}>{w.fuseRating}A FUSE</span>}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {/* ── Pin Map ── */}
            {devicePins.length > 0 && (
              <Section title={`PIN MAP (${devicePins.length} PINS)`}>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['PIN', 'FUNCTION', 'WIRE', 'TO'].map(h => (
                          <th key={h} style={{
                            ...lblStyle, textAlign: 'left', padding: '2px 4px',
                            borderBottom: `1px solid ${C.border}`,
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {devicePins.map((pin, i) => (
                        <tr key={i}>
                          <td style={cellStyle}>{pin.pin_number}</td>
                          <td style={cellStyle}>{pin.pin_function}</td>
                          <td style={cellStyle}>{pin.default_wire_color} {pin.default_wire_gauge_awg}AWG</td>
                          <td style={cellStyle}>{pin.connected_to_device}{pin.connected_to_pin ? `:${pin.connected_to_pin}` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* ── Completion & Status ── */}
            <Section title="STATUS">
              <Row label="DATA COMPLETE" value={`${device.pct_complete || 0}%`}
                color={(device.pct_complete || 0) > 70 ? C.pass : (device.pct_complete || 0) > 40 ? C.warn : C.fail} />
              <Row label="BUILD STATUS" value={device.status?.replace(/_/g, ' ').toUpperCase() || 'NOT STARTED'} />
              {/* Progress bar */}
              <div style={{ margin: '4px 0', height: 3, background: C.border }}>
                <div style={{
                  height: '100%', width: `${device.pct_complete || 0}%`,
                  background: (device.pct_complete || 0) > 70 ? C.pass : (device.pct_complete || 0) > 40 ? C.warn : C.fail,
                }} />
              </div>
            </Section>

            {/* ── Related Devices / System Cost ── */}
            {relatedDevices.length > 0 && (
              <Section title={`RELATED — ${categoryLabel}`}>
                {relatedDevices.map(d => (
                  <div key={d.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '2px 0', cursor: 'pointer',
                  }}>
                    <span style={{ ...valStyle, fontSize: 9 }}>{d.device_name}</span>
                    <span style={{
                      ...valStyle, fontSize: 9,
                      color: d.purchased ? C.pass : C.fail,
                    }}>
                      {d.price ? `$${d.price}` : '—'}
                    </span>
                  </div>
                ))}
                <div style={{
                  marginTop: 6, paddingTop: 4,
                  borderTop: `2px solid ${C.border}`,
                  display: 'flex', justifyContent: 'space-between',
                }}>
                  <span style={lblStyle}>{categoryLabel} TOTAL</span>
                  <span style={{ ...valStyle, color: C.active, fontSize: 11 }}>
                    ${Math.round(systemCost).toLocaleString()}
                  </span>
                </div>
              </Section>
            )}

            {/* ── Actions ── */}
            <div style={{ padding: '8px 12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button
                onClick={() => onShowOnFormboard(device.id)}
                style={actionButtonStyle}
              >
                SHOW ON FORMBOARD
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Section wrapper ─────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '6px 12px 8px', borderBottom: `1px solid ${C.border}` }}>
      <div style={{
        fontFamily: 'Arial', fontSize: 7, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 1,
        color: '#a0a0b0', marginBottom: 4,
        paddingBottom: 2, borderBottom: `1px solid ${C.border}`,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Row (label: value) ──────────────────────────────────────────────
function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
      <span style={lblStyle}>{label}</span>
      <span style={{ ...valStyle, color: color || '#e0e0e8' }}>{value}</span>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────
const lblStyle: React.CSSProperties = {
  fontFamily: 'Arial', fontSize: 8, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.5,
  color: '#a0a0b0',
};

const valStyle: React.CSSProperties = {
  fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700,
  color: '#e0e0e8',
};

const miniStyle: React.CSSProperties = {
  fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700,
  color: '#666680',
};

const cellStyle: React.CSSProperties = {
  ...valStyle, fontSize: 8, padding: '1px 4px',
  borderBottom: '1px solid #333355',
};

const actionButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '2px solid #333355',
  color: '#00ddff',
  padding: '6px 12px',
  fontFamily: 'Arial', fontSize: 8, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 1,
  cursor: 'pointer',
  transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
};
