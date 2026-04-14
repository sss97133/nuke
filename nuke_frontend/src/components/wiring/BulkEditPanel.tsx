// BulkEditPanel.tsx — Bulk property editor for multi-selected devices
// Shows shared/mixed attributes and allows batch updates.

import React, { useCallback, useMemo, useState } from 'react';
import type { ManifestDevice } from './overlayCompute';
import { supabase } from '../../lib/supabase';
import { LOCATION_ZONES } from './harnessConstants';

interface Props {
  devices: ManifestDevice[];
  selectedIds: Set<string>;
  onClose: () => void;
  onUpdate: (ids: string[], updates: Partial<ManifestDevice>) => void;
}

const label: React.CSSProperties = {
  fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
  color: '#8888aa', fontWeight: 700, fontFamily: 'Arial',
};
const val: React.CSSProperties = {
  fontSize: '10px', fontFamily: '"Courier New", monospace', fontWeight: 700,
  color: '#e0e0e8',
};
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '4px 0', borderBottom: '1px solid #2a2a5e', gap: 8,
};

const STATUS_OPTIONS = ['planned', 'ordered', 'received', 'installed', 'wired', 'tested'];

export function BulkEditPanel({ devices, selectedIds, onClose, onUpdate }: Props) {
  const selected = useMemo(() => devices.filter(d => selectedIds.has(d.id)), [devices, selectedIds]);

  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, string | boolean | null>>({});

  // Compute shared/mixed attributes
  const attributes = useMemo(() => {
    const attrs: { key: string; label: string; value: string; isMixed: boolean; options?: string[] }[] = [];

    // Location zone
    const zones = [...new Set(selected.map(d => d.location_zone || ''))];
    attrs.push({
      key: 'location_zone', label: 'ZONE',
      value: zones.length === 1 ? (zones[0] || '—') : '(MIXED)',
      isMixed: zones.length > 1,
      options: LOCATION_ZONES.map(z => z.value),
    });

    // Status
    const statuses = [...new Set(selected.map(d => d.status || ''))];
    attrs.push({
      key: 'status', label: 'STATUS',
      value: statuses.length === 1 ? (statuses[0] || '—') : '(MIXED)',
      isMixed: statuses.length > 1,
      options: STATUS_OPTIONS,
    });

    // Purchased
    const purchased = [...new Set(selected.map(d => d.purchased))];
    attrs.push({
      key: 'purchased', label: 'PURCHASED',
      value: purchased.length === 1 ? (purchased[0] ? 'YES' : 'NO') : '(MIXED)',
      isMixed: purchased.length > 1,
      options: ['true', 'false'],
    });

    // PDM channel group
    const groups = [...new Set(selected.map(d => d.pdm_channel_group || ''))];
    attrs.push({
      key: 'pdm_channel_group', label: 'PDM GROUP',
      value: groups.length === 1 ? (groups[0] || '—') : '(MIXED)',
      isMixed: groups.length > 1,
    });

    return attrs;
  }, [selected]);

  // Shared category summary
  const categories = useMemo(() => [...new Set(selected.map(d => d.device_category))], [selected]);
  const zones = useMemo(() => [...new Set(selected.map(d => d.location_zone))], [selected]);

  const handleApply = useCallback(async () => {
    if (Object.keys(edits).length === 0) return;
    setSaving(true);

    const ids = [...selectedIds];
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(edits)) {
      if (key === 'purchased') {
        updates[key] = value === 'true' || value === true;
      } else {
        updates[key] = value || null;
      }
    }

    // Save to DB
    await supabase
      .from('vehicle_build_manifest')
      .update(updates)
      .in('id', ids);

    // Update local state
    onUpdate(ids, updates as Partial<ManifestDevice>);
    setSaving(false);
    setEdits({});
  }, [edits, selectedIds, onUpdate]);

  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, width: 320, height: '100%', zIndex: 10,
      background: '#1e1e32', borderLeft: '2px solid #2a2a5e',
      overflowY: 'auto', fontFamily: 'Arial, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '2px solid #2a2a5e',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#00ddff' }}>
            BULK EDIT
          </div>
          <div style={{ fontSize: '8px', color: '#8888aa', fontWeight: 700, letterSpacing: '0.5px', marginTop: 2 }}>
            {selected.length} DEVICES SELECTED
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24, height: 24, border: '2px solid #2a2a5e',
            background: 'transparent', cursor: 'pointer', fontSize: '12px',
            fontWeight: 700, color: '#8888aa', lineHeight: '20px', textAlign: 'center',
          }}
        >×</button>
      </div>

      <div style={{ padding: '10px 14px' }}>
        {/* Summary */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...label, fontSize: '7px', letterSpacing: '1px', marginBottom: 4, paddingBottom: 3, borderBottom: '2px solid #e0e0e8' }}>
            SELECTION SUMMARY
          </div>
          <div style={row}>
            <span style={label}>CATEGORIES</span>
            <span style={{ ...val, fontSize: '8px' }}>
              {categories.length === 1 ? categories[0] : `${categories.length} MIXED`}
            </span>
          </div>
          <div style={row}>
            <span style={label}>ZONES</span>
            <span style={{ ...val, fontSize: '8px' }}>
              {zones.length === 1 ? (zones[0] || '—').replace(/_/g, ' ') : `${zones.length} MIXED`}
            </span>
          </div>
          <div style={row}>
            <span style={label}>TOTAL AMPS</span>
            <span style={val}>{selected.reduce((s, d) => s + (d.power_draw_amps || 0), 0).toFixed(1)}A</span>
          </div>
          <div style={row}>
            <span style={label}>TOTAL COST</span>
            <span style={val}>${selected.reduce((s, d) => s + (d.price || 0), 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Editable attributes */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...label, fontSize: '7px', letterSpacing: '1px', marginBottom: 4, paddingBottom: 3, borderBottom: '2px solid #e0e0e8' }}>
            EDIT PROPERTIES
          </div>
          {attributes.map(attr => (
            <div key={attr.key} style={{ ...row, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={label}>{attr.label}</span>
                <span style={{
                  ...val, fontSize: '8px',
                  color: attr.isMixed ? '#ccaa00' : '#e0e0e8',
                }}>
                  {edits[attr.key] != null ? String(edits[attr.key]) : attr.value}
                </span>
              </div>
              {attr.options ? (
                <select
                  value={edits[attr.key] as string ?? ''}
                  onChange={e => {
                    if (e.target.value) {
                      setEdits(prev => ({ ...prev, [attr.key]: e.target.value }));
                    } else {
                      setEdits(prev => {
                        const next = { ...prev };
                        delete next[attr.key];
                        return next;
                      });
                    }
                  }}
                  style={{
                    fontSize: '8px', fontFamily: '"Courier New"', fontWeight: 700,
                    padding: '3px 4px', border: '2px solid #2a2a5e',
                    background: '#1a1a2e', color: '#e0e0e8', cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}
                >
                  <option value="">— SET ALL —</option>
                  {attr.options.map(o => (
                    <option key={o} value={o}>
                      {attr.key === 'purchased' ? (o === 'true' ? 'YES' : 'NO') : o.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder={`SET ${attr.label} FOR ALL`}
                  value={edits[attr.key] as string ?? ''}
                  onChange={e => setEdits(prev => ({ ...prev, [attr.key]: e.target.value }))}
                  style={{
                    fontSize: '8px', fontFamily: '"Courier New"', fontWeight: 700,
                    padding: '3px 6px', border: '2px solid #2a2a5e',
                    background: '#1a1a2e', color: '#e0e0e8', outline: 'none',
                    textTransform: 'uppercase',
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Apply button */}
        {Object.keys(edits).length > 0 && (
          <button
            onClick={handleApply}
            disabled={saving}
            style={{
              width: '100%', padding: '8px',
              fontSize: '9px', fontWeight: 700, fontFamily: 'Arial',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              border: '2px solid #00ddff',
              background: saving ? '#2a2a5e' : '#00ddff',
              color: saving ? '#8888aa' : '#1a1a2e',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saving ? 'SAVING...' : `APPLY TO ${selected.length} DEVICES`}
          </button>
        )}

        {/* Selected device list */}
        <div style={{ marginTop: 12 }}>
          <div style={{ ...label, fontSize: '7px', letterSpacing: '1px', marginBottom: 4, paddingBottom: 3, borderBottom: '2px solid #e0e0e8' }}>
            SELECTED DEVICES
          </div>
          {selected.map(d => (
            <div key={d.id} style={{
              padding: '3px 0', borderBottom: '1px solid #252540',
              fontSize: '8px', color: '#e0e0e8', fontWeight: 700,
            }}>
              {d.device_name}
              <span style={{ color: '#555577', fontWeight: 400, marginLeft: 6, fontFamily: '"Courier New"', fontSize: '7px' }}>
                {d.device_category}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
