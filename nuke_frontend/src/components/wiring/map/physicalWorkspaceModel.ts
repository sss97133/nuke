// Presentation contract for public.harness_schematic_model. Values and conclusions
// belong to PostgreSQL; this file only joins returned keys and formats schedules.
import type { ScheduleColumn, ScheduleRow, ScheduleTable, WiringSchedule } from './wiringSchedule';
import { engineeringText } from './wiringSchedule';
import { SECTIONS } from './useWiringMap';

interface Provenance { source: string | null; method: string | null; observed_at: string | null; trust: string | null }
interface Revision { is_superseded: boolean | null; superseded_by: string | null }
export interface PhysicalCircuit extends Provenance, Revision {
  id: string; circuit_code: string; circuit_name: string | null; harness_section: string | null;
  design_status: string | null; wire_gauge_awg: number | null; wire_color: string | null; wire_type: string | null;
  is_shielded: boolean | null; recorded_checks: Record<string, [string, string]> | null;
  checked_at: string | null; checks_version: string | null;
  checks_invalidated_at: string | null; checks_invalidation_reason: string | null; check_applicability: string;
}
export interface PhysicalSegment extends Provenance {
  id: string; net_id: string | null; circuit_id: string | null; current_circuit_id: string | null;
  from_termination_id: string | null; to_termination_id: string | null;
  gauge_awg: number | null; colour: string | null; wire_part_id: string | null; part_number: string | null;
  planned_length_ft: number | null; planned_length_method: string | null;
  measured_length_ft: number | null; measured_at: string | null; build_state: string | null; design_status: string | null;
  in_current_plan: boolean;
  expected_gauge_awg: number | null; expected_colour: string | null; expected_part_number: string | null;
  expected_part_id: string | null; physical_progress: boolean; needs_revision: boolean; blockers: string[];
}
export interface PhysicalEnd extends Provenance, Revision {
  id: string; circuit_id: string | null; endpoint_id: string; wire_code: string | null; cavity: string | null;
  cavity_layout_id: string | null; terminal_contact_pn: string | null; terminal_contact_catalog_id: string | null;
  pin_seal_pn: string | null; pin_seal_catalog_id: string | null; crimp_tool_pn: string | null; crimp_tool_catalog_id: string | null;
  connector_housing_pn: string | null; connector_housing_catalog_id: string | null;
  wedge_lock_pn: string | null; wedge_lock_catalog_id: string | null; physical_end: boolean;
}
export interface PhysicalEndpoint extends Provenance, Revision {
  id: string; code: string | null; name: string | null; endpoint_type: string | null; family: string | null;
  harness_section: string | null; design_status: string | null; work_status: string | null;
  part_number: string | null; catalog_part_id: string | null; mates_with_endpoint_id: string | null; topology_node_id: string | null;
}
export interface PhysicalNet extends Provenance, Revision {
  id: string; net_code: string; signal_id: string | null; function: string | null; nominal_current_a: number | null;
  peak_current_a: number | null; protection_setting_a: number | null;
}
export interface PhysicalSignal extends Provenance, Revision { id: string; signal_key: string; name: string; signal_type: string | null }
export interface PhysicalRouting { id: string; segment_id: string; landmark_id: string | null; seq: number;
  source: string | null; observed_at: string | null; trust: string | null; branch_current: boolean }
export interface PhysicalBranch extends Revision { id: string; landmark_code: string; description: string | null;
  distance_in: number | null; method: string | null; from_node_id: string | null; to_node_id: string | null;
  polyline_m: unknown; source_file: string | null; derived_on: string | null }
export interface PhysicalTopology extends Provenance, Revision { id: string; node_code: string; kind: string;
  pos_x_m: number | null; pos_y_m: number | null; pos_z_m: number | null; pos_source: string | null }
