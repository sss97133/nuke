// map/WorkspaceProps.tsx — the MAP workspace's properties: structured attributes for whatever is selected (a
// connector, a wire, a pin, a loom segment, a device, a section). Results only; the owner also gets the records card
// (proof, notes, sources, open calls) through `ownerExtra`, which the MAP tab passes only after its owner check.

import React from 'react';
import type { Colorway } from '../connector-inspector/colorways';
import { rule } from '../connector-inspector/colorways';
import { DevicePhoto, WhereOnTruck } from './MountsPanel';
import { SECTIONS, type WiringMapData } from './useWiringMap';
import { kindOf, mask, modelsOf, partNo, publicName, valOf, weakestBasis, type SiteFiles, type WsIndex } from './useWorkspaceSelection';

const FRONT_AXLE = -1.853, IN = 0.0254;
const secWord = (s: string | null | undefined) => SECTIONS.find(x => x.id === s)?.label ?? '—';

function F({ cw, k, children }: { cw: Colorway; k: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '112px minmax(0,1fr)', gap: 8, fontSize: 12.5, lineHeight: 1.55, padding: '1px 0' }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.7, color: cw.inkMuted, paddingTop: 2 }}>{k}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere', color: cw.ink }}>{children}</span>
    </div>
  );
}
function H({ cw, children }: { cw: Colorway; children: React.ReactNode }) {
  return <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: cw.inkMuted, margin: '12px 0 4px', paddingTop: 8, borderTop: rule(cw) }}>{children}</div>;
}
const Link = ({ cw, id, children, onSelect }: { cw: Colorway; id: string; children: React.ReactNode; onSelect: (id: string) => void }) => (
  <button onClick={() => onSelect(id)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: cw.accent, fontFamily: cw.fontMono, fontSize: 12.5, textAlign: 'left' }}>{children}</button>
);

