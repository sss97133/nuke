import { useMemo, useState } from 'react';
import { layoutPhysicalPieces, type DiagramEnd, type DiagramPiece } from './physicalDiagramLayout';
import { engineeringText } from './wiringSchedule';
import { shortId, type PhysicalSegment, type PhysicalWorkspace, type WorkspaceIndex, type WorkspaceTable } from './physicalWorkspaceModel';

/** Exact physical edges from the returned snapshot. Layout is presentational. */
export function diagramPieces(segments: PhysicalSegment[], ix: WorkspaceIndex): DiagramPiece[] {
  const end = (id: string | null, circuitId: string | null): DiagramEnd | null => {
    const t = ix.ends.get(id ?? ''), e = t ? ix.endpoints.get(t.endpoint_id) : undefined;
    if (!t || !e || !circuitId || t.circuit_id !== circuitId) return null;
    return { id: t.id, endpointId: e.id, nodeKey: t.id, code: e.code ?? 'Unnamed connection',
      cavity: engineeringText(t.cavity), isBus: false };
  };
  return segments.map(s => ({ id: s.id, code: ix.circuits.get(s.circuit_id ?? '')?.circuit_code ?? 'Unresolved circuit',
    from: end(s.from_termination_id, s.circuit_id), to: end(s.to_termination_id, s.circuit_id) }));
}

