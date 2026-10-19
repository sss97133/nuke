# Work Order Intelligence

## A job is a quote (2026-10-19)

Use the standard trade vocabulary in docs, readers and interface copy (owner, 2026-10-18:
"its good to use the standard language"). Lifecycle: estimate → quote (→ revisions) →
acceptance → deposit → work order → (change orders) → completion → invoice → payment →
receipt. The live `work_orders.status` check already follows it: `pending`, `quoted`,
`approved`, `rejected`, `scheduled`, `in_progress`, `completed`, `paid`, `cancelled`.

| Standard term | Meaning here | Existing holder |
|---|---|---|
| Estimate | Unpriced or ranged scope derived from evidence (photos, a listing); not an offer | `work_orders.estimated_*` scalars (no provenance); the read-only `buying-evidence.mjs --plan` report |
| Quote | Priced, itemized scope and terms offered by a provider; versioned | `work_orders.status='quoted'` + `quoted_at`. No quote entity: `work_order_quotes` exists only as an unapplied repo migration |
| Quote revision | A new version superseding the prior quote before acceptance | Gap |
| Acceptance / approval | The client signs one specific quote version | `work_orders.approved_at` (no signer, no version) |
| Deposit | Payment against an accepted quote | `work_orders.deposit_cents` (no payment link) |
| Work order | The accepted quote being executed | `work_orders` (status `approved` → `scheduled` → `in_progress`) |
| Change order | A signed revision after acceptance | Gap |
| Invoice | Bill for completed work against the work order | `generated_invoices` |
| Payment | Money movement against an invoice | `work_order_payments`, `payment_events` |
| Receipt | The concluded record: what was done, by whom, and what was paid | `work_order_receipt_unified` + `work_order_balance`, `get_user_day_receipt` |

A **receipt** in Nuke is not a row. It is a computed conclusion over witnesses that have
been reconciled with each other: purchase receipts (`receipts` + `receipt_items`), money
movements (`payment_events`, `work_order_payments`), labor days (`work_sessions` closed by
`confirm_work_session`), operations performed (`component_events`) and outgoing invoices
(`generated_invoices`). An invoice, a payment and a work order can be several witnesses to
one economic item; reconcile their references before summing. Readers assemble the
conclusion: `get_user_day_receipt` (one person-day), `compute_vehicle_investment_proof`
(one vehicle, tiered proven / attributed / projected / market) and
`work_order_receipt_unified` with `work_order_balance` (one job).

A **job** is a **quote**: a `work_orders` header whose itemized lines each name the witness
that will close it, the clock it will carry and the party who must sign. Acceptance turns
the quote into a work order; invoicing and payment conclude it as a receipt. Concluding
fills those slots with admitted observations. It never flips a status. `transfer_milestones`
(required step, deadline, completed clock, signer, evidence pointer) is the existing shape
of an itemized, signer-closed plan in the ownership domain; reuse the shape, not the table.

| Stage (`read_work_order_job_path`) | Quote / work-order line it becomes | Closed by |
|---|---|---|
| intake | Header: asset, requester, stated scope, request clock | Vehicle bound + scope stated + authenticated requester |
| inspection | A billable inspection line; its findings become the plan's basis | Inspector Sign on the findings |
| plan | Operation × material/process × parts × tools × facility × performer | Builder Sign on the plan |
| terms | Price, deposit, schedule, who agreed and when | Client Sign over a frozen scope snapshot + each provider's accept |
| execution | Dated work log, sessions, installed parts, image evidence | Performer records + signed days |
| completion | Performer attestation + client acceptance | Two Signs |
| accounting | Charged, paid in, owed out per provider, comped value | Reconciled payments; release predicates evaluated, nothing disbursed |

Measured on 2026-10-19 by `work_order_job_path_scoreboard()` over all 26 `work_orders`
rows: no row has an approval clock or a schedule window; plan can never reach `recorded`
(`executable: not_assessed`); 4 rows have a done status without a completion clock; booking
readiness and permission authority are `not_assessed` on every row. The scoreboard reports
that evidence exists, not that it is true.

