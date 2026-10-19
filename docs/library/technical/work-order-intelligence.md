# Work Order Intelligence

## Resource evidence graph (2026-10-19)

`work_order_resource_requirements`, `work_order_resource_fulfillments` and
`work_order_resource_attestations` are private typed projections of existing
`vehicle_observations` work records. The observation ID is the projection ID and
idempotency key. Original sources, methods, trust and clocks stay on that observation;
corrections use the existing testimony supersession path.

After a source has been admitted through `ingest-observation`, a service operator calls
`project_work_order_resource_observation(observation_id)`. It accepts only a current,
source-attributed `work_record` on the same vehicle as the work order. The versioned
payload is `structured_data.work_order_resource`:

| Event | Required payload beyond `version: 1`, `event_type`, `work_order_id` |
|---|---|
| `requirement` | `line_item_id`, `requirement_kind` (`tool`, `equipment`, `facility`, `skill`, `inspection`, `approval`), `description`; paired positive `quantity` + `unit`, or both null when unstated; optional paired `basis_observation_id` + exact `basis_excerpt` |
| `fulfillment` | `requirement_id`; exactly one resource: `user_tool_id` / `inventory_tool_id` / `equipment_id` / `facility_organization_id` / `performer_actor_id`; exactly one supplier: `supplier_user_id` / `supplier_organization_id`, or both null for an actor candidate; optional paired `available_from`, `available_until`; optional actor basis `basis_line_item_id` + `basis_line_item_snapshot` |
| `attestation` | `fulfillment_id`; exactly one of `attestor_user_id` / `attestor_organization_id`; `attestation_kind` (`condition`, `suitability`, `permission`, `availability`, `supervision`, `delivery`, `withdrawal`); `verdict` (`supports`, `contradicts`, `unknown`); explicit `scope` |
| `specification` | `specification_stage` (`requested`, `proposed`, `supplied`, `reported_performed`); `material_role` + `material_label` + `material_key` and/or `process_label` + `process_key`; optional `line_item_id`; exactly one basis: `basis_observation_id` + `basis_excerpt`, `basis_component_event_id` + `basis_snapshot`, or `basis_work_order_part_id` + `basis_snapshot` (see below) |

The service-only `read_work_order_resources(work_order_id)` returns the current graph,
source IDs and observation/ingestion clocks, plus recorded coverage. Withdrawing or
reattributing a requirement source excludes its dependent offers and attestations from
the current graph. Original projections remain immutable. Anonymous and authenticated
roles receive no grants; neither the public resolver nor existing access policies change.

Historical source reconstruction uses `basis_observation_id` and `basis_excerpt` on
requirements. The projector checks that the original is a current, same-vehicle
`work_record`, contains the exact excerpt, and has the same `observed_at` as the
interpretation. The original cannot itself be a resource projection. A legacy original
may lack source attribution; the new interpretation still requires an attributed source
and must disclose its method. This establishes citation custody, not mechanical correctness
or the speaker's authenticated identity. The reader exposes the interpretation's method
and confidence; withdrawal or reattribution of the original excludes the whole derived
chain, including on duplicate projection attempts. Unknown quantities stay null.

A fulfillment is a **candidate arrangement**, and an attestation is a **reported
statement**, including when its kind is `permission`. This projection does not
authenticate the attestor or establish supplier authority. Several alternatives can
coexist. Personal inventory may represent multiple tools, so its ID is not an exclusive
physical-unit reservation. Tool requirements accept personal or shop tool/equipment
references; equipment and facility requirements require their respective reference.
Skill and inspection requirements accept a canonical `actors` reference; approval
requirements remain unresolved. No resource conflicts are adjudicated because no capacity
is reserved. The reader explicitly returns booking readiness and permission authority
as `not_assessed`, and reservation/payment flags as false—even for a populated graph.

