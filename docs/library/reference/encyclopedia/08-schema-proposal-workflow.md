# Chapter 8: The Schema Proposal Workflow

How an external agent expands Nuke's vocabulary without breaking it.

---

## Why this chapter exists

Nuke is rails, not destination (AX-043). External agents — Claude, ChatGPT, scrapers, MCP clients — read the handbook, get a key, deposit data on the right shelf with citation. Nuke does no processing. It accepts well-formed deposits, rejects malformed ones, tracks who put what where.

That model has one obvious failure case: the shelf doesn't exist yet.

An agent reading a 1976 build sheet sees a field for `front_axle_ratio`. The vehicle schema has `rear_axle_ratio`. The agent has structured testimony to deposit and no property to deposit it against. The institution has to answer: do we reject the claim, do we widen the schema, who decides, and on what evidence?

Mature peer systems converged on a small answer to this. Wikidata files property proposals as wiki sub-pages with structured templates ([Wikidata:Property proposal](https://www.wikidata.org/wiki/Wikidata:Property_proposal)). Schema.org runs a two-tier vocabulary — `pending` terms are usable today, `core` terms are ratified ([schema.org/docs/pending.home.html](https://schema.org/docs/pending.home.html)). OpenStreetMap formalizes a Draft → Proposed → Voting → Approved process ([OSM Proposal process](https://wiki.openstreetmap.org/wiki/Proposal_process)) while still permitting "any tags you like" for verifiable features. MusicBrainz runs wiki-based RFCs with a Style Council ratifying passed proposals.

Nuke borrows the shape. The form is the thing (AX-044). A schema proposal is itself a form an agent fills, deposits, and waits on. The proposal is testimony about the ontology. Approval is an editorial act recorded with provenance, not a code change.

This chapter is the handbook entry an external agent reads when it encounters data that doesn't fit existing shelves. Read it before you POST.

---

## 0. Grounding — what exists today vs what this chapter proposes

This chapter describes a workflow. The tables the workflow runs on are partly real and partly proposed. Read this section first so you know which is which.

| Table or enum                         | Status                                | Notes |
|---------------------------------------|---------------------------------------|-------|
| `public.vehicle_observations`         | **Exists** (7.51M rows)               | The canonical claim table. Has `kind`, `rank`, `confidence`, `source_id`, `submitted_by_user_id`, `is_superseded`, `superseded_by`. Already implements Wikidata-style rank semantics. |
| `public.observation_sources`          | **Exists** (164 rows)                 | The source registry. Has `category` (`source_category` enum, 15 values), `base_trust_score`, `trust_factors`, `tier`. |
| enum `public.observation_kind`        | **Exists** (14 values)                | `listing, sale_result, comment, bid, sighting, work_record, ownership, specification, provenance, valuation, condition, media, social_mention, expert_opinion` |
| enum `public.source_category`         | **Exists** (15 values)                | `auction, marketplace, forum, social_media, registry, shop, documentation, owner, aggregator, media, event, internal, dealer, museum, agent` |
| enum `public.vfc_rank`                | **Exists** (3 values)                 | `preferred, normal, deprecated` — the Wikidata rank model |
| enum `public.confidence_level`        | **Exists** (5 values)                 | `verified, high, medium, low, inferred` |
| `public.observation_properties`       | **APPLIED** (38 rows as of 2026-06-17) | The fine-grained property registry — what `kind='specification'` is specifying. The name `properties` is already taken on this database for real-estate listings; the registry is `observation_properties`. |
| `public.schema_proposals`             | **APPLIED** (20 rows as of 2026-06-17) | The intake desk this chapter is about. |
| `public.schema_proposal_reviews`      | **APPLIED** (14 rows as of 2026-06-17) | One row per reviewer decision; quorum is per-proposal-type. |
| `public.pending_claims`               | **APPLIED** (0 rows; table exists)    | Where rejected claims park while their proposal is open. |
| column `vehicle_observations.property_id` | **APPLIED** (uuid column, nullable FK) | Existing rows stay NULL; new writes populate. |
| view `public.vehicle_canonical`       | **APPLIED** (view exists)             | Projection of (vehicle_id, property_id) → current value (AX-012). |
| trigger `trg_citation_required_vehicle_observations` | **APPLIED** (2 trigger rows in information_schema) | Rejects writes without `source_id` AND without `submitted_by_user_id`. |

Migration: `database/migrations/PROPOSED_institution_minimum_substrate.sql`. Status: **applied** (all tables, columns, views, and triggers verified live 2026-06-17).

The earlier draft of this chapter named a generic `claims`, `properties`, `sources` trio that doesn't match the deployed substrate. The names below are the verified ones. The shape it describes — file → park → review → migrate — is unchanged; only the table identifiers were drift.

---

## 1. When you must file a schema proposal

You file a proposal whenever the write API rejects your deposit for a vocabulary reason — not because your data was malformed, but because the institution has no slot for it. The four trigger cases:

1. **Unknown property.** You attempted to deposit a claim whose `property_id` does not exist in either the `core` or `pending` namespace. The write API responds `400 unknown_property` with the proposal-needed link in the body.
2. **Unknown source type.** You attempted to register a new source (a forum, registry, magazine, registry-style PDF dump) whose `category` is not in `observation_sources.category`. Source-type expansion is rarer than property expansion but follows the same workflow.
3. **Unknown category.** You attempted to deposit a property whose `category` (e.g. `wheels_and_tires`, `engine_internals`, `electrical_aux`) is not in the categories registry. Categories are how the form-shape groups fields in the UI; new categories need editorial approval.
4. **Fork.** You believe an existing property is conflating two distinct things — typical example: `engine_displacement` carries the factory spec on one vehicle and the current swap-installed value on another. The cure is splitting the property into two children; the rule is you file a proposal, not a unilateral migration.
5. **Trust re-tiering.** You believe a source's `base_trust` is mis-calibrated against its observed track record. Trust scoring affects ranking semantics across the entire substrate, so any change to a source's tier is a proposal, never a direct UPDATE.

If your situation is **none of these** — the property exists, your data fits, your source is registered — you don't file a proposal. You deposit. The proposal workflow is reserved for vocabulary expansion. Everything else is normal ingestion.

What you must **not** do: free-text the missing structure into an existing `notes` field, fake a `source_id` to get past the rejection, or pick the closest existing property and stuff your value in. See [§9 Anti-patterns](#9-anti-patterns).

---

## 2. What a proposal contains (the form fields)

The proposal is a POST to `schema_proposals`. The envelope is closed; additional properties are rejected. The schema lives at `docs/api/schemas/v1/schema_proposal.json`.

```json
{
  "schema_version": "1.0",
  "proposal_type": "add_property" | "fork_property" | "add_source" | "add_category" | "modify_trust_tier" | "deprecate_property",
  "payload": { /* per-proposal_type shape */ },
  "evidence": {
    "rejected_claim_attempts": ["uuid-of-rejected-claim-1", "..."],
    "external_references": [
      { "kind": "manufacturer_spec", "url": "...", "page": 12, "excerpt": "..." },
      { "kind": "photo", "image_id": "uuid", "caption": "..." }
    ],
    "motivation": "Why the existing vocabulary is insufficient. 1-3 paragraphs."
  },
  "estimated_scope": {
    "affected_vehicles_count": 1234,
    "affected_claims_count": 4567,
    "query_used": "SELECT count(*) FROM ... WHERE ..."
  },
  "backward_compatibility": {
    "existing_data_behavior": "preserved_unchanged" | "auto_migrated" | "requires_manual_reattribution",
    "rollback_plan": "What happens if this is reverted within 7 days.",
    "read_api_impact": "What clients reading the old shape will see after promotion."
  },
  "agent": { "id": "claude-anthropic", "version": "...", "session_id": "..." }
}
```

### `payload` shapes per `proposal_type`

**`add_property`** — the common case:
```json
{
  "property_key": "front_axle_ratio",
  "label": "Front Axle Ratio",
  "data_type": "numeric",
  "unit": "ratio",
  "namespace_request": "pending",
  "category": "drivetrain",
  "cardinality": "single",
  "discriminator_key": null,
  "applies_to_kinds": ["specification"],
  "expected_source_categories": ["documentation", "registry", "owner"],
  "description": "Final-drive ratio at the front axle, as installed. One value per vehicle (cardinality 'single'). Distinct from rear_axle_ratio.",
  "suggested_values": ["3.07", "3.42", "3.73", "4.10"]
}
```

Field definitions:

- **`property_key`** — snake_case identifier, unique across the registry. Convention: `<entity>_<attribute>` (e.g. `engine_displacement_l`, `wire_color_code`).
- **`label`** — human-readable form for UIs.
- **`data_type`** ∈ {`string, integer, numeric, boolean, date, timestamp, enum, uuid_ref, jsonb, text_long`} — the `observation_properties.data_type` CHECK list.
- **`unit`** — physical or canonical unit (`'liters'`, `'inches'`, `'usd'`, etc.) or `null` for unitless.
- **`namespace_request`** — `'pending'` (default for new proposals) or `'core'` (only if reviewer flags as core-ready at approval time).
- **`category`** — UI grouping bucket (`identity`, `engine`, `wiring`, `ownership`, etc.). Free-text on the property row; categories are not themselves enumerated.
- **`cardinality`** ∈ {`single, multi`} — REQUIRED. `single` = one canonical value per vehicle (e.g. `vin`). `multi` = multiple simultaneously-distinct or time-ordered claims per vehicle (e.g. `wire_circuit_id`, `mileage_miles`).
- **`discriminator_key`** — for `cardinality='multi'` properties where each claim is simultaneously-distinct (not a time-ordered history), the top-level key in `vehicle_observations.structured_data` that identifies each claim. Example: `'wire_id'` for wire_* properties, `'loom'` for loom-level properties. Set to `null` for `single` or for time-ordered multi (mileage, sale_price — those collapse to the most recent in `vehicle_canonical`). Documented in detail in `database/migrations/20260517_fix_vehicle_canonical_multi_cardinality.sql`.
- **`applies_to_kinds`** — array of `observation_kind` enum values the property can attach to (e.g. `["specification"]`, `["sale_result", "listing"]`).
- **`expected_source_categories`** — array of `source_category` enum values typically authoritative for the property. Used for source-trust ranking and proposal validation.
- **`description`** — 1–3 sentences explaining what the property captures, including any non-obvious semantics or distinctions from sibling properties.
- **`suggested_values`** — optional array of expected enumerated values (for `data_type='enum'`) or representative examples (any data_type).

The trigger `fn_schema_proposal_apply()` (in `database/migrations/20260522_schema_proposal_approval_trigger.sql`) reads these fields verbatim and inserts the matching row into `observation_properties` when the proposal is approved.

**`fork_property`** — splitting a conflated property:
```json
{
  "parent_property_id": "engine_displacement",
  "children": [
    { "label": "engine_displacement_factory",  "definition": "..." },
    { "label": "engine_displacement_current",  "definition": "..." }
  ],
  "migration_mapping": "rule for re-attributing existing claims (or 'manual' if too noisy to automate)"
}
```

**`modify_trust_tier`**:
```json
{
  "source_id": "uuid-or-slug",
  "current_base_trust": 0.75,
  "proposed_base_trust": 0.85,
  "evidence_window_days": 180,
  "observed_accuracy_rate": 0.94
}
```

**`deprecate_property`**:
```json
{
  "property_id": "...",
  "reason": "...",
  "replacement_property_id": "..." | null
}
```

A proposal whose required fields are missing or whose `evidence.motivation` is empty is rejected at submission time with `400 incomplete_proposal`. Empty evidence isn't a proposal — it's a vibe.

---

## 3. Who can propose

Anyone with an authenticated agent_key can `INSERT` to `schema_proposals`. Trust score does not gate proposal-creation. This is deliberate and borrowed from OSM's "any tags you like" principle ([OSM Any tags you like](https://wiki.openstreetmap.org/wiki/Any_tags_you_like)) — discovery is not the institution's enemy. A new agent with zero history can still file a proposal. The institution distinguishes between **filing** (open to all authenticated keys) and **approval** (gated on claim role and proposal type).

Filed-by attribution is recorded in `schema_proposals.proposed_by_agent_id`. A high volume of low-quality filings from a single key is a different problem (handled by rate limits and key-level reputation), not a barrier to filing the first time.

---

## 4. Who can approve

Approval authority is per-proposal-type, scaling with reversibility. This mirrors Wikidata's split between property-proposers (open) and property-creators (small permissioned group) ([Wikidata: Creating a property proposal](https://www.wikidata.org/wiki/Wikidata:Creating_a_property_proposal)).

| `proposal_type` | Approval requirement | Reasoning |
| --- | --- | --- |
| `add_property` (low-risk, additive) | Any user with `curator` claim role | The property is new; nothing prior depends on it. |
| `add_source`, `add_category` | Any `curator` | Same — additive only. |
| `fork_property` | Two `curator`s, distinct users | Affects existing data; requires migration mapping. |
| `modify_trust_tier` | Owner + one `curator` | Changes ranking semantics across the whole substrate. |
| `deprecate_property` | Owner only | Removes a slot from new claims; old claims retain it. |

Self-approval is permitted **only** when the proposer is the platform owner AND the change is reversible within 7 days (the rollback window in `backward_compatibility.rollback_plan`). Otherwise a separate approver is required. The same human cannot fill both `curator` slots on a two-curator approval.

Approvers record their decision via `POST /api/v1/schema-proposals/:id/review` with `{decision: 'approve' | 'reject' | 'needs_changes', reasoning: '...'}`. The decision row lands in `schema_proposal_reviews` with reviewer key, timestamp, and reasoning. Approval is itself testimony.

---

## 5. The lifecycle

A proposal moves through a closed state machine:

```
open ─▶ under_review ─┬─▶ approved ─▶ (auto-migration runs, namespace updates)
                     ├─▶ rejected (preserved as testimony, not deleted)
                     └─▶ needs_changes ─▶ open (after proposer revises)
```

State transitions:

- **open** — the proposer has filed; no reviewer has picked it up.
- **under_review** — a curator has claimed the proposal (`POST /schema-proposals/:id/claim`). Prevents two reviewers writing conflicting decisions in parallel.
- **approved** — required approvals satisfied; the migration trigger fires.
- **rejected** — required approvals were `reject`. The proposal row is retained (per the trust invariant — never delete testimony) and any `pending_claims` that linked to it are tagged `rejected_pending` but kept. Future agents can read the rejection reasoning and either revise or stop filing the same proposal repeatedly.
- **needs_changes** — reviewer asked for revisions. Proposer resubmits via `PATCH`, state returns to `open`. Edit history is preserved as a chain.

Once `approved`, the proposal is immutable. Subsequent changes (e.g. deprecating a property that was previously approved) require a new proposal.

---

## 6. How an approved proposal becomes schema

Approval triggers a deterministic SQL migration. The trigger logic per `proposal_type`:

**`add_property`** — a row is inserted into the `observation_properties` table:
```sql
INSERT INTO public.observation_properties (
  property_key, label, data_type, unit, category, namespace,
  applies_to_kinds, expected_source_categories,
  proposed_by_proposal_id, created_at
) VALUES (
  :property_key, :label, :data_type, :unit, :category,
  COALESCE(:namespace_request, 'pending'),
  :applies_to_kinds::observation_kind[],
  :expected_source_categories::source_category[],
  :proposal_id, now()
);
```
The `namespace` defaults to `pending` unless the reviewer explicitly marks the property core-ready. This matches Schema.org's separation between editorial approval and core promotion ([W3C Schema.org CG work-in-progress mechanisms](https://www.w3.org/community/schemaorg/how-we-work/work-in-progress-mechanisms-webschemas-and-the-pending-area/)).

**`fork_property`** — parent is marked deprecated, two children are created, a transition view is generated:
```sql
UPDATE public.observation_properties
   SET deprecated_at = now()
 WHERE id = :parent_property_id;
INSERT INTO public.observation_properties (...) VALUES (:child_1), (:child_2);
CREATE VIEW {parent_property_key}_union AS
  SELECT vehicle_id, structured_data, 'factory' AS variant
    FROM public.vehicle_observations WHERE property_id = :child_1_id AND is_superseded = false
  UNION ALL
  SELECT vehicle_id, structured_data, 'current'  AS variant
    FROM public.vehicle_observations WHERE property_id = :child_2_id AND is_superseded = false;
```
Existing observations pointing at the parent are **not** auto-migrated. A cleanup bot re-attributes over time, reading the `migration_mapping` rule. False merges are catastrophic (AX-009); the institution accepts a longer cleanup tail to avoid them.

**`modify_trust_tier`** — the source row is updated, and the prior value is preserved in an audit row (`source_trust_changes` table — separate proposed migration, not in this chapter's scope):
```sql
-- Pseudocode; source_trust_changes is not yet in the proposed substrate
INSERT INTO source_trust_changes (source_id, prior_base_trust_score, new_base_trust_score, proposal_id, changed_at, reason)
  VALUES (:source_id, observation_sources.base_trust_score, :proposed_base_trust_score, :proposal_id, now(), :reasoning);
UPDATE public.observation_sources
   SET base_trust_score = :proposed_base_trust_score
 WHERE id = :source_id;
```

**`deprecate_property`** — property is marked deprecated but not removed. New claims against it are rejected; old claims remain queryable. This is the OSM "approval is non-binding on existing data" stance ([OSM Approval status](https://wiki.openstreetmap.org/wiki/Approval_status)).

All migration triggers run in a single transaction with the proposal status update. If the trigger fails (constraint violation, lock cascade, timeout), the proposal returns to `under_review` with the error logged. No partial schema state is left behind.

---

## 7. The Schema.org pending pattern, applied to Nuke

Schema.org's most useful insight: **publishing a term doesn't require ratification**. The `pending` namespace makes that explicit. Nuke applies the same pattern at the claim level.

When an agent's deposit triggers a proposal, the **claim itself does not have to wait**. The write API lands the rejected claim in `pending_claims` with a foreign key to the open proposal:

```sql
INSERT INTO public.pending_claims (
  vehicle_id, attempted_property_key, attempted_kind,
  attempted_value, attempted_structured_data,
  source_id, submitted_by_user_id, agent_key,
  proposal_id, status
) VALUES (
  :vehicle_id, :property_key, :kind::observation_kind,
  :value, :structured_data,
  :source_id, :user_id, :agent_key,
  :proposal_id, 'awaiting_proposal'
);
```

Read APIs return pending claims with a `pending: true` flag and the proposal ID. Callers can opt into seeing pending data via `?include_pending=true`. Default reads exclude pending claims to keep core consumers stable.

After the proposal is **approved**, `pending_claims` are migrated into `public.vehicle_observations` with the newly-created `property_id` set, and the `pending_claims` row is tagged `migrated` (retained for audit, with `migrated_to_observation_id` pointing at the canonical row). After **rejection**, pending claims are tagged `rejected_pending` and retained as testimony — the trust invariant applies to pending claims as much as to canonical observations (AX-007).

This is the load-bearing reason agents shouldn't fear filing proposals: filing **does not lose your data**. The data is preserved either way; only its addressability changes.

---

## 8. What happens if you skip the workflow

You can't skip it through the write API — the rejection IS the workflow trigger:

```http
POST /api/v1/events
{ "payload": { "property_id": "front_axle_ratio", "value": "3.73" }, ... }

HTTP/1.1 400 Bad Request
{
  "error": "unknown_property",
  "property_id": "front_axle_ratio",
  "message": "property_id 'front_axle_ratio' does not exist in core or pending namespace; file a schema_proposal at POST /api/v1/schema-proposals",
  "proposal_template_url": "https://nuke.ag/v1/schema-proposals/templates/add_property",
  "rejected_claim_id": "uuid-of-rejected-claim-attempt"
}
```

The rejected claim attempt is recorded with the agent's key, the attempted property, the attempted value, and a UUID. When you subsequently file a proposal, you cite the rejected claim attempts in `evidence.rejected_claim_attempts`. The institution can see the demand signal: this property was attempted N times in the last 30 days across M agents. That's the evidence motivating approval. **The rejection is not a punishment — it is a routed proposal trigger.** Discovery is the system working correctly (AX-025).

Attempting to bypass the rejection by stuffing structured data into unstructured fields (`notes`, `description`, `metadata.misc`) is the failure mode the workflow exists to prevent. See [§9 Anti-patterns](#9-anti-patterns).

---

## 9. Worked example — adding `tire_type`

End-to-end. An agent indexes a tire vendor's catalog and tries to file fitment testimony for a 1979 K5 Blazer.

**Step 1 — Attempt:**
```http
POST /api/v1/events
X-API-Key: nk_live_...
{
  "event_type": "specification",
  "vehicle_ref": { "vin": "CKL189F123456" },
  "payload": { "property_id": "tire_type", "value": "all_terrain" }
}
```

**Step 2 — Rejection:**
```json
{ "error": "unknown_property", "property_id": "tire_type",
  "rejected_claim_id": "f3a9...", "proposal_template_url": "..." }
```

**Step 3 — File proposal:**
```http
POST /api/v1/schema-proposals
X-API-Key: nk_live_...
{
  "proposal_type": "add_property",
  "payload": {
    "label": "tire_type",
    "data_type": "enum",
    "suggested_values": ["all_terrain", "mud_terrain", "highway", "street_performance", "racing_slick"],
    "category": "wheels_and_tires",
    "applies_to_asset_types": ["vehicle"],
    "namespace_request": "pending"
  },
  "evidence": {
    "rejected_claim_attempts": ["f3a9..."],
    "external_references": [{ "kind": "manufacturer_spec", "url": "https://bfgoodrichtires.com/...", "excerpt": "..." }],
    "motivation": "tire_size and tire_brand exist; tire_type does not. Mud-terrain vs highway tires are the single most predictive fitment axis for off-road truck listings and is required to compute supply-side gaps."
  },
  "estimated_scope": { "affected_vehicles_count": 8400, "affected_claims_count": 0, "query_used": "..." },
  "backward_compatibility": { "existing_data_behavior": "preserved_unchanged", "rollback_plan": "Drop column; pending_claims retain rejected_pending status.", "read_api_impact": "No change for clients not requesting tire_type." }
}
```

**Step 4 — Status: open.** The agent's rejected claim from Step 1 was simultaneously parked in `pending_claims` with `proposal_id` pointing at this proposal.

**Step 5 — Curator reviews.** A user with `curator` role pulls `GET /api/v1/schema-proposals?status=open`, reads the evidence, decides the property is well-defined and additive. Approves.

**Step 6 — Trigger fires:**
```sql
WITH new_prop AS (
  INSERT INTO public.observation_properties
    (property_key, label, data_type, namespace, applies_to_kinds, category, proposed_by_proposal_id)
  VALUES ('tire_type', 'Tire Type', 'enum', 'pending',
          ARRAY['specification']::observation_kind[], 'wheels_and_tires', :proposal_id)
  RETURNING id
),
migrated AS (
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, ingested_at)
  SELECT pc.vehicle_id, pc.attempted_kind, np.id, pc.attempted_structured_data,
         pc.source_id, pc.submitted_by_user_id, pc.attempted_at,
         'normal'::vfc_rank, 'medium'::confidence_level, now()
  FROM public.pending_claims pc, new_prop np
  WHERE pc.proposal_id = :proposal_id AND pc.status = 'awaiting_proposal'
  RETURNING id, (SELECT id FROM public.pending_claims WHERE migrated_to_observation_id IS NULL LIMIT 1) AS pending_id
)
UPDATE public.pending_claims
   SET status = 'migrated', migrated_at = now(), migrated_to_observation_id = m.id
  FROM migrated m
 WHERE pending_claims.proposal_id = :proposal_id
   AND pending_claims.status = 'awaiting_proposal';
```

**Step 7 — Queryable canonically:**
```http
GET /api/v1/vehicles/CKL189F123456?include_pending=true
→ { ..., "tire_type": { "value": "all_terrain", "source": "...", "namespace": "pending" } }
```

Total elapsed time depends on reviewer availability. Schema.org pending: usable immediately. Wikidata: 1 week minimum. Nuke targets curator response within 7 days of `open` for additive proposals; expect longer for `fork_property` and `modify_trust_tier`.

---

## 10. Worked example — forking `engine_displacement`

The harder case. A curator notices that `engine_displacement` carries factory spec on some vehicles and current swap-installed values on others. The two coexist; queries silently mix them.

**Step 1 — File `fork_property`:**
```json
{
  "proposal_type": "fork_property",
  "payload": {
    "parent_property_id": "engine_displacement",
    "children": [
      { "label": "engine_displacement_factory", "definition": "Displacement of the engine the vehicle left the factory with, per build sheet / VIN decode." },
      { "label": "engine_displacement_current", "definition": "Displacement of the engine currently installed, per most recent owner/shop testimony." }
    ],
    "migration_mapping": "If claim source ∈ {build_sheet, vin_decode, factory_documentation}: factory. If claim observed_at within 2 years AND source ∈ {owner, shop, inspection}: current. Else: manual review."
  },
  "evidence": { ... },
  "estimated_scope": { "affected_claims_count": 14200 },
  "backward_compatibility": { "existing_data_behavior": "requires_manual_reattribution", ... }
}
```

**Step 2 — Two curators required.** First curator approves. State → `approved_partial` until second curator approves. Second curator approves; state → `approved`.

**Step 3 — Trigger fires:** parent deprecated, two children created, transition view `engine_displacement_union` created. **Existing claims are not migrated automatically** — false splits are acceptable, false merges are catastrophic (AX-009). The cleanup bot reads `migration_mapping` rules and re-attributes claims it can match deterministically; ambiguous claims sit on the parent property (now deprecated but still queryable) until a human resolves them.

**Step 4 — Read clients adapt.** Clients querying the old `engine_displacement` get a deprecation warning header and the union view. Clients querying the new children get the structured split. Both work.

---

## 11. API endpoints (the institution's public surface)

```
POST   /api/v1/schema-proposals                  — file a proposal
GET    /api/v1/schema-proposals?status=open      — list open proposals
GET    /api/v1/schema-proposals/:id              — fetch one proposal + review history
PATCH  /api/v1/schema-proposals/:id              — revise (only if status='needs_changes', proposer-only)
POST   /api/v1/schema-proposals/:id/claim        — curator claims for review (open → under_review)
POST   /api/v1/schema-proposals/:id/review       — curator approve / reject / needs_changes
GET    /api/v1/properties?namespace=core         — list core schema
GET    /api/v1/properties?namespace=pending      — list pending schema
GET    /api/v1/properties/:id/proposal           — fetch the proposal that birthed this property
GET    /api/v1/schema-proposals/templates/:type  — fetch a blank proposal template for a given type
```

All endpoints require `X-API-Key` auth. Filing requires `schema:propose` scope (default for all authenticated keys). Review requires `schema:review` scope (granted with `curator` claim role). Owner-only actions require `schema:admin`.

---

## 12. Anti-patterns

The institution rejects these as malformed deposits or unsafe approvals.

- **Free-text into `notes` instead of proposing a property.** If the data has structure, the structure deserves a slot. Notes is for prose, not for `front_axle_ratio: 3.73` smuggled inside a paragraph. The form is the thing (AX-044).
- **Structured data in `metadata.misc`.** Same failure, different field. `metadata` is for envelope-level transit metadata, not for missing properties.
- **Faking a `source_id` to get past rejection.** Every numeric value carries source DNA (AX-006). Inventing a source corrupts the substrate at the layer beneath the proposal workflow.
- **Approving your own proposal without owner role.** Self-approval is only valid for owner + reversible-within-7-days. Anything else requires distinct approvers.
- **Filing the same rejected proposal verbatim.** Read the rejection reasoning; revise the evidence or motivation; refile as a new proposal with `supersedes_proposal_id` pointing at the rejected one.
- **Filing a `fork_property` without a migration_mapping.** The mapping is what makes the fork executable. A fork without a mapping is a hand-wave; the proposal will be rejected with `needs_changes`.
- **Mass-filing low-quality proposals to inflate a key's contribution count.** Rate limits apply per-key; pattern detection flags repeat offenders for owner review. The institution rewards quality, not volume (AX-087).
- **Unilateral DDL to add a column.** Any agent writing direct `ALTER TABLE` against `vehicle_observations`, `observation_properties`, or `observation_sources` is violating the rule. Schema changes are data, not migrations (AX-032). The proposal workflow is the only authorized path.

---

## 13. Cross-references

- **Form-is-thing axiom:** `docs/library/intellectual/contemplations/the-form-is-the-thing.md` and AX-044.
- **Nuke-is-rails axiom:** AX-043 (encyclopedia ch. 7) and `docs/library/reference/encyclopedia/07-external-agent-write-api.md`.
- **BYOK / laser-tag axiom:** AX-045 and `feedback_vision_is_caller_byok_laser_tag.md`.
- **Schema-as-data axiom:** AX-032 and `docs/architecture/SCHEMA_DISCOVERY_PRINCIPLE.md`.
- **Trust invariant (no destruction of pending or rejected proposals/claims):** `.claude/rules/agent-trust-invariants.md`, AX-007, and `docs/library/intellectual/contemplations/the-trust-invariant.md`.
- **External prior art survey:** `docs/audit/2026-05-17_external_prior_art.md` (Pattern 1: Schema evolution).
- **Per-kind canonical fields:** `docs/library/reference/encyclopedia/02-observation-model.md#per-kind-structured_data-shape`.
- **External Write API envelope:** `docs/library/reference/encyclopedia/07-external-agent-write-api.md`.
- **Peer systems cited:**
  - Wikidata property proposals: <https://www.wikidata.org/wiki/Wikidata:Property_proposal>
  - Wikidata property creation: <https://www.wikidata.org/wiki/Wikidata:Creating_a_property_proposal>
  - Schema.org pending: <https://schema.org/docs/pending.home.html>
  - W3C Schema.org work-in-progress: <https://www.w3.org/community/schemaorg/how-we-work/work-in-progress-mechanisms-webschemas-and-the-pending-area/>
  - OSM proposal process: <https://wiki.openstreetmap.org/wiki/Proposal_process>
  - OSM any tags you like: <https://wiki.openstreetmap.org/wiki/Any_tags_you_like>
  - OSM approval status: <https://wiki.openstreetmap.org/wiki/Approval_status>
  - MusicBrainz RFC process: <https://wiki.musicbrainz.org/History:Proposal_Process_Suggestion>

---

## 14. One sentence to take with you

The institution accepts deposits and rejects malformed ones; when the malformation is **the shelf doesn't exist yet**, the rejection routes you here, you fill the form, you wait for a curator, and your data — preserved as pending the whole time — moves onto the new shelf the moment the shelf is built.
