// map/MissingList.tsx — "What's still missing", the first thing under the MAP tab's status line (brief 2026-09-30,
// step 2), grouped by system. Each item is counted the way the status line counts it: a connection point with no 3D
// model, one whose model isn't complete (the part-model index says in words what it lacks), and a wire with an open end
// (fewer than two of its ends on a connection point on file). An item names the thing and what closes it; a click
// selects it in the workspace. Results for everyone; the owner also reads the index's own note on the selected item.

import React, { useMemo, useState } from 'react';
import type { Colorway } from '../connector-inspector/colorways';
import { frame, rule } from '../connector-inspector/colorways';
import { SECTIONS, type MapWire, type WiringMapData } from './useWiringMap';
import { mask, modelsOf, publicName, type PartModelIndex, type SiteFiles, type WsIndex } from './useWorkspaceSelection';

type Kind = 'model' | 'partial' | 'end';
interface MissingItem { sel: string; kind: Kind; code: string; name: string; closes: string; notes: string[]; section: string | null }

const KINDS: Kind[] = ['model', 'partial', 'end'];
const KIND_WORD: Record<Kind, string> = { model: 'No 3D model', partial: '3D model not complete', end: 'Open end' };
const tallyWord = (k: Kind, n: number) =>
  k === 'model' ? `${n} without a 3D model` : k === 'partial' ? `${n} with a model not complete` : `${n} wire${n === 1 ? '' : 's'} with an open end`;

