// map/WiringMap.tsx — MAP tab: the vehicle's harness as one engineering workspace (owner 2026-09-29): the tree (harness
// section → device → connector → cavity), one centre view (plan, 3D by zone, connector face, schematic, parts library),
// the selection's properties and the linked tables (wire list, pin list, connectors), all lit by one selection.
// Earlier layout: every node on one plan, worked one target at a time (owner, 2026-09-27; plan vivid-hugging-globe.md).
//
// Everyone sees the results. The owner (the profile's owner check) also sees what needs him, the open calls and
// decisions, and each record's proof and sources (NodeCard, CallCard, WireRecords below).
//
// Reads typed rows only (useWiringMap) plus the vehicle's public design files (useSiteFiles: end positions, loom
// routes, the part-model index). Chrome from the connector inspector's colorways (PAPER default).
// URL-addressable: ?tab=map&view=&sel= (older ?node= and ?call= still open).

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useVehiclePermissions } from '../../../hooks/useVehiclePermissions';
import {
  COLORWAYS, COLORWAY_LIST, COLORWAY_STORAGE_KEY, ColorwayContext, DEFAULT_COLORWAY,
  frame, isColorwayId, rule, textOn, type Colorway, type ColorwayId,
} from '../connector-inspector/colorways';
import { useWiringFacts, type WiringFact, type PurchaseRecord, type ListingRecord } from '../connector-inspector/useWiringFacts';
import { optimizeImageUrl } from '../../../lib/imageOptimizer';
import { WireEvidence } from '../connector-inspector/WireEvidence';
import { DevicePhoto, EnginePhoto, MountsPanel, PartPhotos, WhereOnTruck } from './MountsPanel';
import {
  SECTIONS, useWiringMap, type MapCall, type MapEnd, type MapNode, type MapWire, type Section, type WiringMapData, type WorkStatus,
} from './useWiringMap';
import {
  SHAPE_ORDER, coverage, kindOf, mask, publicName, relOf, useSelection, useSiteFiles, useWsIndex, valOf,
  type SiteFiles, type WsIndex,
} from './useWorkspaceSelection';
import { WorkspaceTree } from './WorkspaceTree';
import { ConnectorFace, PlanView } from './WorkspaceViews';
import { SchematicBlock } from './SchematicBlock';
import { WorkspaceTables } from './WorkspaceTables';
import { WorkspaceProps } from './WorkspaceProps';
import { PartLibrary } from './PartLibrary';
import { needsOwner } from './ownerLayer';

const WORK_WORD: Record<WorkStatus, string> = {
  open: 'OPEN', in_progress: 'IN PROGRESS', needs_owner: 'NEEDS YOU', done: 'DONE', blocked: 'BLOCKED',
};

// Proof a part was lined up, acquired, installed — or not (owner 2026-09-26). Each rung takes its own kind of evidence
// (owner 2026-09-27: "m130 in hand sure.. but any proof of purchase?", "throttle body likely never installed"):
// lined up = a cart, quote or circled listing; acquired = a purchase record, shown whole — ordered, paid, delivered,
// from whom, exactly what, and whether it is the part the design calls for (owner 2026-09-27: "bought? that word
// doesnt encapsulate the full meaning"); installed = fastened and connected.
// Possession and mock-up photos are evidence, never proof, and never counted.
const RUNGS: { label: string; yes: string; no?: string }[] = [
  { label: 'LINED UP', yes: 'lined_up' },
  { label: 'ACQUIRED', yes: 'bought' },
  { label: 'INSTALLED', yes: 'installed', no: 'not_installed' },
];
// Owner 2026-09-27: "need to ensure all our wires are right". Each wire carries the registry's rule checks.
const RULE_WORD: Record<string, string> = {
  'R8 ends': 'BOTH ENDS', 'R9 pin': 'PIN FITS', 'R10 circuit': 'CIRCUIT COMPLETE', 'R11 command': 'WHAT SWITCHES IT',
  'R12 firewall': 'FIREWALL PATH', 'R13 locked': 'LOCKED DECISIONS', 'R14 agree': 'RECORDS AGREE',
};
type Verdict = 'RIGHT' | 'WRONG' | 'INCOMPLETE' | 'UNCHECKED';
function verdictOf(w: MapWire): Verdict {
  const v = Object.values(w.checks ?? {});
  if (!v.length) return 'UNCHECKED';
  return v.some(x => x[0] === 'FAIL') ? 'WRONG' : v.some(x => x[0] === 'OPEN') ? 'INCOMPLETE' : 'RIGHT';
}
const ON_LADDER = new Set(['lined_up', 'bought', 'installed', 'not_installed']);
const LEVEL_WORD: Record<string, string> = {
  lined_up: 'LINED UP', bought: 'ACQUIRED', installed: 'INSTALLED', not_installed: 'NOT INSTALLED',
  on_hand: 'IN HAND — NOT PROOF OF PURCHASE', in_hand: 'IN HAND — NOT PROOF OF PURCHASE',
  mounted: 'MOUNTED — NOT WIRED', placed: 'SET IN PLACE FOR A MOCK-UP — NOT INSTALLED',
  on_truck: 'ON THE TRUCK IN A PHOTO', not_on_truck: 'NOT ON THE TRUCK YET',
  question: 'QUESTION FOR THE OWNER', answered: 'ANSWERED',
};
const deviceProof = (facts: ReturnType<typeof useWiringFacts>, code: string): WiringFact[] =>
  (facts.byPlug[code] ?? []).filter(f => f.property === 'device proof' && f.level !== 'withdrawn');

