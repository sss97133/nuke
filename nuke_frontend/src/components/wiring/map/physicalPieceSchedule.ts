// A view scope over returned PostgreSQL IDs. No circuit creates a wire piece.
import type { PhysicalHarnessModel, PhysicalTermination } from './physicalHarnessModel';
import { engineeringText, type ScheduleColumn, type ScheduleRow, type SourceRecordKind, type SourceRecordTarget, type WiringSchedule } from './wiringSchedule';
import { publicName } from './useWorkspaceSelection';

const col = (key: string, label: string, width = 24, numeric = false): ScheduleColumn => ({ key, label, width, numeric });
const numeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const number = (n: number | null | undefined) => typeof n === 'number' && Number.isFinite(n) ? n : null;
const word = (s: string | null | undefined) => s ? s.replaceAll('_', ' ') : null;
const recordColumn: ScheduleColumn = { key: 'record', label: 'Open record', width: 24, link: true };
export interface PieceScheduleFilter {
  query: string; linkedCircuitIds?: ReadonlySet<string>; linkedEndpointIds?: ReadonlySet<string>;
  linkedPieceIds?: ReadonlySet<string>; linkedEndIds?: ReadonlySet<string>;
}

export function physicalRecordUrl(vehicleId: string, target: SourceRecordTarget, selection: string) {
  const p = new URLSearchParams({ tab: 'map', door: 'schedule', record: `${target.kind}:${target.id}` });
  if (selection) p.set('sel', selection);
  return `https://nuke.ag/vehicle/${encodeURIComponent(vehicleId)}/wiring?${p}`;
}

