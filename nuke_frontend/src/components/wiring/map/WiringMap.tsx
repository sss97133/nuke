// map/WiringMap.tsx — MAP tab: every wire end, plug and open call of the vehicle's harness on one plan, worked
// one target at a time (owner, 2026-09-27; plan ~/.claude/plans/vivid-hugging-globe.md).
//
// Layers: TRUCK → SECTION → NODE (plug / device / splice / stud) → WIRE END. Each node is a target: click it and the
// card shows what it takes, its wires with their paper (vehicle_observations via useWiringFacts), its wire ends,
// and the open calls it's coupled with. Open calls (M130 location, …) are targets too; selecting one highlights
// what it's coupled with (the design structure matrix). Nodes without a twin position sit in their section's tray
// — never drawn at an invented spot.
//
// Reads typed rows only (useWiringMap). Plan drawing shared with the WORKBENCH plan view (planGeometry).
// Chrome from the connector inspector's colorways (PAPER default). URL-addressable: ?tab=map&sec=&node=&call=

import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VBW, VBH, sx, sy, PlanEnvelope } from '../planGeometry';
import {
  COLORWAYS, COLORWAY_LIST, COLORWAY_STORAGE_KEY, ColorwayContext, DEFAULT_COLORWAY,
  frame, isColorwayId, rule, textOn, type Colorway, type ColorwayId,
} from '../connector-inspector/colorways';
import { useWiringFacts } from '../connector-inspector/useWiringFacts';
import { WireEvidence } from '../connector-inspector/WireEvidence';
import {
  SECTIONS, useWiringMap, type MapCall, type MapEnd, type MapNode, type MapWire, type Section, type WorkStatus,
} from './useWiringMap';

const WORK_WORD: Record<WorkStatus, string> = {
  open: 'OPEN', in_progress: 'IN PROGRESS', needs_owner: 'NEEDS YOU', done: 'DONE', blocked: 'BLOCKED',
};

function statusColor(cw: Colorway, s: WorkStatus): string {
  return s === 'done' ? cw.ok : s === 'needs_owner' ? cw.warn : s === 'blocked' ? cw.danger : s === 'in_progress' ? cw.accent : cw.ink;
}