function statusColor(cw: Colorway, s: WorkStatus): string {
  return s === 'done' ? cw.ok : s === 'needs_owner' ? cw.warn : s === 'blocked' ? cw.danger : s === 'in_progress' ? cw.accent : cw.ink;
}

type View = 'plan' | '3d' | 'face' | 'sch' | 'lib';
const VIEWS: [View, string][] = [['plan', 'PLAN'], ['3d', '3D'], ['face', 'CONNECTOR'], ['sch', 'SCHEMATIC'], ['lib', 'LIBRARY']];
const ZoneModels3D = React.lazy(() => import('./ZoneModels3D'));   // three.js loads only when the 3D view opens

function useNarrow(px: number): boolean {
  const q = `(max-width: ${px - 1}px)`;
  const [n, setN] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(q), f = () => setN(m.matches);
    f(); m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return n;
}

// The MAP workspace (owner 2026-09-29: "imagine a zuken engineer looks at the software and data presentation"): a tree,
// one centre view, the selection's properties and the linked tables, all lit by one selection (?sel=). Everyone sees
// the results; the owner also sees what needs him, the open calls and decisions, and each record's proof and sources.
export function WiringMap({ vehicleId }: { vehicleId?: string }) {
  const [params, setParams] = useSearchParams();
  const rawCw = params.get('cw');
  let storedCw: string | null = null;
  try { storedCw = window.localStorage.getItem(COLORWAY_STORAGE_KEY); } catch { /* private mode */ }
  const colorwayId: ColorwayId = isColorwayId(rawCw) ? rawCw : isColorwayId(storedCw) ? storedCw : DEFAULT_COLORWAY;
  const cw = COLORWAYS[colorwayId];
  const set = (patch: Record<string, string | null>) => setParams(prev => {
    const p = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v === null) p.delete(k); else p.set(k, v); }
    return p;
  }, { replace: true });
  const setColorway = (id: ColorwayId) => {
    try { window.localStorage.setItem(COLORWAY_STORAGE_KEY, id); } catch { /* private mode */ }
    set({ cw: id });
  };

  // The owner's layer takes the profile's owner check (useVehiclePermissions: the profile's isRowOwner). ?asOwner=1
  // previews it on the dev server only (import.meta.env.DEV), for local screenshots; a build never honours it.
  const { session } = useAuth();
  const { isOwner: isRowOwner } = useVehiclePermissions(vehicleId ?? null, session, null);
  const isOwner = isRowOwner || (import.meta.env.DEV && params.get('asOwner') === '1');

  const raw = useWiringMap(vehicleId);
  const facts = useWiringFacts(isOwner ? vehicleId : undefined);
  const site = useSiteFiles(vehicleId);
  // the workspace draws results: names without the buying story (the owner's records card keeps the full text)
  const map = useMemo(() => ({
    ...raw,
    nodes: raw.nodes.map(n => ({ ...n, name: publicName(n.name) || n.code })),
    wires: raw.wires.map(w => ({ ...w, name: publicName(w.name) || w.code })),
  }), [raw]);
  const ix = useWsIndex(map, site);
  const [sel, setSel] = useSelection();
  const rel = useMemo(() => relOf(sel, ix, map), [sel, ix, map]);
  const narrow = useNarrow(900);
  const [treeOpen, setTreeOpen] = useState(false);
  const byId = useMemo(() => new Map(raw.nodes.map(n => [n.id, n])), [raw.nodes]);
  const cov = useMemo(() => coverage(site), [site]);

  const k = kindOf(sel), v = valOf(sel);
  const view: View = VIEWS.find(x => x[0] === params.get('view'))?.[0] ?? 'plan';
  const withWires = SECTIONS.filter(s => map.wires.some(w => w.section === s.id));
  const selSection = k === 'n' ? ix.byCode.get(v)?.section : k === 'w' ? ix.wireByCode.get(v)?.section : k === 'y' ? v
    : k === 'p' ? ix.byCode.get(v.split('|')[0])?.section : null;
  const selSys = withWires.some(s => s.id === selSection) ? (selSection as string) : null;
  const [lastSys, setLastSys] = useState<string | null>(null);
  useEffect(() => { if (selSys) setLastSys(selSys); }, [selSys]);
  const sys = selSys ?? lastSys ?? withWires[0]?.id ?? 'power_spine';
  const faceCode = k === 'n' ? v : k === 'p' ? v.split('|')[0] : k === 'w' ? (ix.chain.get(v) ?? [])[0]?.code ?? null
    : k === 'd' ? map.nodes.find(n => ix.devOf(n.code) === v)?.code ?? null : null;
  const pick = (id: string) => { setSel(id); if (narrow) setTreeOpen(false); };
  const clearSel = React.useCallback(() => setSel(null), [setSel]);

  // the owner's records for the selection: proof, notes, sources, rule checks, the calls it hangs on
  const rawNode = k === 'n' ? raw.nodes.find(n => n.code === v) : undefined;
  const rawWire = k === 'w' ? raw.wires.find(w => w.code === v) : undefined;
  const rawCall = k === 'k' ? raw.calls.find(c => c.slug === v) : undefined;
  const records = !isOwner ? undefined
    : rawNode ? <NodeCard cw={cw} n={rawNode} map={raw} byId={byId} facts={facts} recordsOnly onNode={c => pick('n:' + c)} onCall={s => pick('k:' + s)} />
    : rawWire ? <WireRecords cw={cw} w={rawWire} facts={facts} />
    : rawCall ? <CallCard cw={cw} c={rawCall} map={raw} byId={byId} onNode={c => pick('n:' + c)} />
    : undefined;
  const needCalls = isOwner ? raw.calls.filter(needsOwner) : [];   // money, hands, legal, credentials (ownerLayer.ts)

  const loading = !map.loaded;
  const tree = <WorkspaceTree cw={cw} map={map} ix={ix} site={site} sel={sel} rel={rel} onSelect={pick} />;
  const centre = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }}>
      <div role="tablist" style={{ display: 'flex', alignItems: 'stretch', borderBottom: rule(cw), background: cw.bg, flexShrink: 0, overflowX: 'auto' }}>
        {narrow && (
          <button onClick={() => setTreeOpen(true)} style={{ border: 'none', borderRight: rule(cw), background: cw.surface, color: cw.ink,
            fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, padding: '8px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>TREE ▸</button>
        )}
        {VIEWS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} onClick={() => set({ view: id === 'plan' ? null : id })} style={{
            border: 'none', borderBottom: `2px solid ${view === id ? cw.accent : 'transparent'}`, background: view === id ? cw.surface : 'transparent',
            color: view === id ? cw.ink : cw.inkMuted, fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
            padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{label}</button>
        ))}
        {view === 'sch' && (
          <select value={sys} onChange={e => pick('y:' + e.target.value)} aria-label="System" style={{ margin: '4px 8px', maxWidth: 240, border: `2px solid ${cw.border}`,
            background: cw.surface, color: cw.ink, fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700 }}>
            {withWires.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: cw.surface }}>
        {view === 'plan' && <PlanView cw={cw} ix={ix} site={site} sel={sel} rel={rel} onSelect={pick} />}
        {view === '3d' && (
          <Suspense fallback={<div style={{ padding: 16, fontSize: 12, color: cw.inkMuted }}>LOADING THE 3D HARNESS…</div>}>
            <ZoneModels3D cw={cw} ix={ix} site={site} sel={sel} rel={rel} onSelect={pick} onClear={clearSel} />
          </Suspense>
        )}
        {view === 'face' && <ConnectorFace cw={cw} ix={ix} site={site} code={faceCode} sel={sel} rel={rel} onSelect={pick} />}
        {view === 'sch' && <SchematicBlock cw={cw} map={map} ix={ix} section={sys} sel={sel} rel={rel} isOwner={isOwner} onSelect={pick} />}
        {view === 'lib' && <PartLibrary cw={cw} ix={ix} site={site} sel={sel} rel={rel} onSelect={pick} />}
      </div>
    </div>
  );
  const props = (
    <div style={{ padding: '10px 12px' }}>
      {sel && (
        <button onClick={() => setSel(null)} style={{ float: 'right', border: frame(cw), background: cw.surface, color: cw.ink,
          fontFamily: cw.fontBody, fontSize: 10, fontWeight: 700, padding: '2px 6px', cursor: 'pointer' }}>CLEAR</button>
      )}
      {sel
        ? <WorkspaceProps cw={cw} map={map} ix={ix} site={site} sel={sel} isOwner={isOwner} onSelect={pick} ownerExtra={records} />
        : <AtRest cw={cw} map={map} ix={ix} site={site} vehicleId={vehicleId} isOwner={isOwner} rollupFacts={facts} calls={raw.calls} />}
    </div>
  );
  const tables = <WorkspaceTables cw={cw} map={map} ix={ix} site={site} sel={sel} rel={rel} isOwner={isOwner} onSelect={pick} />;

  return (
    <ColorwayContext.Provider value={cw}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: cw.bg, color: cw.ink, fontFamily: cw.fontBody,
        overflowY: narrow ? 'auto' : 'hidden', overflowX: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 12px', borderBottom: frame(cw), background: cw.surface, flexShrink: 0 }}>
          <Summary cw={cw} map={map} ix={ix} site={site} cov={cov} isOwner={isOwner} />
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {COLORWAY_LIST.map(c => (
              <button key={c.id} onClick={() => setColorway(c.id)} title={c.label} style={{
                background: c.id === colorwayId ? cw.accent : cw.surface, color: c.id === colorwayId ? cw.onAccent : cw.ink,
                border: frame(cw), fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, padding: '2px 7px', cursor: 'pointer',
              }}>{c.label}</button>
            ))}
          </span>
        </div>
        {needCalls.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', padding: '5px 12px', borderBottom: `2px solid ${cw.warn}`, background: cw.bg, flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: cw.warn, whiteSpace: 'nowrap' }}>NEEDS YOU ({needCalls.length}) · OWNER ONLY</span>
            {needCalls.slice(0, 10).map(c => (
              <button key={c.id} onClick={() => pick('k:' + c.slug)} title={mask(c.subject)} style={{ ...chipStyle(cw, sel === 'k:' + c.slug), borderColor: cw.warn, ...oneLine }}>{mask(c.subject).toUpperCase()}</button>
            ))}
            {needCalls.length > 10 && <span style={{ fontSize: 11, color: cw.inkMuted, whiteSpace: 'nowrap' }}>+{needCalls.length - 10} MORE IN THE CALLS TABLE</span>}
          </div>
        )}
        {loading && <div style={{ padding: 16, fontSize: 13, color: cw.inkFaint }}>READING THE MAP…</div>}
        {map.error && <div style={{ padding: 16, fontSize: 13, color: cw.danger }}>DATABASE READ FAILED: {map.error}</div>}
        {!loading && !map.error && (narrow ? (
          <>
            <div style={{ height: '62vh', minHeight: 320, flexShrink: 0, borderBottom: frame(cw) }}>{centre}</div>
            <div style={{ background: cw.surface, borderBottom: frame(cw), flexShrink: 0 }}>{props}</div>
            <div style={{ height: '70vh', minHeight: 320, flexShrink: 0, background: cw.surface }}>{tables}</div>
            {treeOpen && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex' }}>
                <div style={{ width: 'min(86vw, 360px)', height: '100%', background: cw.surface, borderRight: frame(cw), display: 'flex', flexDirection: 'column' }}>
                  <button onClick={() => setTreeOpen(false)} style={{ border: 'none', borderBottom: rule(cw), background: cw.bg, color: cw.ink, textAlign: 'left',
                    fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, padding: '10px 12px', cursor: 'pointer' }}>◂ CLOSE THE TREE</button>
                  <div style={{ flex: 1, minHeight: 0 }}>{tree}</div>
                </div>
                <div onClick={() => setTreeOpen(false)} style={{ flex: 1, background: 'rgba(0,0,0,0.35)' }} />
              </div>
            )}
          </>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '250px minmax(0, 1fr) 360px', gridTemplateRows: 'minmax(0, 60fr) minmax(0, 40fr)' }}>
            <div style={{ gridRow: '1 / span 2', gridColumn: 1, minHeight: 0, borderRight: frame(cw), background: cw.surface }}>{tree}</div>
            <div style={{ gridRow: 1, gridColumn: 2, minHeight: 0, minWidth: 0 }}>{centre}</div>
            <div style={{ gridRow: 2, gridColumn: 2, minHeight: 0, minWidth: 0, borderTop: frame(cw), background: cw.surface }}>{tables}</div>
            <div style={{ gridRow: '1 / span 2', gridColumn: 3, minHeight: 0, overflowY: 'auto', borderLeft: frame(cw), background: cw.surface }}>{props}</div>
          </div>
        ))}
      </div>
    </ColorwayContext.Provider>
  );
}

