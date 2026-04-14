// DataView.tsx — HTML device table with sorting, filtering, zone chips
// Sub-tabs: DEVICES | BOM | CUT LIST. Export buttons.

import React, { useState, useMemo, useCallback } from 'react';
import type { ManifestDevice, OverlayResult } from './overlayCompute';
import { generateBOM, bomToText } from './generateBOM';
import { generateCutList, cutListToText } from './generateCutList';
import type { BOMDocument } from './generateBOM';
import type { CutListDocument } from './generateCutList';

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

const ZONE_COLORS: Record<string, string> = {
  engine_bay: '#cc2222',
  firewall: '#cc6600',
  dash: '#2266cc',
  doors: '#8822cc',
  rear: '#22aa44',
  underbody: '#666666',
};

type SubTab = 'devices' | 'bom' | 'cutlist';
type SortKey = 'device_name' | 'location_zone' | 'device_category' | 'wire_gauge_recommended' | 'power_draw_amps' | 'part_number' | 'price' | 'status';
type SortDir = 'asc' | 'desc';

interface DRCDeviceResult {
  severity: 'pass' | 'warn' | 'fail';
  rules: { ruleId: string; label: string; message: string; severity: 'pass' | 'warn' | 'fail' }[];
}

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
  drcMap?: Map<string, DRCDeviceResult>;
  overlay: {
    devices: ManifestDevice[];
    result: OverlayResult;
    terminations: unknown[];
    terminationSummary: { total: number; ready: number; notReady: number; readyPct: number };
  };
}

