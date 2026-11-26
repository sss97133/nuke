-- Submit one private operating-case schema proposal; create no proposed object.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $proposal$
DECLARE
 proposal_id constant uuid := 'f8215459-ec38-4e2e-a855-509257740313';
 agent_key constant text := 'codex-wiring-operating-cases-20261126';
 proposed_payload jsonb := $schema${
 "why": "Operating states and their numerical inputs/results have no existing keyed owner. Parts-configuration scenarios are a different grain. Persisting conditional physics requires immutable context and scoped provenance, while public manuals keep their independent structural currentness.",
 "existing_owners_reused": [
  "vehicles",
  "harness_segments",
  "wire_termination_specs",
  "harness_endpoints",
  "harness_model_evaluations",
  "harness_model_nodes",
  "harness_model_segment_ends",
  "wire_resistance_claims",
  "wire_resistance_conditions",
  "observation_reference_spans",
  "model_fold_signal",
  "model_fold_work",
  "model_fold_tick"
 ],
 "tables": [
  {
   "name": "harness_operating_cases",
   "grain": "One private case identity/control cursor in one vehicle",
   "primary_key": [
    "id"
   ],
   "columns": [
    "id uuid",
    "vehicle_id uuid",
    "case_code text",
    "current_revision_id uuid nullable",
    "private_generation bigint",
    "answered_generation bigint nullable",
    "latest_run_id uuid nullable",
    "attempt_revision_id uuid nullable",
    "attempt_structural_evaluation_id uuid nullable",
    "attempt_scope_key text nullable",
    "attempt_generation bigint nullable",
    "attempt_dependency_key text nullable",
    "attempt_logic_key text nullable",
    "attempt_tick_id uuid nullable",
    "attempted_at timestamptz nullable",
    "failure_count integer",
    "retry_after timestamptz nullable",
    "recorded_by_agent_key text",
    "recorded_at timestamptz",
    "generation_changed_at timestamptz"
   ],
   "foreign_edges": [
    "vehicle_id -> vehicles(id)",
    "current_revision_id + id + vehicle_id -> same case/vehicle revision",
    "latest_run_id + id + vehicle_id -> same case/vehicle scoped run",
    "attempt revision/evaluation -> same case/vehicle; tick token checked against existing model_fold_work lease"
   ],
   "required_constraints": [
    "Unique(vehicle_id,case_code); unique(id,vehicle_id); stable identity/author fields immutable",
    "Generation only advances; role-specific field guards separate source head selection from producer result publication",
    "Nullable/deferred exact FKs admit case/revision/run cycles only inside atomic writer/producer transactions",
    "Attempt context uses the existing lease and global retry policy; this row is not another queue or lease"
   ],
   "clocks": [
    "recorded_at is knowledge clock",
    "generation_changed_at is private input-dirty clock",
    "attempted_at/retry_after are existing-worker attempt clocks"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  },
  {
   "name": "harness_operating_case_revisions",
   "grain": "One immutable complete authored conditional recipe revision",
   "primary_key": [
    "id"
   ],
   "columns": [
    "id uuid",
    "case_id uuid",
    "vehicle_id uuid",
    "revision_number integer",
    "prior_revision_id uuid nullable",
    "reference_termination_id uuid nullable",
    "recipe_hash text",
    "scope_key text",
    "requested_state text",
    "parameter_basis text",
    "expected_wire_count integer",
    "expected_element_count integer",
    "expected_boundary_count integer",
    "recorded_by_agent_key text",
    "method_version text",
    "authored_at timestamptz",
    "recorded_at timestamptz",
    "sealed_at timestamptz nullable"
   ],
   "foreign_edges": [
    "case_id + vehicle_id -> harness_operating_cases(id,vehicle_id)",
    "prior_revision_id + case_id + vehicle_id -> same case/vehicle predecessor",
    "reference_termination_id -> wire_termination_specs(id); indexed same-vehicle and scope guard"
   ],
   "required_constraints": [
    "Unique(case_id,revision_number); unique(id,case_id,vehicle_id); append-only, sealed with exact child counts",
    "parameter_basis=conditional_assumption; requested_state is enabled/disabled/draft, never engineering approval",
    "Scope key hashes exact membership/device pairs/reference/boundaries; no generated DC run ID or evaluation renderer receipt",
    "No silent inheritance, sparse hidden defaults or retarget to successor physical pieces",
    "Missing reference/scope can be saved as unresolved draft; an enabled empty or incomplete scope holds instead of inventing ground",
    "Sealing required at commit; children writable only during the atomic sanctioned author transaction; current pointer only targets sealed revision"
   ],
   "clocks": [
    "authored_at is attributed recipe-authoring time",
    "recorded_at is knowledge clock"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  },
  {
   "name": "harness_operating_case_wires",
   "grain": "One exact selected physical piece input per immutable recipe",
   "primary_key": [
    "revision_id",
    "segment_id"
   ],
   "columns": [
    "revision_id uuid",
    "case_id uuid",
    "vehicle_id uuid",
    "segment_id uuid",
    "wire_state text",
    "resistance_basis text",
    "direct_resistance_ohm numeric nullable",
    "resistance_claim_observation_id uuid nullable",
    "length_basis text",
    "design_length_m numeric nullable",
    "applicability_basis text",
    "recorded_at timestamptz"
   ],
   "foreign_edges": [
    "revision_id + case_id + vehicle_id -> same immutable revision",
    "segment_id -> harness_segments(id); same-vehicle membership checked against its source owner",
    "resistance_claim_observation_id -> wire_resistance_claims(observation_id)"
   ],
   "required_constraints": [
    "wire_state open/closed/unknown; direct assumption OR exact reference-derived basis, never competing inputs",
    "Length basis explicitly planned_gross/measured/design_override/unresolved; no fallback, second allowance or doubled return",
    "Direct R is ohms; authored override is metres; reference reader stays canonical ohm_per_m",
    "Reference choice is not manufacturer/installed applicability; missing/stale/ambiguous basis holds",
    "Open wire need not invent unused R; retained R must still validate; unknown closed-path parameters remain unresolved"
   ],
   "clocks": [
    "recorded_at is recipe-child knowledge clock"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  },
  {
   "name": "harness_operating_case_elements",
   "grain": "One explicit modeled device/test element between exact terminal ports",
   "primary_key": [
    "revision_id",
    "element_id"
   ],
   "columns": [
    "revision_id uuid",
    "element_id uuid",
    "case_id uuid",
    "vehicle_id uuid",
    "element_code text",
    "source_endpoint_id uuid nullable",
    "from_termination_id uuid",
    "to_termination_id uuid",
    "law_kind text",
    "contact_state text nullable",
    "resistance_ohm numeric nullable",
    "voltage_v numeric nullable",
    "current_a numeric nullable",
    "parameter_basis text",
    "recorded_at timestamptz"
   ],
   "foreign_edges": [
    "revision_id + case_id + vehicle_id -> same immutable revision",
    "source_endpoint_id -> harness_endpoints(id) when a source device is identified",
    "from_termination_id/to_termination_id -> wire_termination_specs(id); same-vehicle and selected-scope checks"
   ],
   "required_constraints": [
    "Supported explicit law: resistor/switch/voltage_source/current_source; unmodeled law holds",
    "Only law-appropriate parameter slots; voltage/current may be signed, resistance positive when supplied",
    "SI V/A/ohm; parameter_basis conditional_assumption; nullable unknowns are not zero",
    "Virtual analytical element is not a physical stock/part instance; no inferred contact, ground or whole-endpoint boolean"
   ],
   "clocks": [
    "recorded_at is recipe-child knowledge clock"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  },
  {
   "name": "harness_operating_case_boundaries",
   "grain": "One explicit no-additional-device boundary declaration",
   "primary_key": [
    "revision_id",
    "termination_id"
   ],
   "columns": [
    "revision_id uuid",
    "case_id uuid",
    "vehicle_id uuid",
    "termination_id uuid",
    "boundary_kind text",
    "recorded_at timestamptz"
   ],
   "foreign_edges": [
    "revision_id + case_id + vehicle_id -> same immutable revision",
    "termination_id -> wire_termination_specs(id); must be an actual selected piece attachment in this scope"
   ],
   "required_constraints": [
    "boundary_kind=assumed_open; no duplicate, foreign or conflicting device/boundary declaration",
    "Boundary adds no extra modeled device; it does not sever an existing wire or structural node",
    "Every attached scope terminal has explicit behavior/boundary coverage; no whole-network completeness claim"
   ],
   "clocks": [
    "recorded_at is recipe-child knowledge clock"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  },
  {
   "name": "harness_model_dc_runs",
   "grain": "One immutable closed private scoped solve over an existing structural dependency",
   "primary_key": [
    "id"
   ],
   "columns": [
    "id uuid",
    "vehicle_id uuid",
    "case_id uuid",
    "revision_id uuid",
    "scope_key text",
    "structural_evaluation_id uuid",
    "private_generation bigint",
    "private_input_hash text",
    "private_logic_key text",
    "input_receipt jsonb",
    "logic_receipt jsonb",
    "status text",
    "qualification text",
    "expected_wire_input_count integer",
    "expected_node_count integer",
    "expected_branch_count integer",
    "expected_issue_count integer",
    "sealed_at timestamptz nullable",
    "max_kcl_residual_a numeric nullable",
    "power_residual_w numeric nullable",
    "max_source_residual_v numeric nullable",
    "dependency_checked_at timestamptz",
    "evaluated_at timestamptz"
   ],
   "foreign_edges": [
    "structural_evaluation_id + vehicle_id -> harness_model_evaluations(id,vehicle_id)",
    "revision_id + case_id + vehicle_id -> same immutable recipe"
   ],
   "required_constraints": [
    "Reuse key: structural_evaluation_id,revision_id,scope_key,private_input_hash,private_logic_key",
    "Supporting UNIQUE(id,case_id,vehicle_id), UNIQUE(id,revision_id), UNIQUE(id,structural_evaluation_id), UNIQUE(id,revision_id,structural_evaluation_id) for exact composite child FKs",
    "Sealing required at commit; child admission only in sanctioned producer transaction before seal; no committed open/partial run",
    "Closed atomically with exact typed-child counts; no late append/update/delete; generated run ID/clocks excluded from hash",
    "Numerical status separate from currentness/applicability; qualification=conditional_simulation_only",
    "Normal HOLD/indeterminate/inconsistent/numerical_failure closes with zero numerical children and does not withdraw manual",
    "First module requires existing supported current structural receipt; no private-vehicle graph bypass or UI-sheet truncation"
   ],
   "clocks": [
    "dependency_checked_at is eligibility-check clock",
    "evaluated_at is calculation knowledge clock"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  },
  {
   "name": "harness_model_dc_wire_inputs",
   "grain": "One compiled wire dependency receipt per run and physical piece",
   "primary_key": [
    "run_id",
    "segment_id"
   ],
   "columns": [
    "run_id uuid",
    "revision_id uuid",
    "segment_id uuid",
    "length_basis text",
    "selected_length_ft numeric nullable",
    "selected_length_m numeric nullable",
    "length_source_field text nullable",
    "design_length_m numeric nullable",
    "resistance_claim_observation_id uuid nullable",
    "condition_key text nullable",
    "reference_fingerprint text nullable",
    "reference_ohm_per_m numeric nullable",
    "derived_resistance_ohm numeric nullable",
    "parameter_basis text",
    "applicability_state text",
    "input_state text",
    "recorded_at timestamptz"
   ],
   "foreign_edges": [
    "run_id + revision_id -> same scoped run",
    "revision_id + segment_id -> exact recipe wire membership",
    "resistance_claim_observation_id -> wire_resistance_claims(observation_id)",
    "condition_key -> wire_resistance_conditions(condition_key); must match selected claim"
   ],
   "required_constraints": [
    "Derived private receipt only; source numbers remain canonical observations, never recopied into authored recipe",
    "Preserve variant/gauge/temperature/value-role/document/page/observation/normalization/qualification fingerprints",
    "Explicit length basis and one declared conversion; source applicability/currentness rechecked even if number unchanged",
    "No fabricated length, resistance, measurement witness or thermal rating"
   ],
   "clocks": [
    "recorded_at is private run-admission clock"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  },
  {
   "name": "harness_model_dc_node_results",
   "grain": "One voltage at one structural node in one private scoped run",
   "primary_key": [
    "run_id",
    "node_id"
   ],
   "columns": [
    "run_id uuid",
    "structural_evaluation_id uuid",
    "node_id uuid",
    "voltage_v numeric"
   ],
   "foreign_edges": [
    "run_id + structural_evaluation_id -> same scoped run",
    "structural_evaluation_id + node_id -> harness_model_nodes(evaluation_id,id)"
   ],
   "required_constraints": [
    "Same run/evaluation/scope only; finite numerical voltage from solved run only",
    "Node belongs to the exact compiled selected scope/reference; another node from the same structural evaluation is not sufficient",
    "Node shared by two scopes may have different conditional values; never collapse by node alone"
   ],
   "clocks": [
    "Clock inherited from immutable run"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  },
  {
   "name": "harness_model_dc_branch_results",
   "grain": "One exact wire XOR explicit model-element result in one scoped run",
   "primary_key": [
    "run_id",
    "branch_id"
   ],
   "columns": [
    "run_id uuid",
    "revision_id uuid",
    "structural_evaluation_id uuid",
    "branch_id text",
    "segment_id uuid nullable",
    "element_id uuid nullable",
    "from_node_id uuid",
    "to_node_id uuid",
    "state text",
    "current_a numeric",
    "voltage_drop_v numeric",
    "absorbed_power_w numeric"
   ],
   "foreign_edges": [
    "run_id + revision_id + structural_evaluation_id -> same scoped run",
    "revision_id + segment_id -> exact recipe wire, XOR revision_id + element_id -> exact recipe element",
    "structural_evaluation_id + from_node_id/to_node_id -> same structural evaluation nodes",
    "run_id + from_node_id/to_node_id -> harness_model_dc_node_results(run_id,node_id)"
   ],
   "required_constraints": [
    "Exactly one typed source subject; branch ID must match that typed subject and scope",
    "Exact attachment-match guard: a wire follows its evaluated segment side pair; an element follows its declared terminal pair through scoped attachments; same-evaluation nodes are not sufficient",
    "Finite SI values from solved run only; signed from-to current/drop and absorbed power positive",
    "Distinct physical ends survive shared nodes; no new physical segment or stock contribution"
   ],
   "clocks": [
    "Clock inherited from immutable run"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  },
  {
   "name": "harness_model_dc_issues",
   "grain": "One typed unresolved/failure reason in one private run",
   "primary_key": [
    "run_id",
    "ordinal"
   ],
   "columns": [
    "run_id uuid",
    "revision_id uuid",
    "structural_evaluation_id uuid",
    "ordinal integer",
    "code text",
    "node_id uuid nullable",
    "segment_id uuid nullable",
    "termination_id uuid nullable",
    "element_id uuid nullable",
    "parameter_key text nullable"
   ],
   "foreign_edges": [
    "run_id + revision_id + structural_evaluation_id -> same scoped run",
    "structural_evaluation_id + node_id -> harness_model_nodes(evaluation_id,id) when a node subject is present",
    "typed segment/element -> corresponding recipe membership",
    "termination_id -> wire_termination_specs(id); same-vehicle/scope guard"
   ],
   "required_constraints": [
    "Closed issue code/subject vocabulary from compiler/solver logic version; no private free-form error text in shared telemetry",
    "Expand solver node_ids arrays into deterministic one-row-per-node issue subjects; retain exact run/evaluation/scope bindings",
    "At most one typed segment/termination/element/node subject per issue; global run issues may have no subject",
    "Node issue scope checked against compiled source attachments/reference, not numerical node results: HOLD has no numerical children",
    "No fabricated engineering PASS; a missing parameter remains a typed actionable input gap"
   ],
   "clocks": [
    "Clock inherited from immutable run"
   ],
   "access": "Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants"
  }
 ],
 "writer_contract": {
  "authoring": "Proposed narrow service-only atomic revision writer; attributed agent-authored assumptions, not owner Sign or installed/manufacturer testimony",
  "producer": "Existing model_fold_tick phase under existing controls/lease/budget; separate closed private run, not harness_model_fold or public shared inputs",
  "direct_dml": "Denied outside sanctioned writer/producer; field-specific cursor guards; immutable sealed source/result children"
 },
 "worker_contract": {
  "signal": "Private generation plus opaque event in existing model_fold_signal; never harness_model_signal/public source_epoch or facet-invalidating shortcut",
  "normal": "Structural due first, otherwise at most one private case, otherwise generic work",
  "followup": "Existing vehicle_followup; generic completion also tests private due so another case/new edit is not lost",
  "attempts": "Persist selected case/generation/dependency/logic/tick context before compute; existing lease recovery/backoff handles abandoned attempts; no new queue or lease",
  "normal_hold": "Completed private interpretation; unchanged HOLD does not retry every tick",
  "telemetry": "Typed private-DC phase/status; opaque shared SQLSTATE/domain only; existing gauges/revert must retain immutable DC receipts"
 },
 "reader_contract": {
  "service": "Bounded exact case/revision/scope/run inspector; current structural/source/private logic/dependency/generation and child-count gate",
  "public": "Unchanged; no private fields, parameters, case IDs, hashes or counts added to public input/logic/manual readers"
 },
 "implementation_gates": [
  "Curator review and explicit manual table application; this submission creates no proposed objects",
  "Fresh source/key/constraint/grant inventory immediately before actual DDL",
  "Same-vehicle/revision/scope FK and source-guard negatives",
  "Explicit planned/measured/override length and reference applicability; canonical source qualification/withdrawal including unchanged numerical values",
  "Public source/logic/epoch/manual invariance on private-only edits and logic changes",
  "One existing qualified structural dependency; no unsupported private-vehicle producer bypass",
  "Atomic closure, complete children, stale dependency withdrawal and compare-and-swap publication",
  "Two cases, concurrent edit/lost wakeup, timeout after shared lease and bounded recovery/backoff",
  "Generic followup fairness and truthful retained-private-run revert/gauge semantics",
  "Actual scheduled source-to-private-result replay before runtime/consumer acceptance"
 ],
 "supersedes_plan": "Earlier uninstalled design suggested private inputs in the public structural fold. This proposal replaces that direction with an independently closed private scoped child dependency.",
 "does_not_establish": [
  "Operating case implementation",
  "Qualified vehicle electrical parameters",
  "Whole-harness/nonlinear/thermal/protection/installation behavior",
  "Public schematic integration",
  "Build/cut/stock/supplier/order release"
 ]
}$schema$::jsonb;
 proposed_evidence jsonb := $schema$[
 {
  "kind": "repository_contract",
  "path": "docs/ledger/theory/data-machine-cases.md",
  "section": "13.12",
  "supports": "Typed grain, keys, replay, input-bound SQL checks and downstream generated readers"
 },
 {
  "kind": "existing_owner",
  "path": "supabase/migrations/20261125233922_harness_model_evaluation_loop.sql",
  "supports": "Immutable structural evaluation/node/end/currentness owner"
 },
 {
  "kind": "existing_owner",
  "path": "supabase/migrations/20261126071000_harness_worker_phase.sql",
  "supports": "Existing bounded signal/work/tick phase and generic followup; no separate scheduler"
 },
 {
  "kind": "existing_owner",
  "path": "supabase/migrations/20261126094848_conditioned_wire_reference_intake.sql",
  "supports": "Service-only attributed resistance claim/condition/page-span qualification; applicability unassessed"
 },
 {
  "kind": "deployed_code",
  "path": "supabase/migrations/20261126181729_harness_model_dc_compute.sql",
  "merge_commit": "d0606d170bc7ca580641fefb1d3efa592ecb338f",
  "supports": "Bounded conditional DC computation and exact graph-key binding; no persisted recipes/results"
 },
 {
  "kind": "live_owner_inventory",
  "observed_on": "2026-11-26",
  "supports": "Atlas/registry identify build configuration scenarios and existing harness/worker/source owners; no operating/simulation case owner found"
 }
]$schema$::jsonb;
 proposed_scope jsonb := $schema${
 "eligible_vehicle_population": "not_measured",
 "migration_effect": "one metadata proposal only; no proposed tables, operating cases, source claims or result rows created",
 "first_scope": "private service-only conditional cases over an existing supported current structural receipt"
}$schema$::jsonb;
 proposed_compatibility jsonb := $schema${
 "existing_data_behavior": "preserved_unchanged",
 "rollback_plan": "Submission is inert. Withdraw or supersede through existing review workflow; do not delete proposal history. Actual implementation needs its own reviewed rollback that retains source/revision/run testimony.",
 "read_api_impact": "none from submission; first implementation must preserve public structural shape/hash/epoch/currentness and grants"
}$schema$::jsonb;
BEGIN
 INSERT INTO public.schema_proposals(id,proposed_by_agent_key,proposal_type,payload,evidence,
  estimated_scope,backward_compatibility,status)
 VALUES(proposal_id,agent_key,'add_table',proposed_payload,proposed_evidence,
  proposed_scope,proposed_compatibility,'open')
 ON CONFLICT(id) DO NOTHING;
 -- Replay must not overwrite a curator decision or a foreign/changed definition.
 IF NOT EXISTS(SELECT FROM public.schema_proposals p
  WHERE p.id=proposal_id AND p.proposed_by_agent_key=agent_key AND p.proposed_by_user_id IS NULL
   AND p.proposal_type='add_table' AND p.payload=proposed_payload
   AND p.evidence=proposed_evidence AND p.estimated_scope=proposed_scope
   AND p.backward_compatibility=proposed_compatibility) THEN
  RAISE EXCEPTION 'Operating-case proposal identity/definition mismatch' USING ERRCODE='23514';
 END IF;
END;
$proposal$;
COMMIT;
