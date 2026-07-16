# 20 — Polymorphic Subject: Build Guide

## Completing the Observation System's Own Target Architecture

> **Status:** design + gate. Contains a proposed schema migration. Per the
> universal invariant (*ask only for: schema changes, deletes, auth, ownership,
> destructive ops*), **no migration in this guide may be applied without Skylar's
> explicit sign-off.** Everything here is design and gate-definition; the code
> artifact shipped alongside it (`nuke_frontend/src/entity/entityProof.ts`) is
> read-only against existing tables and touches no schema.

---

## 1. Why this exists (and why it is not a new idea)

`schematics/observation-system.md` already declares the north star: *"a single
intake path for all data, regardless of type or source,"* and names the
observation as the **Body without Organs** — the concept that *"has no single
home territory."* The current reality contradicts that target in exactly one
place: **observations are vehicle-keyed.** `ingest-observation` takes a
`vehicle_id` and writes `vehicle_observations`. The polymorphic *subject* — the
ability for a testimony row to be *about* a vehicle, an org, a user, or any
asset — exists today **only at the financial layer** (`cashflow_deals.subject_type
∈ {user, organization}`, `20260112100000`).

So this guide does not invent a polymorphic substrate. It **completes the
migration the observation system already committed to**, by lifting the proven
`cashflow_deals` subject pattern up into the testimony layer. This is the
subtractive move (use the repo, finish the declared target), not an additive one
(a new island).

This is the keystone under everything the white-label/modes conversation
surfaced. Once subjects are polymorphic:
- an **org** can be *built out via proof* the way a vehicle is (the gate for dad
  wearing Viva);
- **asset analysis** generalizes off one substrate instead of vehicle-only code;
- the **CPA profile** draws on the same proof record;
- **modes** become a *projection of a proof-built entity*, not a costume.

## 2. The chain: entity → proof → profile → projection

| Stage | What it is | Where it lives (today) | Gap |
|---|---|---|---|
| **Entity** | A container that accumulates testimony | `vehicles`, `organizations`, `profiles` | No shared "subject" abstraction across them |
| **Proof** | Verified observations/events/activities w/ provenance | `vehicle_observations` (vehicle-only); org has hand-authored `business_timeline_events` + `organization_ownership_verifications` (real proof state machine) | Observations can't target an org/user; roles lack a claim→verify machine |
| **Profile** | The analyzable surface built from proof | `get_org_profile_fast`, vehicle profile | Org profile completeness is disaggregated counts, not a proof score |
| **Projection** | Mode / mech-suit / valuation / CPA view | branding engine (`src/branding/*`), valuation | Projection currently bypasses the gate (`?brand=` reskins with no proof) |

The fix is one architectural decision applied at the Proof layer; the rest
follows.

## 3. The model (proposed)

Generalize the subject, reusing the `cashflow_deals` shape verbatim so the
pattern stays singular across the codebase:

```
subject_type  text  CHECK (subject_type IN ('vehicle','organization','user','asset'))
subject_id    uuid  -- FK enforced per-type via trigger or partial FKs
```

Applied to the testimony substrate (`vehicle_observations` → generalized, or a
thin `observations` view/table that `vehicle_observations` becomes a partition
of). **Backward-compatible default:** `subject_type='vehicle'` reproduces today's
behavior exactly; existing rows and the existing `ingest-observation` contract
keep working. Nothing breaks; new subject types become *expressible*.

`ingest-observation` gains an optional `subject` ({type,id}); when absent it
defaults to vehicle and the current path is untouched. Trust scoring, content
hashing, dedup, confidence — all of section 5–8 of `observation-system.md` —
are subject-agnostic already and need no change.

## 4. The activity atom — the CEO-drives-for-supplies case

The errand "CEO drove across town to pick up supplies for a job" is **not a new
table.** It is one observation, of `kind = 'activity'`, with:

```
subject_type = 'organization'   (the work was done under the org)
subject_id   = <org>
structured_data = {
  actor_id,                 -- who did it (the CEO, a contributor)
  work_order_id,            -- the job it served (existing work_orders)
  geo_path: [{lat,lng,t}],  -- movement, not a point
  duration_min,
  cost: { mileage_usd, labor_usd, receipt_id },
  intent: 'supply_run'      -- one enum value among many
}
provenance: source, method, observed_at, trust   -- per numbers-carry-source-DNA
```

**The load-bearing rule:** `intent` is **owner-confirmed, never inferred.** This
is the `$410-for-a-text-to-dad` failure generalized — an activity whose *value*
(billable vs. overhead vs. personal) depends on a confirmed intent the system
must not guess. Value accrues only from confirmed-intent activities. "Drive for
supplies" is legible (geo-path + receipt corroborate existence); its *worth* is
deferred to confirmation and the exchange (`habitus-and-the-exchange.md`:
separate veracity from consecration).