Participant candidates reuse `actors`, the canonical vehicle-work actor registry. Actor
names, types, specialties and legacy capability counts do not establish verified skill.
They are not merged with `technicians`, `auth.users` or shop identity by name. The supplier
is a separate attributed contracting party and can remain unknown for an actor candidate.
An optional retained assignment basis must name the requirement's exact operation and
performer and equal the **entire** current line-item row as JSON. Store that snapshot in
`work_order_resource.basis_line_item_snapshot`. Any row revision conservatively withholds
the candidate and its attestations from current reads; duplicate projections also refuse
the stale basis. Independent alternatives remain available. History is retained.

Derived candidates use the existing `internal-inference` source (now also supporting
`work_record`) through sanctioned intake. Their observation clock records the interpretation;
the snapshot preserves the operation's own clocks without asserting a physical-work time.
The reader exposes extraction method, confidence, the source's `interpretation`, candidate
basis, contracting-party status and canonical actor label. Account linkage and qualification
remain `not_assessed`. A supported candidate may still disagree with the requested process;
record that disagreement in the source interpretation rather than declaring fulfillment.

This is the backend evidence relation, not completed booking, authenticated sign-off,
settlement, historical replay, or historical job reconstruction. No source collection,
photo-processing holds, paid inference or existing invoices are changed. The focused
PG17 contract is `supabase/sql/test_work_order_resource_evidence.sql` and is picked up
by the existing database-contract CI job.

## Work specification: material and process together

`work_order_resource_specifications` holds one attributed material/process claim per
source observation. Material and process are kept as a pair: a requested scope
("304 stainless, TIG welded"), a part record, and a reported operation are separate
claims at separate stages, compared side by side rather than turned into a provider
qualification judgment. Stages:

- `requested`: quoted from a retained work record (`basis_observation_id` +
  `basis_excerpt`, same rules and original clock as requirement bases). Required basis.
- `reported_performed`: from a `component_events` row for the named operation. The
  operation's `component_event_id` must be that event, and labels must equal a whole
  recorded metadata value.
- `supplied` / `proposed`: from a `work_order_parts` row of the same work order with
  status `installed` / `quoted`. Cancelled and unused parts do not qualify. Parts have no
  typed operation link, so these claims are work-order scoped; the projector refuses an
  inferred operation. Matching parts to an operation by cost was tried and is not unique.

Labels are verbatim from the basis (contained in the excerpt or part name, or equal to an
event metadata value); keys are the derived interpretation. Keys are dotted, coarse to
fine (`stainless_steel`, `stainless_steel.304`, `welding.tig`). Materials carry a role
(`workpiece`, `filler`, `consumable`) and are compared only within a role, so an ER308L
filler rod is never compared with workpiece tubing. Part and event bases store the
**entire** row as `basis_snapshot`; any later change withholds the claim from current
reads and refuses duplicate projection. There is no FK to those owners because their
rows cascade from vehicles and timeline events. The projector and reader run with
`TimeZone=UTC` so snapshot timestamps compare identically for every caller.

`read_work_order_resources` adds `specifications` (without the snapshot, so part amounts
are not republished), `specification_comparisons` and `specification_summaries`. Each
current requested claim is compared with every current non-requested claim on the same
operation or at work-order scope (`operation_link`). Material and process relations are
`same`, `different`, `unresolved_specificity` (one key refines the other, e.g. ungraded
"SS"), `not_stated` or, for material, `different_role_not_compared`. The summary status is
`conflicting_evidence` when any relation differs, otherwise `consistent`, `unresolved` or
`no_comparable_evidence`. It always returns substitution approval, scope-change acceptance
and completion as `not_established` and qualification as `not_assessed`. A conflict says
the records disagree; it does not decide which record is right or whether a substitution
was agreed. Contract: `supabase/sql/test_work_order_resource_specifications.sql`.

## Image objects in job context