### Invariants

These claims are kept as separate records and never collapsed into one another:

presence (an image occurrence) ≠ identity (account or actor) ≠ ownership/access ≠ skill
(evidence-derived only) ≠ permission ≠ availability (a stated window) ≠ reservation ≠
accepted work ≠ completion ≠ client acceptance ≠ measured usage ≠ asset cost ≠ computed
depreciation ≠ market value ≠ labor value ≠ payment record ≠ payout term ≠ disbursement.

A tool seen in frame is not a tool owned, owned is not permitted for this job, a vouch is
not skill evidence, an accept clock is not completion, and a payment row is not a release.
Each is a stated invariant; the mechanism that enforces it is named where it exists
(constraints and readers above and below) and otherwise recorded as missing.

### Contextual agreements

A job needs fourteen kinds of agreement between named parties. Every agreement is a
`work_record` observation admitted through `ingest-observation` and projected into an
immutable typed row, with three clocks (event, ingest, sign), an authenticated signer
(`submitted_by_user_id = auth.uid()` at a Sign step, never an ambient trigger), a verdict
(`supports` / `contradicts` / `unknown`) and a snapshot of what was agreed. The existing
`basis_line_item_snapshot` pattern then withholds a stale agreement automatically when its
basis changes.

| Agreement | Parties | Existing holder | Gap |
|---|---|---|---|
| Quote acceptance | client ↔ lead provider | `work_orders.approved_at` (one clock) | No signer, no quote version |
| Material/process spec | client ↔ provider ↔ supplier ↔ performer | `work_order_resource_specifications` stages + comparisons | Acceptance of the proposed pair: `not_established` |
| Inspection as a job | client ↔ inspector (≠ executor) | `inspection` requirement + actor fulfillment; `scope_category='inspection'` | No parent ↔ child work-order link |
| Provider offer/accept | provider ↔ lead or client | `work_order_assignments` offer/accept/decline clocks | Dormant; keyed to `technicians`, not the resource graph |
| Compensation terms | provider ↔ payer | `work_order_assignments.payout_type` (flat / hourly / percentage) | No day rate or per-operation term; terms mutable |
| Tool loan/access | tool owner ↔ performer | Fulfillment tool references + `permission` / `condition` / `delivery` / `withdrawal` attestations | Authentication, reservation, return clock, fee |
| Facility/bay access | facility ↔ performer or client | Fulfillment `facility_organization_id` + window | No bay grain, no reservation |
| Co-sign/vouch with a cut | co-signer ↔ provider ↔ client | `supervision` / `suitability` attestations; assignment roles | No authenticated attestor, liability scope or cut term |
| Payment-release conditions | client ↔ providers ↔ platform | `payout_status` vocabulary only | No condition record |
| Vehicle transport custody | shipper ↔ client ↔ shop | `delivery` attestation (resources only); `transfer_milestones` (ownership) | No work-custody handoff |
| Change order/substitution | client ↔ provider | Specification summary reports `substitution_approval: not_established` | No signed supersession; scope text is editable in place |
| Completion acceptance | client ↔ provider | `completed_at`; job path returns `customer_acceptance: not_established` | No client Sign |
| Deposit | client ↔ shop | `work_orders.deposit_cents` | No payment link |
| Vehicle access permission | owner ↔ provider | `vehicle_user_permissions` (role, grantor, expiry, revocation) | Not tied to a job window |

Eleven of the fourteen have no holder or only a partial one.

### Adopted design decisions (owner-overridable defaults, 2026-10-19)

These defaults were adopted on 2026-10-19 so work can proceed. The owner can override any
of them; until then, build against them.

1. **The job row.** `work_orders` is the job header; no `jobs` table. `work_sessions` stays
   the labor witness and links to a job through an evidenced edge.