const oneLine: React.CSSProperties = { whiteSpace: 'nowrap', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 };

function chipStyle(cw: Colorway, on: boolean): React.CSSProperties {
  return {
    background: on ? cw.ink : cw.surface, color: on ? textOn(cw.ink) : cw.ink, border: frame(cw),
    fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, padding: '2px 7px', cursor: 'pointer',
  };
}

// the headline counts, each from its file; the 3D count opens its split by where each end's shape comes from
function Summary({ cw, map, ix, site, cov, isOwner }: {
  cw: Colorway; map: WiringMapData; ix: WsIndex; site: SiteFiles; cov: ReturnType<typeof coverage>; isOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const decided = map.wires.filter(w => w.designStatus === 'decided').length;
  const withEnds = map.wires.filter(w => (ix.chain.get(w.code) ?? []).length > 1).length;
  const placed = map.nodes.filter(n => site.ends[n.code]).length;
  const lenM = site.segs.reduce((a, s) => a + (s.len ?? 0), 0);
  const B = ({ children }: { children: React.ReactNode }) => <b style={{ fontFamily: cw.fontMono, fontSize: 13 }}>{children}</b>;
  const item: React.CSSProperties = { fontSize: 11, letterSpacing: 0.3, color: cw.ink, whiteSpace: 'nowrap' };
  const ASSUMED = new Set(['twin object', 'not sourced']);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 16px', flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted }}>WIRING HARNESS</span>
      <span style={item} title="harness_endpoints; placed = has a position in k5-positions.json"><B>{map.nodes.length}</B> CONNECTORS · <B>{placed}</B> PLACED</span>
      <span style={item} title="vehicle_custom_circuits; ends = wire_termination_specs">
        <B>{map.wires.length}</B> WIRES{isOwner && <> · <B>{decided}</B> DECIDED</>} · <B>{withEnds}</B> WITH BOTH ENDS
      </span>
      {site.segs.length > 0 && <span style={item} title="k5-routes.json"><B>{site.segs.length}</B> LOOM SEGMENTS · <B>{lenM.toFixed(1)}</B> M</span>}
      {site.models && (
        <span style={{ position: 'relative' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
          <button onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ ...item, border: 'none', borderBottom: `2px solid ${cw.accent}`,
            background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: cw.fontBody }}>
            <B>{cov.modelled.length}</B> OF <B>{cov.total}</B> ENDS MODELLED IN 3D, <B>{cov.complete.length}</B> COMPLETE ▾
          </button>
          {open && (
            <div role="tooltip" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 4, width: 320, maxWidth: '86vw',
              background: cw.surface, border: frame(cw), padding: '8px 10px', color: cw.ink }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: cw.inkMuted, marginBottom: 4 }}>WHERE EACH END'S SHAPE COMES FROM</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {SHAPE_ORDER.map(b => (
                    <tr key={b}>
                      <td style={{ padding: '2px 0', borderBottom: rule(cw) }}>{b.toUpperCase()}{ASSUMED.has(b) ? ' (ASSUMED)' : ''}</td>
                      <td style={{ padding: '2px 0', borderBottom: rule(cw), textAlign: 'right', fontFamily: cw.fontMono }}>{cov.bySource[b]}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: '4px 0 2px', fontWeight: 700 }}>FROM A SOURCED SHAPE · FROM AN ASSUMED ONE</td>
                    <td style={{ padding: '4px 0 2px', textAlign: 'right', fontFamily: cw.fontMono, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {SHAPE_ORDER.filter(b => !ASSUMED.has(b)).reduce((a, b) => a + cov.bySource[b], 0)} · {SHAPE_ORDER.filter(b => ASSUMED.has(b)).reduce((a, b) => a + cov.bySource[b], 0)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '2px 0', color: cw.warn, fontWeight: 700 }}>NO 3D MODEL YET</td>
                    <td style={{ padding: '2px 0', textAlign: 'right', fontFamily: cw.fontMono, color: cw.warn, fontWeight: 700 }}>{cov.total - cov.modelled.length}</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ fontSize: 10.5, lineHeight: 1.45, color: cw.inkMuted, marginTop: 6 }}>
                AN END COUNTS ONCE, AT THE WEAKEST SOURCE AMONG ITS MODELS, SO AN ASSUMED SHAPE NEVER COUNTS AS A SOURCED ONE. COMPLETE: EVERY PIECE THE END
                NEEDS IS MODELLED. FROM THE PART-MODEL INDEX{site.models.generated ? ` OF ${site.models.generated}` : ''} AND THE {cov.total} PLACED ENDS.
              </div>
            </div>
          )}
        </span>
      )}
    </div>
  );
}