`read_work_order_image_objects(work_order_id, after_observation_id, limit)` is a
service-only, read-only bridge from the job's vehicle to retained canonical deep-image
observations. Pages contain 1–100 observations, ordered by observation UUID; the returned
cursor continues the current read and is not an immutable historical snapshot. Each tool
and component array member becomes a sighting with its original JSON, source observation,
image, method, confidence, capture/observation/ingestion clocks and exact JSON pointer.
Repeated labels and background objects remain separate occurrences. A sighting count is
neither a distinct-object count nor evidence of billable activity. Missing or malformed
array shapes are reported; malformed members retain their raw claim without an invented label.

Only current attributed `image_deep_byok` condition observations with an approved,
non-external image still assigned to the same vehicle qualify. Conflicting witness image
IDs, reattribution, source withdrawal and changed image qualification remove current
results. The reader performs no new analysis and changes no approval/processing hold.
Its scope is vehicle context: these photos do not establish which work-order operation
used an object, and unanalysed photos and other observation formats are outside coverage.

Existing `equipment_usage_evidence` records link an image to the equipment endpoint.
These remain qualified legacy associations, not per-object physical identity matches.
Their reported state, minutes, method and confidence are exposed, but not adopted as
usage or allocated to the job. The original cascade sometimes inferred minutes from
visibility; this reader neither reruns that cascade nor repairs its historical claims.
Purchase cost and its source, computed depreciation value and its formula are separate
fields. Market value, job cost and labor value remain unknown; the equipment ledger
does not record a currency. No estimate is relabelled as a paid acquisition cost.

Owner direction: observe objects throughout every frame, accumulate evidence at their
entity endpoints, and use that evidence to support labor valuation. Existing canonical
observations already retain these object arrays, so this slice exposes a deterministic
relational read instead of duplicating them in a new sightings ledger. Physical-instance
resolution, material/process compatibility, condition/market valuation, measured usage,
confirmed labor and compensation terms remain distinct downstream work.
Contract: `supabase/sql/test_work_order_image_objects.sql`.

The system that answers "update me on the Smith build" with a complete cited receipt in <5s.

## The Dual System

Two systems coexist for tracking vehicle work. Both are valid. Neither replaces the other.

### System 1: Timeline Events (Forensic Accounting)
- Table: `timeline_events`
- Purpose: Immutable record of what happened, when, by whom
- FK: `work_order_parts.timeline_event_id`, `work_order_labor.timeline_event_id`
- Used by: `get_event_cost_breakdown()`, cost analysis, audit trail

### System 2: Work Orders (Customer Workflow)
- Table: `work_orders`
- Purpose: Active work tracking, quotes, invoicing, customer communication
- FK: `work_order_parts.work_order_id`, `work_order_labor.work_order_id`
- Used by: `resolve_work_order_status()`, balance computation, receipts

### The Bridge
Both FK columns exist on `work_order_parts` and `work_order_labor`. A row can belong to a timeline event AND a work order simultaneously. `timeline_events.work_order_id` links them when needed.

**Decision record:** We don't merge them because they serve different audiences. Timeline events = what-happened-forensically (source of truth for auditors). Work orders = what-the-customer-sees (source of truth for invoicing).

## The Product: resolve_work_order_status()

```sql
SELECT resolve_work_order_status('smith');
```

One RPC call returns:
- Vehicle: id, year, make, model, VIN, sale price
- Contact: name, email, phone
- Work orders: title, status, itemized parts/labor/payments, balance per WO
- Summary: total parts, labor, payments, balance due, comped value

Resolution cascade: `work_orders.customer_name` -> `deal_contacts` -> `vehicles.make/model/vin`

Callable from: frontend (`supabase.rpc()`), MCP server, edge function, curl, another agent.

## Data Flow