export interface PhysicalMate { from_endpoint_id: string; to_endpoint_id: string; relation: string }
export interface PhysicalEvidenceEdge {
  id: string; observation_id: string; row_kind: 'signal' | 'net' | 'segment' | 'termination' | 'endpoint';
  row_id: string; field: string | null; relation: 'supports' | 'needs_bench' | 'open' | 'contradicts';
}
export interface PhysicalWorkspace {
  schema_version: 1; vehicle_id: string; read_at: string; snapshot_key: string;
  provenance_scope: 'keyed_evidence_only'; evidence_edges: PhysicalEvidenceEdge[];
  circuits: PhysicalCircuit[]; segments: PhysicalSegment[]; ends: PhysicalEnd[]; endpoints: PhysicalEndpoint[];
  nets: PhysicalNet[]; signals: PhysicalSignal[]; routings: PhysicalRouting[]; branches: PhysicalBranch[]; topology_nodes: PhysicalTopology[]; mates: PhysicalMate[];
  counts: { current_circuits: number; physical_segments: number; current_plan_segments: number; physical_ends: number;
    segments_with_material_blockers: number; segments_with_planned_length: number; segments_with_measured_length: number;
    current_circuits_without_segments: number; routed_segments: number };
}

export const workspaceTables = ['segments', 'ends', 'endpoints', 'circuits'] as const;
export type WorkspaceTable = typeof workspaceTables[number];
export const tableLabels: Record<WorkspaceTable, string> = { segments: 'Wire pieces', ends: 'Terminations', endpoints: 'Connection points', circuits: 'Circuits' };
export const word = (value: string | null | undefined) => value?.replaceAll('_', ' ') ?? '';
export const sectionName = (value: string | null | undefined) => SECTIONS.find(s => s.id === value)?.label.replaceAll(' + ', ' / ') ?? (word(value) || 'Unassigned');
export const shortId = (id: string | null | undefined) => id ? id.slice(0, 8) : 'Unknown';
export const numericCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const searchableFields: Record<WorkspaceTable, string[]> = {
  segments: ['code', 'name', 'from', 'to', 'gauge', 'colour', 'part', 'expectedPart', 'specification', 'planned', 'measured', 'design', 'build', 'issues', 'section'],
  ends: ['circuit', 'connection', 'cavity', 'terminal', 'seal', 'tool', 'housing', 'wedge', 'role', 'revision'],
  endpoints: ['code', 'name', 'type', 'family', 'part', 'section', 'design', 'revision'],
  circuits: ['code', 'name', 'section', 'design', 'gauge', 'colour', 'specification', 'pieces', 'revision', 'checks'],
};
/** Operator search: circuit identity wins over incidental substrings in another record. */
export function matchesWorkspaceSearch(row: ScheduleRow, table: WorkspaceTable, search: string, exactCircuitCode: boolean): boolean {
  if (!search) return true;
  if (exactCircuitCode && table !== 'endpoints') return String(row.cells[table === 'ends' ? 'circuit' : 'code'] ?? '').toLocaleLowerCase() === search;
  if (searchableFields[table].some(key => String(row.cells[key] ?? '').toLocaleLowerCase().includes(search))) return true;
  const hex = search.replaceAll('-', '');
  const looksLikeRecordId = /^[0-9a-f-]+$/i.test(search) && hex.length >= 8 && hex.length <= 32;
  return looksLikeRecordId && [row.id, row.cells.circuitId, row.cells.currentCircuitId, row.cells.netId]
    .some(value => String(value ?? '').toLocaleLowerCase().replaceAll('-', '').includes(hex));
}

export function workspaceIndex(data: PhysicalWorkspace) {
  return { circuits: new Map(data.circuits.map(c => [c.id, c])), segments: new Map(data.segments.map(s => [s.id, s])),
    ends: new Map(data.ends.map(e => [e.id, e])), endpoints: new Map(data.endpoints.map(e => [e.id, e])),
    nets: new Map(data.nets.map(n => [n.id, n])), signals: new Map(data.signals.map(s => [s.id, s])), branches: new Map(data.branches.map(b => [b.id, b])),
    topology: new Map(data.topology_nodes.map(t => [t.id, t])) };
}
export type WorkspaceIndex = ReturnType<typeof workspaceIndex>;