// nothing selected: where the harness stands by section (results), the real engine with its plugs; the owner also gets
// the proof rollup and where each box goes with its reasons
function AtRest({ cw, map, ix, site, vehicleId, isOwner, rollupFacts, calls }: {
  cw: Colorway; map: WiringMapData; ix: WsIndex; site: SiteFiles; vehicleId?: string; isOwner: boolean;
  rollupFacts: ReturnType<typeof useWiringFacts>; calls: MapCall[];
}) {
  const rows = SECTIONS.map(s => {
    const nodes = map.nodes.filter(n => n.section === s.id), wires = map.wires.filter(w => w.section === s.id);
    return { s, nodes: nodes.length, placed: nodes.filter(n => site.ends[n.code]).length, wires: wires.length,
      decided: wires.filter(w => w.designStatus === 'decided').length, ends: wires.filter(w => (ix.chain.get(w.code) ?? []).length > 1).length };
  }).filter(r => r.nodes + r.wires > 0);
  const rollup = useMemo(() => {
    const r: Record<string, SectionRollup> = {};
    if (!isOwner) return r;
    for (const s of SECTIONS) r[s.id] = { nodes: 0, placed: 0, done: 0, needs: 0, decided: 0, concept: 0, linedUp: 0, bought: 0, installed: 0, right: 0, wrong: 0, incomplete: 0 };
    for (const n of map.nodes) {
      const x = n.section && r[n.section];
      if (!x) continue;
      x.nodes += 1; if (site.ends[n.code]) x.placed += 1; if (n.workStatus === 'done') x.done += 1; if (n.workStatus === 'needs_owner') x.needs += 1;
      const dp = deviceProof(rollupFacts, n.code);
      if (dp.some(f => f.level === 'lined_up')) x.linedUp += 1;
      if (dp.some(f => f.level === 'bought')) x.bought += 1;
      if (dp.some(f => f.level === 'installed')) x.installed += 1;
    }
    for (const w of map.wires) {
      const x = w.section && r[w.section];
      if (!x) continue;
      if (w.designStatus === 'decided') {
        x.decided += 1;
        const vd = verdictOf(w);
        if (vd === 'RIGHT') x.right += 1; else if (vd === 'WRONG') x.wrong += 1; else if (vd === 'INCOMPLETE') x.incomplete += 1;
      } else x.concept += 1;
    }
    return r;
  }, [isOwner, map.nodes, map.wires, rollupFacts, site.ends]);
  const th: React.CSSProperties = { textAlign: 'right', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, color: cw.inkMuted, padding: '3px 4px', borderBottom: `2px solid ${cw.border}` };
  const td: React.CSSProperties = { textAlign: 'right', fontFamily: cw.fontMono, padding: '3px 4px', borderBottom: rule(cw) };
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: cw.inkMuted }}>WHOLE TRUCK</div>
      <div style={{ fontSize: 12.5, margin: '2px 0 8px' }}>SELECT ANYTHING IN THE TREE, A VIEW OR A TABLE; EVERY PANE LIGHTS WHAT IT LINKS TO.</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr><th style={{ ...th, textAlign: 'left' }}>SECTION</th><th style={th}>CONN.</th><th style={th}>PLACED</th><th style={th}>WIRES</th>{isOwner && <th style={th}>DECIDED</th>}<th style={th}>BOTH ENDS</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.s.id}>
            <td style={{ padding: '3px 4px', borderBottom: rule(cw) }}>{r.s.label}</td>
            <td style={td}>{r.nodes}</td><td style={td}>{r.placed}</td><td style={td}>{r.wires}</td>{isOwner && <td style={td}>{r.decided}</td>}<td style={td}>{r.ends}</td>
          </tr>
        ))}</tbody>
      </table>
      <EnginePhoto vehicleId={vehicleId} cw={cw} />
      {isOwner && (
        <>
          <Head cw={cw}>RECORDS (OWNER)</Head>
          <Rollup cw={cw} sec={null} rollup={rollup} calls={calls} />
          <MountsPanel vehicleId={vehicleId} cw={cw} />
        </>
      )}
    </div>
  );
}

