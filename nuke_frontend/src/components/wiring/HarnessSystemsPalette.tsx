// HarnessSystemsPalette.tsx — Left panel with draggable electrical system catalog items

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { ElectricalSystemCatalogItem, HarnessEndpoint } from './harnessTypes';
import { SYSTEM_CATEGORY_LABELS } from './harnessConstants';

interface Props {
  designId: string;
  vehicleType: string | null;
  existingEndpoints: HarnessEndpoint[];
  onAddFromCatalog: (item: ElectricalSystemCatalogItem) => void;
  collapsed: boolean;
  onToggle: () => void;
}

export function HarnessSystemsPalette({ designId, vehicleType, existingEndpoints, onAddFromCatalog, collapsed, onToggle }: Props) {
  const [catalog, setCatalog] = useState<ElectricalSystemCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('electrical_system_catalog')
        .select('*')
        .order('sort_order');
      if (data) setCatalog(data);
      setLoading(false);
    }
    load();
  }, []);

  // Filter to items that apply to this vehicle type
  const filtered = useMemo(() => {
    if (!vehicleType) return catalog;
    return catalog.filter(item =>
      item.applies_to_vehicle_types.includes(vehicleType) || item.applies_to_vehicle_types.length === 0
    );
  }, [catalog, vehicleType]);

  // Group by category
  const grouped = useMemo(() => {
    const groups = new Map<string, ElectricalSystemCatalogItem[]>();
    for (const item of filtered) {
      const list = groups.get(item.system_category) || [];
      list.push(item);
      groups.set(item.system_category, list);
    }
    return groups;
  }, [filtered]);

  // Check which items are already in the design (by name match)
  const existingNames = useMemo(() => {
    const s = new Set<string>();
    existingEndpoints.forEach(ep => s.add(ep.name.toLowerCase()));
    return s;
  }, [existingEndpoints]);

  if (collapsed) {
    return (
      <div
        style={{
          width: 24,
          minWidth: 24,
          borderRight: '2px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          writingMode: 'vertical-rl',
          fontSize: '8px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: 'var(--text-muted)',
        }}
        onClick={onToggle}
        title="Expand systems palette"
      >
        SYSTEMS
      </div>
    );
  }

  return (
    <div style={{
      width: 180,
      minWidth: 180,
      borderRight: '2px solid var(--border)',
      background: 'var(--surface)',
      overflow: 'auto',
      padding: '6px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          SYSTEMS
        </span>
        <button
          className="button-win95"
          onClick={onToggle}
          style={{ fontSize: '8px', padding: '1px 4px' }}
          title="Collapse"
        >
          &laquo;
        </button>
      </div>

      {loading && <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Loading...</div>}

      {[...grouped.entries()].map(([category, items]) => (
        <div key={category} style={{ marginBottom: '8px' }}>
          <div style={{
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            letterSpacing: '0.5px',
            marginBottom: '3px',
            borderBottom: '1px solid var(--border)',
            paddingBottom: '2px',
          }}>
            {SYSTEM_CATEGORY_LABELS[category] || category}
          </div>

          {items.map(item => {
            const isPresent = existingNames.has(item.system_name.toLowerCase());
            const isRequired = item.is_required;

            return (
              <div
                key={item.id}
                onClick={() => !isPresent && onAddFromCatalog(item)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 3px',
                  cursor: isPresent ? 'default' : 'pointer',
                  opacity: isPresent ? 0.5 : 1,
                  fontSize: '9px',
                  lineHeight: 1.3,
                }}
                title={isPresent ? 'Already in design' : `Add ${item.system_name} (${item.typical_amperage || '?'}A)`}
              >
                {/* Status indicator */}
                <div style={{
                  width: 6,
                  height: 6,
                  minWidth: 6,
                  background: isPresent
                    ? 'var(--success)'
                    : isRequired
                      ? 'var(--error)'
                      : 'var(--border)',
                }} />

                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {item.system_name}
                </span>

                {item.typical_amperage != null && item.typical_amperage > 0 && (
                  <span style={{
                    fontSize: '7px',
                    fontFamily: '"Courier New", monospace',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.typical_amperage}A
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Legend */}
      <div style={{ marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '7px', color: 'var(--text-muted)', marginBottom: '2px' }}>
          <div style={{ width: 6, height: 6, background: 'var(--success)' }} /> IN DESIGN
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '7px', color: 'var(--text-muted)', marginBottom: '2px' }}>
          <div style={{ width: 6, height: 6, background: 'var(--error)' }} /> REQUIRED (MISSING)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '7px', color: 'var(--text-muted)' }}>
          <div style={{ width: 6, height: 6, background: 'var(--border)' }} /> OPTIONAL
        </div>
      </div>
    </div>
  );
}