export function DataView({
  devices, result, selectedDeviceId,
  onDeviceClick, overlay, drcMap,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('devices');
  const [filter, setFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('device_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // ── Filtered + sorted devices ──
  const filteredDevices = useMemo(() => {
    let filtered = devices;

    if (zoneFilter) {
      filtered = filtered.filter(d => d.location_zone === zoneFilter);
    }

    if (filter.trim()) {
      const q = filter.toLowerCase();
      filtered = filtered.filter(d =>
        d.device_name.toLowerCase().includes(q) ||
        (d.manufacturer || '').toLowerCase().includes(q) ||
        (d.part_number || '').toLowerCase().includes(q) ||
        (d.device_category || '').toLowerCase().includes(q)
      );
    }

    filtered = [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });

    return filtered;
  }, [devices, filter, zoneFilter, sortKey, sortDir]);

  // ── Zone counts ──
  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of devices) {
      if (d.location_zone) counts[d.location_zone] = (counts[d.location_zone] || 0) + 1;
    }
    return counts;
  }, [devices]);

  // ── BOM / Cut List generation ──
  const bomDoc = useMemo((): BOMDocument | null => {
    if (subTab !== 'bom') return null;
    return generateBOM(result, devices, 65, overlay.terminations as never[]);
  }, [subTab, result, devices, overlay.terminations]);

  const cutListDoc = useMemo((): CutListDocument | null => {
    if (subTab !== 'cutlist') return null;
    return generateCutList(result);
  }, [subTab, result]);

  // ── Column sort handler ──
  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);

  // ── Export handlers ──
  const handleExportBOM = useCallback(() => {
    if (!bomDoc) return;
    const text = bomToText(bomDoc, '1977 K5 Blazer');
    downloadText(text, 'K5_Blazer_BOM.txt');
  }, [bomDoc]);

  const handleExportCutList = useCallback(() => {
    if (!cutListDoc) return;
    const text = cutListToText(cutListDoc, '1977 K5 Blazer');
    downloadText(text, 'K5_Blazer_CutList.txt');
  }, [cutListDoc]);

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: C.bg, overflow: 'hidden',
    }}>
      {/* ── Sub-tabs + filter ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 12px', height: 30,
        borderBottom: `2px solid ${C.border}`,
        flexShrink: 0,
      }}>
        {(['devices', 'bom', 'cutlist'] as SubTab[]).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            style={{
              background: subTab === t ? C.elevated : 'transparent',
              color: subTab === t ? C.active : C.label,
              border: 'none',
              borderBottom: subTab === t ? `2px solid ${C.active}` : '2px solid transparent',
              padding: '0 10px', height: '100%',
              fontFamily: 'Arial', fontSize: 8, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.5,
              cursor: 'pointer',
            }}
          >
            {t === 'cutlist' ? 'CUT LIST' : t.toUpperCase()}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {subTab === 'devices' && (
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="FILTER..."
            style={{
              background: C.surface, border: `1px solid ${C.border}`,
              color: C.text, padding: '3px 8px',
              fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700,
              outline: 'none', width: 180,
            }}
          />
        )}

        {subTab === 'bom' && (
          <button onClick={handleExportBOM} style={exportBtnStyle}>EXPORT BOM</button>
        )}
        {subTab === 'cutlist' && (
          <button onClick={handleExportCutList} style={exportBtnStyle}>EXPORT CUT LIST</button>
        )}
      </div>

      {/* ── Zone filter chips ── */}
      {subTab === 'devices' && (
        <div style={{
          display: 'flex', gap: 4, padding: '4px 12px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <button
            onClick={() => setZoneFilter(null)}
            style={{
              ...chipStyle,
              color: !zoneFilter ? C.active : C.muted,
              borderColor: !zoneFilter ? C.active : C.border,
            }}
          >
            ALL ({devices.length})
          </button>
          {Object.entries(zoneCounts).sort((a, b) => b[1] - a[1]).map(([zone, count]) => (
            <button
              key={zone}
              onClick={() => setZoneFilter(zoneFilter === zone ? null : zone)}
              style={{
                ...chipStyle,
                color: zoneFilter === zone ? ZONE_COLORS[zone] || C.active : C.muted,
                borderColor: zoneFilter === zone ? ZONE_COLORS[zone] || C.active : C.border,
              }}
            >
              {zone.replace(/_/g, ' ').toUpperCase()} ({count})
            </button>
          ))}
        </div>
      )}

      {/* ── Content area ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {subTab === 'devices' && (
          <DeviceTable
            devices={filteredDevices}
            selectedDeviceId={selectedDeviceId}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onDeviceClick={onDeviceClick}
            drcMap={drcMap}
          />
        )}
        {subTab === 'bom' && bomDoc && <BOMView doc={bomDoc} />}
        {subTab === 'cutlist' && cutListDoc && <CutListView doc={cutListDoc} />}
      </div>

      {/* ── Status bar ── */}
      <div style={{
        display: 'flex', gap: 12, padding: '4px 12px',
        borderTop: `2px solid ${C.border}`,
        fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700,
        color: C.muted, flexShrink: 0,
      }}>
        <span>{filteredDevices.length} / {devices.length} DEVICES</span>
        <span>PURCHASED: {devices.filter(d => d.purchased).length}/{devices.length}</span>
        <span>TOTAL: ${Math.round(result.partsCost).toLocaleString()}</span>
        <span>COMPLETION: {result.avgCompletion}%</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Device Table
// ══════════════════════════════════════════════════════════════════════

const COLUMNS: { key: SortKey | 'drc'; label: string; width?: number }[] = [
  { key: 'drc', label: 'DRC', width: 30 },
  { key: 'device_name', label: 'NAME', width: 200 },
  { key: 'location_zone', label: 'ZONE', width: 90 },
  { key: 'device_category', label: 'CATEGORY', width: 100 },
  { key: 'wire_gauge_recommended', label: 'AWG', width: 50 },
  { key: 'power_draw_amps', label: 'AMPS', width: 60 },
  { key: 'part_number', label: 'PART #', width: 120 },
  { key: 'price', label: 'COST', width: 70 },
  { key: 'status', label: 'STATUS', width: 80 },
];

const DRC_COLORS = { pass: '#22c55e', warn: '#eab308', fail: '#ef4444' } as const;

function DeviceTable({ devices, selectedDeviceId, sortKey, sortDir, onSort, onDeviceClick, drcMap }: {
  devices: ManifestDevice[];
  selectedDeviceId: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onDeviceClick: (id: string, shiftKey?: boolean) => void;
  drcMap?: Map<string, DRCDeviceResult>;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {COLUMNS.map(col => (
            <th
              key={col.key}
              onClick={() => col.key !== 'drc' && onSort(col.key as SortKey)}
              style={{
                ...thStyle,
                width: col.width,
                cursor: col.key !== 'drc' ? 'pointer' : 'default',
                color: sortKey === col.key ? C.active : C.label,
                position: 'sticky',
                top: 0,
                background: C.bg,
                zIndex: 1,
              }}
            >
              {col.label}
              {sortKey === col.key && (
                <span style={{ marginLeft: 2 }}>{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {devices.map(d => {
          const isSelected = d.id === selectedDeviceId;
          const drcResult = drcMap?.get(d.id);
          const drcColor = drcResult ? DRC_COLORS[drcResult.severity] : undefined;
          return (
            <tr
              key={d.id}
              onClick={(e) => onDeviceClick(d.id, e.shiftKey)}
              style={{
                cursor: 'pointer',
                background: isSelected ? C.active + '15' : 'transparent',
                borderLeft: isSelected ? `2px solid ${C.active}` : '2px solid transparent',
              }}
            >
              <td style={{ ...tdStyle, textAlign: 'center', width: 30 }}>
                {drcColor && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6, height: 6,
                      background: drcColor,
                    }}
                    title={drcResult?.rules.filter(r => r.severity !== 'pass').map(r => r.message).join('; ') || 'All checks pass'}
                  />
                )}
              </td>
              <td style={tdStyle}>{d.device_name}</td>
              <td style={tdStyle}>
                {d.location_zone && (
                  <span style={{
                    padding: '0 4px',
                    border: `1px solid ${ZONE_COLORS[d.location_zone] || C.border}`,
                    color: ZONE_COLORS[d.location_zone] || C.muted,
                    fontFamily: 'Arial', fontSize: 7, fontWeight: 700,
                    textTransform: 'uppercase',
                  }}>
                    {d.location_zone.replace(/_/g, ' ')}
                  </span>
                )}
              </td>
              <td style={{ ...tdStyle, color: C.muted }}>{d.device_category?.replace(/_/g, ' ')}</td>
              <td style={tdStyle}>{d.wire_gauge_recommended || '—'}</td>
              <td style={tdStyle}>{d.power_draw_amps || '—'}</td>
              <td style={{ ...tdStyle, fontSize: 8 }}>{d.part_number || '—'}</td>
              <td style={{
                ...tdStyle,
                color: d.purchased ? C.pass : d.price ? C.fail : C.muted,
              }}>
                {d.price ? `$${d.price}` : '—'}
              </td>
              <td style={{
                ...tdStyle,
                color: d.status === 'validated' ? C.pass : d.status === 'wired' ? C.active : d.status === 'in_progress' ? C.warn : C.muted,
              }}>
                {d.status?.replace(/_/g, ' ').toUpperCase() || '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ══════════════════════════════════════════════════════════════════════
// BOM View
// ══════════════════════════════════════════════════════════════════════

function BOMView({ doc }: { doc: BOMDocument }) {
  return (
    <div style={{ padding: 12 }}>
      {doc.sections.map(section => (
        <div key={section.section} style={{ marginBottom: 16 }}>
          <div style={{
            fontFamily: 'Arial', fontSize: 8, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 1,
            color: C.active, paddingBottom: 4,
            borderBottom: `2px solid ${C.border}`, marginBottom: 4,
          }}>
            {section.section} ({section.itemCount} ITEMS — ${Math.round(section.subtotal).toLocaleString()})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['PART', 'P/N', 'QTY', 'UNIT', 'TOTAL', 'STATUS'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.items.map((item, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{item.partName}</td>
                  <td style={{ ...tdStyle, fontSize: 8 }}>{item.partNumber || '—'}</td>
                  <td style={tdStyle}>{item.quantity}</td>
                  <td style={tdStyle}>{item.unitPrice ? `$${item.unitPrice.toFixed(2)}` : '—'}</td>
                  <td style={tdStyle}>{item.totalPrice ? `$${item.totalPrice.toFixed(2)}` : '—'}</td>
                  <td style={{
                    ...tdStyle,
                    color: item.purchased ? C.pass : C.fail,
                  }}>
                    {item.purchased ? 'PURCHASED' : 'NEEDED'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Totals */}
      <div style={{
        padding: '8px 0', borderTop: `2px solid ${C.border}`,
        display: 'flex', gap: 16,
        fontFamily: "'Courier New', monospace", fontSize: 11, fontWeight: 700,
      }}>
        <span style={{ color: C.label }}>PARTS: <span style={{ color: C.text }}>${Math.round(doc.totalCost).toLocaleString()}</span></span>
        <span style={{ color: C.label }}>LABOR: <span style={{ color: C.text }}>${Math.round(doc.estimatedLaborCost).toLocaleString()}</span></span>
        <span style={{ color: C.active }}>TOTAL: ${Math.round(doc.grandTotal).toLocaleString()}</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Cut List View
// ══════════════════════════════════════════════════════════════════════

function CutListView({ doc }: { doc: CutListDocument }) {
  return (
    <div style={{ padding: 12 }}>
      {doc.sections.map(section => (
        <div key={section.section} style={{ marginBottom: 16 }}>
          <div style={{
            fontFamily: 'Arial', fontSize: 8, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 1,
            color: C.active, paddingBottom: 4,
            borderBottom: `2px solid ${C.border}`, marginBottom: 4,
          }}>
            {section.section} ({section.wires.length} WIRES — {section.totalLengthFt.toFixed(1)} FT)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['#', 'LABEL', 'FROM', 'TO', 'SPEC', 'COLOR', 'LENGTH'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.wires.map(w => (
                <tr key={w.wireNumber}>
                  <td style={{ ...tdStyle, color: C.muted }}>W{w.wireNumber}</td>
                  <td style={tdStyle}>{w.label}</td>
                  <td style={{ ...tdStyle, fontSize: 8 }}>{w.from}</td>
                  <td style={{ ...tdStyle, fontSize: 8 }}>{w.to}</td>
                  <td style={tdStyle}>{w.spec}</td>
                  <td style={tdStyle}>{w.color}</td>
                  <td style={tdStyle}>{w.lengthFt.toFixed(1)} ft</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Purchase summary */}
      {doc.purchaseSummary.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            fontFamily: 'Arial', fontSize: 8, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 1,
            color: C.label, paddingBottom: 4,
            borderBottom: `2px solid ${C.border}`, marginBottom: 4,
          }}>
            WIRE PURCHASE SUMMARY
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['GAUGE', 'TOTAL', 'SPOOL', 'COLORS'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.purchaseSummary.map(s => (
                <tr key={s.gauge}>
                  <td style={tdStyle}>{s.gauge} AWG</td>
                  <td style={tdStyle}>{s.totalLengthFt.toFixed(1)} ft</td>
                  <td style={tdStyle}>{s.suggestedSpoolFt} ft spool</td>
                  <td style={{ ...tdStyle, fontSize: 8 }}>{s.colors.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Styles ──────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  fontFamily: 'Arial', fontSize: 7, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.5,
  color: '#a0a0b0',
  padding: '4px 6px',
  textAlign: 'left',
  borderBottom: '2px solid #333355',
};

const tdStyle: React.CSSProperties = {
  fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700,
  color: '#e0e0e8',
  padding: '3px 6px',
  borderBottom: '1px solid #333355',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 200,
};

const chipStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #333355',
  padding: '1px 6px',
  fontFamily: 'Arial', fontSize: 7, fontWeight: 700,
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const exportBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '2px solid #333355',
  color: '#00ddff',
  padding: '3px 10px',
  fontFamily: 'Arial', fontSize: 8, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.5,
  cursor: 'pointer',
};