This is also the answer to *"orgs are weird, requires constant AI to build schema."*
Orgs are weird in their **data**, not their **schema**. The schema stays boring:
one polymorphic activity observation. The AI's job is **classification onto it**
("this blob is a supply_run, actor=CEO, job=#412"), never minting a `supply_runs`
table. If a case genuinely won't fit the atom, that is the signal to evolve the
*one* atom surgically — not to spawn structures.

## 5. The gate (un-fakeable artifact, per `the-illegible-asset.md`)

No proof-of-build is computed for an entity class until its un-fakeable
completion artifact is named. For the two classes this thread needs:

- **Organization.** Existence-proof = a **verified independent-counterparty
  transaction** (`payment_events` with a real `counterparty_org_id` ≠ self) and a
  **verified work record** (`work_orders` with confirmed labor). Fakeable via
  round-tripping and self-dealing → both need VIN-grade provenance before they
  count. Filings/fees (`organization_ownership_verifications`) prove *ownership*,
  not *asset formation* — do not conflate them.
- **Activity.** Existence-proof = confirmed-intent + at least one corroborating
  brute fact (receipt, geo-path, or a second observer). Bare time-logging is
  Goodhart bait and counts for nothing.

## 6. Modes are derived, not configured (recalc engine)

Once the org accumulates proof, its **mode is read off the substrate**, per
`harness-is-derived-recalc-engine-not-renders`:
- geofence ← observed `shop_locations` + activity `geo_path` clusters;
- activities ← observed `kind='activity'` observations;
- associated people ← verified `organization_contributors`.

The branding engine (`src/branding/*`) already consumes a `BrandIdentity`; the
only change is that, in production, the identity is *resolved from a proof-built
profile and gated by it*, instead of from a `?brand=` param. The prototype's
`resolveBrand('org:slug')` becomes `resolveBrand` **gated on proof score > 0**.

## 7. Migration plan — SCHEMA, NEEDS SKYLAR SIGN-OFF

Smallest reversible first step, in order; do not run without approval:
1. ✅ **APPLIED 2026-06-17** (migration `20260617000000_observation_polymorphic_subject.sql`,
   approved by Skylar). Added `subject_type text NOT NULL DEFAULT 'vehicle'` and
   `subject_id uuid` (nullable) to `vehicle_observations` (~7.5M rows) —
   metadata-only, no table rewrite, **no testimony row touched**. Effective
   subject = `(subject_type, COALESCE(subject_id, vehicle_id))`; legacy rows keep
   `subject_id` NULL and resolve to `vehicle_id`. CHECK added `NOT VALID` (instant).
   No index yet (deferred to a concurrent follow-up once non-vehicle rows exist).
   Verified: columns present, constraint present, sample rows = `vehicle`/null/has-vehicle.
   **Zero behavior change** — non-vehicle subjects are now merely *expressible*.
2. ✅ **APPLIED 2026-06-17** — `ingest-observation` (and the shared
   `_shared/observationWriter.ts`) accept an optional polymorphic subject.
   - `index.ts` (the HTTP endpoint, has its own insert) + `observationWriter.ts`
     (the shared path used by extractors) both take an optional `subject`
     (`{type,id}` / `subjectType`,`subjectId`) and set `subject_type`/`subject_id`
     via **conditional spread** → when omitted the insert is byte-identical and
     the vehicle path is unchanged. Verified backward-compatible by construction.
   - `observationWriter.writeObservation` now requires `vehicleId` only for
     vehicle subjects, requires `subjectId` for non-vehicle, and **skips the
     vehicle-only post-processing** (`gapFillVehicle`, `writeFieldEvidence`) for
     non-vehicle subjects.
   - Deployed `ingest-observation` (CLI, `--no-verify-jwt`); edge logs clean, no
     errors. **No synthetic test row written** — `vehicle_observations` is
     never-deleted testimony, so a fake org row would be permanent contamination
     (facts-are-sacred). End-to-end non-vehicle write validates naturally when the
     first real org writer (step 5) lands. Extractors importing `observationWriter`
     pick up the shared change on their next redeploy (backward-compatible until then).

   Original code findings (2026-06-17, reading `_shared/observationWriter.ts`):
   - The insert is built once in `writeObservationRow` (≈L327). Adding the
     subject is mechanically: thread `subjectType?`/`subjectId?` through
     `ObservationInput` (L39) → `writeObservationRow` params → the insert object,
     **via conditional spread so the vehicle path is byte-identical when subject
     is absent** (zero regression risk for existing callers).
   - BUT the function is **vehicle-shaped after the insert**: `writeObservation`
     then calls `gapFillVehicle` and `writeFieldEvidence`, both keyed on
     `vehicleId`. For a non-vehicle subject these must be **skipped** (guard:
     `if (subjectType && subjectType !== 'vehicle') skip vehicle post-processing`).
   - **Sequencing:** deploying step 2 alone ships capability with no consumer and
     nonzero risk to the universal intake. Do it **paired with the first real
     non-vehicle writer** (e.g. the org build-out write path), and validate
     end-to-end through the sanctioned path (write one org observation, read it
     back) — never a raw insert (trust-invariant single-write-path).
   - Smoke test on deploy: first confirm the **vehicle** path is unchanged
     (ingest a normal vehicle observation, check `get_logs` + the row), then the
     org path. Keep the prior version ready to redeploy.