2. **Where agreements live.** New projector event types named in standard language
   (`quote`, `quote_acceptance`, `change_order`, `invoice`, `release_condition`,
   `custody`), added the way `operation` was. Status columns become derived caches,
   not truth. `quote` and `quote_acceptance` exist (see "Quotes and acceptance").
3. **Sign.** One authenticated Sign RPC family records the signer, the sign clock and a
   snapshot or hash of the scope it covers. A later scope edit withholds the acceptance.
4. **Identity bridge.** Extend `account_link_claims` with an `actor_id` (exclusive with the
   external identity). Evidence rungs: unknown → self_claim → work_evidence → co_sign →
   authenticated_sign. Never match by name. `technicians` and `technician_phone_links` are
   retained legacy claims, not the bridge.
5. **Inspection.** When priced or booked, an inspection is its own `work_orders` row
   (`scope_category='inspection'`) with a parent link; its findings feed the parent plan.
   The pre-purchase inspection is the first paid job.
6. **Compensation terms.** Add day rate and per-operation beside flat, hourly and
   percentage, pinned at acceptance. Book hours are a reference, never a price. Day-rate
   productivity is measured from signed days plus completion evidence, never from
   inferred minutes.
7. **Payment release.** Predicates declared at acceptance and evaluated over evidence, as
   a computed conclusion. Disbursement and Stripe Connect stay off.
8. **Co-sign.** An authenticated `supervision` / `suitability` / `permission` attestation
   (job-scoped in `work_order_resource_attestations`; standing in a user-subject sibling)
   plus a separate compensation term (`work_order_assignments.role='cosigner'`). A vouch
   is never skill evidence.
9. **Mutable conclusions** become superseding testimony: session un-confirm, line-item
   status, payment status and scope text.
10. **Phantom tables and the quote.** `work_order_quotes`, `work_order_proofs`,
    `work_contracts` and `technician_payout_log` exist in repo migrations but not live.
    They are not applied as written. The quote is the central object, so it keeps the
    standard name: an immutable, versioned, observation-backed quote projection, where a
    revision supersedes and an acceptance signs one version. Reconciled 2026-10-19: the
    repo's `20251212000013_work_order_quotes.sql` (a mutable `status` of draft / sent /
    accepted / rejected / withdrawn, no version) was never applied, because that version is
    recorded live as `profile_integrity_guardrails`; `20261019094500_work_order_quotes.sql`
    reuses the name for the immutable projection. Proofs fold into the observation/image path.

### Listing → pre-purchase inspection

Today Nuke can produce an honest **estimate to inspect** from a listing, not an estimate to
restore. Measured 2026-10-19: of 124,355 `description_discoveries` rows, 90,817 are stored
extraction-failure rows (`raw_extraction.error`) and 7,504 carry structured condition,
flags, work or modifications. `resolve_labor_rate()` with no reported rate returns a
labelled $160 `spitball` placeholder (4 shop rates, below its threshold of 30).
`labor_operations` holds 64 seed codes written around GM trucks; `stage_transition_labor_map`
holds 28 seed ranges. No live transport owner exists.

Pipeline, each step extending an existing owner:

1. Listing claims reader: verbatim excerpt, source, clock and confidence per claim;
   failure rows and unattributed images excluded and counted.
2. Claim → operation crosswalk to `labor_operations` / `stage_transition_labor_map` through
   a reviewed keyword table.
3. As-found specification stage: what the listing shows today.
4. Requirement templates per operation.
5. Per-line estimate with method, coverage and a min/typical/max range.
6. Pre-purchase inspection job on a non-owned vehicle, with a seller `permission`
   attestation; findings land as `inspection_type: pre_purchase` observations.
7. Builder match (below).
8. Purchase and custody through `transfer_milestones` plus `delivery` attestations.
9. The quote, accepted as a work order, then invoice, payment and receipt on the
   work-order spine.

