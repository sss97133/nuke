// map/useWorkspaceSelection.ts — the MAP workspace's shared model: the public site files (end positions, loom routes,
// the part-model index), an index over the typed rows, the selection in the URL (?sel=), and what each selection links
// to, so the tree, the views, the properties and the tables all light the same things (cross-probing).
//
// Selection ids: n:<node code> · w:<wire code> · p:<node code>|<cavity> · s:<segment> · d:<device> · y:<section> · k:<call slug>

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MapEnd, MapNode, MapWire, WiringMapData } from './useWiringMap';

export interface SiteEnd {
  xyz: [number, number, number];
  basis: string;
  margin_mm: number | null;
  dev: string;
  dev_name: string;
  size?: { shape?: string; dx?: number; dy?: number; dz?: number; d?: number; t?: number; axis?: string };
  color?: string;
  on?: string;
  face?: Record<string, [number, number]>;
}
export interface SiteSeg {
  id: string; b: string | null; od: number | null; par: number; len: number | null; mar: number | null; cov: string | null;
  f: string; t: string; w: string[]; clips: number; pts: [number, number, number][];
}
export interface PartModel { endpoints?: string[]; shape_basis?: string; what?: string; maker?: string; maker_pn?: string; dims_mm?: Record<string, number> }
export interface PartModelIndex {
  generated?: string;
  ends?: Record<string, { models: string[]; complete: boolean }>;
  ends_by_shape_basis?: Record<string, number>;   // the index's own split (index_v5), when it carries one
  parts: Record<string, PartModel>;
}
export interface SiteFiles { loaded: boolean; ends: Record<string, SiteEnd>; segs: SiteSeg[]; models: PartModelIndex | null }

const EMPTY_SITE: SiteFiles = { loaded: false, ends: {}, segs: [], models: null };
const getJson = (u: string) => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null);

/** The vehicle's public design files; each carries its vehicle id, so another vehicle reads none of them.
 *  TODO: the end positions move into harness_endpoints in the next registry pass; this file is the bridge until then. */
export function useSiteFiles(vehicleId: string | undefined): SiteFiles {
  const [site, setSite] = useState<SiteFiles>(EMPTY_SITE);
  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    Promise.all([getJson('/wiring/k5-positions.json'), getJson('/wiring/k5-routes.json'), getJson('/wiring/part-models/index.json')])
      .then(([pos, rts, pm]) => {
        if (cancelled) return;
        const mine = (f: { vehicle_id?: string } | null) => !!f && f.vehicle_id === vehicleId;
        setSite({
          loaded: true,
          ends: mine(pos) ? (pos.ends ?? {}) : {},
          segs: mine(rts) ? (rts.segments ?? []) : [],
          models: mine(pos) && pm ? pm : null,
        });
      });
    return () => { cancelled = true; };
  }, [vehicleId]);
  return site;
}

export interface PinRow { node: string; cav: string; wires: string[]; terminal: string | null; seal: string | null; tool: string | null }

export interface WsIndex {
  byId: Map<string, MapNode>;
  byCode: Map<string, MapNode>;
  wireByCode: Map<string, MapWire>;
  pins: PinRow[];
  pinsByNode: Map<string, PinRow[]>;
  wiresByNode: Map<string, Set<string>>;
  chain: Map<string, { code: string; cav: string | null }[]>;   // wire code -> its ends, source first
  segsByWire: Map<string, string[]>;
  segById: Map<string, SiteSeg>;
  devOf: (code: string) => string;
}

// a cavity as the page shows it: the cavity itself. A working note after it (" — pin order OPEN until …") or beside it
// ("(AEM pin letter unknown until …)", "(ZGP p.11)") stays on the row.
const cavOf = (c: string | null) => (c ? c.split(' — ')[0].split(' (')[0].trim() : c);
const RANK = (c: string) => (/^(M130|PDM)/.test(c) ? 0 : /^(SPL-|RAIL-)/.test(c) ? 1 : /^FIREWALL-CABIN/.test(c) ? 2 : /^FIREWALL/.test(c) ? 3 : 4);