export function WorkspaceProps({ cw, map, ix, site, sel, isOwner, onSelect, ownerExtra }: {
  cw: Colorway; map: WiringMapData; ix: WsIndex; site: SiteFiles; sel: string | null; isOwner: boolean; onSelect: (id: string) => void; ownerExtra?: React.ReactNode;
}) {
  const k = kindOf(sel), v = valOf(sel);
  const mono = { fontFamily: cw.fontMono };
  const head = (kind: string, id: string, name?: string) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: cw.inkMuted }}>{kind}</div>
      <div style={{ ...mono, fontSize: 17, fontWeight: 700, color: cw.ink, overflowWrap: 'anywhere' }}>{id}</div>
      {name && <div style={{ fontSize: 13, color: cw.ink }}>{mask(name)}</div>}
    </div>
  );
  const lenOf = (wc: string) => {
    const segs = (ix.segsByWire.get(wc) ?? []).map(s => ix.segById.get(s)).filter(Boolean);
    if (!segs.length) return null;
    return { mm: Math.round(segs.reduce((a, s) => a + (s!.len ?? 0), 0) * 1000), pm: Math.round(Math.sqrt(segs.reduce((a, s) => a + (s!.mar ?? 0) ** 2, 0))), n: segs.length };
  };
  // a status word is the owner's; a visitor sees the result, or a dash where there is none yet
  const pending = isOwner ? <span style={{ color: cw.warn }}>ENDS PENDING</span> : '—';
  const endLink = (h: { code: string; cav: string | null }) => <Link cw={cw} id={'p:' + h.code + '|' + (h.cav ?? '')} onSelect={onSelect}>{h.code}{h.cav ? ':' + h.cav : ''}</Link>;
  const wireTable = (wcs: string[], here?: string) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr>{['WIRE', 'AWG', 'COLOR', here ? 'OTHER END' : 'FROM → TO', 'MM'].map(h => <th key={h} style={{ textAlign: h === 'AWG' || h === 'MM' ? 'right' : 'left', fontSize: 9.5, color: cw.inkMuted, padding: '2px 4px', borderBottom: `2px solid ${cw.border}` }}>{h}</th>)}</tr></thead>
      <tbody>{wcs.map(wc => {
        const w = ix.wireByCode.get(wc), ch = ix.chain.get(wc) ?? [], L = lenOf(wc);
        // the other end: the far end from here; from a pass-through (the 61-pin), both ends
        const others = ch.filter(h => h.code !== here);
        const far = !here ? [ch[0], ch[ch.length - 1]].filter(Boolean)
          : ch[0]?.code === here ? others.slice(-1) : ch[ch.length - 1]?.code === here ? others.slice(0, 1) : [ch[0], ch[ch.length - 1]].filter(Boolean);
        return (
          <tr key={wc} onClick={() => onSelect('w:' + wc)} style={{ cursor: 'pointer', background: sel === 'w:' + wc ? `${cw.accent}22` : 'transparent' }}>
            <td style={{ ...mono, padding: '2px 4px', borderBottom: rule(cw) }}>{wc}</td>
            <td style={{ ...mono, padding: '2px 4px', borderBottom: rule(cw), textAlign: 'right' }}>{w?.gauge ?? ''}</td>
            <td style={{ padding: '2px 4px', borderBottom: rule(cw) }}>{w?.color ?? ''}</td>
            <td style={{ ...mono, padding: '2px 4px', borderBottom: rule(cw) }}>{far.length ? far.map((h, i) => <span key={i}>{i ? ' → ' : ''}{h!.code}{h!.cav ? ':' + h!.cav : ''}</span>) : pending}</td>
            <td style={{ ...mono, padding: '2px 4px', borderBottom: rule(cw), textAlign: 'right' }}>{L ? `${L.mm} ±${L.pm}` : ''}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
  const model3d = (code: string) => {
    const idx = site.models; if (!idx) return <span style={{ color: cw.inkMuted }}>—</span>;
    const e = idx.ends?.[code], models = modelsOf(idx, code);
    if (!models.length) return <span style={{ color: cw.warn }}>NOT COMPLETE: NO 3D MODEL YET</span>;
    const weakest = weakestBasis(idx, models);
    return (
      <span>
        {e?.complete ? <b style={{ color: cw.ok }}>COMPLETE</b> : <b style={{ color: cw.warn }}>MODELLED, NOT COMPLETE</b>}
        {' · '}SHAPE FROM {weakest.toUpperCase()}{models.length > 1 ? ` (THE WEAKEST OF ITS ${models.length} MODELS)` : ''}
        {' · '}<span style={mono}>{models.join(' ')}</span>
      </span>
    );
  };

  if (!sel) return <div style={{ color: cw.inkMuted, fontSize: 12.5 }}>SELECT ANYTHING: A ROW IN THE TREE OR A TABLE, A PART OR LOOM ON THE PLAN, A WIRE ON THE SCHEMATIC, A PIN ON A CONNECTOR FACE.</div>;

  if (k === 'n') {
    const n = ix.byCode.get(v); if (!n) return null;
    const pos = site.ends[v], pins = ix.pinsByNode.get(v) ?? [], wires = [...(ix.wiresByNode.get(v) ?? [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return (
      <div>
        {head('CONNECTOR', n.code, n.name)}
        <DevicePhoto cw={cw} code={n.code} captionOf={publicName} />
        <WhereOnTruck cw={cw} code={n.code} showWhy={isOwner} showStatus={isOwner} />
        <F cw={cw} k="3D MODEL">{model3d(n.code)}</F>
        <F cw={cw} k="PART NO."><span style={mono}>{partNo(n.partNumber)}</span></F>
        <F cw={cw} k="TYPE">{n.type.toUpperCase()}{n.family && n.family !== 'unknown' ? ` · ${n.family.toUpperCase()}` : ''}</F>
        <F cw={cw} k="SECTION">{secWord(n.section)}</F>
        {pos?.dev && pos.dev !== n.code && <F cw={cw} k="DEVICE"><Link cw={cw} id={'d:' + pos.dev} onSelect={onSelect}>{pos.dev_name}</Link></F>}
        <F cw={cw} k="CAVITIES">{pins.length} WITH A WIRE ON FILE</F>
        {pos ? (
          <>
            <H cw={cw}>WHERE IT IS</H>
            <F cw={cw} k="STATION"><span style={mono}>{((pos.xyz[1] - FRONT_AXLE) / IN).toFixed(1)} IN</span> BEHIND THE FRONT AXLE</F>
            <F cw={cw} k="LATERAL"><span style={mono}>{(Math.abs(pos.xyz[0]) / IN).toFixed(1)} IN</span> {pos.xyz[0] > 0 ? 'DRIVER SIDE' : pos.xyz[0] < 0 ? 'PASSENGER SIDE' : ''}</F>
            <F cw={cw} k="HEIGHT"><span style={mono}>{(pos.xyz[2] / IN).toFixed(1)} IN</span> ABOVE THE GROUND</F>
            <F cw={cw} k="MARGIN"><span style={mono}>{pos.margin_mm != null ? `±${pos.margin_mm} MM` : '—'}</span></F>
            {pos.size && <F cw={cw} k="DRAWN"><span style={mono}>{pos.size.shape === 'disc' ? `⌀${pos.size.d} × ${pos.size.t}` : `${pos.size.dx} × ${pos.size.dy} × ${pos.size.dz}`} MM</span></F>}
          </>
        ) : <F cw={cw} k="WHERE">NOT PLACED YET</F>}
        {wires.length > 0 && <><H cw={cw}>WIRES ({wires.length})</H>{wireTable(wires, n.code)}</>}
        {ownerExtra && <><H cw={cw}>RECORDS (OWNER)</H>{ownerExtra}</>}
      </div>
    );
  }
  if (k === 'w') {
    const w = ix.wireByCode.get(v); if (!w) return null;
    const ch = ix.chain.get(v) ?? [], L = lenOf(v), segs = (ix.segsByWire.get(v) ?? []).map(s => ix.segById.get(s)!).filter(Boolean);
    return (
      <div>
        {head('WIRE', w.code, w.name)}
        <F cw={cw} k="SECTION">{secWord(w.section)}</F>
        <F cw={cw} k="GAUGE"><span style={mono}>{w.gauge != null ? `${w.gauge} AWG` : '—'}</span></F>
        <F cw={cw} k="SPEC"><span style={mono}>{w.spec ?? '—'}</span></F>
        <F cw={cw} k="COLOR">{w.color ?? '—'}</F>
        <F cw={cw} k="FROM">{ch[0] ? endLink(ch[0]) : '—'}</F>
        <F cw={cw} k="TO">{ch.length > 1 ? endLink(ch[ch.length - 1]) : pending}</F>
        {ch.length > 2 && <F cw={cw} k="VIA">{ch.slice(1, -1).map((h, i) => <span key={i}>{i ? ' · ' : ''}{endLink(h)}</span>)}</F>}
        <F cw={cw} k="LENGTH">{L ? <><span style={mono}>{L.mm} ± {L.pm} MM</span> ROUTED THROUGH {L.n} SEGMENTS</> : '—'}</F>
        {isOwner && <F cw={cw} k="STATUS">{w.designStatus === 'decided' ? 'DECIDED' : 'CONCEPT (NOT DECIDED)'}</F>}
        {segs.length > 0 && <>
          <H cw={cw}>ROUTE ({segs.length})</H>
          {segs.map(s => (
            <div key={s.id} onClick={() => onSelect('s:' + s.id)} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, fontSize: 12, padding: '2px 0', borderBottom: rule(cw), cursor: 'pointer' }}>
              <span><span style={mono}>{s.id}</span> <span style={{ color: cw.inkMuted }}>{(s.b ?? '').split(' (')[0]}</span></span>
              <span style={mono}>⌀{s.od ?? '?'} · {Math.round((s.len ?? 0) * 1000)} ±{s.mar ?? '?'}</span>
            </div>
          ))}
        </>}
        {ownerExtra && <><H cw={cw}>RECORDS (OWNER)</H>{ownerExtra}</>}
      </div>
    );
  }
  if (k === 'p') {
    const [code, cav] = v.split('|'), p = ix.pins.find(x => x.node === code && x.cav === cav);
    return (
      <div>
        {head('PIN', `${code}:${cav || '—'}`, ix.byCode.get(code)?.name)}
        <F cw={cw} k="CONNECTOR"><Link cw={cw} id={'n:' + code} onSelect={onSelect}>{code}</Link></F>
        <F cw={cw} k="TERMINAL"><span style={mono}>{partNo(p?.terminal)}</span></F>
        <F cw={cw} k="SEAL"><span style={mono}>{partNo(p?.seal)}</span></F>
        <F cw={cw} k="TOOL"><span style={mono}>{partNo(p?.tool)}</span></F>
        {p && p.wires.length > 0 && <><H cw={cw}>WIRES ({p.wires.length})</H>{wireTable(p.wires, code)}</>}
      </div>
    );
  }
  if (k === 's') {
    const s = ix.segById.get(v); if (!s) return null;
    return (
      <div>
        {head('LOOM SEGMENT', s.id, s.b ?? undefined)}
        <F cw={cw} k="FROM">{ix.byCode.has(s.f) ? <Link cw={cw} id={'n:' + s.f} onSelect={onSelect}>{s.f}</Link> : <span style={mono}>{s.f}</span>}</F>
        <F cw={cw} k="TO">{ix.byCode.has(s.t) ? <Link cw={cw} id={'n:' + s.t} onSelect={onSelect}>{s.t}</Link> : <span style={mono}>{s.t}</span>}</F>
        <F cw={cw} k="LENGTH"><span style={mono}>{Math.round((s.len ?? 0) * 1000)} ± {s.mar ?? '?'} MM</span></F>
        <F cw={cw} k="OUTER DIA."><span style={mono}>{s.od ?? '?'} MM{s.par > 1 ? ` × ${s.par} SIDE BY SIDE` : ''}</span></F>
        <F cw={cw} k="COVERING">{s.cov ?? '—'}</F>
        <F cw={cw} k="CLIPS"><span style={mono}>{s.clips}</span></F>
        <H cw={cw}>WIRES INSIDE ({s.w.length})</H>{wireTable(s.w)}
      </div>
    );
  }
  if (k === 'd') {
    const nodes = map.nodes.filter(n => ix.devOf(n.code) === v), name = nodes[0] ? site.ends[nodes[0].code]?.dev_name ?? v : v;
    return (
      <div>
        {head('DEVICE', v, name)}
        <F cw={cw} k="CONNECTORS">{nodes.map((n, i) => <span key={n.code}>{i ? ' · ' : ''}<Link cw={cw} id={'n:' + n.code} onSelect={onSelect}>{n.code}</Link></span>)}</F>
        <F cw={cw} k="3D MODEL">{nodes[0] ? model3d(nodes[0].code) : '—'}</F>
      </div>
    );
  }
  if (k === 'y') {
    const wires = map.wires.filter(w => w.section === v), nodes = map.nodes.filter(n => n.section === v);
    return (
      <div>
        {head('SECTION', secWord(v))}
        <F cw={cw} k="WIRES"><span style={mono}>{wires.length}</span>{isOwner ? ` (${wires.filter(w => w.designStatus === 'decided').length} DECIDED)` : ''}</F>
        <F cw={cw} k="CONNECTORS"><span style={mono}>{nodes.length}</span></F>
      </div>
    );
  }
  if (k === 'k') return ownerExtra ? <div>{ownerExtra}</div> : null;
  return null;
}