export function WiringMap({ vehicleId }: { vehicleId?: string }) {
  const [params, setParams] = useSearchParams();
  const rawCw = params.get('cw');
  let storedCw: string | null = null;
  try { storedCw = window.localStorage.getItem(COLORWAY_STORAGE_KEY); } catch { /* private mode */ }
  const colorwayId: ColorwayId = isColorwayId(rawCw) ? rawCw : isColorwayId(storedCw) ? storedCw : DEFAULT_COLORWAY;
  const cw = COLORWAYS[colorwayId];

  const map = useWiringMap(vehicleId);
  const facts = useWiringFacts(vehicleId);

  const sec = (params.get('sec') as Section | null) || null;
  const nodeCode = params.get('node');
  const callSlug = params.get('call');
  const set = (patch: Record<string, string | null>) => setParams(prev => {
    const p = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v === null) p.delete(k); else p.set(k, v); }
    return p;
  }, { replace: true });
  const setColorway = (id: ColorwayId) => {
    try { window.localStorage.setItem(COLORWAY_STORAGE_KEY, id); } catch { /* private mode */ }
    set({ cw: id });
  };

  const byId = useMemo(() => new Map(map.nodes.map(n => [n.id, n])), [map.nodes]);
  const node = nodeCode ? map.nodes.find(n => n.code === nodeCode) ?? null : null;
  const call = callSlug ? map.calls.find(c => c.slug === callSlug) ?? null : null;

  // what the selected call is coupled with (lit on the plan)
  const coupled = useMemo(() => new Set((call?.links ?? []).map(l => l.endpointId).filter(Boolean) as string[]), [call]);

  // rollups per section (the group-context layer)
  const rollup = useMemo(() => {
    const r: Record<string, { nodes: number; placed: number; done: number; needs: number; decided: number; concept: number }> = {};
    for (const s of SECTIONS) r[s.id] = { nodes: 0, placed: 0, done: 0, needs: 0, decided: 0, concept: 0 };
    for (const n of map.nodes) {
      const x = n.section && r[n.section];
      if (!x) continue;
      x.nodes += 1; if (n.x != null) x.placed += 1; if (n.workStatus === 'done') x.done += 1; if (n.workStatus === 'needs_owner') x.needs += 1;
    }
    for (const w of map.wires) {
      const x = w.section && r[w.section];
      if (!x) continue;
      if (w.designStatus === 'decided') x.decided += 1; else x.concept += 1;
    }
    return r;
  }, [map.nodes, map.wires]);

  const visible = map.nodes.filter(n => !sec || n.section === sec);
  const placed = visible.filter(n => n.x != null && n.y != null);
  const unplaced = visible.filter(n => n.x == null || n.y == null);

  // nodes sharing one anchor fan out in a small ring, so each stays clickable (display only; data keeps the anchor)
  const drawn = useMemo(() => {
    const groups = new Map<string, MapNode[]>();
    for (const n of placed) {
      const k = `${n.x!.toFixed(3)},${n.y!.toFixed(3)}`;
      groups.set(k, [...(groups.get(k) ?? []), n]);
    }
    const out: { n: MapNode; px: number; py: number; lx: number; ly: number; solo: boolean; lead: boolean; more: number }[] = [];
    for (const g of groups.values()) {
      const cx = sx(g[0].y!), cy = sy(g[0].x!);
      g.forEach((n, i) => {
        const a = (i / Math.max(1, g.length)) * Math.PI * 2 - Math.PI / 2;
        const r = g.length > 1 ? 10 + g.length * 1.8 : 0;
        const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
        // a cluster gets ONE label above it (first code + how many more); each node still has its own tooltip + click
        out.push({ n, px, py, lx: cx, ly: cy - r - 9, solo: g.length === 1, lead: i === 0, more: g.length - 1 });
      });
    }
    return out;
  }, [placed]);

  const loading = !map.loaded;
  return (
    <ColorwayContext.Provider value={cw}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: cw.bg, color: cw.ink, fontFamily: cw.fontBody }}>
        {/* ── header: layers + colorway ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: rule(cw), flexWrap: 'wrap' }}>
          <Tab cw={cw} on={!sec} onClick={() => set({ sec: null, node: null, call: null })} label="TRUCK" sub={`${map.nodes.length} NODES`} />
          {SECTIONS.map(s => {
            const r = rollup[s.id];
            if (!r || r.nodes + r.decided + r.concept === 0) return null;
            return (
              <Tab key={s.id} cw={cw} on={sec === s.id} onClick={() => set({ sec: s.id, node: null, call: null })} label={s.label}
                sub={`${r.done}/${r.nodes} DONE · ${r.decided + r.concept} WIRES${r.concept ? ` (${r.concept} CONCEPT)` : ''}`} />
            );
          })}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {COLORWAY_LIST.map(c => (
              <button key={c.id} onClick={() => setColorway(c.id)} title={c.label} style={{
                background: c.id === colorwayId ? cw.accent : cw.surface, color: c.id === colorwayId ? cw.onAccent : cw.ink,
                border: frame(cw), fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, padding: '2px 8px', cursor: 'pointer',
              }}>{c.label}</button>
            ))}
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* ── plan + calls + trays ── */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '8px 12px' }}>
            {loading && <div style={{ fontSize: 14, color: cw.inkFaint }}>READING THE MAP…</div>}
            {map.error && <div style={{ fontSize: 14, color: cw.danger }}>DATABASE READ FAILED: {map.error}</div>}
            {!loading && !map.error && (
              <>
                <svg viewBox={`0 0 ${VBW} ${VBH}`} style={{ width: '100%', display: 'block', border: frame(cw), background: cw.surface }}>
                  <PlanEnvelope body={cw.faceStroke} border={cw.border} muted={cw.inkFaint} font={cw.fontBody} />
                  {drawn.map(({ n, px, py, lx, ly, solo, lead, more }) => {
                    const sel = node?.id === n.id;
                    const lit = coupled.has(n.id);
                    const c = statusColor(cw, n.workStatus);
                    return (
                      <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => set({ node: n.code, call: null, sec: n.section ?? sec })}>
                        <rect x={px - 5} y={py - 5} width={10} height={10}
                          fill={n.designStatus === 'decided' ? c : cw.surface} stroke={lit ? cw.warn : c}
                          strokeWidth={sel || lit ? 3 : 1.5}>
                          <title>{`${n.code} — ${n.name} · ${WORK_WORD[n.workStatus]} · ${n.posSource ?? ''}`}</title>
                        </rect>
                        {(sel || lit) && !solo && (
                          <text x={px} y={py - 8} fontFamily={cw.fontMono} fontSize={9} fontWeight={700} fill={lit ? cw.warn : cw.accent}
                            textAnchor="middle" style={{ pointerEvents: 'none' }}>{n.code}</text>
                        )}
                        {!!sec && (solo || lead) && !((sel || lit) && !solo) && (
                          <text x={solo ? px : lx} y={solo ? py - 8 : ly} fontFamily={cw.fontMono} fontSize={9} fontWeight={700}
                            fill={lit ? cw.warn : cw.ink} textAnchor="middle" style={{ pointerEvents: 'none' }}>
                            {n.code}{!solo && more > 0 ? ` +${more}` : ''}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* open calls: targets too */}
                {map.calls.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted, marginBottom: 4 }}>
                      OPEN CALLS ({map.calls.filter(c => c.workStatus !== 'decided').length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {map.calls.map(c => (
                        <button key={c.id} onClick={() => set({ call: c.slug, node: null })} style={{
                          background: call?.id === c.id ? cw.warn : cw.surface, color: call?.id === c.id ? textOn(cw.warn) : cw.ink,
                          border: `2px solid ${cw.warn}`, fontFamily: cw.fontBody, fontSize: 14, padding: '3px 8px', cursor: 'pointer',
                        }}>
                          {c.subject.toUpperCase()}{c.options.length ? ` · ${c.options.length} OPTIONS` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* trays: nodes that aren't placed yet, by section */}
                {unplaced.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted, marginBottom: 4 }}>
                      NOT PLACED YET ({unplaced.length}) — NO POSITION ON THE TRUCK
                    </div>
                    {SECTIONS.filter(s => !sec || s.id === sec).map(s => {
                      const list = unplaced.filter(n => n.section === s.id);
                      if (!list.length) return null;
                      return (
                        <div key={s.id} style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 14, color: cw.inkFaint, marginBottom: 3 }}>{s.label} ({list.length})</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {list.map(n => (
                              <button key={n.id} onClick={() => set({ node: n.code, call: null })} title={n.name} style={{
                                background: node?.id === n.id ? cw.accent : cw.surface, color: node?.id === n.id ? cw.onAccent : cw.ink,
                                border: rule(cw), borderLeft: `4px solid ${statusColor(cw, n.workStatus)}`,
                                fontFamily: cw.fontMono, fontSize: 14, padding: '2px 6px', cursor: 'pointer',
                              }}>{n.code}</button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── the target card ── */}
          <div style={{ width: 400, flexShrink: 0, borderLeft: frame(cw), background: cw.surface, overflowY: 'auto', padding: '12px 14px' }}>
            {node && <NodeCard cw={cw} n={node} map={map} byId={byId} facts={facts} onNode={c => set({ node: c })} onCall={s => set({ call: s, node: null })} />}
            {!node && call && <CallCard cw={cw} c={call} map={map} byId={byId} onNode={c => set({ node: c, call: null })} />}
            {!node && !call && <Rollup cw={cw} sec={sec} rollup={rollup} calls={map.calls} />}
          </div>
        </div>
      </div>
    </ColorwayContext.Provider>
  );
}

function Tab({ cw, on, onClick, label, sub }: { cw: Colorway; on: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button onClick={onClick} style={{
      background: on ? cw.accent : cw.surface, color: on ? cw.onAccent : cw.ink, border: frame(cw),
      fontFamily: cw.fontBody, padding: '3px 8px', cursor: 'pointer', textAlign: 'left',
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 12, opacity: 0.85 }}>{sub}</div>
    </button>
  );
}

function Field({ cw, label, children }: { cw: Colorway; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.6, alignItems: 'baseline' }}>
      <span style={{ width: 96, flexShrink: 0, color: cw.inkFaint, fontWeight: 700, letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontFamily: cw.fontMono, color: cw.ink, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

function Head({ cw, children }: { cw: Colorway; children: React.ReactNode }) {
  return <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted, margin: '12px 0 4px', borderTop: rule(cw), paddingTop: 8 }}>{children}</div>;
}

function NodeCard({ cw, n, map, byId, facts, onNode, onCall }: {
  cw: Colorway; n: MapNode; map: ReturnType<typeof useWiringMap>; byId: Map<string, MapNode>;
  facts: ReturnType<typeof useWiringFacts>; onNode: (code: string) => void; onCall: (slug: string) => void;
}) {
  // a wire touches this node if one of its ends is here (wire_termination_specs, every end of every wire) or its
  // from/to link points here; its path is all its ends in order: M130/PDM -> 61-pin -> device
  const ends = new Map<string, MapEnd>(map.ends.filter(e => e.endpointId === n.id).map(e => [e.circuitId, e]));
  const wires = map.wires.filter(w => ends.has(w.id) || w.fromId === n.id || w.toId === n.id);
  const pathOf = (w: MapWire): string => {
    const codes = map.ends.filter(e => e.circuitId === w.id).map(e => byId.get(e.endpointId)?.code).filter(Boolean) as string[];
    const all = codes.length ? codes : [byId.get(w.fromId ?? '')?.code ?? w.fromText ?? '?', byId.get(w.toId ?? '')?.code ?? w.toText ?? '?'];
    const rank = (c: string) => (/^(M130|PDM30)/.test(c) ? 0 : /^FIREWALL-CABIN/.test(c) ? 1 : /^FIREWALL/.test(c) ? 2 : 3);
    return [...new Set(all)].sort((a, b) => rank(a) - rank(b)).map(c => (c === n.code ? `[${c}]` : c)).join(' → ');
  };
  const calls = map.calls.filter(c => c.links.some(l => l.endpointId === n.id));
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div>
      <div style={{ fontFamily: cw.fontMono, fontSize: 19, fontWeight: 700, color: cw.accent }}>{n.code}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{n.name}</div>
      <Field cw={cw} label="TYPE">{n.type.toUpperCase()}{n.family && n.family !== 'unknown' ? ` · ${n.family.toUpperCase()}` : ''}</Field>
      <Field cw={cw} label="STATUS">
        <span style={{ color: statusColor(cw, n.workStatus), fontWeight: 700 }}>{WORK_WORD[n.workStatus]}</span>
        {' · '}{n.designStatus === 'decided' ? 'DECIDED' : 'CONCEPT (NOT DECIDED)'}
      </Field>
      <Field cw={cw} label="WHO">{n.assignee ?? 'UNASSIGNED'}</Field>
      <Field cw={cw} label="POSITION">{n.x != null ? n.posSource ?? 'placed' : 'NOT PLACED YET'}</Field>
      {n.partNumber && <Field cw={cw} label="PLUG / KIT">{n.partNumber}</Field>}
      {n.notes && <Field cw={cw} label="NOTE">{n.notes}</Field>}
      <Field cw={cw} label="SOURCE">{n.source ?? '—'}{n.trust ? ` (${n.trust})` : ''}</Field>

      {wires.length > 0 && <Head cw={cw}>WIRES AT THIS NODE ({wires.length})</Head>}
      {wires.map(w => {
        const end = ends.get(w.id);
        const other = map.ends.filter(e => e.circuitId === w.id && e.endpointId !== n.id)
          .map(e => byId.get(e.endpointId)).find(Boolean) ?? byId.get(w.fromId === n.id ? w.toId ?? '' : w.fromId ?? '');
        const cav = end?.cavity ?? (w.fromId === n.id ? w.fromCavity : w.toCavity);
        const isOpen = open === w.id;
        return (
          <div key={w.id} style={{ borderBottom: rule(cw), padding: '4px 0' }}>
            <button onClick={() => setOpen(isOpen ? null : w.id)} style={{
              display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: 0,
              cursor: 'pointer', color: cw.ink, fontFamily: cw.fontBody, fontSize: 14, lineHeight: 1.5,
            }}>
              <span style={{ fontFamily: cw.fontMono, fontWeight: 700, color: cw.accent }}>#{w.code}</span> {w.name}
              <span style={{ color: cw.inkFaint }}>
                {' · '}{w.gauge ? `${w.gauge} AWG ` : ''}{w.color ?? ''}{cav ? ` · CAVITY ${cav}` : ''}
                {' · '}{pathOf(w)}
                {w.designStatus === 'concept' ? ' · CONCEPT' : ''}{isOpen ? ' ▾' : ' ▸'}
              </span>
            </button>
            {isOpen && (
              <div style={{ paddingLeft: 8 }}>
                {end && (
                  <Field cw={cw} label="THIS END">
                    {[end.terminal, end.seal].filter(Boolean).join(' + ') || '—'}{end.tool ? ` · TOOL ${end.tool}` : ''}
                  </Field>
                )}
                {other && <button onClick={() => onNode(other.code)} style={linkStyle(cw)}>OPEN {other.code} ▸</button>}
                <WireEvidence wireId={w.code} facts={facts} cw={cw} />
              </div>
            )}
          </div>
        );
      })}

      {calls.length > 0 && <Head cw={cw}>OPEN CALLS THIS DEPENDS ON ({calls.length})</Head>}
      {calls.map(c => (
        <button key={c.id} onClick={() => onCall(c.slug)} style={linkStyle(cw)}>{c.subject.toUpperCase()} ▸</button>
      ))}
    </div>
  );
}

function CallCard({ cw, c, map, byId, onNode }: {
  cw: Colorway; c: MapCall; map: ReturnType<typeof useWiringMap>; byId: Map<string, MapNode>; onNode: (code: string) => void;
}) {
  const callsById = new Map(map.calls.map(x => [x.id, x]));
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.warn }}>OPEN CALL</div>
      <div style={{ fontSize: 17, fontWeight: 700, margin: '4px 0 8px' }}>{c.subject}</div>
      <Field cw={cw} label="KIND">{(c.kind ?? '—').toUpperCase()}</Field>
      <Field cw={cw} label="STATUS">{(c.workStatus ?? 'open').toUpperCase().replace('_', ' ')}</Field>
      <Field cw={cw} label="WHO">{c.assignee ?? 'UNASSIGNED'}</Field>
      {c.options.length > 0 && <Head cw={cw}>OPTIONS ON RECORD ({c.options.length}) — NOT RANKED YET</Head>}
      {c.options.map(o => (
        <div key={o.id} style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 6 }}>
          <div style={{ fontWeight: 700 }}>{o.label}{o.zone ? ` · ${o.zone.toUpperCase()}` : ''}</div>
          {o.source && <div style={{ color: cw.inkFaint }}>{o.source}</div>}
        </div>
      ))}
      {c.links.length > 0 && <Head cw={cw}>COUPLED WITH ({c.links.length})</Head>}
      {c.links.map((l, i) => {
        const nd = l.endpointId ? byId.get(l.endpointId) : null;
        const oc = l.otherDecisionId ? callsById.get(l.otherDecisionId) : null;
        return (
          <div key={i} style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 6 }}>
            {nd && <button onClick={() => onNode(nd.code)} style={linkStyle(cw)}>{nd.code} — {nd.name} ▸</button>}
            {oc && <div style={{ fontWeight: 700 }}>{oc.subject}</div>}
            {l.note && <div>{l.note}</div>}
            <div style={{ color: cw.inkFaint }}>{l.source}{l.trust ? ` (${l.trust})` : ''}</div>
          </div>
        );
      })}
    </div>
  );
}

function Rollup({ cw, sec, rollup, calls }: {
  cw: Colorway; sec: Section | null; rollup: Record<string, { nodes: number; placed: number; done: number; needs: number; decided: number; concept: number }>;
  calls: MapCall[];
}) {
  const rows = SECTIONS.filter(s => !sec || s.id === sec).filter(s => rollup[s.id] && rollup[s.id].nodes + rollup[s.id].decided + rollup[s.id].concept > 0);
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted, marginBottom: 6 }}>
        {sec ? SECTIONS.find(s => s.id === sec)?.label : 'WHOLE TRUCK'} — WHERE IT STANDS
      </div>
      {rows.map(s => {
        const r = rollup[s.id];
        return (
          <div key={s.id} style={{ borderBottom: rule(cw), padding: '6px 0', fontSize: 14, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700 }}>{s.label}</div>
            <div style={{ fontFamily: cw.fontMono }}>
              {r.done}/{r.nodes} NODES DONE · {r.placed} PLACED · {r.needs} NEED YOU
            </div>
            <div style={{ fontFamily: cw.fontMono }}>
              {r.decided} WIRES DECIDED · {r.concept} CONCEPT
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 14, color: cw.inkFaint, marginTop: 8 }}>
        {calls.filter(c => c.workStatus !== 'decided').length} OPEN CALLS · CLICK A NODE OR A CALL TO WORK IT.
      </div>
    </div>
  );
}

function linkStyle(cw: Colorway): React.CSSProperties {
  return {
    display: 'block', background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer', textAlign: 'left',
    color: cw.accent, fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700,
  };
}

export default WiringMap;
