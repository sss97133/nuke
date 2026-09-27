// map/useWiringMap.ts — the wiring map's rows for one vehicle: nodes (harness_endpoints), wires
// (vehicle_custom_circuits), wire ends (wire_termination_specs), open calls (wiring_decisions + options + links).
// Typed rows only (migration 20260927030100_wiring_map_typed_rows.sql); live rows only (is_superseded = false).
// Read-only. Public for public vehicles (RLS), like the rest of the wiring page.

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

export type Section =
  | 'engine' | 'power_spine' | 'comms' | 'dash_cabin' | 'body_convenience'
  | 'lighting_front' | 'lighting_rear' | 'powertrain_chassis';

export const SECTIONS: { id: Section; label: string }[] = [
  { id: 'power_spine', label: 'POWER + GROUNDS' },
  { id: 'engine', label: 'ENGINE' },
  { id: 'comms', label: 'COMMS' },
  { id: 'dash_cabin', label: 'DASH / CABIN' },
  { id: 'body_convenience', label: 'BODY' },
  { id: 'lighting_front', label: 'LIGHTING FRONT' },
  { id: 'lighting_rear', label: 'LIGHTING REAR' },
  { id: 'powertrain_chassis', label: 'POWERTRAIN / CHASSIS' },
];

export type WorkStatus = 'open' | 'in_progress' | 'needs_owner' | 'done' | 'blocked';

export interface MapNode {
  id: string;
  code: string;
  name: string;
  type: string;
  family: string | null;
  section: Section | null;
  designStatus: 'concept' | 'decided';
  workStatus: WorkStatus;
  assignee: string | null;
  x: number | null;          // twin coords (m); null = not placed
  y: number | null;
  posSource: string | null;
  partNumber: string | null;
  notes: string | null;
  source: string | null;
  trust: string | null;
}

export interface MapWire {
  id: string;
  code: string;
  name: string;
  section: Section | null;
  designStatus: 'concept' | 'decided';
  derivation: string | null;
  gauge: number | null;
  color: string | null;
  spec: string | null;
  fromId: string | null;
  toId: string | null;
  fromCavity: string | null;
  toCavity: string | null;
  fromText: string | null;
  toText: string | null;
  buildState: string | null;
  checks: Record<string, [string, string]> | null;   // rule checks R8-R14 (check_plug_ends.py --wires), derived each load
}

export interface MapEnd {
  circuitId: string;
  endpointId: string;
  cavity: string | null;
  terminal: string | null;
  seal: string | null;
  tool: string | null;
  source: string | null;
}

export interface MapOption { id: string; key: string; label: string; zone: string | null; source: string | null }
export interface MapLink {
  relation: string; otherDecisionId: string | null; endpointId: string | null;
  endpointCode: string | null; endpointName: string | null;   // named even when the node is retired (a 'blocks' link)
  note: string | null; source: string | null; trust: string | null;
}
export interface MapCall {
  id: string;
  slug: string;
  subject: string;
  kind: string | null;
  status: string | null;
  workStatus: string;
  assignee: string | null;
  decided: boolean;           // a locked decision (status decided): shown under LOCKED, with what it rules out
  trust: string | null;       // T1 = the owner's own lock; T3 = an agent pick under his delegation (replaceable)
  chosen: string | null;
  scope: string | null;
  decidedOn: string | null;
  source: string | null;
  options: MapOption[];
  links: MapLink[];
}

export interface WiringMapData {
  loaded: boolean;
  error: string | null;
  nodes: MapNode[];
  wires: MapWire[];
  ends: MapEnd[];
  calls: MapCall[];
}

const EMPTY: WiringMapData = { loaded: false, error: null, nodes: [], wires: [], ends: [], calls: [] };

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null || v === '' ? null : Number(v));