// the index's note on what an end lacks, read as the gap that closes it (first match wins; "as KNOCK-1" reads KNOCK-1's)
const GAPS: [RegExp, string][] = [
  [/\bgauge unknown\b|\bwithout a gauge\b/i, 'wire gauge not on file'],
  [/\bnot picked\b|\bnot named in the registry\b/i, 'part not chosen yet'],
  [/dimension|\bno drawing\b|\bno (?:thread|sensor) size\b|\bthread or size\b|\bnot its diameter\b/i, 'dimensions not on file'],
  [/\bpart number\b[^.;]*\bnot (?:recorded|on file)\b|\bnames no part number\b/i, 'part number not on file'],
];
function gapOf(idx: PartModelIndex, note: string, depth = 0): string {
  const as = /^(?:[^:]+:\s*)?as ([A-Z0-9][A-Z0-9_-]*)\b/.exec(note);
  const ref = as && depth < 3 ? idx.ends?.[as[1]]?.missing?.[0] : undefined;
  if (ref) return gapOf(idx, ref, depth + 1);
  return GAPS.find(([re]) => re.test(note))?.[1] ?? 'not modelled yet';
}
// the piece a note is about: "a heat-shrink cap for each stub splice (not named …)" → "heat-shrink cap for each stub splice"
const pieceOf = (note: string) => note.split(/:\s|\s\(/)[0].replace(/\s+not picked$/i, '').replace(/^(?:a|an|the|one)\s+/i, '').trim();

// a wire end in its own words (from_component / to_component); some rows hold a {'device': …, 'pin': …} record as text
function endWords(t: string | null): string {
  if (!t) return '';
  const dev = /'device':\s*'([^']*)'/.exec(t), pin = /'pin':\s*'([^']*)'/.exec(t);
  const s = publicName((dev ? [dev[1], pin?.[1]].filter(Boolean).join(', ') : t).replace(/_/g, ' '));
  return s.length > 60 ? s.slice(0, 59).trimEnd() + '…' : s;
}

export function missingOf(map: WiringMapData, ix: WsIndex, site: SiteFiles): MissingItem[] {
  const out: MissingItem[] = [];
  const idx = site.models;
  if (idx) Object.keys(site.ends).forEach(code => {
    const node = ix.byCode.get(code), pos = site.ends[code], rec = idx.ends?.[code];
    const notes = (rec?.missing ?? []).map(n => mask(n));
    const base = { sel: 'n:' + code, code, name: (pos.dev === code ? pos.dev_name : node?.name) || node?.name || code, notes, section: node?.section ?? null };
    if (!modelsOf(idx, code).length) {
      const gaps = [...new Set(notes.map(n => gapOf(idx, n)))].join('; ');
      out.push({ ...base, kind: 'model', closes: gaps || (rec ? 'what it lacks is not on file' : 'not in the part-model index yet') });
    } else if (!rec?.complete) {
      out.push({ ...base, kind: 'partial', closes: notes.map(n => `${pieceOf(n)} — ${gapOf(idx, n)}`).join('; ') || 'what it lacks is not on file' });
    }
  });
  map.wires.forEach(w => {
    const closes = openEndOf(w, ix);
    if (closes) out.push({ sel: 'w:' + w.code, kind: 'end', code: '#' + w.code, name: w.name, closes, notes: [], section: w.section });
  });
  return out;
}

/** What closes a wire's open end, in words, or null when both ends are on a connection point on file. The list and the
 *  wire card both read it here, so they say the same thing. */
export function openEndOf(w: MapWire, ix: WsIndex): string | null {
  const hops = ix.chain.get(w.code) ?? [];
  if (hops.length > 1) return null;
  if (!hops.length) return `both ends (${endWords(w.fromText) || '?'} → ${endWords(w.toText) || '?'}) — connection points not on file`;
  // which end is open: the side the one end on file isn't; a wire-end row with no matching link falls back to the words
  const k = hops[0].code, f = ix.byId.get(w.fromId ?? '')?.code, t = ix.byId.get(w.toId ?? '')?.code;
  const kIsTo = (w.toText ?? '').startsWith(k) && !(w.fromText ?? '').startsWith(k);
  const toOpen = f === k && t !== k ? true : t === k && f !== k ? false : !kIsTo;
  const at = toOpen ? t : f;
  return at ? `${at} — cavity not on file` : `${endWords(toOpen ? w.toText : w.fromText) || 'the other end'} — connection point not on file`;
}

// full: the list is its door's whole page (brief step 4), so it doesn't cap its height or offer to hide itself
export function MissingList({ cw, map, ix, site, sel, isOwner, narrow, full, onSelect }: {
  cw: Colorway; map: WiringMapData; ix: WsIndex; site: SiteFiles; sel: string | null; isOwner: boolean; narrow: boolean; full?: boolean; onSelect: (id: string) => void;
}) {
  const [hidden, setHidden] = useState(false);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const items = useMemo(() => missingOf(map, ix, site), [map, ix, site]);
  const groups = useMemo(() => {
    const known = new Set<string>(SECTIONS.map(s => s.id));
    const by = new Map<string, MissingItem[]>();
    items.forEach(i => { const s = i.section && known.has(i.section) ? i.section : ''; by.set(s, [...(by.get(s) ?? []), i]); });
    const cmp = (a: MissingItem, b: MissingItem) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.code.localeCompare(b.code, undefined, { numeric: true });
    return [...SECTIONS.map(s => ({ id: s.id as string, label: s.label })), { id: '', label: 'NO SYSTEM ON FILE' }]
      .map(g => ({ ...g, items: (by.get(g.id) ?? []).slice().sort(cmp) })).filter(g => g.items.length);
  }, [items]);
  if (!items.length) return null;
  const tally = (list: MissingItem[]) => KINDS.map(k => [k, list.filter(i => i.kind === k).length] as const).filter(([, n]) => n > 0)
    .map(([k, n]) => tallyWord(k, n)).join(' · ');
  const toggle = (id: string) => setShut(p => { const x = new Set(p); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const cols = narrow ? 'auto minmax(0, 1fr)' : '184px minmax(0, 1fr) minmax(0, 1.6fr)';
  return (
    <section aria-label="What's still missing" style={{ flexShrink: 0, background: cw.bg, borderBottom: frame(cw) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px 10px', flexWrap: 'wrap', padding: '6px 12px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: cw.ink }}>WHAT'S STILL MISSING</span>
        <b style={{ fontFamily: cw.fontMono, fontSize: 13 }}>{items.length}</b>
        <span style={{ fontSize: 12.5, color: cw.inkMuted }}>{tally(items)}. {full ? 'Select a part to see it on the truck, or a wire to follow it.' : 'Select one to find it in the workspace below.'}</span>
        {!full && (
          <button onClick={() => setHidden(h => !h)} aria-expanded={!hidden} style={{ marginLeft: 'auto', border: frame(cw), background: cw.surface, color: cw.ink,
            fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {hidden ? 'SHOW THE LIST ▾' : 'HIDE THE LIST ▴'}
          </button>
        )}
      </div>
      {(full || !hidden) && (
        <div style={{ maxHeight: full ? undefined : narrow ? '60vh' : '34vh', overflowY: full ? undefined : 'auto', borderTop: rule(cw) }}>
          {groups.map(g => (
            <div key={g.id || 'none'}>
              <button onClick={() => toggle(g.id)} aria-expanded={!shut.has(g.id)} style={{ display: 'flex', alignItems: 'baseline', gap: '2px 10px', flexWrap: 'wrap',
                width: '100%', textAlign: 'left', border: 'none', borderBottom: rule(cw), background: cw.surface, color: cw.ink, padding: '5px 12px',
                cursor: 'pointer', fontFamily: cw.fontBody }}>
                <span style={{ width: 10, fontSize: 10, color: cw.inkMuted }}>{shut.has(g.id) ? '▸' : '▾'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8 }}>{g.label}</span>
                <b style={{ fontFamily: cw.fontMono, fontSize: 12.5 }}>{g.items.length}</b>
                <span style={{ fontSize: 12, color: cw.inkMuted }}>{tally(g.items)}</span>
              </button>
              {!shut.has(g.id) && g.items.map(i => {
                const on = sel === i.sel;
                return (
                  <button key={i.sel} onClick={() => onSelect(i.sel)} aria-pressed={on} style={{
                    display: 'grid', gridTemplateColumns: cols, gap: '1px 12px', width: '100%', textAlign: 'left', border: 'none', borderBottom: rule(cw),
                    background: on ? `${cw.accent}22` : 'transparent', color: cw.ink, padding: '4px 12px 4px 32px', cursor: 'pointer',
                    fontFamily: cw.fontBody, fontSize: 14, lineHeight: 1.4,
                  }}>
                    <span style={{ fontFamily: cw.fontMono, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.code}</span>
                    <span title={i.name} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                    <span style={{ gridColumn: narrow ? '1 / -1' : undefined, minWidth: 0, overflowWrap: 'anywhere' }}>
                      <b style={{ color: cw.warn }}>{KIND_WORD[i.kind]}:</b> {i.closes}
                    </span>
                    {on && isOwner && i.notes.length > 0 && (
                      <span style={{ gridColumn: '1 / -1', fontSize: 12.5, color: cw.inkMuted, overflowWrap: 'anywhere' }}>
                        <b>THE INDEX'S NOTE (OWNER):</b> {i.notes.join(' · ')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