The smallest honest first version is the read-only `scripts/discovery/buying-evidence.mjs
--plan` report (operator contract in `scripts/discovery/buying-evidence.md`): identity conflicts first, then claims, candidate operations labelled
`seed_uncalibrated`, the rate exactly as `resolve_labor_rate` returns it, priced parts only
where a text-fitment match exists (unverified), and a PPI checklist.

### Matching as an explainable join

"Most accessible provider" is an explainable SQL join per requirement, not a score. Each
candidate × input is `pass`, `fail` or `unknown`, with its reason. Inputs: the requirement,
distance, service area, availability window, the resource satisfied by the candidate or by
a Plan-B supplier, evidence rung, workload and price terms. A missing resource yields a
Plan-B fulfillment, not disqualification. The largest gaps are person-level location,
service area and availability, and a join key between tools and requirements.

### The app as navigator

The client apps navigate this graph rather than owning state. A profile is a public booking
hub with provider, client and private faces. The work surface holds the signature queue,
jobs in motion on a seven-stage rail, open requirements nearby, evidence to file and
capture. One shared job view returns faces from server-supplied viewer slots and actions
only from server-supplied action lists. Stage states map onto the trust ladder:
recorded → attributed, partial → pending, status_only → recorded (dimmed), inconsistency →
conflicting; proven only for authenticated signatures. Readers follow the privacy doctrine
below: job path, resources and evidence are anon-safe readers with personal information
stripped at the source; only a party's own payments and balances, and its signature queue,
need the authenticated party.

### Privacy doctrine (owner, 2026-10-18)

- **Open by default.** Job, work, provider and vehicle data (job paths, quote scope and
  specifications, resources, evidence, provider capability and work history) is platform
  data, used across platform calculations and readable anonymously.
- **Prices are open.** Quote prices, labor rates and parts costs are open.
- **Party money is not.** Actual payments and balances between specific parties are
  visible only to those parties.
- **Personal information is withheld:** email, phone, street address and the legal names
  of private people. People appear by platform handle.
- **Contact is brokered.** Users reach each other through a platform contact request, never
  through exposed contact fields, so contact data cannot be extracted.
- **Mechanism.** Readers default to anon-safe, with personal information stripped at the
  source rather than gated per caller. Sign writers require the authenticated party. The
  job readers shipped so far (`read_work_order_resources`, `read_work_order_job_path`,
  `read_work_order_image_objects`) are still service-only; opening them under this
  doctrine is separate work.

### Exposures and traps

The 2026-10-19 review found read paths that exposed personal contact fields on work-order
and participant data; they are being closed in separate migrations and are not described
here.
The trap functions below are correctness hazards, listed in
`docs/ledger/CAPABILITY_MAP.md`: `resolve_labor_rate`'s contract branch reads the absent
`work_contracts`; `generate_repair_estimate` writes to an absent table;
`estimate_labor_from_description` returns hardcoded confidence; and
`organization_capabilities.verified` is true on rows with no evidence.

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

## Quotes and acceptance

A job is a quote: estimate → quote (revisions) → acceptance → deposit → work order →
change order → completion → invoice → payment → receipt. `work_order_quotes` holds the
quote and its revisions; `work_order_quote_acceptances` holds the customer's acceptance.
Both are immutable projections keyed by their source observation.

**Quote.** A provider's quote is a `work_record` admitted through `ingest-observation` with
event type `quote` (payload: `quote_version`, `supersedes_quote_id`, `quoting_party`
`{kind, id}`, `scope_snapshot`, `lines`, `deposit_requested` `{amount, currency}` or null,
`valid_until` or null). The projector requires:

- `scope_snapshot` equal to `work_order_quote_scope_snapshot(work_order_id)`: the current
  operations, requirements, material/process specifications, parts and labor rows, without
  progress fields (status, actor, hours) or amounts.
