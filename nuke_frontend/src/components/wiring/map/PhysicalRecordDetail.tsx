import type { ReactNode } from 'react';
import PrefetchLink from '../../PrefetchLink';
import { engineeringText as text } from './wiringSchedule';
import { endLabel, sectionName, shortId, word, type PhysicalCircuit, type PhysicalEnd,
  type PhysicalEndpoint, type PhysicalSegment, type PhysicalWorkspace, type WorkspaceIndex, type WorkspaceTable } from './physicalWorkspaceModel';

export type RecordSelection = { table: WorkspaceTable; id: string };
type Pick = (table: WorkspaceTable, id: string) => void;
interface Context { data: PhysicalWorkspace; ix: WorkspaceIndex; pick: Pick }
const length = (v: number | null | undefined, unit = 'ft') => v == null ? null : `${v.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`;
const stamp = (v: string | null | undefined) => v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return <div className="hw-field"><dt>{label}</dt><dd className={mono ? 'hw-mono' : undefined}>{children == null || children === '' ? <span className="hw-unknown">Not recorded</span> : children}</dd></div>;
}
function Group({ title, children }: { title: string; children: ReactNode }) { return <section className="hw-detail-group"><h3>{title}</h3>{children}</section>; }
function Link({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button type="button" className="hw-link" onClick={onClick}>{children}</button>; }

export function RecordDetail({ selected, data, ix, pick }: Context & { selected: RecordSelection }) {
  const record = ix[selected.table].get(selected.id);
  if (!record) return <div className="hw-detail" role="status"><h2>Record unavailable</h2><p>This record is not part of the current database read.</p><code>{selected.id}</code></div>;
  return <div className="hw-detail">
    {selected.table === 'segments' ? <SegmentDetail segment={record as PhysicalSegment} data={data} ix={ix} pick={pick} /> : selected.table === 'ends' ? <EndDetail end={record as PhysicalEnd} data={data} ix={ix} pick={pick} />
      : selected.table === 'endpoints' ? <EndpointDetail endpoint={record as PhysicalEndpoint} data={data} ix={ix} pick={pick} /> : <CircuitDetail circuit={record as PhysicalCircuit} data={data} ix={ix} pick={pick} />}
    <RecordEvidence selected={selected} data={data} ix={ix} />
    <Group title="Record identity"><dl><Field label="Record ID" mono>{record.id}</Field><Field label="Observed">{stamp(record.observed_at)}</Field><Field label="Source trust">{record.trust}</Field></dl></Group>
  </div>;
}
const evidenceKind = { segments: 'segment', ends: 'termination', endpoints: 'endpoint' } as const;
function RecordEvidence({ selected, data, ix }: { selected: RecordSelection; data: PhysicalWorkspace; ix: WorkspaceIndex }) {
  const relatedNets = new Map(data.segments.filter(s => selected.table === 'circuits' ? s.circuit_id === selected.id : selected.table === 'segments' && s.id === selected.id)
    .flatMap(s => { const net = ix.nets.get(s.net_id ?? ''); return net ? [[net.id, net] as const] : []; }));
  const relatedSignals = new Map([...relatedNets.values()].flatMap(n => { const signal = ix.signals.get(n.signal_id ?? ''); return signal ? [[signal.id, signal] as const] : []; }));
  const edges = data.evidence_edges.flatMap(edge => {
    if (selected.table !== 'circuits' && edge.row_kind === evidenceKind[selected.table] && edge.row_id === selected.id) return [{ edge, scope: 'This record' }];
    if (edge.row_kind === 'net' && relatedNets.has(edge.row_id)) return [{ edge, scope: `Related net ${relatedNets.get(edge.row_id)!.net_code} · ${shortId(edge.row_id)}` }];
    if (edge.row_kind === 'signal' && relatedSignals.has(edge.row_id)) return [{ edge, scope: `Related signal ${text(relatedSignals.get(edge.row_id)!.name)} · ${shortId(edge.row_id)}` }];
    return [];
  });
  return <Group title="Linked evidence">
    {selected.table === 'circuits' && <p className="hw-muted">Net and signal evidence is linked through this circuit’s physical pieces.</p>}
    {edges.length ? <ul className="hw-evidence-list">{edges.map(({ edge, scope }) => <li key={edge.id}>
      <PrefetchLink className="hw-link" to={`/vehicle/${encodeURIComponent(data.vehicle_id)}/observation/${encodeURIComponent(edge.observation_id)}`}>Open evidence record · {shortId(edge.observation_id)}</PrefetchLink>
      <small>{scope}</small>
      <small>{word(edge.relation)}{edge.field && ` · ${text(edge.field)}`}</small>
    </li>)}</ul> : <p className="hw-unknown">{selected.table === 'circuits' ? 'No evidence links for this circuit’s related nets or signals were included in this read.' : 'No evidence links for this record were included in this read.'}</p>}
    <p className="hw-muted">Source prose is not included in this harness read. The evidence page checks access to each observation; source text and artifacts may be withheld there.</p>
  </Group>;
}
function PieceLinks({ pieces, ix, pick, selectedId }: { pieces: PhysicalSegment[]; ix: WorkspaceIndex; pick: Pick; selectedId?: string }) {
  return <div className="hw-related-list">{pieces.map(piece => <button type="button" key={piece.id} className={piece.id === selectedId ? 'hw-related-current' : undefined} onClick={() => pick('segments', piece.id)}>
    <span>{endLabel(piece.from_termination_id, ix)}<br />→ {endLabel(piece.to_termination_id, ix)}</span><small>Piece {shortId(piece.id)} · {length(piece.planned_length_ft) ?? 'Planned length unknown'}</small></button>)}</div>;
}
function SegmentDetail({ segment: s, data, ix, pick }: Context & { segment: PhysicalSegment }) {
  const c = ix.circuits.get(s.circuit_id ?? ''), target = ix.circuits.get(s.current_circuit_id ?? ''), net = ix.nets.get(s.net_id ?? '');
  const routes = data.routings.filter(r => r.segment_id === s.id).sort((a, b) => a.seq - b.seq);
  const related = data.segments.filter(p => p.net_id === s.net_id && s.net_id !== null);
  const endpointIds = new Set(related.flatMap(p => [ix.ends.get(p.from_termination_id ?? '')?.endpoint_id, ix.ends.get(p.to_termination_id ?? '')?.endpoint_id]));
  const mates = data.mates.filter(m => endpointIds.has(m.from_endpoint_id) && endpointIds.has(m.to_endpoint_id));
  return <><div className="hw-record-title"><span>Wire piece · {shortId(s.id)}</span><h2>{c?.circuit_code ?? 'Unresolved circuit'}<small>{text(c?.circuit_name)}</small></h2><div className="hw-tags"><span>{word(s.design_status) || 'Design not recorded'}</span><span>{word(s.build_state) || 'Build not recorded'}</span></div></div>
    {!!s.blockers.length && <Group title="Material / revision issues"><ul className="hw-blockers">{s.blockers.map(blocker => <li key={blocker}>{word(blocker)}</li>)}</ul></Group>}
    <Group title="Physical ends"><div className="hw-end-pair">{([['From', s.from_termination_id], ['To', s.to_termination_id]] as const).map(([label, id]) => <div key={label}><span>{label}</span>{id ? <Link onClick={() => pick('ends', id)}>{endLabel(id, ix)}</Link> : <span className="hw-unknown">Unresolved end</span>}</div>)}</div></Group>
    <Group title="Material and length"><dl><Field label="Piece material">{[s.gauge_awg == null ? null : `${s.gauge_awg} AWG`, text(s.colour)].filter(Boolean).join(' · ')}</Field><Field label="Catalog wire part" mono>{text(s.part_number)}</Field><Field label="Expected material reference" mono>{text(s.expected_part_number)}</Field><Field label="Source wire specification" mono>{text(c?.wire_type)}</Field><Field label="Planned length">{length(s.planned_length_ft)}</Field><Field label="Planning basis">{text(s.planned_length_method)}</Field><Field label="Measured length">{length(s.measured_length_ft)}</Field><Field label="Measured at">{stamp(s.measured_at)}</Field></dl><p className="hw-muted">The expected reference identifies the specified material. Catalog identity and availability require their own records.</p></Group>
    <Group title="Design source"><dl><Field label="Plan membership">{s.in_current_plan ? 'Current plan' : 'Outside current plan'}</Field><Field label="Source circuit">{c && <Link onClick={() => pick('circuits', c.id)}>{c.circuit_code} · {c.is_superseded ? 'retained revision' : 'current revision'}</Link>}</Field>
      {(s.needs_revision || s.circuit_id !== s.current_circuit_id) && <><Field label="Current target">{target && <Link onClick={() => pick('circuits', target.id)}>{target.circuit_code} · {shortId(target.id)}</Link>}</Field><Field label="Target material">{[s.expected_gauge_awg == null ? null : `${s.expected_gauge_awg} AWG`, text(s.expected_colour), text(s.expected_part_number)].filter(Boolean).join(' · ')}</Field></>}
      <Field label="Check applicability">{word(c?.check_applicability)}</Field></dl></Group>
    <Group title={`Net ${net?.net_code ?? 'unresolved'}`}><p className="hw-muted">{text(net?.function)}</p><PieceLinks pieces={related} ix={ix} pick={pick} selectedId={s.id} />{mates.map(m => <div className="hw-mate" key={`${m.from_endpoint_id}:${m.to_endpoint_id}`}>Declared connector mate: {ix.endpoints.get(m.from_endpoint_id)?.code} ↔ {ix.endpoints.get(m.to_endpoint_id)?.code}</div>)}</Group>
    <Group title="Recorded route">{routes.length ? <ol className="hw-route-list">{routes.map(route => { const branch = ix.branches.get(route.landmark_id ?? ''); return <li key={route.id}><strong>{branch?.landmark_code ?? 'Unresolved branch'}</strong> {text(branch?.description)}
      <small>{length(branch?.distance_in, 'in') ?? 'Distance not recorded'} · {word(branch?.method) || 'Basis not included in this read'}{!route.branch_current && ' · Retained or unresolved branch'}</small>
      {branch && <details><summary>Route geometry</summary><dl><Field label="From node">{ix.topology.get(branch.from_node_id ?? '')?.node_code}</Field><Field label="To node">{ix.topology.get(branch.to_node_id ?? '')?.node_code}</Field><Field label="Derived on">{branch.derived_on}</Field></dl></details>}</li>; })}</ol> : <p className="hw-unknown">No route membership recorded for this piece.</p>}</Group>
  </>;
}
function EndDetail({ end: e, data, ix, pick }: Context & { end: PhysicalEnd }) {
  const endpoint = ix.endpoints.get(e.endpoint_id), circuit = ix.circuits.get(e.circuit_id ?? '');
  const pieces = data.segments.filter(s => s.from_termination_id === e.id || s.to_termination_id === e.id);
  return <><div className="hw-record-title"><span>{e.physical_end ? 'Physical wire end' : 'Other termination record'}</span><h2>{endpoint?.code ?? 'Unresolved connection'}<small>{text(e.cavity) ?? 'Cavity not recorded'}</small></h2>{e.is_superseded && <p className="hw-issue">Retained revision</p>}</div>
    <Group title="Connection"><dl><Field label="Connection point">{endpoint && <Link onClick={() => pick('endpoints', endpoint.id)}>{endpoint.code}</Link>}</Field><Field label="Cavity / stud">{text(e.cavity)}</Field><Field label="Cavity key" mono>{e.cavity_layout_id}</Field><Field label="Circuit">{circuit && <Link onClick={() => pick('circuits', circuit.id)}>{circuit.circuit_code}</Link>}</Field></dl></Group>
    <Group title="Specified parts and tool"><dl><Field label="Terminal" mono>{text(e.terminal_contact_pn)}</Field><Field label="Seal" mono>{text(e.pin_seal_pn)}</Field><Field label="Housing" mono>{text(e.connector_housing_pn)}</Field><Field label="Wedge lock" mono>{text(e.wedge_lock_pn)}</Field><Field label="Crimp tool" mono>{text(e.crimp_tool_pn)}</Field></dl><p className="hw-muted">Specifications describe requirements. Received quantity and tool availability are separate records.</p></Group>
    <Group title="Connected physical pieces">{pieces.length ? <PieceLinks pieces={pieces} ix={ix} pick={pick} /> : <p className="hw-unknown">No physical piece references this record.</p>}</Group>
  </>;
}
function EndpointDetail({ endpoint: e, data, ix, pick }: Context & { endpoint: PhysicalEndpoint }) {
  const ends = data.ends.filter(t => t.endpoint_id === e.id), point = ix.topology.get(e.topology_node_id ?? '');
  const mates = data.mates.filter(m => m.from_endpoint_id === e.id || m.to_endpoint_id === e.id);
  return <><div className="hw-record-title"><span>Connection point</span><h2>{e.code}<small>{text(e.name)}</small></h2><div className="hw-tags"><span>{word(e.design_status) || 'Design not recorded'}</span>{e.is_superseded && <span>Retained revision</span>}</div></div>
    <Group title="Connection specification"><dl><Field label="Type">{word(e.endpoint_type)}</Field><Field label="Family">{text(e.family)}</Field><Field label="Catalog part" mono>{text(e.part_number)}</Field></dl></Group>
    {!!mates.length && <Group title="Declared mates">{mates.map(m => { const id = m.from_endpoint_id === e.id ? m.to_endpoint_id : m.from_endpoint_id; return <Link key={id} onClick={() => pick('endpoints', id)}>{ix.endpoints.get(id)?.code ?? shortId(id)}</Link>; })}</Group>}
    <Group title="Database placement"><dl><Field label="Topology node">{point?.node_code}</Field><Field label="X / Y / Z (m)">{point && [point.pos_x_m, point.pos_y_m, point.pos_z_m].map(v => v == null ? 'Unknown' : v).join(' / ')}</Field><Field label="Position basis">{text(point?.pos_source) ?? 'Basis not included in this read'}</Field><Field label="Revision">{point ? point.is_superseded ? 'Retained topology revision' : 'Current topology revision' : null}</Field></dl></Group>
    <Group title="Termination records"><div className="hw-related-list">{ends.length ? ends.map(end => <button type="button" key={end.id} onClick={() => pick('ends', end.id)}><span>{text(end.cavity) ?? 'Cavity not recorded'}</span><small>Circuit {ix.circuits.get(end.circuit_id ?? '')?.circuit_code ?? end.wire_code ?? 'unknown'} · {text(end.terminal_contact_pn) ?? 'Terminal not recorded'}</small></button>) : <p className="hw-unknown">No termination records returned.</p>}</div></Group>
  </>;
}
function CircuitDetail({ circuit: c, data, ix, pick }: Context & { circuit: PhysicalCircuit }) {
  const pieces = data.segments.filter(s => s.circuit_id === c.id);
  return <><div className="hw-record-title"><span>Circuit source</span><h2>{c.circuit_code}<small>{text(c.circuit_name)}</small></h2><div className="hw-tags"><span>{word(c.design_status) || 'Design not recorded'}</span>{c.is_superseded && <span>Retained source revision</span>}</div></div>
    <Group title="Design specification"><dl><Field label="Section">{sectionName(c.harness_section)}</Field><Field label="Wire">{[c.wire_gauge_awg == null ? null : `${c.wire_gauge_awg} AWG`, text(c.wire_color), text(c.wire_type)].filter(Boolean).join(' · ')}</Field></dl></Group>
    <Group title="Linked physical pieces">{pieces.length ? <PieceLinks pieces={pieces} ix={ix} pick={pick} /> : <p className="hw-issue">No physical piece is linked to this circuit.</p>}</Group>
    <Group title="Recorded checks"><dl><Field label="Applicability">{word(c.check_applicability)}</Field><Field label="Recorded at">{stamp(c.checked_at)}</Field><Field label="Check version">{text(c.checks_version)}</Field>{c.checks_invalidated_at && <Field label="Invalidated at">{stamp(c.checks_invalidated_at)}</Field>}{c.checks_invalidation_reason && <Field label="Invalidation reason">{text(c.checks_invalidation_reason)}</Field>}</dl>
      <p className="hw-muted">These recorded results are not bound to a complete current electrical validation.</p>{c.recorded_checks && <ul className="hw-checks">{Object.entries(c.recorded_checks).map(([rule, result]) => <li key={rule}><strong>{rule} · {result[0]}</strong><span>{text(result[1])}</span></li>)}</ul>}</Group>
  </>;
}