export function buildPhysicalPieceSchedule(model: PhysicalHarnessModel, filter: PieceScheduleFilter, isOwner: boolean): WiringSchedule {
  if (!model.design_selection) throw new Error('The database design selection has not been loaded.');
  const selectedCircuits = new Set(model.design_selection.circuit_ids), selectedPieces = new Set(model.design_selection.segment_ids);
  const circuits = new Map(model.circuits.map(c => [c.id, c]));
  const endpoints = new Map(model.endpoints.map(e => [e.id, e]));
  const ends = new Map(model.terminations.map(t => [t.id, t]));
  const unsegmented = model.unsegmented_end_records ?? [];
  const query = filter.query.trim().toLowerCase();
  const exactCase = model.circuits.filter(c => c.code === filter.query.trim());
  const exactCircuits = new Set((exactCase.length ? exactCase : model.circuits.filter(c => c.code.toLowerCase() === query)).map(c => c.id));
  const linked = filter.linkedCircuitIds !== undefined || filter.linkedEndpointIds !== undefined
    || filter.linkedPieceIds !== undefined || filter.linkedEndIds !== undefined;
  const searchEnd = (t: PhysicalTermination | undefined) => t ? [t.id, endpoints.get(t.endpoint_id)?.code, endpoints.get(t.endpoint_id)?.name,
    t.cavity, t.terminal_contact_pn, t.pin_seal_pn, t.crimp_tool_pn].map(v => engineeringText(v)).join(' ') : '';
  const matches = (values: unknown[]) => !query || values.join(' ').toLowerCase().includes(query);
  const pieces = model.segments.filter(s => {
    if (!selectedPieces.has(s.id)) return false;
    const c = circuits.get(s.circuit_id), f = s.from_termination_id ? ends.get(s.from_termination_id) : undefined,
      t = s.to_termination_id ? ends.get(s.to_termination_id) : undefined;
    return (!linked || filter.linkedCircuitIds?.has(s.circuit_id)
      || filter.linkedPieceIds?.has(s.id) || (s.from_termination_id && filter.linkedEndIds?.has(s.from_termination_id))
      || (s.to_termination_id && filter.linkedEndIds?.has(s.to_termination_id))
      || (f && filter.linkedEndpointIds?.has(f.endpoint_id)) || (t && filter.linkedEndpointIds?.has(t.endpoint_id)))
      && (exactCircuits.size ? exactCircuits.has(s.circuit_id)
        : matches([s.id, c?.code, publicName(c?.name ?? ''), s.gauge_awg, engineeringText(s.colour), engineeringText(s.keyed_part_number), searchEnd(f), searchEnd(t)]));
  });
  const scopedCircuits = new Set(pieces.map(s => s.circuit_id));
  // Keep selected circuits which have no selected piece. Their source records
  // remain inspectable; an empty piece set never manufactures a conductor.
  for (const c of model.circuits) {
    if (!selectedCircuits.has(c.id) || scopedCircuits.has(c.id)) continue;
    const contextEnds = [...model.terminations, ...unsegmented].filter(t => t.circuit_id === c.id);
    const linkedContext = !linked || filter.linkedCircuitIds?.has(c.id)
      || contextEnds.some(t => filter.linkedEndIds?.has(t.id) || filter.linkedEndpointIds?.has(t.endpoint_id));
    const matched = exactCircuits.size ? exactCircuits.has(c.id) : matches([c.id, c.code, publicName(c.name ?? ''), ...contextEnds.map(t => [t.id,
      endpoints.get(t.endpoint_id)?.code, 'cavity' in t ? engineeringText(t.cavity) : '', searchEnd(ends.get(t.id))].join(' '))]);
    const hasSelectedPiece = model.segments.some(s => selectedPieces.has(s.id) && s.circuit_id === c.id);
    if (linkedContext && matched && (!hasSelectedPiece || !!query || filter.linkedEndIds)) scopedCircuits.add(c.id);
  }
  const referencedEnds = new Set(pieces.flatMap(s => [s.from_termination_id, s.to_termination_id]).filter((id): id is string => id != null));
  const contextEnds = model.terminations.filter(t => scopedCircuits.has(t.circuit_id) || referencedEnds.has(t.id));
  const extraEnds = unsegmented.filter(t => scopedCircuits.has(t.circuit_id) && !ends.has(t.id));
  const endpointIds = new Set([...contextEnds, ...extraEnds].map(t => t.endpoint_id));
  const contextCircuitIds = new Set([...scopedCircuits, ...contextEnds.map(t => t.circuit_id)]);
  const endAddress = (id: string | null) => {
    const t = id ? ends.get(id) : undefined, e = t ? endpoints.get(t.endpoint_id) : undefined;
    return t ? `${e?.code ?? '[connection record not returned]'} · ${engineeringText(t.cavity) ?? '[cavity not recorded]'}`
      : id == null ? '[end not assigned]' : '[end record not returned]';
  };
  const row = (kind: SourceRecordKind, id: string, selection: string, cells: ScheduleRow['cells']): ScheduleRow => ({ id, selection,
    record: { kind, id }, cells: { ...cells, id, record: physicalRecordUrl(model.vehicle_id, { kind, id }, selection) } });
  const wireRows = pieces.map(s => {
    const c = circuits.get(s.circuit_id);
    return row('segments', s.id, c ? `w:${c.code}` : '', { code: c?.code ?? null, name: publicName(c?.name ?? ''),
      from: endAddress(s.from_termination_id), to: endAddress(s.to_termination_id), gauge: number(s.gauge_awg), colour: engineeringText(s.colour),
      part: engineeringText(s.keyed_part_number), spec: engineeringText(c?.wire_type), planned: number(s.planned_length_ft), basis: engineeringText(s.planned_length_method),
      measured: number(s.measured_length_ft), measuredAt: s.measured_at ?? null, build: word(s.build_state), design: word(s.design_status),
      specification: word(s.specification_state), connection: word(s.link_state), circuitId: s.circuit_id, netId: s.net_id,
      fromEndId: s.from_termination_id, toEndId: s.to_termination_id, section: c?.section ?? null });
  }).sort((a, b) => numeric(String(a.cells.code ?? ''), String(b.cells.code ?? '')) || a.id.localeCompare(b.id));
  const endRows = [...contextEnds.map(t => {
    const c = circuits.get(t.circuit_id), e = endpoints.get(t.endpoint_id);
    return row('ends', t.id, c ? `w:${c.code}` : '', { code: c?.code ?? null, node: e?.code ?? null, cavity: engineeringText(t.cavity),
      terminal: engineeringText(t.terminal_contact_pn), seal: engineeringText(t.pin_seal_pn), tool: engineeringText(t.crimp_tool_pn),
      role: referencedEnds.has(t.id) ? 'Referenced by shown piece' : 'Additional source end on shown circuit',
      circuitId: t.circuit_id, endpointId: t.endpoint_id, cavityId: t.cavity_layout_id });
  }), ...extraEnds.map(t => row('ends', t.id, circuits.has(t.circuit_id) ? `w:${circuits.get(t.circuit_id)!.code}` : '', {
    code: circuits.get(t.circuit_id)?.code ?? null, node: endpoints.get(t.endpoint_id)?.code ?? null,
    role: 'Unsegmented source end; cavity and part metadata not included in this read', circuitId: t.circuit_id, endpointId: t.endpoint_id,
  }))].sort((a, b) => numeric(String(a.cells.code ?? ''), String(b.cells.code ?? '')) || numeric(String(a.cells.node ?? ''), String(b.cells.node ?? '')) || a.id.localeCompare(b.id));
  const nodeRows = model.endpoints.filter(e => endpointIds.has(e.id)).map(e => row('endpoints', e.id, `n:${e.code}`, {
    code: e.code, name: publicName(e.name ?? ''), type: word(e.type), part: engineeringText(e.part_number), nodeKind: word(e.node_kind),
  })).sort((a, b) => numeric(String(a.cells.code ?? ''), String(b.cells.code ?? '')));
  const circuitRows = model.circuits.filter(c => contextCircuitIds.has(c.id)).map(c => row('circuits', c.id, `w:${c.code}`, {
    code: c.code, name: publicName(c.name ?? ''), design: word(c.design_status), section: c.section,
    gauge: number(c.gauge_awg), colour: engineeringText(c.colour), spec: engineeringText(c.wire_type), pieces: pieces.filter(s => s.circuit_id === c.id).length,
  })).sort((a, b) => numeric(String(a.cells.code ?? ''), String(b.cells.code ?? '')));
  const manifest: NonNullable<WiringSchedule['manifest']> = [];
  const add = (kind: SourceRecordKind, ids: Iterable<string>, available: ReadonlySet<string>) => {
    for (const id of [...new Set(ids)].sort()) manifest.push({ kind, id, state: available.has(id) ? 'included' : 'not returned by source reader' });
  };
  add('segments', pieces.map(s => s.id), new Set(pieces.map(s => s.id)));
  add('circuits', contextCircuitIds, new Set(circuitRows.map(r => r.id)));
  add('ends', [...referencedEnds, ...endRows.map(r => r.id)], new Set(endRows.map(r => r.id)));
  add('endpoints', endpointIds, new Set(nodeRows.map(r => r.id)));
  return { vehicleId: model.vehicle_id, isOwner, readAt: model.read_at ?? null, snapshotKey: model.snapshot_hash,
    scopeLabel: `${pieces.length} shown physical pieces; related source circuits, ends and connection points`, manifest,
    tables: [
      { id: 'wires', title: 'Physical wire pieces', rows: wireRows, columns: [col('code', 'Circuit', 16), col('name', 'Function', 40),
        col('from', 'From connection / cavity', 42), col('to', 'To connection / cavity', 42), col('gauge', 'AWG', 9, true), col('colour', 'Colour', 18),
        col('part', 'Keyed wire part', 30), col('spec', 'Source circuit specification', 28), col('planned', 'Planned length (ft)', 20, true), col('basis', 'Length basis', 35),
        col('measured', 'Measured length (ft)', 22, true), col('measuredAt', 'Measurement recorded at', 28), col('build', 'Recorded piece state', 24),
        col('specification', 'Stored specification agreement', 28), col('connection', 'Connection references', 24), col('design', 'Piece design state', 22),
        col('section', 'Section', 22), col('id', 'Physical piece ID', 38), col('circuitId', 'Source circuit ID', 38), col('netId', 'Net ID', 38),
        col('fromEndId', 'From termination ID', 38), col('toEndId', 'To termination ID', 38), recordColumn] },
      { id: 'pins', title: 'Terminations', rows: endRows, columns: [col('code', 'Circuit', 16), col('node', 'Connection point', 28), col('cavity', 'Cavity / stud', 42),
        col('terminal', 'Terminal part', 30), col('seal', 'Seal part', 28), col('tool', 'Crimp tool', 30), col('role', 'Source context', 50),
        col('id', 'Termination ID', 38), col('circuitId', 'Source circuit ID', 38), col('endpointId', 'Connection point ID', 38), col('cavityId', 'Cavity layout ID', 38), recordColumn] },
      { id: 'conns', title: 'Connection points', rows: nodeRows, columns: [col('code', 'Connection point', 28), col('name', 'Description', 44),
        col('type', 'Type', 22), col('part', 'Part number', 32), col('nodeKind', 'Node kind', 24), col('id', 'Connection point ID', 38), recordColumn] },
      { id: 'circuits', title: 'Source circuits', rows: circuitRows, columns: [col('code', 'Circuit', 16), col('name', 'Function', 40),
        col('design', 'Design state', 22), col('section', 'Section', 22), col('gauge', 'Circuit AWG', 14, true), col('colour', 'Circuit colour', 20),
        col('spec', 'Source specification', 28), col('pieces', 'Shown physical pieces', 22, true), col('id', 'Source circuit ID', 38), recordColumn] },
    ] };
}