export function readPhysicalWorkspace(value: unknown, vehicleId: string): PhysicalWorkspace {
  const v = value as Partial<PhysicalWorkspace> | null;
  if (!v || v.vehicle_id !== vehicleId || v.schema_version !== 1 || typeof v.snapshot_key !== 'string'
    || typeof v.read_at !== 'string' || v.provenance_scope !== 'keyed_evidence_only' || !v.counts || typeof v.counts.current_plan_segments !== 'number'
    || ['circuits', 'segments', 'ends', 'endpoints', 'nets', 'signals', 'routings', 'branches', 'topology_nodes', 'mates', 'evidence_edges'].some(k => !Array.isArray(v[k as keyof PhysicalWorkspace]))) {
    throw new Error('The harness read is unavailable or has an unsupported structure.');
  }
  if (v.segments?.some(s => typeof s.in_current_plan !== 'boolean')) throw new Error('The harness read does not identify current plan membership.');
  return v as PhysicalWorkspace;
}

export function endLabel(id: string | null, ix: WorkspaceIndex): string {
  const end = ix.ends.get(id ?? '');
  if (!end) return 'Unresolved end';
  return [ix.endpoints.get(end.endpoint_id)?.code ?? 'Unresolved connection', engineeringText(end.cavity) ?? 'Cavity not recorded'].join(' · ');
}
const col = (key: string, label: string, width = 24, numeric = false): ScheduleColumn => ({ key, label, width, numeric });
const finite = (v: number | null) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const text = engineeringText;