// the owner's records on a wire: the registry's rule checks and the paper behind it
function WireRecords({ cw, w, facts }: { cw: Colorway; w: MapWire; facts: ReturnType<typeof useWiringFacts> }) {
  const checks = Object.entries(w.checks ?? {}).filter(([, x]) => x[0] !== 'PASS');
  return (
    <div>
      <WireVerdict cw={cw} w={w} />
      {checks.map(([key, x]) => (
        <Field key={key} cw={cw} label={RULE_WORD[key] ?? key}>
          <span style={{ color: x[0] === 'FAIL' ? cw.danger : cw.warn, fontWeight: 700 }}>{x[0] === 'FAIL' ? 'WRONG' : 'OPEN'}</span>{' — '}{x[1]}
        </Field>
      ))}
      {w.name && <Field cw={cw} label="AS RECORDED">{w.name}</Field>}
      <WireEvidence wireId={w.code} facts={facts} cw={cw} />
    </div>
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

function NodeCard({ cw, n, map, byId, facts, recordsOnly, onNode, onCall }: {
  cw: Colorway; n: MapNode; map: ReturnType<typeof useWiringMap>; byId: Map<string, MapNode>;
  facts: ReturnType<typeof useWiringFacts>; recordsOnly?: boolean; onNode: (code: string) => void; onCall: (slug: string) => void;
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
  const calls = map.calls.filter(c => !c.decided && c.links.some(l => l.endpointId === n.id));
  const onFile = deviceProof(facts, n.code).sort((a, b) => (a.seenAt ?? '').localeCompare(b.seenAt ?? ''));
  const notes = onFile.filter(f => !ON_LADDER.has(f.level ?? ''));
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div>
      {recordsOnly ? <Field cw={cw} label="AS RECORDED">{n.name}</Field> : (
        <>
          <div style={{ fontFamily: cw.fontMono, fontSize: 19, fontWeight: 700, color: cw.accent }}>{n.code}</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{n.name}</div>
          <DevicePhoto cw={cw} code={n.code} />
          <WhereOnTruck cw={cw} code={n.code} />
          <Field cw={cw} label="TYPE">{n.type.toUpperCase()}{n.family && n.family !== 'unknown' ? ` · ${n.family.toUpperCase()}` : ''}</Field>
        </>
      )}
      <Field cw={cw} label="STATUS">
        <span style={{ color: statusColor(cw, n.workStatus), fontWeight: 700 }}>{WORK_WORD[n.workStatus]}</span>
        {' · '}{n.designStatus === 'decided' ? 'DECIDED' : 'CONCEPT (NOT DECIDED)'}
      </Field>
      <Field cw={cw} label="WHO">{n.assignee ?? 'UNASSIGNED'}</Field>
      <Field cw={cw} label="POSITION">{n.x != null ? n.posSource ?? 'placed' : 'NOT PLACED YET'}</Field>
      {n.partNumber && <Field cw={cw} label="PLUG / KIT">{n.partNumber}</Field>}
      {n.partNumber && <PartPhotos cw={cw} codes={n.partNumber} />}
      {n.notes && <Field cw={cw} label="NOTE">{n.notes}</Field>}
      <Field cw={cw} label="SOURCE">{n.source ?? '—'}{n.trust ? ` (${n.trust})` : ''}</Field>

      <Head cw={cw}>PROOF — LINED UP · ACQUIRED · INSTALLED</Head>
      {RUNGS.map(r => {
        const yes = onFile.filter(f => f.level === r.yes);
        const no = r.no ? onFile.filter(f => f.level === r.no) : [];
        const implied = r.yes === 'lined_up' && !yes.length && onFile.some(f => f.level === 'bought' || f.level === 'installed');
        return (
          <div key={r.label}>
            <Field cw={cw} label={r.label}>
              {yes.length ? <span style={{ color: cw.ok, fontWeight: 700 }}>YES</span>
                : no.length ? <span style={{ color: cw.warn, fontWeight: 700 }}>NO</span>
                : implied ? 'IMPLIED BY THE PURCHASE'
                : <span style={{ color: cw.inkMuted }}>NO PROOF ON FILE</span>}
            </Field>
            {[...yes, ...no].map(f => <ProofRow key={f.id} cw={cw} f={f} />)}
          </div>
        );
      })}
      {notes.length > 0 && <Head cw={cw}>OTHER EVIDENCE — NOT PROOF ({notes.length})</Head>}
      {notes.map(f => <ProofRow key={f.id} cw={cw} f={f} />)}

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
              <WireVerdict cw={cw} w={w} />
            </button>
            {isOpen && (
              <div style={{ paddingLeft: 8 }}>
                {end && (
                  <Field cw={cw} label="THIS END">
                    {[end.terminal, end.seal].filter(Boolean).join(' + ') || '—'}{end.tool ? ` · TOOL ${end.tool}` : ''}
                  </Field>
                )}
                {Object.entries(w.checks ?? {}).filter(([, v]) => v[0] !== 'PASS').map(([k, v]) => (
                  <Field key={k} cw={cw} label={RULE_WORD[k] ?? k}>
                    <span style={{ color: v[0] === 'FAIL' ? cw.danger : cw.warn, fontWeight: 700 }}>{v[0] === 'FAIL' ? 'WRONG' : 'OPEN'}</span>
                    {' — '}{v[1]}
                  </Field>
                ))}
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
  if (c.decided) {
    const out = c.links.filter(l => l.relation === 'blocks');
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.ink }}>
          {c.trust === 'T1' ? 'LOCKED DECISION' : 'DECIDED FOR YOU — REPLACEABLE'}
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, margin: '4px 0 8px' }}>{c.subject}</div>
        {c.chosen && <Field cw={cw} label="CHOSEN">{c.chosen}</Field>}
        {c.decidedOn && <Field cw={cw} label="DECIDED">{c.decidedOn}</Field>}
        {c.scope && <Field cw={cw} label="RULE">{c.scope}</Field>}
        {c.source && <Field cw={cw} label="SOURCE">{c.source}</Field>}
        <Head cw={cw}>RETIRED FROM THE MAP BY THIS DECISION ({out.length})</Head>
        {out.map((l, i) => (
          <div key={i} style={{ fontSize: 14, lineHeight: 1.5, borderBottom: rule(cw), padding: '4px 0' }}>
            <span style={{ fontFamily: cw.fontMono, fontWeight: 700 }}>{l.endpointCode ?? '—'}</span>
            {l.endpointName ? ` — ${l.endpointName}` : ''}
            {l.note && <div style={{ color: cw.inkFaint }}>{l.note}</div>}
          </div>
        ))}
      </div>
    );
  }
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

// a wire's verdict from its rule checks: right, wrong (what fails), or incomplete (what is still open)
function WireVerdict({ cw, w }: { cw: Colorway; w: MapWire }) {
  const v = verdictOf(w);
  if (v === 'UNCHECKED') return null;
  const bad = Object.entries(w.checks ?? {}).filter(([, x]) => x[0] === (v === 'WRONG' ? 'FAIL' : 'OPEN')).map(([k]) => RULE_WORD[k] ?? k);
  const tone = v === 'RIGHT' ? cw.ok : v === 'WRONG' ? cw.danger : cw.warn;
  return (
    <span style={{ display: 'block', fontSize: 14, color: tone, fontWeight: 700 }}>
      {v}{bad.length ? ` — ${bad.join(', ')}` : ''}
    </span>
  );
}

// one photo (or receipt) and what it shows about this part; the photo opens full size
function ProofRow({ cw, f }: { cw: Colorway; f: WiringFact }) {
  const tone = f.level === 'question' || f.level === 'not_installed' ? cw.warn
    : f.level === 'lined_up' || f.level === 'bought' || f.level === 'installed' ? cw.ok : cw.inkMuted;
  const thumb = optimizeImageUrl(f.photoUrl, 'thumbnail');
  return (
    <div style={{ display: 'flex', gap: 10, borderBottom: rule(cw), padding: '6px 0' }}>
      {thumb && f.photoUrl && (
        <a href={f.photoUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }} title="Open the photo">
          <img src={thumb} alt="" width={76} height={76} loading="lazy"
            style={{ display: 'block', objectFit: 'contain', border: rule(cw), background: cw.bg }} />
        </a>
      )}
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 700, color: tone }}>
          {LEVEL_WORD[f.level ?? ''] ?? (f.level ?? '').toUpperCase()}{f.eventDate ? ` ${f.eventDate}` : ''}
          {f.seenAt ? ` · PHOTO ${f.seenAt.slice(0, 10)}` : ''}
        </div>
        {f.order ? <PurchaseLines cw={cw} o={f.order} /> : f.listing ? <ListingLines cw={cw} l={f.listing} /> : <div>{f.value}</div>}
        <div style={{ color: cw.inkFaint }}>
          {f.order ? `PURCHASE RECORD — THE OWNER'S ${(f.order.marketplace ?? 'ORDER').toUpperCase()} ORDER`
            : f.listing ? 'A LISTING, NOT A PURCHASE — ORDER IT FROM THE LINK'
            : f.ownerWords ? "THE OWNER'S WORDS" : f.level === 'question' ? 'RAISED BY A PHOTO ON THIS PROFILE'
            : "READ FROM THE VEHICLE'S OWN PHOTO · NOT YET CONFIRMED BY THE OWNER"}
        </div>
      </div>
    </div>
  );
}

