// connector-inspector/TableSkin.tsx — dense sortable/filterable pin schedule
// (the print sheet's columns) over the same ConnectorModel. 14px floor.
// All chrome from the active Colorway: LEDGER is the home turf — zebra
// stripes, cell-grid column rules, color ONLY as small insulation swatches
// and the AWG vdrop-upsize coding (legend in the filter bar). UNCUT renders
// as plain mono text — a pill for "nothing has happened yet" is noise.

import React, { useMemo, useState } from 'react';
import type { DerivedWire } from '../harnessDerivation';
import type { CavityGroup, ConnectorModel } from './types';
import { colorParts } from './colorCodes';
import { frame, rule, textOn, useColorway, type Colorway } from './colorways';
import { BUILD_STATE_LABELS, type BuildState } from './useBuildState';

interface Row {
  order: number;
  cav: string;
  func: string;
  wire: DerivedWire | null;   // null = spare cavity
  group: CavityGroup | 'overflow';
}

type SortKey = 'cav' | 'wire' | 'circuit' | 'awg' | 'len' | 'subsystem' | 'state';

const GROUPS: { id: 'all' | CavityGroup | 'overflow'; label: string }[] = [
  { id: 'all', label: 'ALL' }, { id: 'sensor', label: 'SENSOR' }, { id: 'drive', label: 'DRIVE' },
  { id: 'power', label: 'POWER' }, { id: 'can', label: 'CAN' }, { id: 'spare', label: 'SPARE' },
  { id: 'overflow', label: 'OVERFLOW' },
];

