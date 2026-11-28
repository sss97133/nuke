import type { ReactNode } from 'react';
import type { PhysicalHarnessModel, PhysicalSegment } from './physicalHarnessModel';
import { engineeringText, type SourceRecordTarget } from './wiringSchedule';
import { publicName, wireGaugeDisplay } from './useWorkspaceSelection';

export function readSourceRecordTarget(value: string | null): SourceRecordTarget | null {
  if (!value) return null;
  const [kind, ...rest] = value.split(':');
  return ['segments', 'ends', 'endpoints', 'circuits'].includes(kind) && rest.join(':')
    ? { kind: kind as SourceRecordTarget['kind'], id: rest.join(':') } : null;
}

interface Props { model: PhysicalHarnessModel; target: SourceRecordTarget; onRecord: (target: SourceRecordTarget) => void }
const display = (v: unknown) => v == null || v === '' ? 'Not recorded' : typeof v === 'string' ? engineeringText(v) : String(v);

/** Exact returned records and their typed keys; no positional end inference. */
export function PhysicalRecordDetail({ model, target, onRecord }: Props) {
  const pieces = new Set(model.design_selection?.segment_ids ?? []);
  const circuits = new Map(model.circuits.map(c => [c.id, c]));
  const ends = new Map(model.terminations.map(t => [t.id, t]));
  const endpoints = new Map(model.endpoints.map(e => [e.id, e]));
  const link = (kind: SourceRecordTarget['kind'], id: string | null | undefined, title: string) => id
    ? <button type="button" title={id} onClick={() => onRecord({ kind, id })}>{title}</button> : <span>Not assigned</span>;
  const fields = (entries: [string, unknown][]) => <dl className="physical-record-fields">{entries.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{display(v)}</dd></div>)}</dl>;
  const address = (id: string | null) => {
    const t = id ? ends.get(id) : undefined;
    return t ? `${endpoints.get(t.endpoint_id)?.code ?? 'Connection unresolved'} · ${engineeringText(t.cavity) ?? 'Cavity not recorded'}` : id == null ? 'End not assigned' : 'End reference unresolved';
  };
  const pieceSummary = (s: PhysicalSegment) => `${address(s.from_termination_id)} → ${address(s.to_termination_id)}`;
  const circuitPieces = (id: string) => <ul className="physical-record-links">{model.segments.filter(s => s.circuit_id === id).map(s =>
    <li key={s.id}>{link('segments', s.id, pieceSummary(s))}<br />{s.gauge_awg == null ? 'Gauge not recorded' : `${wireGaugeDisplay(s.gauge_awg)} AWG`} · {s.planned_length_ft == null ? 'Length not recorded' : `${s.planned_length_ft} ft planned`}
      {!pieces.has(s.id) && ' · Outside selected design'}</li>)}</ul>;
  let body: ReactNode = null;
  let title: string | null = null;
  if (target.kind === 'segments') {
    const s = model.segments.find(s => s.id === target.id);
    if (s) {
      const c = circuits.get(s.circuit_id); title = `Physical wire piece · ${c?.code ?? 'Circuit reference unresolved'}`;
      body = <>{s.specification_state === 'conflict' && <p role="alert">The stored piece, circuit or catalog specifications conflict. This record is not a cutting instruction.</p>}
        <h3>Physical ends</h3><ol>{(['from', 'to'] as const).map(side => {
          const id = side === 'from' ? s.from_termination_id : s.to_termination_id;
          const t = id ? ends.get(id) : undefined;
          return <li key={side}>{side === 'from' ? 'From' : 'To'}: {link('ends', id, address(id))}
            {t && t.circuit_id !== s.circuit_id && <strong role="alert"> End belongs to another source circuit.</strong>}</li>;
        })}</ol>
        {fields([['Design membership', pieces.has(s.id) ? 'Selected design' : 'Source context outside selected design'],
        ['Function', publicName(c?.name ?? '')], ['Recorded piece AWG', wireGaugeDisplay(s.gauge_awg)], ['Recorded circuit AWG', wireGaugeDisplay(s.circuit_gauge_awg)],
        ['Piece colour', s.colour], ['Keyed wire part', s.keyed_part_number], ['Source circuit specification', c?.wire_type],
        ['Planned length (ft)', s.planned_length_ft], ['Length basis', s.planned_length_method], ['Measured length (ft)', s.measured_length_ft],
        ['Measurement recorded at', s.measured_at], ['Recorded piece state', s.build_state], ['Piece design state', s.design_status],
        ['Stored specification agreement', s.specification_state], ['Connection references', s.link_state]])}
        <p>{link('circuits', s.circuit_id, `Source circuit ${c?.code ?? s.circuit_id}`)}</p>
        <details><summary>Record keys</summary>{fields([['Piece ID', s.id], ['Source circuit ID', s.circuit_id], ['Net ID', s.net_id],
          ['Catalog part ID', s.wire_part_id], ['From termination ID', s.from_termination_id], ['To termination ID', s.to_termination_id]])}</details></>;
    }
  } else if (target.kind === 'ends') {
    const t = ends.get(target.id), u = model.unsegmented_end_records?.find(t => t.id === target.id);
    if (t || u) {
      const e = endpoints.get((t ?? u)!.endpoint_id); title = `Termination · ${e?.code ?? 'Connection reference unresolved'}`;
      body = <>{fields([['Termination ID', target.id], ['Circuit ID', (t ?? u)!.circuit_id], ['Connection point ID', (t ?? u)!.endpoint_id],
        ...(t ? [['Cavity / stud', t.cavity], ['Cavity layout ID', t.cavity_layout_id], ['Terminal part', t.terminal_contact_pn],
          ['Terminal catalog ID', t.terminal_contact_catalog_id], ['Seal part', t.pin_seal_pn], ['Seal catalog ID', t.pin_seal_catalog_id],
          ['Crimp tool', t.crimp_tool_pn], ['Crimp tool catalog ID', t.crimp_tool_catalog_id]] as [string, unknown][] : [])])}
        {!t && <p>Cavity and part metadata are not included for this unsegmented end in the current source reader.</p>}
        <p>{link('endpoints', (t ?? u)!.endpoint_id, `Connection ${e?.code ?? (t ?? u)!.endpoint_id}`)}</p>
        <p>{link('circuits', (t ?? u)!.circuit_id, 'Source circuit')}</p>
        <h3>Referenced source pieces</h3><ul className="physical-record-links">{model.segments.filter(s => [s.from_termination_id, s.to_termination_id].includes(target.id)).map(s =>
          <li key={s.id}>{link('segments', s.id, pieceSummary(s))}</li>)}</ul></>;
    }
  } else if (target.kind === 'endpoints') {
    const e = endpoints.get(target.id);
    if (e) {
      title = `Connection point · ${e.code}`;
      body = <>{fields([['Connection point ID', e.id], ['Description', publicName(e.name ?? '')], ['Part number', e.part_number], ['Recorded type', e.type], ['Node kind', e.node_kind]])}
        <h3>Source terminations</h3><ul className="physical-record-links">{[...model.terminations, ...(model.unsegmented_end_records ?? [])].filter(t => t.endpoint_id === e.id).map(t =>
          <li key={t.id}>{link('ends', t.id, `${circuits.get(t.circuit_id)?.code ?? 'Circuit unresolved'} · ${'cavity' in t ? t.cavity ?? 'Cavity not recorded' : 'Cavity not included'}`)}</li>)}</ul></>;
    }
  } else {
    const c = circuits.get(target.id);
    if (c) {
      title = `Source circuit · ${c.code}`;
      body = <>{fields([['Source circuit ID', c.id], ['Function', publicName(c.name ?? '')], ['Design state', c.design_status], ['Section', c.section],
        ['Circuit AWG', wireGaugeDisplay(c.gauge_awg)], ['Circuit colour', c.colour], ['Source specification', c.wire_type]])}
        <h3>Physical piece records</h3>{circuitPieces(c.id)}
        <h3>Source terminations</h3><ul className="physical-record-links">{[...model.terminations, ...(model.unsegmented_end_records ?? [])].filter(t => t.circuit_id === c.id).map(t =>
          <li key={t.id}>{link('ends', t.id, `${endpoints.get(t.endpoint_id)?.code ?? 'Connection unresolved'} · ${'cavity' in t ? t.cavity ?? 'Cavity not recorded' : 'Cavity not included'}`)}</li>)}</ul>
        {!model.segments.some(s => s.circuit_id === c.id) && <p>No physical piece record for this source circuit is included in this read.</p>}</>;
    }
  }
  if (!title) return <div role="alert">This exact {target.kind} record is not returned by the current source reader: {target.id}. No replacement record has been selected.</div>;
  return <section className="physical-record-detail" aria-label="Physical source record" tabIndex={-1}><h2>{title}</h2>
    <p className="physical-record-qualification">Recorded plans and states are not construction release, stock allocation or proof of completion.</p>{body}
    <details className="physical-record-qualification"><summary>Source reference</summary><p>Content {model.snapshot_hash} · Read {model.read_at ?? 'time not included'}</p></details>
    </section>;
}