// a lined-up part: where it is sold, exactly what, how many, the price read and when — not a purchase
function ListingLines({ cw, l }: { cw: Colorway; l: ListingRecord }) {
  const usd = (n?: number) => (typeof n === 'number' ? `$${n.toFixed(2)}` : null);
  const qty = l.quantity ?? 1;
  const each = usd(l.price_usd);
  const what = [qty > 1 ? `${qty} ×` : null, l.part ?? null,
    (l.part_numbers ?? []).length ? `(${(l.part_numbers ?? []).join(' / ')})` : null].filter(Boolean).join(' ');
  const short = /out of stock|backorder/i.test(l.stock ?? '');
  return (
    <div style={{ fontFamily: cw.fontMono, fontSize: 13, lineHeight: 1.55 }}>
      {l.site && <div>AT {l.site.toUpperCase()}</div>}
      {what && <div>{what}</div>}
      {each && (
        <div>
          {each}{qty > 1 ? ` EACH · ${usd((l.price_usd ?? 0) * qty)} FOR ${qty}` : ''}{l.captured ? ` · PRICE READ ${l.captured}` : ''}
        </div>
      )}
      {l.stock && <div style={{ color: short ? cw.warn : cw.ink, fontWeight: short ? 700 : 400 }}>{l.stock.toUpperCase()}</div>}
      {l.note && <div style={{ color: cw.warn }}>{l.note.toUpperCase()}</div>}
      {l.url && (
        <a href={l.url} target="_blank" rel="noreferrer" style={{ ...linkStyle(cw), fontFamily: cw.fontMono, fontSize: 13 }}>
          OPEN THE LISTING ▸
        </a>
      )}
    </div>
  );
}

