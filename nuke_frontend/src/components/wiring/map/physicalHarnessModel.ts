// Physical edges come from segment keys, never from sorting a circuit's ends.
import { cavOf } from './useWorkspaceSelection';
export interface PhysicalCircuit {
  id: string; code: string; name: string; section: string | null; design_status: string;
}
export interface PhysicalEndpoint { id: string; code: string; name: string; node_kind: string | null }
export interface PhysicalTermination { id: string; circuit_id: string; endpoint_id: string; cavity: string | null; cavity_layout_id: string | null }
export interface PhysicalSegment {
  id: string; net_id: string; circuit_id: string; design_status: string | null;
  from_termination_id: string | null; to_termination_id: string | null;
  gauge_awg: number | null; circuit_gauge_awg: number | null; colour: string | null;
  keyed_part_number: string | null; planned_length_ft: number | null; measured_length_ft: number | null;
  link_state: 'linked' | 'incomplete' | 'stale'; specification_state: 'agrees' | 'incomplete' | 'conflict';
  legacy_check_state: 'unversioned' | 'not_checked';
}
export interface PhysicalMating { from_endpoint_id: string; to_endpoint_id: string }
export interface PhysicalHarnessModel {
  contract_version: 1; vehicle_id: string; snapshot_hash: string;
  snapshot_kind: 'current_read_not_published_revision';
  circuits: PhysicalCircuit[]; endpoints: PhysicalEndpoint[]; terminations: PhysicalTermination[];
  segments: PhysicalSegment[]; connector_matings: PhysicalMating[];
  nets: { id: string }[];
}

/** Reject an incompatible or misrouted response instead of falling back to an invented legacy chain. */
export function readPhysicalHarnessModel(value: unknown, vehicleId: string): PhysicalHarnessModel {
  const g = value as PhysicalHarnessModel | null;
  if (!g || g.contract_version !== 1 || g.vehicle_id !== vehicleId || typeof g.snapshot_hash !== 'string'
    || g.snapshot_kind !== 'current_read_not_published_revision'
    || !['circuits', 'endpoints', 'terminations', 'segments', 'connector_matings', 'nets']
      .every(k => Array.isArray((g as unknown as Record<string, unknown>)[k]))) {
    throw new Error('The physical wiring model could not be read.');
  }
  return g;
}

export interface SchematicEnd {
  id: string; nodeKey: string; isBus: boolean; endpointId: string; code: string; cavity: string | null; rawCavity: string | null;
}
export interface SchematicPiece {
  id: string; code: string; circuit: PhysicalCircuit; segment: PhysicalSegment;
  from: SchematicEnd | null; to: SchematicEnd | null;
}
export function physicalSchematicPieces(model: PhysicalHarnessModel, section: string, includeConcepts: boolean) {
  const circuits = new Map(model.circuits.filter(c => c.section === section
    && (includeConcepts || c.design_status === 'decided')).map(c => [c.id, c]));
  const ends = new Map(model.terminations.map(t => [t.id, t]));
  const endpoints = new Map(model.endpoints.map(e => [e.id, e]));
  const nets = new Set(model.nets.map(n => n.id));
  const end = (id: string | null, segment: PhysicalSegment): SchematicEnd | null => {
    const t = id ? ends.get(id) : null;
    const e = t ? endpoints.get(t.endpoint_id) : null;
    if (!t || !e || t.circuit_id !== segment.circuit_id) return null;
    // Reuse the stored net fold, with its case-sensitive raw cavity labels and bus grain.
    // A display-normalized label alone never proves an electrical junction.
    const pin = t.cavity_layout_id ?? (t.cavity && !/^(stud|lug|[-+]?\s*post)/i.test(t.cavity) ? t.cavity : null);
    const shared = segment.link_state !== 'stale' && nets.has(segment.net_id)
      && (e.node_kind === 'bus' || (e.node_kind === 'terminals' && pin != null));
    return { id: t.id, isBus: shared && e.node_kind === 'bus', endpointId: e.id, code: e.code, cavity: cavOf(t.cavity), rawCavity: t.cavity,
      nodeKey: shared ? JSON.stringify([e.id, segment.net_id, e.node_kind === 'bus' ? 'bus' : pin]) : t.id };
  };
  const pieces: SchematicPiece[] = [];
  for (const segment of model.segments) {
    const circuit = circuits.get(segment.circuit_id);
    if (circuit && (includeConcepts || segment.design_status === 'decided')) pieces.push({ id: segment.id, code: circuit.code, circuit, segment,
      from: end(segment.from_termination_id, segment), to: end(segment.to_termination_id, segment) });
  }
  return pieces;
}

export function physicalPieceLabel(p: SchematicPiece): string {
  const s = p.segment;
  const gauge = s.gauge_awg == null ? 'Gauge unknown' : `${s.gauge_awg} AWG`;
  const length = s.measured_length_ft != null ? `${s.measured_length_ft} ft measured`
    : s.planned_length_ft != null ? `${s.planned_length_ft} ft planned` : 'Length unknown';
  const state = s.specification_state === 'conflict'
    ? `Specification conflict: segment ${s.gauge_awg ?? '?'} AWG; circuit ${s.circuit_gauge_awg ?? '?'} AWG; part ${s.keyed_part_number ?? 'unknown'}`
    : s.specification_state === 'incomplete' ? 'Specification incomplete' : 'Stored specifications agree';
  const connection = s.link_state === 'linked' ? '' : s.link_state === 'stale'
    ? ' · Connection references need repair' : ' · Connection incomplete';
  const qualification = s.design_status === 'decided' ? '' : s.design_status === 'contradicted'
    ? ' · Rejected segment' : s.design_status === 'candidate' ? ' · Candidate segment' : ' · Segment qualification unknown';
  const end = (e: SchematicEnd | null) => e ? `${e.code} ${e.rawCavity ?? '(cavity unknown)'}` : 'Unspecified end';
  return `${p.code} · ${end(p.from)} ↔ ${end(p.to)} · ${gauge} · ${s.colour ?? 'Colour unknown'} · ${length} · ${state}${connection}${qualification}`;
}