export function useWiringMap(vehicleId: string | undefined): WiringMapData {
  const [data, setData] = useState<WiringMapData>(EMPTY);
  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    (async () => {
      const fail = (msg: string) => { if (!cancelled) setData({ ...EMPTY, loaded: true, error: msg }); };
      const [designs, overlays, calls] = await Promise.all([
        supabase.from('harness_designs').select('id').eq('vehicle_id', vehicleId),
        supabase.from('vehicle_wiring_overlays').select('id').eq('vehicle_id', vehicleId),
        supabase.from('wiring_decisions')
          .select('id, slug, subject, decision_kind, status, work_status, assignee, chosen, scope, decided_on, source, trust')
          .eq('vehicle_id', vehicleId).eq('is_superseded', false).not('decision_kind', 'is', null),   // calls, not receipts
      ]);
      if (designs.error || overlays.error || calls.error) return fail((designs.error || overlays.error || calls.error)!.message);
      const designIds = (designs.data ?? []).map(d => (d as Row).id as string);
      const overlayIds = (overlays.data ?? []).map(o => (o as Row).id as string);
      const callIds = (calls.data ?? []).map(c => (c as Row).id as string);
      const [nodes, wires, ends, options, links] = await Promise.all([
        designIds.length
          ? supabase.from('harness_endpoints')
              .select('id, code, name, endpoint_type, family, harness_section, design_status, work_status, assignee, pos_x_m, pos_y_m, pos_source, part_number, notes, source, trust')
              .in('design_id', designIds).eq('is_superseded', false).not('code', 'is', null).limit(2000)
          : Promise.resolve({ data: [], error: null }),
        overlayIds.length
          ? supabase.from('vehicle_custom_circuits')
              .select('id, circuit_code, circuit_name, harness_section, design_status, derivation_version, wire_gauge_awg, wire_color, wire_type, from_endpoint_id, to_endpoint_id, from_cavity, to_cavity, from_component, to_component, build_state, checks')
              .in('overlay_id', overlayIds).eq('is_superseded', false).limit(3000)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('wire_termination_specs')
          .select('circuit_id, endpoint_id, cavity, terminal_contact_pn, pin_seal_pn, crimp_tool_pn, source')
          .eq('vehicle_id', vehicleId).eq('is_superseded', false).not('circuit_id', 'is', null).limit(3000),
        callIds.length
          ? supabase.from('wiring_decision_alternatives').select('id, decision_id, key, label, zone, source')
              .in('decision_id', callIds).eq('is_superseded', false)
          : Promise.resolve({ data: [], error: null }),
        callIds.length
          ? supabase.from('wiring_decision_links')
              .select('decision_id, relation, other_decision_id, endpoint_id, note, source, trust, endpoint:harness_endpoints(code, name)')
              .in('decision_id', callIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const err = nodes.error || wires.error || ends.error || options.error || links.error;
      if (err) return fail(err.message);
      if (cancelled) return;
      const opts = (options.data ?? []) as Row[];
      const lks = (links.data ?? []) as Row[];
      setData({
        loaded: true,
        error: null,
        nodes: ((nodes.data ?? []) as Row[]).map(r => ({
          id: r.id as string, code: r.code as string, name: s(r.name) ?? (r.code as string), type: s(r.endpoint_type) ?? 'custom',
          family: s(r.family), section: s(r.harness_section) as Section | null,
          designStatus: (s(r.design_status) ?? 'concept') as MapNode['designStatus'],
          workStatus: (s(r.work_status) ?? 'open') as WorkStatus, assignee: s(r.assignee),
          x: n(r.pos_x_m), y: n(r.pos_y_m), posSource: s(r.pos_source), partNumber: s(r.part_number),
          notes: s(r.notes), source: s(r.source), trust: s(r.trust),
        })),
        wires: ((wires.data ?? []) as Row[]).map(r => ({
          id: r.id as string, code: r.circuit_code as string, name: s(r.circuit_name) ?? '', section: s(r.harness_section) as Section | null,
          designStatus: (s(r.design_status) ?? 'concept') as MapWire['designStatus'], derivation: s(r.derivation_version),
          gauge: n(r.wire_gauge_awg), color: s(r.wire_color), spec: s(r.wire_type),
          fromId: s(r.from_endpoint_id), toId: s(r.to_endpoint_id), fromCavity: s(r.from_cavity), toCavity: s(r.to_cavity),
          fromText: s(r.from_component), toText: s(r.to_component), buildState: s(r.build_state),
          checks: (r.checks as Record<string, [string, string]> | null) ?? null,
        })),
        ends: ((ends.data ?? []) as Row[]).map(r => ({
          circuitId: r.circuit_id as string, endpointId: r.endpoint_id as string, cavity: s(r.cavity),
          terminal: s(r.terminal_contact_pn), seal: s(r.pin_seal_pn), tool: s(r.crimp_tool_pn), source: s(r.source),
        })),
        calls: ((calls.data ?? []) as Row[]).map(r => ({
          id: r.id as string, slug: r.slug as string, subject: s(r.subject) ?? (r.slug as string), kind: s(r.decision_kind),
          status: s(r.status), workStatus: s(r.work_status) ?? 'open', assignee: s(r.assignee),
          decided: r.status === 'decided' || r.work_status === 'decided',
          chosen: s(r.chosen), scope: s(r.scope), decidedOn: s(r.decided_on), source: s(r.source), trust: s(r.trust),
          options: opts.filter(o => o.decision_id === r.id).map(o => ({
            id: o.id as string, key: o.key as string, label: s(o.label) ?? '', zone: s(o.zone), source: s(o.source),
          })),
          links: lks.filter(l => l.decision_id === r.id).map(l => ({
            relation: l.relation as string, otherDecisionId: s(l.other_decision_id), endpointId: s(l.endpoint_id),
            endpointCode: s((l.endpoint as Row | null)?.code), endpointName: s((l.endpoint as Row | null)?.name),
            note: s(l.note), source: s(l.source), trust: s(l.trust),
          })),
        })),
      });
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);
  return data;
}