```
iMessage chat.db ──> ingest-thread.mjs ──> vehicle_observations
                                           (scope changes, agreements)

iMessage chat.db ──> ingest-zelle.mjs ──> work_order_payments
(Zelle SMS 767666)                        (deduped by wo+amount+method+sender+date)

Gmail receipts ────> ingest-receipts.mjs ──> work_order_parts
(Amazon, Summit)                             (with source citations)

Manual entry ──────────────────────────────> work_order_labor
                                             (with rate_source, book hours)

All of the above ──> resolve_work_order_status('query') ──> JSONB response
                     work_order_receipt_unified (view)
                     work_order_balance(wo_id)
```

## Tables

### work_order_payments
Customer payments. Ingested from Zelle SMS notifications in iMessage chat.db.

| Column | Type | Purpose |
|--------|------|---------|
| work_order_id | uuid FK | Which work order this pays toward |
| amount | numeric | Payment amount |
| payment_method | text | zelle, check, cash, wire, venmo, etc. |
| sender_name | text | Who sent it (from Zelle notification) |
| memo | text | Zelle memo field (e.g., "BILSTEIN SHOCKS") |
| reference_id | text | External ref: Zelle confirmation #, check # |
| source | text | How discovered: zelle_sms, manual, bank_feed |
| source_metadata | jsonb | Raw data: iMessage ROWID, QB txn id |

Dedup index on `(work_order_id, amount, payment_method, sender_name, payment_date)`.

### labor_operations
Mitchell-style flat rate book. 64 operations across body, paint, mechanical, exhaust, etc.

| Column | Type | Purpose |
|--------|------|---------|
| code | text PK | e.g., MECH-BRAKES-REAR, EXH-CUSTOM-FAB |
| name | text | Human name |
| base_hours | numeric | Standard book hours |
| system | text | Vehicle system: body, paint, mechanical, exhaust, etc. |
| model_year_min/max | int | Applicability range |

### user_labor_rates
Per-technician hourly rates. Priority 2 in `resolve_labor_rate()` cascade.

### work_contracts
Client-org negotiated rate agreements. Priority 1 in `resolve_labor_rate()` cascade. Vehicle-specific contracts override general ones.

## Rate Resolution Cascade

`resolve_labor_rate(org, user, vehicle, client)` returns `{rate, source}`:

1. **Contract rate** (priority 1): `work_contracts` where client+org match, vehicle-specific first
2. **User rate** (priority 2): `user_labor_rates` where user matches and is_active
3. **Organization rate** (priority 3): `businesses.labor_rate` for the org
4. **System default** (priority 4): $125/hr market average

## Comp Tracking

Parts and labor can be marked `is_comped = true`. When comped:
- `comp_retail_value` tracks what it would have cost
- `comp_reason` explains why (goodwill, warranty, error correction)
- Comped items are excluded from invoice totals
- Total comped value is reported separately (goodwill tracking)

## Scripts

All scripts live in `mcp-servers/nuke-context/` and share `lib/env.mjs` for environment loading.

| Script | npm | Purpose |
|--------|-----|---------|
| resolve.mjs | `wo:resolve` | Full build status report. RPC primary, client-side fallback, iMessage enrichment |
| balance.mjs | `wo:balance` | Itemized balance for one work order or vehicle |
| ingest-zelle.mjs | `wo:ingest-zelle` | Parse Zelle SMS from chat.db -> work_order_payments |
| ingest-receipts.mjs | `wo:ingest-receipts` | Amazon/Summit receipts -> work_order_parts |
| ingest-thread.mjs | `wo:ingest-thread` | iMessage thread -> vehicle_observations |

## Migrations

| Migration | Phase | Purpose |
|-----------|-------|---------|
| `20260327100000_work_order_intelligence_schema.sql` | Schema | Tables, columns, constraints, RLS |
| `20260327100001_work_order_intelligence_seed.sql` | Seed | 64 labor operations |
| `20260327100002_work_order_receipt_view.sql` | View | `work_order_receipt_unified` + `work_order_balance()` |
| `20260327100003_resolve_work_order_status.sql` | RPC | The product function |
