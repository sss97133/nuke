# Opportunity Matching — the data model

**Status, 2026-10-15 UTC:** general matching contract; bounded read-only comparison implemented in the
existing buying-evidence operator. Forty-one focused contracts pass; a synthetic request compared against two
live public retained records yields one supported fit and one supported mismatch, with transmission unknown.
No persisted request/match fold, public feed or fleet gain is established.
**Owner direction:** general market matching, 2026-10-14 local; earlier funding case in the case ledger
`data-machine-cases.md` §13.9, §13.9.1, §13.9.2 (2026-10-07).
**Reads first:** `docs/ledger/theory/data-machine.md`, `../organization-entity/SPEC.md`, SCHEMA_LAW.
**Lanes:** organizations and identities belong to identity-origin; stacks, folds and migrations to data-model.

## 0. The function

Connect attributed demand with relevant supply before either party needs a Nuke account. A source post requesting a
specific vehicle, a listing offering one, a shop's capability and an organization's eligibility for a funding program
are useful observations to relate. The general question is: which candidates satisfy which stated needs, what supports
each connection, what remains unknown, and what changed? An account can let a participant confirm or revise a request;
it is not the prerequisite for retaining an otherwise permitted source observation.

The owner's interests are one input, not the whole market model. Local access, statewide supply, national buyer demand
and cultural communities can make something relevant before a person expresses an interest in it. Someone who admires
old Porsches may have a better actionable lead among nearby 1980s cars. The Utah fossils example illustrates discovery
from surrounding resources, not authorization to start a fossils collector. Keep personal taste, observed market context,
practical ability to act and financial outcomes as separate evidence families; none implies the others.

**The join rule:** a criterion references the **same property key** as the candidate claim it tests, while preserving
their different roles. A buyer's maximum mileage is a requirement, not an odometer reading; a budget is not an asking
price. A deterministic predicate compares compatible values after identity, scope, units and clocks have been checked.
Text interpretation creates attributed candidate criteria with its method/version and exact source region; it does not
turn preference into a fact about an asset. Missing vocabulary goes through `schema_proposals`, not a parallel registry.

### 0.1 Request, supply and evaluation grain

| Relationship | Required representation and boundary |
|---|---|
| Requesting actor → request episode | Existing `external_identities` for a platform handle, `organizations` for a resolved organization, or `user` where explicitly attributed. Preserve an unresolved actor; do not infer a person merge, organization role or Nuke-account ownership. |
| Source → request episode | Original source/channel, post/presentation key, source locator and retained evidence reference. Source posting/event time, capture/observation time and ingestion time are separate, with unknown precision/basis retained. Repeated captures are sightings, not independent requests. |
| Episode → criteria | Each criterion has source witness, candidate property key, operator, typed desired value/unit, required versus preferred status, scope and interpretation method/version. Keep unparsed or ambiguous requirements visible. Alternatives and negation cannot be flattened into an all-required list. |
| Episode → revision/status | A budget change, withdrawal or fulfilled request is later attributed evidence linked to the episode; supersede interpretations through sanctioned paths while preserving testimony. Absence of a later observation does not establish continued demand. |
| Candidate → claims/presentation | Vehicle identity, configuration claims and the offered presentation are separate. Preserve unresolved vehicle links, source episodes, asking-price witnesses and availability evidence. A matching historical vehicle need not be for sale now. |
| Evaluation → inputs | Request revision, candidate claim IDs, visibility context, cutoff, rules/version and all failed or unknown predicates. Changed/superseded inputs must identify affected evaluations; an earlier receipt and a recomputed current answer are separate proofs. |

This is the required contract, not a claim that these links all exist today. Request criteria, request status and match
dependencies still need an owned representation/admission design. Observations-first is the starting point; it does not
authorize arbitrary JSON to bypass vocabulary, custody, subject or visibility requirements.

### 0.2 What a match can say