export function PhysicalDiagram({ data, ix, segmentIds, selectedId, pick }: { data: PhysicalWorkspace; ix: WorkspaceIndex;
  segmentIds: string[]; selectedId?: string; pick: (table: WorkspaceTable, id: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const segments = useMemo(() => segmentIds.flatMap(id => { const s = ix.segments.get(id); return s ? [s] : []; }), [segmentIds, ix]);
  const pieces = useMemo(() => diagramPieces(segments, ix), [segments, ix]);
  const graph = useMemo(() => layoutPhysicalPieces(pieces), [pieces]);
  const selected = ix.segments.get(selectedId ?? '');
  const matings = data.mates.filter(m => graph.place.has(m.from_endpoint_id) && graph.place.has(m.to_endpoint_id));
  const incomplete = pieces.filter(p => !p.from || !p.to);
  return <div className="hw-diagram">
    <div className="hw-diagram-tools"><span>{pieces.length} physical pieces · Diagram is not to scale</span><div>
      <button type="button" aria-label="Zoom diagram out" onClick={() => setZoom(z => Math.max(.3, z / 1.2))}>−</button>
      <button type="button" aria-label="Reset diagram zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom diagram in" onClick={() => setZoom(z => Math.min(3, z * 1.2))}>+</button></div></div>
    <div className="hw-diagram-scroll" tabIndex={0} aria-label="Physical connection diagram">
      {!pieces.length ? <div className="hw-empty"><h3>No physical pieces in this selection</h3><p>Choose another section or clear the filters.</p></div> : <>
        {!!incomplete.length && <p className="hw-diagram-warning">{incomplete.length} pieces have unresolved ends. Their recorded connections remain visible; inspect the piece for its missing references.</p>}
        <svg width={graph.width * zoom} height={graph.height * zoom} viewBox={`0 0 ${graph.width} ${graph.height}`} aria-label="Physical pieces and declared connector mates" role="group">
          {graph.hops.map(h => {
            const s = ix.segments.get(h.piece.id)!, active = s.id === selectedId;
            const related = !!selected && s.net_id !== null && s.net_id === selected.net_id;
            const description = `${h.wc}, piece ${shortId(s.id)}: ${h.piece.from?.code ?? 'Unresolved'} ${h.piece.from?.cavity ?? ''} to ${h.piece.to?.code ?? 'Unresolved'} ${h.piece.to?.cavity ?? ''}`;
            return <g key={s.id} data-segment-id={s.id} role="button" tabIndex={0} aria-label={description} className="hw-diagram-piece" onClick={() => pick('segments', s.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick('segments', s.id); } }}>
              <title>{description} · {s.measured_length_ft != null ? `${s.measured_length_ft} ft measured` : s.planned_length_ft != null ? `${s.planned_length_ft} ft planned` : 'Length not recorded'}{s.blockers.length ? ` · ${s.blockers.join(', ')}` : ''}</title>
              <path d={h.d} fill="none" stroke="transparent" strokeWidth={14} />
              <path d={h.d} fill="none" stroke={s.blockers.length ? 'var(--hw-warn)' : active || related ? 'var(--hw-accent)' : 'var(--hw-ink)'} strokeWidth={active ? 3 : related ? 2 : 1.2} strokeDasharray={s.design_status === 'decided' ? undefined : '6 4'} />
            </g>;
          })}
          {matings.map(m => { const a = graph.place.get(m.from_endpoint_id)!, b = graph.place.get(m.to_endpoint_id)!; return <g key={`${m.from_endpoint_id}:${m.to_endpoint_id}`} data-mating="connector">
            <title>{ix.endpoints.get(m.from_endpoint_id)?.code} mates with {ix.endpoints.get(m.to_endpoint_id)?.code}. Declared connector relationship, not a wire or a continuity result.</title>
            <path d={`M${a.x + a.w} ${a.y + 15}h14V${b.y + 15}H${b.x + b.w}`} fill="none" stroke="var(--hw-muted)" strokeWidth={1.5} strokeDasharray="2 5" /></g>; })}
          {[...graph.place].map(([id, place]) => {
            const endpoint = ix.endpoints.get(id), code = endpoint?.code ?? 'Unnamed connection';
            return <g key={id} data-endpoint-id={id}>
              <rect x={place.x} y={place.y} width={place.w} height={place.h} fill="var(--hw-bg)" stroke="var(--hw-border)" />
              <g role="button" tabIndex={0} aria-label={`Inspect connection ${code}`} className="hw-diagram-node" onClick={() => pick('endpoints', id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick('endpoints', id); } }}>
                <rect x={place.x} y={place.y} width={place.w} height={40} fill="var(--hw-surface)" stroke="var(--hw-border)" />
                <text x={place.x + 10} y={place.y + 17} fontSize={13} fontWeight={650} fill="var(--hw-ink)">{code}<title>{engineeringText(endpoint?.name)}</title></text>
                <text x={place.x + 10} y={place.y + 32} fontSize={11} fill="var(--hw-muted)">{endpoint?.design_status ?? 'Design not recorded'}</text>
              </g>
              {place.rows.map(row => <g key={row.key} data-termination-id={row.key} role="button" tabIndex={0} className="hw-diagram-node" aria-label={`Inspect ${row.code} ${row.cav || 'unknown cavity'}`} onClick={() => pick('ends', row.key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick('ends', row.key); } }}>
                <title>{row.cav || 'Cavity not recorded'} · Circuits {row.wires.join(', ')}</title>
                <rect x={place.x + 1} y={row.y - row.height / 2} width={place.w - 2} height={row.height} fill="transparent" />
                <text fontSize={12} fill="var(--hw-ink)">{row.cavityLines.map((line, i) => <tspan key={i} x={place.x + 10} y={row.y - row.height / 2 + 14 + i * 14}>{line}</tspan>)}</text>
                <text x={place.x + 10} y={row.y + row.height / 2 - 5} fontSize={10.5} fill="var(--hw-muted)">Circuit {row.wires.join(', ')} · end {shortId(row.key)}</text>
              </g>)}
            </g>;
          })}
        </svg>
        {pieces.filter(p => !p.from && !p.to).map(p => <button type="button" key={p.id} className="hw-diagram-unresolved" onClick={() => pick('segments', p.id)}>Circuit {p.code} · piece {shortId(p.id)} · both ends unresolved</button>)}
      </>}
    </div>
    <div className="hw-diagram-legend">Solid line: physical piece. Dashed wire: design not decided. Dotted line: declared connector mate. Select a line or connection to inspect its record.</div>
  </div>;
}
