# Proof-of-Maintenance

*Working paper — 2026-06-16*
*Status: DRAFT / proposal. Companion to `2026-06-16_make_model_subject_and_cohort_terminal.md` (Section 5) and the precedent sweep of the same session.*

> A car is worth more when you can *prove* it was cared for. Today that proof is a
> shoebox of receipts and the owner's word. Proof-of-maintenance is the
> machine-verifiable version: an append-only, evidence-cited condition-and-care
> ledger for a single VIN that an underwriter — or a cohort index — can trust
> **without physically inspecting the car.** It is the per-VIN analog of what
> provenance is to a Marti report: the document that makes the asset lendable.

This is **develop-from-what-exists.** Proof-of-maintenance is **not a new island,
a new table, or a new "attestation engine."** It is a **projection over testimony
the platform already collects** — `work_orders`, `work_order_labor`,
`work_order_parts`, `work_sessions`, `timeline_events`, `vehicle_images`, and the
governed-claim atoms in `projection_event` — assembled the way `vehicle_wiki()`
assembles a VIN's spec page. The schema for the *ledger view* is zero. The schema
for the *substrate* already exists and is partly populated. What is missing is the
projector and the one explicit owner-signature gate that promotes a claim from
"inferred" to "attested."

(Per `feedback_dont_mint_new_structures_use_the_repo.md`: the answer is "the
repository" with correct structure, not a new named layer.)

---

## 1. What proof-of-maintenance IS

A **verifiable, append-only, evidence-cited maintenance/condition ledger for a
specific VIN.** Three properties, each load-bearing:

- **Verifiable without inspection.** Every line cites its evidence — a dated
  photo (`vehicle_images.taken_at` + `exif_data` + `file_hash`), a work order
  (`work_orders` → `work_order_labor`/`work_order_parts`), an owner-confirmed work
  session (`work_sessions` finalized via `confirm_work_session`), or a sourced
  document. The reader trusts the **citation chain**, not the assertion. This is
  the same move that makes `vehicle_wiki()` readable by a stranger: the page is
  the consensus of cited claims, not a brochure.

- **Append-only.** It obeys the universal trust invariant
  (`.claude/rules/agent-trust-invariants.md`): testimony is never deleted or
  overwritten. A correction is a *supersession*, not an edit. A maintenance ledger
  that can be silently rewritten is worthless to an underwriter; the append-only
  substrate is exactly what makes it bankable.

- **Provenance-as-trust, at the unit scale.** Section 5 of the cohort paper
  established that Nuke's provenance graph is **synthetic centralization** — it
  makes distributed custody verifiable without moving the cars. Proof-of-
  maintenance is that claim made concrete for **one VIN**: the cohort analog of
  provenance-as-trust, computed per-asset. The cohort index aggregates these
  per-VIN ledgers into a basket-level condition floor.

The honest framing: this is not "tamper-proof" in the blockchain sense and does
not need to be. It is **citation-backed and supersession-audited** — the same
trust model peer systems (MusicBrainz, Wikidata, OpenLibrary) converged on, and
the same model the rest of Nuke already runs on. Its credibility comes from the
evidence chain and the reputation-weighted consensus engine, not from cryptography.

---

## 2. How it composes from what EXISTS

Proof-of-maintenance is an **assembly + projection**, exactly like the cohort
terminal. Nothing below is hypothetical except the projector function and the
signature gate.

### The substrate that already exists

| ledger block | source table / function | file | status |
|---|---|---|---|
| **labor performed** | `work_order_labor` (task_name, task_category, hours, hourly_rate, total_cost, difficulty_rating, `ai_estimated`) | `supabase/migrations/20251102000009_work_order_research_system.sql:91-105` | EXISTS, partial K5 data |
| **parts installed** | `work_order_parts` (part_name, part_number, brand, quantity, unit_price, `ai_extracted`, `user_verified`) | `…20251102000009…:49-67` | EXISTS |
| **work request + status** | `work_orders` (title, description, status draft→paid, vehicle_id, estimated/actual hours) | `…20251212000010_work_orders_schema_backfill.sql:7-43` | EXISTS |
| **owner-confirmed labor session** | `work_sessions` (vehicle_id, session_date, duration_minutes, confidence_score, work_description, status) | `…20250831155000_create_work_sessions.sql:2-15` | EXISTS |
| **before/after/timelapse/receipt proof artifacts** | `work_order_proofs` (proof_type, urls[], metadata) | `…20251212000015_work_order_proofs.sql:7-27` | EXISTS — already the "proof" table |
| **dated photo evidence** | `vehicle_images` (`taken_at`, `exif_data`, `latitude/longitude`, `file_hash`, `documented_by_user_id`) | `…20250117000003_vehicle_images_table.sql` + `…20250111_add_gps_to_vehicle_images.sql` | EXISTS, well-populated |
| **maintenance/condition events** | `timeline_events` (event_type maintenance/repair/inspection, source_type service_record/receipt, confidence_score, verification_status, affects_value/safety) | `…20250118_timeline_events_schema.sql:5-56` | EXISTS |
| **cost rollup** | `get_event_cost_breakdown(event_id)`, `work_order_comprehensive_receipt` view | `…20251204_comprehensive_work_order_receipt.sql:230-329, 114-177` | EXISTS |
| **governed claim atoms** | `projection_event` (evidence_class, evidence_ref, observed_at, retracted_at) | `…20260615000000_projection_event_evidence_class.sql:12-14` | EXISTS |
| **the assembly pattern** | `vehicle_wiki(p_vehicle_id)` → canonical + cited_fields | `…20260615030000_vehicle_wiki_view.sql:9-37` | EXISTS (the template to mirror) |

**The point:** proof-of-maintenance is not a build, it is a **read**. Every block
above is a row that already lands through the existing intake path. The work is to
*project* them into one cited ledger — the way `vehicle_wiki()` projects a VIN's
spec page out of `projection_event` rows — not to mint a parallel maintenance
system.

Note the naming reality for citation accuracy: there is **no `vehicle_observations`
table**; per-VIN testimony flows through `timeline_events` + `vehicle_events` +
`vehicle_images` + `projection_event`. The proposal below uses `projection_event`
as the atom store (the same store `project_attribute()` already reads), not a new
observations table.

### The projection, not the island

`vehicle_wiki()` is the existence proof. It takes a `vehicle_id`, reads the
governed claim graph, and returns `{canonical, cited_fields, field_count}` where
every cited field is the weighted consensus of evidence-cited claims with its
citation, confidence, contributors, and conflict flag. **Proof-of-maintenance is
the same function with a maintenance lens** — `proof_of_maintenance(vehicle_id)` —
reading the *care* substrate instead of the *spec* substrate. Same shape, same
trust model, same renderer pattern. (Sketch in §6.)

---

## 3. The trust model

Every maintenance claim carries the universal datum stamp
`(source, method, observed_at, trust)` (Universal Invariant #1,
`feedback_numbers_carry_source_dna.md`) plus an **evidence class**. The evidence
class is not decorative — it is the literal weight in the consensus engine.
`nuke_evidence_weight()` (`…20260615020000_consensus_and_reputation.sql:12-22`)
assigns:

```
document     1.00     vin_decode    1.00
image        0.90     context_atoms 0.60     owner_claim   0.45
```

A maintenance ledger inherits these weights directly. The tiering for care
evidence falls out cleanly:

| evidence | class | weight | example |
|---|---|---|---|
| dated service invoice / receipt | `document` | 1.00 | `timeline_events.documentation_urls`, `work_order_parts.part_number` + receipt |
| before/after photo with EXIF | `image` | 0.90 | `work_order_proofs.urls[]`, `vehicle_images.taken_at` |
| platform-inferred labor session | `context_atoms` | 0.60 | a `work_session` at status `auto_inferred` (base_trust ~0.30) |
| owner's bare assertion ("I changed the oil") | `owner_claim` | 0.45 | unconfirmed `timeline_events` row |

**The high-trust tier is owner-confirmed labor.** The `confirm_work_session` MCP
tool (`supabase/functions/mcp-connector/index.ts`) is the gate: an inferred
`work_session` (status `auto_inferred`, base_trust ~0.30) becomes an owner-
confirmed FACT only when the owner runs `decision='confirm'` or `'amend'`. Per the
photo-intent rule (`feedback_photo_intent_must_be_confirmed_not_assumed.md`),
**value accrues to the ledger ONLY on confirm/amend, never from inference alone** —
the $410-for-a-text-to-dad incident is the cautionary tale. On confirmation the
tool writes a high-trust `projection_event` atom (attribute cluster
`work_transition_confirmed`) with full lineage to the source `dT` atom.

This means the ledger is **self-grading**: an underwriter reading
`proof_of_maintenance(vehicle_id)` sees, per line, whether the claim is
document-backed (1.00), owner-confirmed (high actor trust), photo-evidenced (0.90),
or merely inferred (0.60) — and the consensus engine has already surfaced any
conflict (`project_attribute` flags `conflict:true` when a runner-up claim has
≥50% of the winner's support). Conflict is **surfaced, not hidden** — a disputed
maintenance claim is shown as disputed, which is itself underwriting signal.

---

## 4. What it unlocks

### Collateral valuation — the LTV lever

The precedent is real and specific. **RM Sotheby's Financial Services and
Sotheby's Financial lend $1M–$250M against collector vehicles at 50–60% LTV with
no borrower credit check** — underwritten purely on the asset's appraised value,
provenance, condition, and comps. The trust machine already exists at the
ultra-high end. What it runs on today is **hand-built, per-marque, human-mediated
PDFs**: Marti Reports for Ford, Porsche Kardex, auction-house catalog provenance.
Siloed paper.

A maintained, documented asset earns a better LTV. That is not aspiration; it is
how the ultra-high-end market already prices risk. Proof-of-maintenance is the
**computable, cross-marque, continuously-updated** version of the condition+
provenance dossier those lenders already underwrite on. The valuation engine
already has the hook: `compute-vehicle-valuation`
(`supabase/functions/compute-vehicle-valuation/index.ts`) weights an
`originality` signal and a `condition` signal — both currently neutral (1.0)
"pending build-class-aware scoring" (lines 410-411, 620-623). **A populated
proof-of-maintenance ledger is exactly the input those two dark signals need.** A
car with a deep, owner-confirmed, document-cited care ledger is *measurably*
better collateral than an identical VIN with an empty ledger — and the LTV can
reflect it.

### The "digital freeport" custody claim

Section 5.1 established the McDonald's-vs-Fort-Knox resolution: capital
historically demanded physical centralization (the vault, the freeport) as a
*proxy for trust*, because it could not verify distributed custody. Geneva
Freeport and Le Freeport run this model at ~$100B scale with title-transfer-in-
situ. Proof-of-maintenance is the per-VIN brick of **synthetic centralization**:
it makes one distributed car's condition-and-custody state verifiable at
institutional trust levels *without moving it.* Aggregate ten thousand of these
and you have computed the trust state of ten thousand garages — the freeport
becomes the optional top-tier convenience, not the precondition for lending.

### The survivor curve, individualized

Section 5.3's two value vectors meet here: **maintenance preserves the individual
unit** (removes it from the attrition curve), while **depletion raises the
survivor's scarcity value.** Proof-of-maintenance is the attestation that a
specific VIN has been kept off the decay curve. It is the per-unit input to the
cohort's `make_model.survival_estimate` and the per-unit justification for pricing
that VIN above the cohort median.

---

## 5. The honest gaps

This is a DRAFT/proposal. What is genuinely missing, separated by kind:

**Schema to add (BUILD — needs Skylar's sign-off per Universal Invariant #4):**
- No new tables are strictly required if the ledger is a pure projection. The one
  candidate addition is a **`maintenance` attribute block** in
  `_shared/cockpit/attribute-registry.ts` (mirroring the `MAKE_MODEL` block the
  cohort paper proposes) so that synthesized care-facts (`drivetrain_serviced`,
  `last_major_service_at`, `documented_service_count`, `restoration_completeness`)
  flow through `project_attribute()` like any other subject attribute. These are
  `subject_kind: "vehicle"` attributes — no new subject kind.
- A possible `proof_of_maintenance_attestations` view (not table) materializing
  the projector output for fast read. View, not table — per platform-hygiene
  (`there are already 1,013 tables, 483 empty`).

**What requires owner signature (per the no-self-attribution rules):**
- Promotion of any inferred labor/cost to the high-trust tier — `confirm_work_session`
  is the existing gate and **must remain owner-signed.** An agent under Skylar
  writes through `ingest-observation`, never raw INSERT into testimony
  (`feedback_agent_under_skylar_writes_through_ingest_observation.md`); the
  PreToolUse hook blocks God-mode writes.
- Ownership/value confirmation and any line that asserts dollar value of labor
  (`feedback_exhaust_evidence_before_owner_eyes.md`: agentic confidence with
  provenance is the product, but labor/value confirmation still needs the human
  signature).

**The one thing that needs external validation:**
> **Would a real lender accept this ledger in place of a physical inspection?**

This is the open research question, and it is honest to leave it open. The
precedent says the *concept* is proven — the ultra-high-end already lends on
documentation alone, no credit check, 50–60% LTV. What is unproven is whether a
**computed, cross-marque ledger** clears the same underwriting bar a Marti report
clears today. The likely first path is not a bank but a **sponsor/anchor-LP**
(Section 5.6's "whale"): one backer who accepts the ledger for one cohort, the way
every real fund starts with an anchor LP. The minimum viable test is one cohort,
one whale, one defensible proof-of-maintenance attestation — not a retail lending
product.

---

## 6. Proposed shape (DRAFT)

Mirror `vehicle_wiki()`. A single STABLE function that **assembles** deterministic
care-aggregates from owned rows and **projects** the curated care-attributes
through consensus.

```
proof_of_maintenance(p_vehicle_id uuid) RETURNS jsonb   -- STABLE, mirrors vehicle_wiki()
  → header := { vehicle_id, ledger_status, total_documented_spend,
                documented_service_count, owner_confirmed_session_count,
                last_attested_service_at }

  -- ASSEMBLE (deterministic SQL over rows we own; no consensus needed)
  → labor_ledger := work_order_labor ⋈ work_orders WHERE vehicle_id
        each line: { task, category, hours, cost, evidence_class, source, observed_at,
                     attested: (work_session confirmed?) }
  → parts_ledger := work_order_parts ⋈ work_orders WHERE vehicle_id
        each line: { part_name, part_number, brand, qty, cost, user_verified, source }
  → proof_artifacts := work_order_proofs WHERE vehicle_id           -- before/after/receipt urls
  → photo_evidence  := vehicle_images WHERE vehicle_id AND taken_at IS NOT NULL
        (dated, EXIF-cited — the image-class 0.90 evidence)
  → service_history := timeline_events WHERE vehicle_id
                       AND event_type IN ('maintenance','repair','inspection')
        each line carries its source_type + verification_status + confidence_score
  → cost_rollup := get_event_cost_breakdown(...) per event

  -- PROJECT (weighted consensus, conflict-surfaced — same engine as vehicle_wiki)
  → cited_care_fields := jsonb_agg(
        project_attribute(p_vehicle_id, 'maintenance.<X>'))
        for X in {drivetrain_serviced, last_major_service_at,
                  documented_service_count, restoration_completeness,
                  matching_numbers, originality_class}

  → return jsonb_build_object(
        'header', header,
        'labor_ledger', labor_ledger,         -- every line: {value, source, observed_at, trust, attested}
        'parts_ledger', parts_ledger,
        'proof_artifacts', proof_artifacts,
        'photo_evidence', photo_evidence,
        'service_history', service_history,
        'cited_care_fields', cited_care_fields,
        'trust_summary', { document_backed_pct, owner_confirmed_pct,
                           inferred_only_pct, conflicts: [...] },
        'note', 'Every line is cited; attested lines are owner-confirmed via
                 confirm_work_session. Empty blocks are intake gaps, not a
                 verdict of "unmaintained".')
```

Two discipline rules baked into the shape:

1. **Empty is an intake gap, never a verdict.** Per
   `feedback_valuation_block_when_not_defensible.md`: a thin ledger means *we
   haven't captured the records yet*, **not** "this car was neglected." The
   `trust_summary` reports coverage honestly (`document_backed_pct`,
   `inferred_only_pct`); it never renders "unmaintained" from absence.

2. **Attested ≠ inferred, and the reader sees which.** Every line carries
   `attested: bool`. The high-trust ledger is the subset where labor passed
   `confirm_work_session`. An underwriter can choose to weight only attested lines
   — the ledger does not pretend inference is confirmation.

The companion `project_maintenance_canonical(vehicle_id)` (mirror of
`project_vehicle_canonical`) would sync a denormalized header cache, writing a
column only when a non-conflicted consensus backs it.

---

## What we are NOT doing

- **Not minting a new maintenance/attestation system.** This is `work_orders` +
  `work_sessions` + `timeline_events` + `vehicle_images` + `projection_event`,
  projected by one function that mirrors `vehicle_wiki()`.
- **Not auto-attesting.** Inference stays at 0.60; only `confirm_work_session`
  promotes to the high-trust tier, and only the owner runs it.
- **Not fabricating a care score from photo pixels.** Photo intent must be
  confirmed (`feedback_photo_intent_must_be_confirmed_not_assumed.md`); a photo is
  evidence of *a moment*, not proof of *labor value*.
- **Not building the lending product.** We build the ledger; the financial layer
  drops in as activation when the ledger is trustworthy — the same sequencing the
  deleted exchange/vault scaffolding taught us (`platform-hygiene.md`).

---

## The open question, stated plainly

The schema is mostly free. The projector is a weekend mirror of `vehicle_wiki()`.
The trust model is the consensus engine we already run. The single thing that is
**not** in our control is whether a counterparty — a lender, a sponsor, an index —
**accepts a computed ledger as a substitute for the inspection-and-Marti-report
ritual the market runs on today.** The precedent says the underlying behavior
(lend on documentation, no credit check) is proven at the top of the market. The
research is: *port that behavior down from hand-built PDFs to a cross-marque
computable ledger, and find the first counterparty willing to underwrite on it.*
Build the ledger; the answer to the question is a conversation with the first whale.