Return each criterion as met, unmet, unknown or conflicting **against the admitted evidence**, with its supporting IDs
and clocks. Required criteria determine qualification; preferred criteria can order otherwise qualified candidates but
cannot silently exclude them. All required criteria must be supported and met before claiming requirements satisfied.
Any unmet required criterion disqualifies under that request version; missing or conflicting required evidence leaves
qualification unresolved. An all-unknown or empty requirement set never proves eligibility.

Distinguish three answers:

1. **Fit:** the retained claims satisfy a declared request predicate. State whether this is reported specification,
   verified current configuration or another supported scope. "Manual preferred" is not "manual required"; no rust
   observation is not evidence of rust-free condition. Different historical mileage readings need not be a conflict.
2. **Actionable availability:** the request is still open and a matching offer remains available within declared
   freshness limits, location/access constraints and known terms. A listing's disappearance is not a confirmed sale;
   an old request and an old listing cannot establish an actionable match merely by agreeing on configuration.
3. **Financial opportunity:** qualified sale comparisons, compatible condition/configuration and currency/fee basis,
   acquisition/transport/repair/selling costs, time and uncertainty support a stated economic question. Cheap asking
   price, interest or geographic proximity alone establishes neither arbitrage nor profit.

City/state/country and cultural context must name the evidence population, time window and relevant relation: local
access, regional abundance, destination demand or a source community's observed valuations, for example. Geographic
level is not a relevance score, and a community label does not establish an individual's taste. Unknown transport,
skills, capital and selling time remain unknown rather than inferred advantages.

Visibility travels with the evidence. A public vehicle does not make a private group post, personal browsing history,
identity detail or derived request public. Each output admits only source material permitted to its caller; derived
matches cannot reveal restricted source facts through quotes, scores or reasons. Public source attribution is also not
authority to contact, notify, negotiate or transact for someone. Automated outreach has its own explicit authorization.

### 0.3 Existing owners and the current missing relationships

Live atlas/reader metadata and bounded vocabulary reads on **2026-10-15 UTC** established these owners. Activity and
registry presence do not establish semantic completeness; no full-market request population or readiness count was run.

| Existing owner | Reuse and remaining boundary |
|---|---|
| `external_identities` | Canonical platform × handle identity, with account claiming separate. Cross-platform person and person/organization role resolution remain separate evidence questions. |
| `vehicle_observations` / `ingest-observation` | Canonical sourced observation path supports nonvehicle subjects, including `external_identity`. Request-episode criteria, revisions/status, source visibility and request-to-supply links are not established by that capacity alone. |
| `observation_properties` / `schema_proposals` | Existing ratified keys and curator path; no new criteria registry. Request budget, distance, condition, active request and availability semantics require their own reviewed contracts where absent. |
| `get_vehicle_specs(uuid[], boolean)` / `get_field_provenance(uuid,text)` | Existing public-parent specification and provenance readers. Bulk typed reads cover eleven core keys, capped at twenty requested vehicles; record metadata is explicitly unassayed. Provenance input-limit refusal is unknown, not an empty successful evidence set. |
| `demand_signal` | Existing aggregate entity/search-interest metric store, observed idle; not a buyer-request ledger. |
| `taste_intent_signals` | Existing user preference signals from Facebook saves; not authority to assert a nonmember's request or a vehicle fact. |
| `demand_briefs` | Existing concierge house-to-partner asks; not a replacement market-request owner. |
| `scripts/discovery/buying-evidence.mjs` | Existing bounded, private retained-evidence comparison tool and the first implementation owner below. |

The next representation gaps are request episode identity and lifecycle; typed criteria and their source regions;
per-source visibility; availability and presentation freshness; geography/access relationships; and dependencies from
each evaluation to the precise request revision and candidate claims. Their absence must produce named unknowns in
the reader, not pressure to infer eligibility, availability or financial value.

### 0.4 Bounded implementation and the improvement loop