3. ✅ **APPLIED 2026-06-17** (migration `20260617000100_observation_kind_activity.sql`).
   Added `'activity'` to the `observation_kind` enum — additive/online, no lock.
   Defined as the **pre-confirmation** action kind (intent/value owner-confirmed
   before promotion to `work_record`), so it does not overlap `work_record`.
   Structured-data shape per §4. No source registered to produce it yet (sources
   opt in via `supported_observations` when a real activity writer lands).
4. ✅ **APPLIED 2026-06-17** (migration `20260617000200_contributor_role_verification.sql`).
   Added `verification_method` (default `self_claimed`), `verified_by`,
   `verified_at`, `claim_evidence` to `organization_contributors` — additive,
   metadata-only. No new table (lighter than the ownership-verification pattern;
   the FSM rides the existing `status` + these columns). Existing roles honestly
   become `self_claimed`. Surfaced in the mode switcher (verified vs self-claimed
   per work mode). **Follow-up (4b, needs actor-ontology check):** a
   `proof_of_work` auto-verify path — promote a role when the user is an actor on
   the org's `work_orders`. **Confirmed blocked (2026-06-17):**
   `work_orders.lead_actor_id` FKs to a separate **`actors`** entity, and `actors`
   has no `user_id`/`profile_id`/`auth_user_id` column — so there is no simple
   actor↔user join. 4b requires mapping the actor↔user resolution first (the
   digital-twin actor/org ontology). Do not build the RPC on a guessed join.
5. ✅ **APPLIED 2026-06-17** — the projection gate (scope corrected from the
   original "org proof-score RPC": the read-model `src/entity/entityProof.ts`
   already computes proof from existing tables client-side, so no DB RPC was
   minted). Added `canProject(entityType, id)` = `entityProof(...).hasFormationProof`
   (fail-closed). Gated **both** projection paths: `resolveBrand` (the `?brand=` /
   subdomain entry — refuses org/vehicle with no formation proof) and
   `activateBrand` (the mode-switch tap — returns false + refuses). Synthetic/demo
   brands are exempt. tsc + build green.
   - **Validated on real data (no synthetic writes):** Viva! Las Vegas Autos has
     3 `work_orders` → `hasFormationProof=true` → **wearable** (dad-test link
     reskins). Desert Performance / FBM / Hot Kiss / Taylor / Epstein have 0
     formation artifacts → **refused** ("costume over an empty framework").
   - This validates steps 1–3 in spirit (the gate reads the polymorphic-ready
     read-model) and closes the entity→proof→projection loop in the product. The
     end-to-end *non-vehicle write* (step 2) still validates naturally when a real
     org-fact writer exists; org facts that already live in structured tables
     (`work_orders`, `payment_events`) are read as proof directly — re-emitting
     them as observations would be a data fork (single-write-path rule).

Each step is independently shippable and backward-compatible. The trust
invariant holds throughout: never delete/overwrite testimony; supersede.

## 8. Measured against doctrine (the self-check)

- **Don't mint** — completes the observation system's declared target; reuses
  the `cashflow_deals` subject pattern; adds zero new conceptual layers. ✓
- **Everything is an entity with service provenance** — makes it literally true
  at the testimony layer, not just the financial one. ✓
- **Numbers carry source DNA / write through ingest-observation** — the activity
  atom carries full provenance; no raw inserts. ✓
- **Formation not activity (Goodhart) + own-the-gaze** — the gate (§5) refuses to
  score activity-without-artifact; proof is the user's own, owned. ✓
- **Trust invariant** — additive, backward-compatible, supersession preserved. ✓

## 9. Shipped alongside (no schema)

`nuke_frontend/src/entity/entityProof.ts` — a read-only, build-verified
computation of an entity's proof/completeness **from existing tables today**
(vehicle and org), returning a uniform `{ entityType, entityId, signals, proofScore,
gaps }`. It is the read-model the entity→proof→profile UI consumes, and it proves
the polymorphic *read* pattern works against the current schema before any
migration is approved. See that file's header for the exact signals used.