- Each line names `ref_kind` (`operation`, `requirement`, `part`, `labor`, `fee`) and a `ref_id`
  in the snapshot (null for a fee), a description and a `pricing_basis`: `flat`, `hourly`
  (unit `hour`), `day_rate` (unit `day`) or `per_operation` (unit `operation`). An amount
  requires an ISO currency, and the reverse; a quantity is stated or null, never assumed. At
  least one line must be priced; an unpriced scope is an estimate.
- The quoting party is an explicit actor, user or organization id, or `unknown`. It is
  attributed by the source and not authenticated; it is never matched by name.
- Version 1 first, then the next integer, superseding the current version. The newer version
  withholds the older from current reads; history stays.

The projection stores a SHA-256 `quote_hash` over the quote's canonical content.

**Issue (Sign).** `issue_work_order_quote(p_work_order_id, p_lines, p_deposit, p_valid_until,
p_supersedes_quote_id)` lets an authenticated provider issue a version through the same path:
an `owner-input` work record signed by `auth.uid()`, projected as `quote` in the same
transaction, with the signer as quoting party. Eligible: an active owner of the work order's
organization (`business_ownership`), or an account whose evidenced identity bridge
(`viewer_identity_bridge`: an approved actor claim at `work_evidence` or above; `self_claim` is
not enough) names the work order's lead actor or an operation's actor. The customer cannot
quote their own job. A repeated identical request returns the existing quote.

**Acceptance (Sign).** `accept_work_order_quote(p_quote_id, p_quote_hash)` is the only writer.
The caller must be the work order's customer (`auth.uid() = work_orders.customer_id`; a vehicle
owner is not assumed to be the client, since in a pre-purchase inspection the owner is the
seller). The hash must match the version, the version must be current and unexpired, its scope
snapshot must still match, and the quoting user cannot accept their own quote. The RPC writes
an `owner-input` work record (signer, sign clock, quote hash) and projects it in the same
transaction; the projector refuses a `quote_acceptance` presented any other way. Neither
`work_orders.status` nor `approved_at` is written. Nothing is collected, authorized or paid.

**Reader.** `work_order_quotes_read(p_work_order_id)` is open to anon and authenticated
callers under the privacy doctrine, and follows the open job readers. Slots come from
`work_order_viewer_slots`; a work order on a non-public vehicle is shown only to slot holders;
the header (`vehicle_label`, `display_title`, `request_source_label`) comes from
`work_order_open_header`. It returns:

- the current quote and every version, with the full scope snapshot, priced lines, totals,
  the deposit as a requested term (`nature: requested_term_not_payment`) and validity (a
  withdrawn version shows its summary only);
- version states (`current`, `superseded`, `withdrawn`);
- acceptance state (`accepted`, `withheld` with a reason, or `not_accepted`);
- stored and derived `quoted_at` / `approved_at`;
- the viewer block (a visitor gets `context: visitor`, no slots, no actions) and coverage.

The quoting party and the signer appear by public profile handle, organization name or
`unnamed party` (`platform_*_label`). A quote issued through `issue_work_order_quote` is
attributed `authenticated_sign`. Raw user ids, and free text that names the customer or looks
like contact data, go only to parties. No payments, balances or contact fields are returned.
An acceptance is withheld when its quote is superseded or withdrawn, the scope changes, the
signer is no longer the customer, or its own source is withdrawn. `accept_quote` appears in
`actions` only when the viewer could sign now, and only the customer can.

Not yet: change orders as their own event, and deposit and payment links.
Contracts: `supabase/sql/test_work_order_quotes.sql`, `test_work_order_quote_issue.sql`,
`test_work_order_quotes_open_read.sql`.

## Job path self-measurement

`read_work_order_job_path(work_order_id)` reports one work order's evidence across seven
stages: intake, inspection, plan, terms, execution, completion and accounting.
`work_order_job_path_scoreboard()` aggregates every `work_orders` row (the denominator)
into per-stage state counts, gap counts and inconsistency counts. Both are service-only,
read-only and run as the caller; they read existing owners (`work_orders`, line items,
the resource graph, parts, labor, assignments, `component_events`, status history,
`work_order_payments`, `payment_events`) and return counts, statuses and clocks, never
customer contact fields or amounts.