The current implementation extends the buying-evidence operator to accept an explicitly attributed
structured request and compare **1–10 explicitly selected public candidate vehicles** through existing typed property
and provenance readers. Its private JSON/HTML output exposes criterion-by-candidate outcomes, supporting evidence,
clocks and gaps. It is a read-only comparison of retained evidence, with no paid per-record inference, request admission,
match persistence, public feed, automatic candidate enumeration, source activation or outreach. Merge, deployment and
runtime verification require their own receipts; this specification does not establish those stages or a fleet gain.

This bounded reader makes a missing relationship observable through a useful question. It is not the complete product.
The broader sequence is: prove the source-to-comparison contract; repair owned request/criteria/visibility relationships;
qualify source enumeration, lifecycle and availability; maintain evaluations from changed inputs; expose permitted
matches in existing readers; then evaluate contextual ranking and any economic claims against appropriate outcomes.
Each step needs its population, freshness rule, consumer and acceptance assay before a public-readiness claim.

For recursive improvement, retain a plausible wrong interpretation, later discriminating evidence, the same request
and candidate evaluation before/after, and an unaffected counterexample. Examples include changing a falsely required
manual transmission to a preference, or withdrawing a match when later evidence establishes a fulfilled request.
Revised inputs must invalidate affected conclusions without rewriting earlier evidence. Use separately selected held-out
requests and candidates to measure new supported answers, regressions and correction cost; one successful fixture,
schema growth or a new source does not prove general improvement. Full population and net usable coverage remain
unmeasured until the corresponding acceptance population and assay exist.

## 1. Funding case study — entities (2026-10-07 design)

The original case below is retained as a dated application of the general function: for every organization, which
programs it fits and which keys are missing. Nuke is one organization among those candidates. These proposed shapes
and historical source states are not evidence of current admission, authorization or deployment.

