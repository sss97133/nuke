// LiveCutList.tsx — sortable cut-list table for the Harness Workbench.
// Rows come from the FULL derivation; rows whose subsystem is toggled off are
// dimmed and collapse out (180ms), so toggling reads as wires leaving the harness.

import React, { useMemo, useState } from 'react';
import type { DerivedWire } from './harnessDerivation';
import { wireColorHex } from './wiringTheme';

const C = {
  surface: '#1f1f35',
  elevated: '#252540',
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  active: '#00ddff',
} as const;

type SortKey = 'id' | 'label' | 'fromPin' | 'color' | 'gauge' | 'lengthFt' | 'subsystem';

const COLUMNS: { key: SortKey; label: string; width?: string; align?: 'right' }[] = [
  { key: 'id', label: 'ID', width: '44px' },
  { key: 'label', label: 'CIRCUIT' },
  { key: 'fromPin', label: 'FROM', width: '110px' },
  { key: 'color', label: 'COLOR', width: '92px' },
  { key: 'gauge', label: 'AWG', width: '40px', align: 'right' },
  { key: 'lengthFt', label: 'FT', width: '48px', align: 'right' },
  { key: 'subsystem', label: 'SUBSYSTEM', width: '140px' },
];

interface Props {
  wires: DerivedWire[];               // full derivation wires (all subsystems)
  activeWireIds: Set<string>;         // ids present in the ACTIVE derivation
  subsystemColors: Record<string, string>;
}

export function LiveCutList({ wires, activeWireIds, subsystemColors }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');

  const sorted = useMemo(() => {
    let list = [...wires];
    if (filter) {
      const f = filter.toLowerCase();
      list = list.filter(w =>
        w.label.toLowerCase().includes(f) ||
        w.subsystem.toLowerCase().includes(f) ||
        w.fromPin.toLowerCase().includes(f) ||
        w.id.toLowerCase().includes(f),
      );
    }
    return list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (sortKey === 'id' || sortKey === 'gauge') {
        cmp = (parseFloat(String(av)) || 0) - (parseFloat(String(bv)) || 0);
      } else if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [wires, filter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const activeCount = sorted.filter(w => activeWireIds.has(w.id)).length;
  const activeFt = sorted.filter(w => activeWireIds.has(w.id)).reduce((s, w) => s + w.lengthFt, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', height: 28, flexShrink: 0,
        borderBottom: `2px solid ${C.border}`, background: C.surface,
      }}>
        <span style={{ fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 1, color: C.label }}>
          LIVE CUT LIST
        </span>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700, color: C.active }}>
          {activeCount}/{wires.length} WIRES — {Math.round(activeFt)} FT
        </span>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="FILTER..."
          style={{
            marginLeft: 'auto', width: 140, fontFamily: 'Arial', fontSize: 8, fontWeight: 700,
            letterSpacing: 0.5, padding: '2px 6px', background: '#1a1a2e',
            border: `1px solid ${C.border}`, color: C.text, outline: 'none', textTransform: 'uppercase',
          }}
        />
      </div>

      {/* table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, zIndex: 2, background: C.elevated }}>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    width: col.width, padding: '5px 8px', cursor: 'pointer', userSelect: 'none',
                    textAlign: col.align || 'left',
                    fontFamily: 'Arial', fontSize: 7, fontWeight: 700, letterSpacing: 0.5,
                    color: sortKey === col.key ? C.active : C.label,
                    borderBottom: `2px solid ${C.border}`, textTransform: 'uppercase',
                  }}
                >
                  {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ▴' : ' ▾') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(w => {
              const active = activeWireIds.has(w.id);
              const hex = wireColorHex(w.color);
              return (
                <tr
                  key={w.id}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    opacity: active ? 1 : 0.18,
                    transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <td style={tdMono}>#{w.id}</td>
                  <td style={{ ...tdText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={w.label}>
                    {w.label}
                  </td>
                  <td style={tdMono}>{w.fromPin}</td>
                  <td style={{ ...tdMono, whiteSpace: 'nowrap' }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, marginRight: 4,
                      background: hex || '#555', border: '1px solid #555', verticalAlign: 'middle',
                    }} />
                    {w.color}
                  </td>
                  <td style={{ ...tdMono, textAlign: 'right' }}>{w.gauge}</td>
                  <td style={{ ...tdMono, textAlign: 'right' }}>{w.lengthFt.toFixed(1)}</td>
                  <td style={{ ...tdText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span style={{
                      fontSize: 7, fontWeight: 700, padding: '1px 4px', letterSpacing: 0.3,
                      background: subsystemColors[w.subsystem] || C.muted, color: '#fff',
                      textTransform: 'uppercase',
                    }}>
                      {w.subsystem.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const tdMono: React.CSSProperties = {
  padding: '4px 8px', fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700, color: '#e0e0e8',
};
const tdText: React.CSSProperties = {
  padding: '4px 8px', fontFamily: 'Arial', fontSize: 9, color: '#e0e0e8',
};
