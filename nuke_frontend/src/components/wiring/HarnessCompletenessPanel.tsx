// HarnessCompletenessPanel.tsx — Shows what's missing for a complete electrical system

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { ElectricalSystemCatalogItem, HarnessEndpoint } from './harnessTypes';
import { SYSTEM_CATEGORY_LABELS } from './harnessConstants';

interface Props {
  vehicleType: string | null;
  buildIntent: string; // 'street' | 'race' | 'show'
  existingEndpoints: HarnessEndpoint[];
  onAddMissing: (item: ElectricalSystemCatalogItem) => void;
  onClose: () => void;
}

export function HarnessCompletenessPanel({ vehicleType, buildIntent, existingEndpoints, onAddMissing, onClose }: Props) {
  const [catalog, setCatalog] = useState<ElectricalSystemCatalogItem[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('electrical_system_catalog')
        .select('*')
        .order('sort_order');
      if (data) setCatalog(data);
    }
    load();
  }, []);

  const existingNames = useMemo(() => {
    const s = new Set<string>();
    existingEndpoints.forEach(ep => s.add(ep.name.toLowerCase()));
    return s;
  }, [existingEndpoints]);

  // Filter catalog to applicable systems
  const applicable = useMemo(() => {
    return catalog.filter(item => {
      if (vehicleType && item.applies_to_vehicle_types.length > 0 && !item.applies_to_vehicle_types.includes(vehicleType)) {
        return false;
      }
      return true;
    });
  }, [catalog, vehicleType]);

  // Classify into present, missing-required, missing-optional
  const { present, missingRequired, missingOptional } = useMemo(() => {
    const p: ElectricalSystemCatalogItem[] = [];
    const mr: ElectricalSystemCatalogItem[] = [];
    const mo: ElectricalSystemCatalogItem[] = [];

    for (const item of applicable) {
      const found = existingNames.has(item.system_name.toLowerCase());
      if (found) {
        p.push(item);
      } else if (item.is_required || item.is_required_for.includes(buildIntent)) {
        mr.push(item);
      } else {
        mo.push(item);
      }
    }
    return { present: p, missingRequired: mr, missingOptional: mo };
  }, [applicable, existingNames, buildIntent]);

  const totalApplicable = applicable.length;
  const completeness = totalApplicable > 0
    ? Math.round((present.length / totalApplicable) * 100)
    : 0;

  return (
    <div style={{
      position: 'absolute',
      top: 40,
      right: 230,
      width: 280,
      maxHeight: 'calc(100% - 80px)',
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      zIndex: 20,
      overflow: 'auto',
      padding: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            COMPLETENESS
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: '"Courier New", monospace' }}>
            {completeness}%
          </div>
        </div>
        <button className="button-win95" onClick={onClose} style={{ fontSize: '8px' }}>CLOSE</button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: 'var(--bg)', border: '1px solid var(--border)', marginBottom: '8px' }}>
        <div style={{
          height: '100%',
          width: `${completeness}%`,
          background: completeness >= 90 ? 'var(--success)' : completeness >= 60 ? 'var(--warning)' : 'var(--error)',
          transition: 'width 0.3s ease',
        }} />
      </div>

      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '8px' }}>
        {present.length} of {totalApplicable} systems for <strong>{buildIntent}</strong> build
      </div>

      {/* Missing required */}
      {missingRequired.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{
            fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
            color: 'var(--error)', marginBottom: '3px',
          }}>
            MISSING — REQUIRED ({missingRequired.length})
          </div>
          {missingRequired.map(item => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '2px 0', fontSize: '9px',
            }}>
              <div>
                <div>{item.system_name}</div>
                <div style={{ fontSize: '7px', color: 'var(--text-muted)' }}>
                  {SYSTEM_CATEGORY_LABELS[item.system_category] || item.system_category}
                  {item.typical_amperage ? ` · ${item.typical_amperage}A` : ''}
                </div>
              </div>
              <button
                className="button-win95"
                onClick={() => onAddMissing(item)}
                style={{ fontSize: '7px', padding: '1px 4px' }}
              >
                + ADD
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Missing optional */}
      {missingOptional.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{
            fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
            color: 'var(--text-muted)', marginBottom: '3px',
          }}>
            MISSING — OPTIONAL ({missingOptional.length})
          </div>
          {missingOptional.map(item => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '2px 0', fontSize: '9px',
            }}>
              <div>
                <div style={{ color: 'var(--text-muted)' }}>{item.system_name}</div>
                <div style={{ fontSize: '7px', color: 'var(--text-muted)' }}>
                  {item.typical_amperage ? `${item.typical_amperage}A` : ''}
                </div>
              </div>
              <button
                className="button-win95"
                onClick={() => onAddMissing(item)}
                style={{ fontSize: '7px', padding: '1px 4px' }}
              >
                + ADD
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Present */}
      {present.length > 0 && (
        <div>
          <div style={{
            fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
            color: 'var(--success)', marginBottom: '3px',
          }}>
            IN DESIGN ({present.length})
          </div>
          {present.map(item => (
            <div key={item.id} style={{ fontSize: '9px', color: 'var(--text-muted)', padding: '1px 0' }}>
              {item.system_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