// the whole purchase record, line by line: when, what it cost, from whom, exactly what, and does it fit the design
function PurchaseLines({ cw, o }: { cw: Colorway; o: PurchaseRecord }) {
  const money = typeof o.paid_usd === 'number' ? `$${o.paid_usd.toFixed(2)}` : null;
  const when = [o.order_date && `ORDERED ${o.order_date}`, money && `PAID ${money}`,
    o.delivered_date ? `DELIVERED ${o.delivered_date}` : 'DELIVERY NOT ON RECORD'].filter(Boolean).join(' · ');
  const from = [o.seller ? `FROM ${o.seller.toUpperCase()}` : null,
    o.order_number ? `${(o.marketplace ?? '').toUpperCase()} ORDER ${o.order_number}`.trim() : null].filter(Boolean).join(' · ');
  const what = [(o.quantity ?? 1) > 1 ? `${o.quantity} ×` : null, (o.part_numbers ?? []).join(' / ') || null].filter(Boolean).join(' ');
  const misfit = /^not\b/i.test(o.design_match ?? '');
  const b = o.billing;
  const usd = (n?: number) => (typeof n === 'number' ? `$${n.toFixed(2)}` : '?');
  const who = (b?.client ?? 'the client').toUpperCase();
  const billLine = !b ? null
    : b.status === 'billed_and_paid'
      ? `BILLED TO ${who} ${usd(b.billed_usd)} — PAID · COST ${usd(b.cost_usd)} · ${(b.margin_usd ?? 0) >= 0 ? '+' : '−'}${usd(Math.abs(b.margin_usd ?? 0))}`
      : b.status === 'planned_not_invoiced'
        ? `PLANNED FOR ${who}'S NEXT INVOICE (${usd(b.planned_usd)}) — NOT INVOICED · COST ${usd(b.cost_usd)}`
        : `NOT BILLED TO ${who} — COST ${usd(b.cost_usd)}`;
  return (
    <div style={{ fontFamily: cw.fontMono, fontSize: 13, lineHeight: 1.55 }}>
      <div>{when}</div>
      {from && <div>{from}</div>}
      {what && <div>{what}{o.condition ? ` · ${o.condition.toUpperCase()}` : ''}</div>}
      {o.design_match && <div style={{ color: misfit ? cw.warn : cw.ok, fontWeight: 700 }}>DESIGN: {o.design_match.toUpperCase()}</div>}
      {billLine && (
        <div style={{ color: b?.status === 'billed_and_paid' ? cw.ink : cw.warn, fontWeight: 700 }} title={b?.source ?? ''}>
          {billLine}
        </div>
      )}
      {b?.source && <div style={{ color: cw.inkFaint, fontFamily: 'inherit' }}>{b.source.toUpperCase()}</div>}
    </div>
  );
}

