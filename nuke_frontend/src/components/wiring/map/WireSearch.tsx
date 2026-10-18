// map/WireSearch.tsx — the "Follow a wire" door's one search box (brief docs/wiring/research/2026-09-30_map-progressive-
// disclosure-brief.md, step 4), over the rows the MAP already reads. A part or connector by its name or code ranks first,
// then a wire by its number or circuit name, then a pin (a cavity). A connector's wires are every wire whose chain
// touches it, so a "firewall" search finds the wires that pass through the firewall pair, not only those ending there.
// With nothing typed, pick a system instead. Picking a wire opens its card.

import React, { useMemo, useState } from 'react';
import type { Colorway } from '../connector-inspector/colorways';
import { frame, rule } from '../connector-inspector/colorways';
import { SECTIONS, type WiringMapData } from './useWiringMap';
import { mask, type SiteFiles, type WsIndex } from './useWorkspaceSelection';

const norm = (t: string | null | undefined) => String(t ?? '').toLowerCase().replace(/[_#]/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byCode = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// 0: the words as a whole word or phrase ("injector 1" finds "Injector 1", not "injector 12"); 1: the phrase as the start
// of a word; 2: every word starts a word somewhere; 9: no match
function rank(hay: string | null | undefined, q: string, words: string[]): number {
  const h = norm(hay);
  if (!h || !q) return 9;
  if (new RegExp(`(^|[^a-z0-9])${esc(q)}($|[^a-z0-9])`).test(h)) return 0;
  if (new RegExp(`(^|[^a-z0-9])${esc(q)}`).test(h)) return 1;
  const hw = h.split(/[^a-z0-9.]+/);
  return words.every(w => hw.some(x => x.startsWith(w))) ? 2 : 9;
}

interface Place { code: string; name: string; r: number; wires: string[] }

// card: on a phone the picked wire's card sits right under the box, above the results
export function WireSearch({ cw, map, ix, site, sel, narrow, card, onSelect }: {
  cw: Colorway; map: WiringMapData; ix: WsIndex; site: SiteFiles; sel: string | null; narrow: boolean; card?: React.ReactNode; onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [sys, setSys] = useState<string | null>(null);
  const ql = norm(q), words = ql.split(' ').filter(Boolean);

  const found = useMemo(() => {
    if (!ql) return null;
    // parts and connectors: the connector's code and name, and its device's name and code
    const places: Place[] = map.nodes.map(n => {
      const dev = ix.devOf(n.code);
      const r = Math.min(rank(n.code, ql, words), rank(n.name, ql, words), rank(site.ends[n.code]?.dev_name, ql, words), dev !== n.code ? rank(dev, ql, words) : 9);
      return { code: n.code, name: site.ends[n.code]?.dev_name && dev !== n.code ? `${n.name} · ${site.ends[n.code].dev_name}` : n.name, r,
        wires: [...(ix.wiresByNode.get(n.code) ?? [])].sort(byCode) };
    }).filter(p => p.r < 9).sort((a, b) => a.r - b.r || byCode(a.code, b.code))
      .filter((p, _, all) => p.r <= Math.max(1, all[0].r));   // a phrase match beats a scatter of words
    const listed = new Set(places.slice(0, 12).flatMap(p => p.wires));
    // wires by number or circuit name, ranked; those already under a connector above aren't repeated
    const wires = map.wires.map(w => ({ w, r: norm(w.code) === ql ? -1 : rank(w.name, ql, words) }))
      .filter(x => x.r < 9).sort((a, b) => a.r - b.r || byCode(a.w.code, b.w.code))
      .filter((x, _, all) => x.r <= Math.max(1, all[0].r) && !listed.has(x.w.code)).map(x => x.w.code);
    // pins: a cavity by its own name, or connector:cavity
    const pins = ix.pins.filter(p => norm(p.cav) === ql || norm(`${p.node}:${p.cav}`).startsWith(ql))
      .sort((a, b) => byCode(a.node + '|' + a.cav, b.node + '|' + b.cav));
    return { places, wires, pins };
  }, [ql, map.nodes, map.wires, ix, site.ends]);   // eslint-disable-line react-hooks/exhaustive-deps

  const label: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: cw.inkMuted, padding: '10px 12px 4px' };
  const endTxt = (h?: { code: string; cav: string | null }) => (h ? h.code + (h.cav ? ':' + h.cav : '') : '');
  // one wire, one row: its number and circuit, then gauge, colour and where it runs; "passes through" when `at` is a hop
  const WireRow = ({ wc, at }: { wc: string; at?: string }) => {
    const w = ix.wireByCode.get(wc); if (!w) return null;
    const ch = ix.chain.get(wc) ?? [], on = sel === 'w:' + wc;
    const through = !!at && ch.findIndex(h => h.code === at) > 0 && ch.findIndex(h => h.code === at) < ch.length - 1;
    return (
      <button onClick={() => onSelect('w:' + wc)} aria-pressed={on} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none',
        borderBottom: rule(cw), background: on ? `${cw.accent}22` : 'transparent', color: cw.ink, padding: `4px 12px 4px ${at ? 24 : 12}px`,
        cursor: 'pointer', fontFamily: cw.fontBody, fontSize: 13.5, lineHeight: 1.4, minWidth: 0 }}>
        <span style={{ fontFamily: cw.fontMono, fontWeight: 700, color: cw.accent }}>#{wc}</span> <span style={{ overflowWrap: 'anywhere' }}>{mask(w.name)}</span>
        <span style={{ display: 'block', fontSize: 12, color: cw.inkMuted, overflowWrap: 'anywhere' }}>
          {[w.gauge != null ? `${w.gauge} AWG` : null, w.color].filter(Boolean).join(' ')}
          {ch.length ? `${w.gauge != null || w.color ? ' · ' : ''}${endTxt(ch[0])}${ch.length > 1 ? ' → ' + endTxt(ch[ch.length - 1]) : ''}` : ''}
          {through && <b style={{ color: cw.ink }}> · passes through here</b>}
        </span>
      </button>
    );
  };

  const withWires = SECTIONS.map(s => ({ ...s, wires: map.wires.filter(w => w.section === s.id).map(w => w.code).sort(byCode) })).filter(s => s.wires.length);
  return (
    <div>
      <div style={{ padding: '10px 12px', borderBottom: rule(cw) }}>
        <input value={q} onChange={e => setQ(e.target.value)} autoFocus={!narrow} type="search" aria-label="Search a part, a connector or a wire"
          placeholder="A part, a connector or a wire: injector 1, firewall, 13"
          style={{ width: '100%', boxSizing: 'border-box', border: `2px solid ${cw.border}`, background: cw.surface, color: cw.ink,
            fontFamily: cw.fontBody, fontSize: 15, padding: '7px 9px' }} />
      </div>
      {card}
      {!found && (
        <>
          <div style={label}>OR PICK A SYSTEM</div>
          {withWires.map(s => (
            <div key={s.id}>
              <button onClick={() => setSys(sys === s.id ? null : s.id)} aria-expanded={sys === s.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline',
                width: '100%', textAlign: 'left', border: 'none', borderBottom: rule(cw), background: cw.surface, color: cw.ink, padding: '6px 12px',
                cursor: 'pointer', fontFamily: cw.fontBody }}>
                <span style={{ width: 10, fontSize: 10, color: cw.inkMuted }}>{sys === s.id ? '▾' : '▸'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8 }}>{s.label}</span>
                <span style={{ fontSize: 12, color: cw.inkMuted }}>{s.wires.length} wires</span>
              </button>
              {sys === s.id && s.wires.map(wc => <WireRow key={wc} wc={wc} />)}
            </div>
          ))}
        </>
      )}
      {found && !found.places.length && !found.wires.length && !found.pins.length && (
        <div style={{ padding: '10px 12px', fontSize: 13, color: cw.inkMuted }}>Nothing on file matches “{q.trim()}”.</div>
      )}
      {found && found.places.length > 0 && (
        <>
          <div style={label}>PARTS AND CONNECTORS ({found.places.length})</div>
          {found.places.slice(0, 12).map(p => (
            <div key={p.code} style={{ borderBottom: frame(cw) }}>
              <button onClick={() => onSelect('n:' + p.code)} aria-pressed={sel === 'n:' + p.code} style={{ display: 'block', width: '100%', textAlign: 'left',
                border: 'none', borderBottom: rule(cw), background: sel === 'n:' + p.code ? `${cw.accent}22` : cw.surface, color: cw.ink, padding: '5px 12px',
                cursor: 'pointer', fontFamily: cw.fontBody, fontSize: 13.5, lineHeight: 1.4 }}>
                <span style={{ fontFamily: cw.fontMono, fontWeight: 700 }}>{p.code}</span> <span style={{ overflowWrap: 'anywhere' }}>{mask(p.name)}</span>
                <span style={{ display: 'block', fontSize: 12, color: cw.inkMuted }}>{p.wires.length ? `${p.wires.length} wire${p.wires.length === 1 ? '' : 's'} end here or pass through` : 'no wire on file here yet'}</span>
              </button>
              {p.wires.map(wc => <WireRow key={wc} wc={wc} at={p.code} />)}
            </div>
          ))}
          {found.places.length > 12 && <div style={{ padding: '6px 12px', fontSize: 12, color: cw.inkMuted }}>{found.places.length - 12} more; add a word to narrow it.</div>}
        </>
      )}
      {found && found.wires.length > 0 && (
        <>
          <div style={label}>WIRES BY NUMBER OR NAME ({found.wires.length})</div>
          {found.wires.slice(0, 60).map(wc => <WireRow key={wc} wc={wc} />)}
        </>
      )}
      {found && found.pins.length > 0 && (
        <>
          <div style={label}>PINS ({found.pins.length})</div>
          {found.pins.slice(0, 30).map(p => (
            <div key={p.node + '|' + p.cav}>
              <div style={{ padding: '4px 12px 0', fontFamily: cw.fontMono, fontSize: 12, fontWeight: 700 }}>{p.node}:{p.cav}</div>
              {p.wires.map(wc => <WireRow key={wc} wc={wc} at={p.node} />)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