export function useWsIndex(map: WiringMapData, site: SiteFiles): WsIndex {
  return useMemo(() => {
    const byId = new Map(map.nodes.map(n => [n.id, n]));
    const byCode = new Map(map.nodes.map(n => [n.code, n]));
    const wireById = new Map(map.wires.map(w => [w.id, w]));
    const wireByCode = new Map(map.wires.map(w => [w.code, w]));
    const endsByWire = new Map<string, MapEnd[]>();
    map.ends.forEach(e => { const a = endsByWire.get(e.circuitId) ?? []; a.push(e); endsByWire.set(e.circuitId, a); });
    const pinKey = new Map<string, PinRow>();
    const wiresByNode = new Map<string, Set<string>>();
    const chain = new Map<string, { code: string; cav: string | null }[]>();
    const addPin = (node: string, cav: string | null, wire: string, e?: MapEnd) => {
      const k = node + '|' + (cav ?? '');
      const p = pinKey.get(k) ?? { node, cav: cav ?? '', wires: [], terminal: e?.terminal ?? null, seal: e?.seal ?? null, tool: e?.tool ?? null };
      if (!p.wires.includes(wire)) p.wires.push(wire);
      pinKey.set(k, p);
      const s = wiresByNode.get(node) ?? new Set<string>(); s.add(wire); wiresByNode.set(node, s);
    };
    map.wires.forEach(w => {
      const ends = endsByWire.get(w.id) ?? [];
      const hops = ends.map(e => ({ code: byId.get(e.endpointId)?.code ?? '', cav: cavOf(e.cavity), e })).filter(h => h.code);
      if (!hops.length) {                      // no wire ends on file yet: the wire's own from/to links
        const f = byId.get(w.fromId ?? '')?.code, t = byId.get(w.toId ?? '')?.code;
        if (f) hops.push({ code: f, cav: cavOf(w.fromCavity), e: undefined as unknown as MapEnd });
        if (t) hops.push({ code: t, cav: cavOf(w.toCavity), e: undefined as unknown as MapEnd });
      }
      const from = byId.get(w.fromId ?? '')?.code;
      hops.sort((a, b) => (a.code === from ? -1 : b.code === from ? 1 : RANK(a.code) - RANK(b.code)));
      chain.set(w.code, hops.map(h => ({ code: h.code, cav: h.cav })));
      hops.forEach(h => addPin(h.code, h.cav, w.code, h.e));
    });
    void wireById;
    const pins = [...pinKey.values()];
    const pinsByNode = new Map<string, PinRow[]>();
    pins.forEach(p => { const a = pinsByNode.get(p.node) ?? []; a.push(p); pinsByNode.set(p.node, a); });
    pinsByNode.forEach(a => a.sort((x, y) => x.cav.localeCompare(y.cav, undefined, { numeric: true })));
    const segsByWire = new Map<string, string[]>();
    site.segs.forEach(s => s.w.forEach(wc => { const a = segsByWire.get(wc) ?? []; a.push(s.id); segsByWire.set(wc, a); }));
    const segById = new Map(site.segs.map(s => [s.id, s]));
    const devOf = (code: string) => site.ends[code]?.dev ?? code;
    return { byId, byCode, wireByCode, pins, pinsByNode, wiresByNode, chain, segsByWire, segById, devOf };
  }, [map.nodes, map.wires, map.ends, site.segs, site.ends]);
}

export interface Rel { nodes: Set<string>; wires: Set<string>; pins: Set<string>; segs: Set<string>; devs: Set<string>; sections: Set<string> }
export const kindOf = (id: string | null) => (id ? id.slice(0, id.indexOf(':')) : '');
export const valOf = (id: string | null) => (id ? id.slice(id.indexOf(':') + 1) : '');

export function relOf(sel: string | null, ix: WsIndex, map: WiringMapData): Rel {
  const R: Rel = { nodes: new Set(), wires: new Set(), pins: new Set(), segs: new Set(), devs: new Set(), sections: new Set() };
  if (!sel) return R;
  const addWire = (wc: string, withSegs = true) => {
    const w = ix.wireByCode.get(wc); if (!w) return;
    R.wires.add(wc); if (w.section) R.sections.add(w.section);
    (ix.chain.get(wc) ?? []).forEach(h => { R.nodes.add(h.code); R.pins.add(h.code + '|' + (h.cav ?? '')); R.devs.add(ix.devOf(h.code)); });
    if (withSegs) (ix.segsByWire.get(wc) ?? []).forEach(s => R.segs.add(s));
  };
  const addNode = (code: string) => {
    R.nodes.add(code); R.devs.add(ix.devOf(code));
    (ix.pinsByNode.get(code) ?? []).forEach(p => { R.pins.add(code + '|' + p.cav); p.wires.forEach(wc => addWire(wc)); });
  };
  const k = kindOf(sel), v = valOf(sel);
  if (k === 'n') addNode(v);
  else if (k === 'w') addWire(v);
  else if (k === 'p') { const [code] = v.split('|'); R.pins.add(v); R.nodes.add(code); (ix.pins.find(p => p.node + '|' + p.cav === v)?.wires ?? []).forEach(wc => addWire(wc)); }
  else if (k === 's') { const s = ix.segById.get(v); if (s) { R.segs.add(v); s.w.forEach(wc => addWire(wc, false)); } }
  else if (k === 'd') map.nodes.filter(n => ix.devOf(n.code) === v).forEach(n => addNode(n.code));
  else if (k === 'y') { R.sections.add(v); map.wires.filter(w => w.section === v).forEach(w => addWire(w.code)); }
  else if (k === 'k') { const c = map.calls.find(x => x.slug === v); (c?.links ?? []).forEach(l => { if (l.endpointCode) addNode(l.endpointCode); }); }
  return R;
}

