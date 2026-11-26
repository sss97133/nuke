// map/SchematicBlock.tsx — the MAP workspace's schematic: one section's wires as a block diagram, generated from the
// physical segment keys. Sources and controllers on the left, pass-throughs and splices in the
// middle, loads on the right; each hop between two pin rows gets its own lane, so no two wires share a line.

import React, { useMemo, useRef, useState } from 'react';
import type { Colorway } from '../connector-inspector/colorways';
import { frame } from '../connector-inspector/colorways';
import { kindOf, valOf, type Rel } from './useWorkspaceSelection';
import { publicName } from './useWorkspaceSelection';
import { physicalSchematicPieces, physicalPieceLabel } from './physicalHarnessModel';
import { usePhysicalHarnessModel } from './usePhysicalHarnessModel';

// Shared geometry; data readers and record qualification remain separate.
import { layoutPhysicalPieces as layout, DIAGRAM_ROW as ROW, DIAGRAM_HEADER as HDR } from './physicalDiagramLayout';

export function SchematicBlock({ cw, vehicleId, section, sel, rel, isOwner, onSelect }: {
  cw: Colorway; vehicleId: string | undefined; section: string; sel: string | null; rel: Rel; isOwner: boolean; onSelect: (id: string) => void;
}) {
  const { model, loaded, error } = usePhysicalHarnessModel(vehicleId);
  const pieces = useMemo(() => model ? physicalSchematicPieces(model, section, isOwner) : [], [model, section, isOwner]);
  const L = useMemo(() => layout(pieces), [pieces]);
  const [z, setZ] = useState(1);
  const box = useRef<HTMLDivElement | null>(null);
  const has = !!sel && sel !== 'y:' + section;
  const wcls = (wc: string) => (!has ? cw.ink : sel === 'w:' + wc ? cw.accent : rel.wires.has(wc) ? cw.accent : cw.border);
  const selPin = kindOf(sel) === 'p' ? valOf(sel) : null;
  const name = (dev: string) => publicName(model?.endpoints.find(e => e.id === dev)?.name ?? 'Unspecified connection');
  if (error) return <p role="alert">{error}</p>;
  if (!loaded) return <p>Reading the physical wiring model…</p>;
  if (!L.hops.length) return <div><p>{pieces.length} physical wire pieces; none has a recorded connection in this system.</p>
    {pieces.length > 0 && <ul>{pieces.map(p => <li key={p.id}>Wire {p.code}: both ends need identification.</li>)}</ul>}</div>;
  const matings = (model?.connector_matings ?? []).flatMap(m => {
    const a = model?.endpoints.find(e => e.id === m.from_endpoint_id);
    const b = model?.endpoints.find(e => e.id === m.to_endpoint_id);
    const pa = a ? L.place.get(a.id) : null, pb = b ? L.place.get(b.id) : null;
    return a && b && pa && pb ? [{ a, b, pa, pb }] : [];
  });
  const conflicts = pieces.filter(p => p.segment.specification_state === 'conflict');
  const selected = pieces.filter(p => sel === 'w:' + p.code);
  return (
    <div ref={box} data-snapshot-hash={model?.snapshot_hash} style={{ position: 'relative', height: '100%', overflow: 'auto', background: cw.surface }}>
      <p>{pieces.length} physical wire pieces. Planned lengths need verification before cutting. Recorded rule checks are not tied to the current physical specifications.</p>
      {conflicts.length > 0 && <p role="alert">{conflicts.map(p => `Wire ${p.code}: ${physicalPieceLabel(p)}`).join('; ')}</p>}
      {selected.length > 0 && <ul aria-label="Selected wire pieces">{selected.map(p => <li key={p.id}>{physicalPieceLabel(p)}</li>)}</ul>}
      {pieces.some(p => !p.from || !p.to) && <ul aria-label="Incomplete wire connections">{pieces.filter(p => !p.from || !p.to).map(p =>
        <li key={p.id}>Wire {p.code}: {!p.from && !p.to ? 'both ends need identification' : 'one end needs identification'}.</li>)}</ul>}
      <svg width={L.width * z} height={L.height * z} viewBox={`0 0 ${L.width} ${L.height}`} role="group" aria-label="Block diagram of this section's wires">
        <text x={L.X[0]} y={22} fontFamily={cw.fontBody} fontSize={10} fontWeight={700} fill={cw.inkMuted}>SOURCES AND CONTROLLERS</text>
        {L.cols[1].length > 0 && <text x={L.X[1]} y={22} fontFamily={cw.fontBody} fontSize={10} fontWeight={700} fill={cw.inkMuted}>PASS-THROUGHS AND SPLICES</text>}
        {L.cols[2].length > 0 && <text x={L.X[2]} y={22} fontFamily={cw.fontBody} fontSize={10} fontWeight={700} fill={cw.inkMuted}>LOADS AND SENSORS</text>}
        {L.hops.map(h => (
          <g key={h.piece.id} data-segment-id={h.piece.id} role="button" tabIndex={0} aria-label={physicalPieceLabel(h.piece)}
            onClick={() => onSelect('w:' + h.wc)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect('w:' + h.wc); } }} style={{ cursor: 'pointer' }}>
            <path d={h.d} fill="none" stroke="transparent" strokeWidth={9} />
            <path d={h.d} fill="none" stroke={h.piece.segment.specification_state === 'conflict' || h.piece.segment.design_status === 'contradicted' ? cw.danger : wcls(h.wc)} strokeWidth={has && (sel === 'w:' + h.wc) ? 2.4 : has && rel.wires.has(h.wc) ? 1.8 : 1}
              strokeDasharray={h.piece.circuit.design_status !== 'decided' || h.piece.segment.design_status !== 'decided' ? '5 3' : undefined}><title>{physicalPieceLabel(h.piece)}</title></path>
          </g>
        ))}
        {[...L.place.entries()].map(([dev, p]) => {
          const codes = [...new Set(p.rows.map(r => r.code))];
          const lit = has && codes.some(c => rel.nodes.has(c));
          return (
            <g key={dev} data-endpoint-id={dev} opacity={has && !lit ? 0.45 : 1}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={cw.surface} stroke={lit ? cw.accent : cw.faceStroke} strokeWidth={lit ? 2 : 1.2} />
              <line x1={p.x} y1={p.y + HDR - 4} x2={p.x + p.w} y2={p.y + HDR - 4} stroke={cw.faceStroke} />
              <text x={p.x + 7} y={p.y + 14} fontFamily={cw.fontBody} fontSize={11} fontWeight={700} fill={cw.ink} style={{ cursor: 'pointer' }}
                onClick={() => onSelect('n:' + codes[0])}>{name(dev).slice(0, p.w > 200 ? 34 : 24)}</text>
              <text x={p.x + 7} y={p.y + 26} fontFamily={cw.fontMono} fontSize={9.5} fill={cw.inkMuted}>{codes.join(' ').slice(0, p.w > 200 ? 40 : 28)}</text>
              {p.rows.map(r => {
                const key = r.code + '|' + r.cav, on = r.isBus ? sel === 'n:' + r.code : selPin === key, rl = has && r.wires.some(w => rel.wires.has(w));
                return (
                  <g key={r.key} data-electrical-node={r.key} data-termination-ids={r.terminationIds.join(',')} onClick={() => onSelect(r.isBus ? 'n:' + r.code : 'p:' + key)} style={{ cursor: 'pointer' }}>
                    <rect x={p.x + 1} y={r.y - ROW / 2} width={p.w - 2} height={ROW} fill={on ? cw.accent : rl ? `${cw.accent}22` : 'transparent'} />
                    <text x={p.x + 7} y={r.y + 3.5} fontFamily={cw.fontMono} fontSize={10.5} fill={on ? cw.onAccent : cw.ink}>{r.isBus ? 'Bus' : (r.cav || '—').slice(0, 9)}</text>
                    <text x={p.x + 72} y={r.y + 3.5} fontFamily={cw.fontMono} fontSize={10} fill={on ? cw.onAccent : cw.inkMuted}>{r.wires.join(' ').slice(0, p.w > 200 ? 26 : 14)}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
        {matings.map(({ a, b, pa, pb }) => <g key={a.id + ':' + b.id} data-mating="connector">
          <path d={`M${pa.x + pa.w} ${pa.y + 15}H${pa.x + pa.w + 12}V${pb.y + 15}H${pb.x + pb.w}`}
            fill="none" stroke={cw.inkMuted} strokeDasharray="2 4"><title>{a.code} mates with {b.code}. Connector relationship; no cable length or pin continuity inferred.</title></path>
        </g>)}
      </svg>
      {matings.length > 0 && <p>Dotted line: connector halves mate. Individual cavity continuity requires its own recorded mapping.</p>}
      <div style={{ display: 'inline-flex', gap: 4, margin: 8 }}>
        {[['−', 1 / 1.3], ['+', 1.3]].map(([l, f]) => (
          <button key={String(l)} onClick={() => setZ(v => Math.min(3, Math.max(0.3, v * Number(f))))} style={{ minWidth: 30, background: cw.surface, color: cw.ink, border: frame(cw), fontFamily: cw.fontBody, fontWeight: 700, cursor: 'pointer' }}>{l}</button>
        ))}
      </div>
    </div>
  );
}