interface SectionRollup { nodes: number; placed: number; done: number; needs: number; decided: number; concept: number; linedUp: number; bought: number; installed: number; right: number; wrong: number; incomplete: number }

function Rollup({ cw, sec, rollup, calls }: {
  cw: Colorway; sec: Section | null; rollup: Record<string, SectionRollup>;
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
              LINED UP {r.linedUp}/{r.nodes} · ACQUIRED {r.bought}/{r.nodes} · INSTALLED {r.installed}/{r.nodes} (PROOF ON FILE)
            </div>
            <div style={{ fontFamily: cw.fontMono }}>
              {r.decided} WIRES DECIDED · {r.concept} CONCEPT
            </div>
            <div style={{ fontFamily: cw.fontMono }}>
              <span style={{ color: cw.ok }}>RIGHT {r.right}</span>{' · '}
              <span style={{ color: r.wrong ? cw.danger : cw.inkMuted }}>WRONG {r.wrong}</span>{' · '}
              <span style={{ color: r.incomplete ? cw.warn : cw.inkMuted }}>INCOMPLETE {r.incomplete}</span>{' OF '}{r.decided}
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 14, color: cw.inkFaint, marginTop: 8 }}>
        {calls.filter(c => !c.decided).length} OPEN CALLS · {calls.filter(c => c.decided).length} LOCKED · CLICK A NODE OR A CALL TO WORK IT.
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
