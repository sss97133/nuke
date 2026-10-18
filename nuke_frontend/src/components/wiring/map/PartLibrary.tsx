// map/PartLibrary.tsx — the MAP workspace's parts library: every part the harness is drawn with (the part-model index on
// main, nuke_frontend/public/wiring/part-models/index.json), its maker and part number, where its shape comes from, its
// size, and the ends it serves. Clicking a part selects its end everywhere.

import React, { useMemo, useState } from 'react';
import type { Colorway } from '../connector-inspector/colorways';
import { frame, rule } from '../connector-inspector/colorways';
import { SHAPE_ORDER, mask, partNo, publicName, type Rel, type SiteFiles, type WsIndex } from './useWorkspaceSelection';

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

export function PartLibrary({ cw, ix, site, sel, rel, onSelect }: {
  cw: Colorway; ix: WsIndex; site: SiteFiles; sel: string | null; rel: Rel; onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [basis, setBasis] = useState<string | null>(null);
  const parts = useMemo(() => Object.entries(site.models?.parts ?? {}).map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => SHAPE_ORDER.indexOf(a.shape_basis ?? 'not sourced') - SHAPE_ORDER.indexOf(b.shape_basis ?? 'not sourced') || a.id.localeCompare(b.id)),
  [site.models]);
  if (!site.models) return <div style={{ padding: 16, color: cw.inkMuted, fontSize: 13 }}>THE PART-MODEL INDEX DID NOT LOAD.</div>;
  const count = (b: string) => parts.filter(p => (p.shape_basis ?? 'not sourced') === b).length;
  const ql = q.trim().toLowerCase();
  const rows = parts.filter(p => (!basis || (p.shape_basis ?? 'not sourced') === basis)
    && (!ql || [p.id, p.what, p.maker, p.maker_pn, ...(p.endpoints ?? [])].join(' ').toLowerCase().includes(ql)));
  const selCode = sel?.startsWith('n:') ? sel.slice(2) : null;
  const chip = (on: boolean): React.CSSProperties => ({
    border: frame(cw), background: on ? cw.ink : cw.surface, color: on ? cw.surface : cw.ink,
    fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, padding: '3px 8px', cursor: 'pointer',
  });
  const th: React.CSSProperties = { position: 'sticky', top: 0, background: cw.surface, textAlign: 'left', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.7, color: cw.inkMuted, padding: '6px 8px', borderBottom: `2px solid ${cw.border}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '4px 8px', borderBottom: rule(cw), verticalAlign: 'top', color: cw.ink };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: cw.surface }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', borderBottom: rule(cw) }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="FILTER PARTS" aria-label="Filter parts"
          style={{ width: 180, border: `2px solid ${cw.border}`, background: cw.surface, color: cw.ink, fontFamily: cw.fontBody, fontSize: 12, padding: '3px 6px' }} />
        <button style={chip(!basis)} onClick={() => setBasis(null)}>ALL {parts.length}</button>
        {SHAPE_ORDER.filter(b => count(b) > 0).map(b => (
          <button key={b} style={chip(basis === b)} onClick={() => setBasis(basis === b ? null : b)}>SHAPE FROM {b.toUpperCase()} {count(b)}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: cw.inkMuted }}>PART-MODEL INDEX {site.models.generated ?? ''}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 }}>
          <thead><tr>{['PART', 'WHAT IT IS', 'MAKER', 'MAKER P/N', 'SHAPE FROM', 'SIZE MM', 'ENDS'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map(p => {
            const eps = p.endpoints ?? [], pri = !!selCode && eps.includes(selCode), lk = !pri && eps.some(e => rel.nodes.has(e));
            const first = eps.find(e => ix.byCode.has(e));
            const dims = Object.entries(p.dims_mm ?? {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${fmt(v as number)}`).join(' × ');
            return (
              <tr key={p.id} onClick={() => first && onSelect('n:' + first)} style={{ cursor: first ? 'pointer' : 'default', background: pri ? `${cw.accent}33` : lk ? `${cw.accent}14` : 'transparent' }}>
                <td style={{ ...td, fontFamily: cw.fontMono, whiteSpace: 'nowrap' }}>{p.id}</td>
                <td style={{ ...td, minWidth: 220 }}>{publicName((p.what ?? '').split(' (')[0])}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{mask(p.maker)}</td>
                <td style={{ ...td, fontFamily: cw.fontMono }}>{partNo(p.maker_pn)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{(p.shape_basis ?? 'not sourced').toUpperCase()}</td>
                <td style={{ ...td, fontFamily: cw.fontMono, whiteSpace: 'nowrap' }}>{dims || '—'}</td>
                <td style={{ ...td, fontFamily: cw.fontMono }}>{eps.join(' ')}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {!rows.length && <div style={{ padding: 16, color: cw.inkMuted, fontSize: 12 }}>NOTHING MATCHES.</div>}
      </div>
    </div>
  );
}