interface Props {
  model: ConnectorModel;
  buildStates: Record<string, BuildState>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

export function TableSkin({ model, buildStates, selectedKey, onSelect }: Props) {
  const cw = useColorway();
  const [filter, setFilter] = useState('');
  const [group, setGroup] = useState<'all' | CavityGroup | 'overflow'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('cav');
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    model.cavities.forEach((c, i) => {
      if (c.wires.length === 0) {
        out.push({ order: i, cav: c.key, func: c.funcLabel || '', wire: null, group: 'spare' });
      } else {
        for (const w of c.wires) out.push({ order: i, cav: c.key, func: c.funcLabel || '', wire: w, group: c.group });
      }
    });
    model.overflow.forEach((w, i) => {
      out.push({ order: model.cavities.length + i, cav: '—', func: 'OVERFLOW', wire: w, group: 'overflow' });
    });
    return out;
  }, [model]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let list = rows.filter(r => group === 'all' || r.group === group);
    if (f) {
      list = list.filter(r => {
        const w = r.wire;
        const hay = [r.cav, r.func, w?.id, w?.label, w?.fromPin, w?.toDest, w?.subsystem, w?.color, w && (buildStates[w.id] ?? 'uncut')]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(f);
      });
    }
    const num = (s: string) => parseFloat(s.replace(/[^\d.]/g, '')) || 0;
    const cmp = (a: Row, b: Row): number => {
      switch (sortKey) {
        case 'cav': return a.order - b.order;
        case 'wire': return (a.wire?.id || '').localeCompare(b.wire?.id || '', undefined, { numeric: true });
        case 'circuit': return (a.wire?.label || '').localeCompare(b.wire?.label || '');
        case 'awg': return (a.wire ? a.wire.effectiveGauge : 99) - (b.wire ? b.wire.effectiveGauge : 99);
        case 'len': return (a.wire?.lengthFt || 0) - (b.wire?.lengthFt || 0);
        case 'subsystem': return (a.wire?.subsystem || 'zz').localeCompare(b.wire?.subsystem || 'zz');
        case 'state': return num(String(a.wire ? stateOrd(buildStates[a.wire.id]) : -1)) - num(String(b.wire ? stateOrd(buildStates[b.wire.id]) : -1));
        default: return 0;
      }
    };
    return [...list].sort((a, b) => cmp(a, b) * sortDir);
  }, [rows, filter, group, sortKey, sortDir, buildStates]);

  const clickSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  };

  const TH = ({ k, children, width }: { k: SortKey | null; children: React.ReactNode; width?: number | string }) => (
    <th
      onClick={k ? () => clickSort(k) : undefined}
      style={{
        position: 'sticky', top: 0, zIndex: 1, background: cw.elevated, color: cw.inkMuted,
        fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
        textAlign: 'left', padding: '8px 10px', borderBottom: frame(cw),
        cursor: k ? 'pointer' : 'default', whiteSpace: 'nowrap', width,
      }}
    >
      {children}{k === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: cw.bg }}>
      {/* filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: frame(cw), flexWrap: 'wrap' }}>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="FILTER — wire #, circuit, pin, color, subsystem…"
          style={{
            background: cw.surface, color: cw.ink, border: frame(cw),
            fontFamily: cw.fontMono, fontSize: 14, padding: '6px 10px', width: 340,
          }}
        />
        {GROUPS.map(g => (
          <button key={g.id} onClick={() => setGroup(g.id)} style={{
            background: group === g.id ? cw.elevated : 'transparent',
            color: group === g.id ? cw.accent : cw.inkMuted,
            border: `${cw.borderStyle === 'standard' ? 2 : 1}px solid ${group === g.id ? cw.accent : cw.border}`,
            fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
            padding: '4px 10px', cursor: 'pointer',
          }}>{g.label}</button>
        ))}
        {/* legend: the AWG color coding is REAL — gaugeChangedFromSpec, the
            vdrop upsize from the derivation. Rendered in the coding color
            itself so the legend is its own sample. */}
        <span style={{ marginLeft: 'auto', fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, color: cw.warn }}>
          COLORED AWG = UPSIZED FROM SPEC (VDROP)
        </span>
        <span style={{ fontFamily: cw.fontMono, fontSize: 14, color: cw.inkFaint }}>
          {shown.length} ROWS
        </span>
      </div>

      {/* table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <TH k="cav" width={70}>CAV</TH>
              <TH k="wire" width={70}>WIRE</TH>
              <TH k="circuit">CIRCUIT</TH>
              <TH k={null} width={120}>COLOR</TH>
              <TH k="awg" width={60}>AWG</TH>
              <TH k={null} width={110}>SPEC</TH>
              <TH k="len" width={70}>FT</TH>
              <TH k={null} width={110}>FROM</TH>
              <TH k={null}>TO</TH>
              <TH k="subsystem" width={150}>SUBSYSTEM</TH>
              <TH k="state" width={100}>STATE</TH>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const w = r.wire;
              const spare = !w;
              const key = r.cav !== '—' ? r.cav : w ? `wire:${w.id}` : String(i);
              const selected = key === selectedKey;
              const st = w ? (buildStates[w.id] ?? 'uncut') : null;
              const stripe = cw.tableStripe && i % 2 === 1 ? cw.tableStripe : 'transparent';
              return (
                <tr
                  key={`${r.cav}-${w?.id ?? 'spare'}-${i}`}
                  onClick={() => onSelect(selected ? null : key)}
                  style={{
                    background: selected ? cw.elevated : stripe,
                    opacity: spare ? 0.45 : 1,
                    cursor: 'pointer',
                    borderBottom: rule(cw),
                  }}
                >
                  <TD cw={cw} mono strong color={r.group === 'overflow' ? cw.warn : cw.ink}>{r.cav}{r.func && r.cav !== '—' ? ` ${r.func}` : ''}</TD>
                  <TD cw={cw} mono strong color={r.group === 'overflow' ? cw.warn : cw.accent}>{w ? `#${w.id}` : ''}</TD>
                  <TD cw={cw}>{w ? w.label : `SPARE${r.func ? ` (${r.func})` : ''}`}</TD>
                  <TD cw={cw} mono>
                    {w && (
                      <span style={{ display: 'inline-flex', width: 26, height: 13, border: `1px solid ${cw.swatchBorder}`, verticalAlign: 'middle', marginRight: 6 }}>
                        {colorParts(w.color).map((p, j) => <span key={j} style={{ flex: 1, background: p }} />)}
                      </span>
                    )}
                    {w?.color || ''}
                  </TD>
                  <TD cw={cw} mono color={w?.gaugeChangedFromSpec ? cw.warn : undefined}>{w ? w.effectiveGauge : ''}</TD>
                  <TD cw={cw} mono>{w?.spec || ''}</TD>
                  <TD cw={cw} mono>{w ? w.lengthFt : ''}</TD>
                  <TD cw={cw} mono>{w?.fromPin || ''}</TD>
                  <TD cw={cw}>{w?.toDest || ''}</TD>
                  <TD cw={cw}>{w?.subsystem || ''}</TD>
                  <TD cw={cw} mono>
                    {/* UNCUT = plain mono cell value; pills are for states
                        that actually happened. Badge text via textOn — full
                        contrast against the badge fill, never a fixed color. */}
                    {st && (st === 'uncut' ? (
                      BUILD_STATE_LABELS[st]
                    ) : (
                      <span style={{ background: cw.buildState[st], color: textOn(cw.buildState[st]), fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, padding: '1px 7px' }}>
                        {BUILD_STATE_LABELS[st]}
                      </span>
                    ))}
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function stateOrd(s: BuildState | undefined): number {
  return ['uncut', 'cut', 'terminated_a', 'terminated_b', 'routed', 'verified'].indexOf(s ?? 'uncut');
}

function TD({ children, mono, strong, color, cw }: {
  children: React.ReactNode; mono?: boolean; strong?: boolean; color?: string;
  cw: Colorway;
}) {
  return (
    <td style={{
      padding: '6px 10px',
      fontFamily: mono ? cw.fontMono : cw.fontBody,
      fontSize: 14, fontWeight: strong ? 700 : 400,
      color: color || cw.ink, whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320,
      borderRight: cw.gridLine ? `1px solid ${cw.gridLine}` : undefined,
    }}>
      {children}
    </td>
  );
}