| Entity | Lives in | Key | Notes |
|---|---|---|---|
| **Organization** (funder, awardee, research institution, applicant) | `organizations` (commons) | canonical domain, then staged `metadata.external_keys` (UEI, DUNS) | Created by `create_organization_batch` (#810). No type column: "funder", "awardee", "institution" are projections of its relations (SPEC §0). |
| **Person** (PI, co-PI, contact) | blocked | — | No first-class person subject yet (organization-entity SPEC §1.5). Until then names stay text inside the observation; never a key. |
| **Opportunity** (a program, solicitation or topic with windows) | observation, `kind = offer`, on the funder organization | the offer observation id; source identifier = solicitation number | Observations first (SCHEMA_LAW §2). Earns its own table only when the match fold needs window and criteria predicates; that table copies the grammar. |
| **Criterion** | attributed requirement referring to the opportunity and candidate property (desired value, operator, unit, required/preferred role) | `observation_properties.property_key` plus criterion/source identity | Vocabulary grows through `add_property` proposals; a requirement is not an observed organization fact. |
| **Organization fact** | observation on the organization (same property keys) | property key + observed_at | From registries (SAM.gov entity data), award rows, the organization's own testimony. Trust T1/T2/T3. |
| **Award** (outcome) | observation, `kind = activity`, `kind_detail = funding_award`, on the funder; mirrored on the awardee | NSF award id / agency tracking number | Landed by the declared-source reader (#767). One action, two ledgers (organization SPEC §1.5). |
| **Application** (pursuit outcome) | observation, `kind = activity`, `kind_detail = funding_application`, on the applicant | applicant + opportunity + submitted_at | Status changes (pitched, invited, declined, proposed, funded) are superseding observations, never updates. Nuke's pitch is the first row. |
| **Match** | fold per (organization, opportunity, as_of) | the pair + as_of | A view first (§4: could a view do this?); a table when ranking needs it. |

## 2. Relations (claims with provenance, §13.3)

`funds` (funder → opportunity) · `awarded_to` / `awarded_by` (award ↔ awardee) · `partners_with` (awardee ↔ research
institution, the STTR edge) · `applied_to` (applicant → opportunity) · `principal_investigator_of` (person → award,
blocked) · `parent_of` (`organization_hierarchy`, existing).

## 3. The nine layers

| Layer | What it holds here |
|---|---|
| Log | award, opportunity, criterion, organization-fact and application observations, each with source, event time, ingest time, trust |
| Key | awardee, institution and funder to `organizations`; opportunity to its offer observation; person (blocked) |
| Dimension | program and phase; topic (NSF topic codes, NAICS); place (state); size band; track (SBIR, STTR) |
| Fold | per organization: awards, amounts, phases by year; per opportunity: window open or closed now; per pair: criteria met / unmet / unknown |
| Baseline | the winners' cohort per program × year × state × topic × size band |
| Residual | an organization's distance from that cohort |
| Feature | criteria coverage and residual per (organization, opportunity, as_of) |
| Prediction | P(invited), P(funded) withheld until relevant application/exposure outcomes and denominators support a calibrated evaluation; winners-only data supplies cohort context, not odds |
| Outcome | application status and awards, joined back by key and clock |

## 4. The match, exactly

For each (organization O, opportunity P, as_of t):

- **criteria_met / criteria_unmet / criteria_unknown / criteria_conflicting:** each criterion of P against qualified
  O claims on the same key, scope and units. Both event and ingestion clocks must be at or before t; a later-ingested
  historical fact was not known then. A latest value alone does not resolve an unresolved contradiction.
- **eligible:** every applicable required criterion is supported and met, with no unresolved required evidence. An
  unmet required criterion is ineligible; all-unknown and incomplete required evidence is unresolved, not eligible.
- **cohort fit:** descriptive position among past winners only for compatible measured dimensions, with its cohort,
  dates and coverage. Any percentile method requires validation; proximity to winners is not a probability of funding.
- **surface rule:** supported eligibility and an evidenced open window at t, with preferred-criteria/context ordering
  separately qualified. A request lacking complete eligibility evidence can appear as an unresolved lead with its gaps,
  never as an eligible match. A maintained pair/revision evaluation is proposed; no match fold is delivered here.

## 5. Funding sources (historical proposal states, 2026-10-07)

Refresh source/proposal state before any intake action. This list preserves the earlier design, not a current grant
of access or a claim that these approvals remain open.

| Source | Gives | State |
|---|---|---|
| SBIR.gov bulk award file | awards across 12 agencies (207,731), employees at award, institutions | proposal `8684c1c9`, open |
| NSF awards API | NSF awards with abstracts, 2024 onward | proposal `97b3c2d5`, open |
| SAM.gov entity data | UEI, size, ownership, NAICS, address: the organization facts the criteria test | next |
| Grants.gov / agency solicitations | opportunities, windows, criteria | next |
| USAspending | all federal awards | later |

## 6. Grading (point-in-time)

Replay a past window using only facts both observed and ingested before its cutoff, preserving source/criteria versions
and unresolved organizations. A declared SAM.gov population can support a covered discovery or ranking question, subject
to registry coverage and exposure limits. It is **not the application denominator**: registered nonawardees may never
have applied, and an unobserved award is not a rejection. Funding or invitation probability requires the relevant
submitted/invited applicant population, linked outcomes, censoring/missingness treatment and held-out calibration.
Until then report winners' characteristics and qualified criteria fit, not success odds. Applicant and registry
populations stay separately named and counted.

## 7. Funding implementation record and backlog (2026-10-07 snapshot)

**Exists:** the `add_source` approval path (#766); the declared-source reader (#767); the stack registry with S61 v1
(#768); the batch organization creator (#810, not run); the award history (14,796 NSF awards pulled).

**Missing, in build order:**

1. The owner's approval of the two award sources, then the landing run.
2. The organization batch for awardees and institutions (identity-origin).
3. The criteria vocabulary: `add_property` proposals for employee_count, us_ownership_pct, place_of_work,
   pi_min_hours, topic, requires_research_partner, and the rest of the solicitation's rules.
4. The opportunity as an offer observation for NSF 26-510, with its criteria.
5. SAM.gov entity facts as a source.
6. The match view, then S61 v2 keyed by (organization, program), with Nuke as one row and acceptance test.
7. The surface: on an organization page, the opportunities it fits; on an opportunity page, the organizations that fit.