A stage state is `recorded`, `partial`, `status_only` (a status says done or paid without
the clock) or `absent`. It reports whether evidence exists, not whether it is true.
Inconsistencies are reported and never repaired: an assignment status of accepted with no
`accepted_at`, a done status with no completion clock, a paid status with no payment record,
and payments on a work order with no vehicle. Vehicle-scoped `payment_events` are counted
beside the job with attribution `not_established`. Plan executability, customer acceptance,
measured usage, labor value and cost allocation stay unassessed or false, and nothing is
disbursed. The scoreboard is the measurement the RSI loop reads before choosing the next
gap that retained evidence can close. Contract: `supabase/sql/test_work_order_job_path.sql`.

The terms stage reads quotes through `work_order_quote_state`. A current quote supplies the
quote clock (`quote_clock_basis: current_quote`) and keeps terms at least partial. A current
customer acceptance supplies the approval clock: the sign clock, attributed by
`approval_signer` (role and acceptance id; no raw user id, since the open job readers pass
this stage to anyone) with `approval_clock_basis: quote_acceptance_sign`. Terms is then recorded and `no_approval_clock` no longer applies.
A withheld acceptance adds `acceptance_withheld_<reason>`. `work_orders.approved_at` and
`quoted_at` stay the fallback; the stored approval clock is also reported as
`stored_approval_clock`. Contract: `supabase/sql/test_work_order_job_path_quotes.sql`.

### Requested operations from scope text

`work_order_line_items` is the operations owner. A work order's own description or
scope text often itemizes the requested work, but line items had no provenance and no
sanctioned insert path. The `operation` event (payload: `line_number`, `task_type`,
`task_description`, `basis_field` = `description` | `scope_description`, `basis_excerpt`,
optional `notes`) projects one admitted work record into one line item whose id is the
source observation id. The excerpt must appear in that field of the same-vehicle work
order, and the task text must equal it. The row starts `pending` with no cost, hours or
actor: a requested item, not priced, assigned, scheduled or performed work. Task type is
set only when one explicit verb names it, otherwise `other`. Supply lines are not operations.

`source_observation_id`, `basis_field` and `basis_excerpt` record provenance. A trigger keeps
text, line number and provenance immutable on sourced rows and requires a sourced insert to
match its current observation and the work order's text. Status stays editable by the work
order's parties. Bills list only priced or comped lines, so requested rows do not bill. The
job path counts sourced and pending operations, treats labor-task rows as operations evidence
(`operations_only_in_labor_rows`), and reports `operation_source_withdrawn` and
`operation_excerpt_missing_from_scope` without deleting rows.
Contract: `supabase/sql/test_work_order_scope_operations.sql`.

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
Client-org negotiated rate agreements, created in `20260327100000_work_order_intelligence_schema.sql`. **Absent live** (`to_regclass` null, 2026-10-19). Priority 1 in the `resolve_labor_rate()` cascade, so that branch errors when it runs.

## Rate Resolution Cascade

`resolve_labor_rate(org, user, vehicle, client)` returns `{rate, source, rate_confidence, …}`:

1. **Contract rate** (priority 1): `work_contracts` where client+org match, vehicle-specific first. Runs only when both client and org are passed; the table is absent live, so this branch is a trap.
2. **User rate** (priority 2): `user_labor_rates` where user matches and is_active
3. **Organization rate** (priority 3): `businesses.labor_rate` for the org
4. **No reported rate** (priority 4): the median of `businesses.labor_rate` when at least 30 shops report one (`market_estimate`); otherwise a $160 `spitball`. On 2026-10-19, 4 shops report a rate, so it returns `spitball` / `spitball_no_data`. A placeholder, never a provider's rate.

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