/** The selection lives in the URL, so a view can be linked. The MAP tab's older ?node= and ?call= still open. */
export function useSelection(): [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const sel = params.get('sel') ?? (params.get('node') ? 'n:' + params.get('node') : params.get('call') ? 'k:' + params.get('call') : null);
  const set = (id: string | null) => setParams(prev => {
    const p = new URLSearchParams(prev);
    p.delete('node'); p.delete('call');
    if (id) p.set('sel', id); else p.delete('sel');
    return p;
  }, { replace: true });
  return [sel, set];
}

/** What the page may print of free text from the records: amounts, order and listing numbers are masked. */
export function mask(t: string | null | undefined): string {
  return String(t ?? '')
    .replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, '$•••')
    .replace(/\b((?:order|invoice|receipt|confirmation)\s*(?:no\.?|number|num)?\s*[:#]?\s*)(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{2,}/gi, '$1•••')
    .replace(/((?:ebay|amazon)\.com\/(?:itm|dp)\/)[\w-]{6,}/gi, '$1•••')
    .replace(/\b((?:ebay|amazon)\s+(?:item|listing)\s*#?\s*)\d{6,}/gi, '$1•••');
}

// The buying story (where a part was lined up, what it cost, when it was ordered, through whom) is the owner's record,
// not the result. A public name keeps what the part is: story clauses and story asides go, the first clause stays.
const STORY = /\$|\b(?:lined up|re-?ordered|ordered|on order|backorder(?:ed)?|bought|owned|delivered|paid|invoice|receipt|seller|state row)\b/i;
export function publicName(t: string | null | undefined): string {
  const s = String(t ?? '').replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (STORY.test(inner) ? '' : m));
  const parts = s.split(/(\s*;\s*|\s+—\s+)/);
  let out = parts[0];
  const cut = out.search(STORY);
  if (cut > 0) out = out.slice(0, cut).replace(/[\s,:—-]+$/, '');
  for (let i = 1; i < parts.length; i += 2) if (!STORY.test(parts[i + 1] ?? '')) out += parts[i] + (parts[i + 1] ?? '');
  return mask(out.trim());
}

/** A part number the page may show: never a marketplace listing, and "unknown" reads as a dash. */
export function partNo(pn: string | null | undefined): string {
  const s = String(pn ?? '').trim();
  if (!s || /^unknown$/i.test(s) || /(?:ebay|amazon)\s+(?:item|listing)/i.test(s)) return '—';
  return mask(s);
}

// 3D completion: an end counts once, at the WEAKEST shape source among its models (a chain is as strong as its weakest
// record), so an assumed shape never counts as a sourced one. The part-model index writes the split itself
// (ends_by_shape_basis); it is computed here the same way only when the index doesn't carry it.
export const SHAPE_ORDER = ['maker drawing', 'datasheet dims', 'scaled from photo', 'twin object', 'not sourced'];
export const modelsOf = (idx: PartModelIndex, code: string): string[] =>
  idx.ends?.[code]?.models ?? Object.entries(idx.parts).filter(([, p]) => (p.endpoints ?? []).includes(code)).map(([id]) => id);
export const weakestBasis = (idx: PartModelIndex, models: string[]): string =>
  models.map(m => idx.parts[m]?.shape_basis ?? 'not sourced').map(b => (SHAPE_ORDER.includes(b) ? b : 'not sourced'))
    .sort((a, b) => SHAPE_ORDER.indexOf(b) - SHAPE_ORDER.indexOf(a))[0] ?? 'not sourced';
export function coverage(site: SiteFiles) {
  const idx = site.models, total = Object.keys(site.ends).length;
  const modelled: string[] = [], complete: string[] = [], bySource: Record<string, number> = {};
  SHAPE_ORDER.forEach(s => { bySource[s] = 0; });
  if (idx) {
    Object.keys(site.ends).forEach(code => {
      const models = modelsOf(idx, code);
      if (!models.length) return;
      modelled.push(code);
      if (idx.ends?.[code]?.complete) complete.push(code);
      bySource[weakestBasis(idx, models)] += 1;
    });
    if (idx.ends_by_shape_basis) SHAPE_ORDER.forEach(s => { bySource[s] = Number(idx.ends_by_shape_basis?.[s] ?? 0); });
  }
  return { total, modelled, complete, bySource };
}
