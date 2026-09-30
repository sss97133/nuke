// map/WorkspaceTables.tsx — the MAP workspace's linked tables: wire list, pin list and connectors for everyone, and the
// calls and decisions for the owner. A row the selection links to is tinted; clicking a row selects it everywhere.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Colorway } from '../connector-inspector/colorways';
import { frame, rule } from '../connector-inspector/colorways';
import { SECTIONS, type WiringMapData } from './useWiringMap';
import { kindOf, mask, modelsOf, partNo, valOf, type Rel, type SiteFiles, type WsIndex } from './useWorkspaceSelection';

type Tab = 'wires' | 'pins' | 'conns' | 'open';
interface Col<T> { h: string; v: (r: T) => string | number; td?: (r: T) => React.ReactNode; mono?: boolean; num?: boolean; w?: number }
const secWord = (s: string | null) => SECTIONS.find(x => x.id === s)?.label ?? '';

export function WorkspaceTables({ cw, map, ix, site, sel, rel, isOwner, onSelect }: {
  cw: Colorway; map: WiringMapData; ix: WsIndex; site: SiteFiles; sel: string | null; rel: Rel; isOwner: boolean; onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('wires');
  const [q, setQ] = useState('');
  const [onlyLinked, setOnlyLinked] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const models = site.models;
  const modelled = (code: string) => !!models && modelsOf(models, code).length > 0;
  const lenOf = (wc: string) => {
    const segs = (ix.segsByWire.get(wc) ?? []).map(s => ix.segById.get(s)).filter(Boolean);
    if (!segs.length) return null;
    const L = segs.reduce((a, s) => a + (s!.len ?? 0), 0) * 1000, M = Math.sqrt(segs.reduce((a, s) => a + (s!.mar ?? 0) ** 2, 0));
    return `${Math.round(L)} ±${Math.round(M)}`;
  };
  const endTxt = (h?: { code: string; cav: string | null }) => (h ? h.code + (h.cav ? ':' + h.cav : '') : '');

  const T = useMemo(() => {
    const wires = {
      rows: map.wires.slice().sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
      id: (w: typeof map.wires[number]) => 'w:' + w.code, linked: (w: typeof map.wires[number]) => rel.wires.has(w.code),
      cols: [
        { h: 'WIRE', v: w => w.code, mono: true },
        { h: 'FROM', v: w => endTxt((ix.chain.get(w.code) ?? [])[0]), mono: true },
        { h: 'TO', v: w => { const c = ix.chain.get(w.code) ?? []; return c.length > 1 ? endTxt(c[c.length - 1]) : ''; }, mono: true },
        { h: 'AWG', v: w => w.gauge ?? '', num: true },
        { h: 'COLOR', v: w => w.color ?? '' },
        { h: 'SPEC', v: w => w.spec ?? '', mono: true },
        { h: 'LENGTH MM', v: w => lenOf(w.code) ?? '', num: true },
        { h: 'CIRCUIT', v: w => mask(w.name), w: 260 },
        { h: 'SECTION', v: w => secWord(w.section) },
        { h: 'ENDS', v: w => ((ix.chain.get(w.code) ?? []).length ? '' : 'pending'), td: w => ((ix.chain.get(w.code) ?? []).length ? '' : <span style={{ color: cw.warn }}>PENDING</span>) },
      ] as Col<typeof map.wires[number]>[],
    };
    const pins = {
      rows: ix.pins.slice().sort((a, b) => (a.node + '|' + a.cav).localeCompare(b.node + '|' + b.cav, undefined, { numeric: true })),
      id: (p: typeof ix.pins[number]) => 'p:' + p.node + '|' + p.cav, linked: (p: typeof ix.pins[number]) => rel.pins.has(p.node + '|' + p.cav),
      cols: [
        { h: 'CONNECTOR', v: p => p.node, mono: true },
        { h: 'CAVITY', v: p => p.cav, mono: true },
        { h: 'WIRE', v: p => p.wires.join(' '), mono: true },
        { h: 'COLOR', v: p => p.wires.map(wc => ix.wireByCode.get(wc)?.color ?? '').filter(Boolean).join(', ') },
        { h: 'TERMINAL', v: p => partNo(p.terminal), mono: true },
        { h: 'SEAL', v: p => partNo(p.seal), mono: true },
        { h: 'OTHER END', v: p => p.wires.flatMap(wc => (ix.chain.get(wc) ?? []).filter(h => h.code !== p.node).map(endTxt)).slice(0, 2).join(' '), mono: true },
      ] as Col<typeof ix.pins[number]>[],
    };
    const conns = {
      rows: map.nodes.slice().sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
      id: (n: typeof map.nodes[number]) => 'n:' + n.code, linked: (n: typeof map.nodes[number]) => rel.nodes.has(n.code),
      cols: [
        { h: 'CONNECTOR', v: n => n.code, mono: true },
        { h: 'DESCRIPTION', v: n => mask(n.name), w: 280 },
        { h: 'PART NO.', v: n => partNo(n.partNumber), mono: true },
        { h: 'SECTION', v: n => secWord(n.section) },
        { h: '3D', v: n => (modelled(n.code) ? 'modelled' : 'not yet'), td: n => (modelled(n.code) ? 'MODELLED' : <span style={{ color: cw.warn }}>NOT YET</span>) },
        { h: 'PLACED', v: n => (site.ends[n.code] ? `±${site.ends[n.code].margin_mm ?? '?'} mm` : 'no'), num: true },
        { h: 'CAVITIES', v: n => (ix.pinsByNode.get(n.code) ?? []).length, num: true },
      ] as Col<typeof map.nodes[number]>[],
    };
    const calls = map.calls.slice().sort((a, b) => Number(a.decided) - Number(b.decided));   // open calls first, then the decisions
    const open = {
      rows: calls, id: (c: typeof calls[number]) => 'k:' + c.slug, linked: (c: typeof calls[number]) => c.links.some(l => !!l.endpointCode && rel.nodes.has(l.endpointCode)),
      cols: [
        { h: 'CALL', v: c => mask(c.subject), w: 320 },
        { h: 'STATUS', v: c => (c.decided ? (c.trust === 'T1' ? 'LOCKED' : 'DECIDED FOR YOU') : (c.workStatus || '').replace(/_/g, ' ').toUpperCase()) },
        { h: 'OPTIONS', v: c => c.options.length, num: true },
        { h: 'COUPLED WITH', v: c => c.links.map(l => l.endpointCode).filter(Boolean).slice(0, 4).join(' '), mono: true },
      ] as Col<typeof calls[number]>[],
    };
    return { wires, pins, conns, open };
  }, [map, ix, site, rel, cw]);   // eslint-disable-line react-hooks/exhaustive-deps

  const t = T[tab === 'open' && !isOwner ? 'wires' : tab] as { rows: unknown[]; id: (r: unknown) => string; linked: (r: unknown) => boolean; cols: Col<unknown>[] };
  const ql = q.trim().toLowerCase();
  let rows = t.rows;
  if (ql) rows = rows.filter(r => t.cols.map(c => String(c.v(r))).join(' ').toLowerCase().includes(ql));
  if (onlyLinked && sel) rows = rows.filter(r => t.linked(r) || t.id(r) === sel);
  const shown = rows.slice(0, 1200);
  const priOf = (r: unknown) => t.id(r) === sel || (kindOf(sel) === 'n' && tab === 'pins' && valOf(sel) === (r as { node?: string }).node);

  useEffect(() => {   // bring the selection's row into view when it comes from another pane (this table only: on a phone
    // the whole page scrolls, and scrollIntoView would move the page too)
    const box = wrap.current, el = (box?.querySelector('tr[data-pri="1"]') ?? box?.querySelector('tr[data-rel="1"]')) as HTMLElement | null;
    if (!box || !el) return;
    const head = (box.querySelector('thead') as HTMLElement | null)?.offsetHeight ?? 0;
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top - head < box.scrollTop) box.scrollTop = top - head;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [sel, tab]);

  const TABS: [Tab, string, number][] = [['wires', 'WIRE LIST', map.wires.length], ['pins', 'PIN LIST', ix.pins.length], ['conns', 'CONNECTORS', map.nodes.length]];
  if (isOwner) TABS.push(['open', 'CALLS AND DECISIONS', map.calls.length]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: rule(cw), overflowX: 'auto', flexShrink: 0 }}>
        {TABS.map(([k, l, n]) => (
          <button key={k} onClick={() => setTab(k)} aria-selected={tab === k} role="tab" style={{
            border: 'none', borderBottom: `2px solid ${tab === k ? cw.accent : 'transparent'}`, background: tab === k ? cw.surface : 'transparent',
            color: tab === k ? cw.ink : cw.inkMuted, fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{l} <span style={{ fontFamily: cw.fontMono, fontWeight: 400, opacity: 0.6 }}>{n}</span></button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', borderBottom: rule(cw), flexShrink: 0, flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="FILTER THIS TABLE" aria-label="Filter this table"
          style={{ width: 220, border: `2px solid ${cw.border}`, background: cw.surface, color: cw.ink, fontFamily: cw.fontBody, fontSize: 12, padding: '3px 6px' }} />
        <button onClick={() => setOnlyLinked(v => !v)} aria-pressed={onlyLinked} style={{
          border: frame(cw), background: onlyLinked ? cw.ink : cw.surface, color: onlyLinked ? cw.surface : cw.ink, fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, padding: '3px 8px', cursor: 'pointer',
        }}>LINKED TO SELECTION</button>
        <span style={{ marginLeft: 'auto', fontFamily: cw.fontMono, fontSize: 11, color: cw.inkMuted }}>{shown.length}{rows.length > shown.length ? ` of ${rows.length}` : ''} ROWS{sel ? ` · ${t.rows.filter(r => t.linked(r)).length} LINKED` : ''}</span>
      </div>
      <div ref={wrap} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5, fontFamily: cw.fontBody }}>
          <thead><tr>{t.cols.map(c => (
            <th key={c.h} style={{ position: 'sticky', top: 0, background: cw.surface, textAlign: c.num ? 'right' : 'left', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.7, color: cw.inkMuted, padding: '6px 8px', borderBottom: `2px solid ${cw.border}`, whiteSpace: 'nowrap' }}>{c.h}</th>
          ))}</tr></thead>
          <tbody>{shown.map(r => {
            const id = t.id(r), pri = priOf(r), lk = !pri && !!sel && t.linked(r);
            return (
              <tr key={id} data-pri={pri ? '1' : undefined} data-rel={lk ? '1' : undefined} onClick={() => onSelect(id)} style={{ cursor: 'pointer', background: pri ? `${cw.accent}33` : lk ? `${cw.accent}14` : 'transparent' }}>
                {t.cols.map(c => (
                  <td key={c.h} title={String(c.v(r))} style={{
                    padding: '4px 8px', borderBottom: rule(cw), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: c.w ?? 230,
                    fontFamily: c.mono ? cw.fontMono : cw.fontBody, textAlign: c.num ? 'right' : 'left', color: cw.ink,
                  }}>{c.td ? c.td(r) : String(c.v(r))}</td>
                ))}
              </tr>
            );
          })}</tbody>
        </table>
        {!shown.length && <div style={{ padding: 16, color: cw.inkMuted, fontSize: 12 }}>NOTHING MATCHES.</div>}
      </div>
    </div>
  );
}