export function physicalSchedule(data: PhysicalWorkspace, isOwner = false): WiringSchedule {
  const ix = workspaceIndex(data);
  const link = (table: WorkspaceTable, id: string) => `https://nuke.ag/vehicle/${encodeURIComponent(data.vehicle_id)}/wiring?tab=map&records=${table}&record=${encodeURIComponent(id)}`;
  const finish = (table: WorkspaceTable, rows: ScheduleRow[], columns: ScheduleColumn[]): ScheduleTable => ({
    id: table, title: tableLabels[table], rows: rows.map(r => ({ ...r, cells: { ...r.cells, id: r.id, record: link(table, r.id) } })),
    columns: [...columns, col('id', 'Record ID', 38), { key: 'record', label: 'Open record', width: 22, link: true }],
  });
  const segments = data.segments.map(s => {
    const c = ix.circuits.get(s.circuit_id ?? '');
    return { id: s.id, selection: `segments:${s.id}`, cells: {
      code: c?.circuit_code ?? null, piece: shortId(s.id), name: text(c?.circuit_name),
      from: endLabel(s.from_termination_id, ix), to: endLabel(s.to_termination_id, ix),
      gauge: finite(s.gauge_awg), colour: text(s.colour), part: text(s.part_number), expectedPart: text(s.expected_part_number), specification: text(c?.wire_type),
      planned: finite(s.planned_length_ft), basis: text(s.planned_length_method), measured: finite(s.measured_length_ft),
      build: word(s.build_state), design: word(s.design_status), plan: s.in_current_plan ? 'Current plan' : 'Outside current plan', issues: s.blockers.map(word).join('; ') || null,
      checks: word(c?.check_applicability), section: sectionName(c?.harness_section),
      circuitId: s.circuit_id, currentCircuitId: s.current_circuit_id, netId: s.net_id,
      observed: s.observed_at, trust: s.trust,
    } };
  }).sort((a, b) => numericCompare(a.cells.code ?? '', b.cells.code ?? '') || numericCompare(a.cells.from, b.cells.from) || a.id.localeCompare(b.id));
  const ends = data.ends.map(e => ({ id: e.id, selection: `ends:${e.id}`, cells: {
    circuit: ix.circuits.get(e.circuit_id ?? '')?.circuit_code ?? e.wire_code,
    connection: ix.endpoints.get(e.endpoint_id)?.code ?? null, cavity: text(e.cavity),
    terminal: text(e.terminal_contact_pn), seal: text(e.pin_seal_pn), tool: text(e.crimp_tool_pn),
    housing: text(e.connector_housing_pn), wedge: text(e.wedge_lock_pn),
    role: e.physical_end ? 'Physical wire end' : 'Other recorded termination', revision: e.is_superseded ? 'Retained revision' : 'Current',
    observed: e.observed_at, trust: e.trust,
  } })).sort((a, b) => numericCompare(a.cells.connection ?? '', b.cells.connection ?? '') || numericCompare(a.cells.cavity ?? '', b.cells.cavity ?? ''));
  const endpoints = data.endpoints.map(e => ({ id: e.id, selection: `endpoints:${e.id}`, cells: {
    code: e.code, name: text(e.name), type: word(e.endpoint_type), family: text(e.family), part: text(e.part_number),
    section: sectionName(e.harness_section), design: word(e.design_status), revision: e.is_superseded ? 'Retained revision' : 'Current',
    observed: e.observed_at, trust: e.trust,
  } })).sort((a, b) => numericCompare(a.cells.code ?? '', b.cells.code ?? ''));
  const circuits = data.circuits.map(c => ({ id: c.id, selection: `circuits:${c.id}`, cells: {
    code: c.circuit_code, name: text(c.circuit_name), section: sectionName(c.harness_section), design: word(c.design_status),
    gauge: finite(c.wire_gauge_awg), colour: text(c.wire_color), specification: text(c.wire_type),
    pieces: data.segments.filter(s => s.circuit_id === c.id).length,
    revision: c.is_superseded ? 'Retained source revision' : 'Current', checks: word(c.check_applicability),
    observed: c.observed_at, trust: c.trust,
  } })).sort((a, b) => numericCompare(a.cells.code, b.cells.code));
  const provenance = [col('observed', 'Observed at', 28), col('trust', 'Source trust', 16)];
  return { vehicleId: data.vehicle_id, readAt: data.read_at, snapshotKey: data.snapshot_key, isOwner,
    qualificationNote: 'Physical piece records. Planned lengths are not final-cut measurements. Recorded checks do not establish construction approval. Blank means not recorded.',
    tables: [
      finish('segments', segments, [col('code', 'Circuit', 16), col('design', 'Design state', 16), col('plan', 'Plan membership', 24), col('issues', 'Material / revision blockers', 48), col('piece', 'Piece', 12), col('name', 'Function', 38), col('from', 'From connection / cavity', 40), col('to', 'To connection / cavity', 40),
        col('gauge', 'AWG', 8, true), col('colour', 'Colour', 18), col('part', 'Catalog wire part', 30), col('expectedPart', 'Expected material reference', 32), col('specification', 'Source wire specification', 28), col('planned', 'Planned length (ft)', 19, true), col('basis', 'Length basis', 35), col('measured', 'Measured length (ft)', 20, true),
        col('build', 'Build state', 16), col('checks', 'Check applicability', 25), col('section', 'Section', 24), col('circuitId', 'Source circuit ID', 38), col('currentCircuitId', 'Current circuit ID', 38), col('netId', 'Net ID', 38), ...provenance]),
      finish('ends', ends, [col('circuit', 'Circuit', 16), col('connection', 'Connection point', 28), col('cavity', 'Cavity / stud', 45), col('terminal', 'Terminal part', 30), col('seal', 'Seal part', 26), col('tool', 'Crimp tool', 28), col('housing', 'Housing', 28), col('wedge', 'Wedge lock', 28), col('role', 'Record role', 28), col('revision', 'Revision', 22), ...provenance]),
      finish('endpoints', endpoints, [col('code', 'Connection point', 28), col('name', 'Description', 40), col('type', 'Type', 22), col('family', 'Family', 24), col('part', 'Part number', 30), col('section', 'Section', 24), col('design', 'Design state', 16), col('revision', 'Revision', 22), ...provenance]),
      finish('circuits', circuits, [col('code', 'Circuit', 16), col('name', 'Function', 40), col('section', 'Section', 24), col('design', 'Design state', 16), col('gauge', 'AWG', 8, true), col('colour', 'Colour', 18), col('specification', 'Specification', 28), col('pieces', 'Linked physical pieces', 22, true), col('revision', 'Revision', 26), col('checks', 'Check applicability', 26), ...provenance]),
    ] };
}
