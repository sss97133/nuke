# Opportunity Matching — the data model

**Status:** model, not built. **Owner direction:** case ledger `data-machine-cases.md` §13.9, §13.9.1, §13.9.2
(2026-10-07). **Reads first:** `docs/ledger/theory/data-machine.md`, `../organization-entity/SPEC.md`, SCHEMA_LAW.
**Lanes:** organizations and identities belong to identity-origin; stacks, folds and migrations to data-model.

## 0. The function

For every organization in the ledger, which opportunities it fits, how well, and which keys are missing, surfaced when
the data says so and recomputed as observations land. A funding program is the first opportunity class (NSF SBIR/STTR is
the case study); contracts, competitions and buyers are the same shape. Nuke is one organization among the rows scored.

**The one rule:** a criterion and an organization fact use the **same property key**. "At most 500 employees" on the
opportunity and "employee count 3" on the organization are both observations on `employee_count`. Matching is then a
join on property keys, not a model. (Supply-side rule: gap computation is a SQL join.)

## 1. Entities

| Entity | Lives in | Key | Notes |
|---|---|---|---|
| **Organization** (funder, awardee, research institution, applicant) | `organizations` (commons) | canonical domain, then staged `metadata.external_keys` (UEI, DUNS) | Created by `create_organization_batch` (#810). No type column: "funder", "awardee", "institution" are projections of its relations (SPEC §0). |
| **Person** (PI, co-PI, contact) | blocked | — | No first-class person subject yet (organization-entity SPEC §1.5). Until then names stay text inside the observation; never a key. |
| **Opportunity** (a program, solicitation or topic with windows) | observation, `kind = offer`, on the funder organization | the offer observation id; source identifier = solicitation number | Observations first (SCHEMA_LAW §2). Earns its own table only when the match fold needs window and criteria predicates; that table copies the grammar. |
| **Criterion** | observation on the opportunity (property key + required value, operator) | `observation_properties.property_key` | Vocabulary grows through `add_property` proposals. |
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
| Prediction | P(invited), P(funded) per pair; winners-only until a denominator exists (marked as such) |
| Outcome | application status and awards, joined back by key and clock |

## 4. The match, exactly

For each (organization O, opportunity P, as_of t):

- **criteria_met / criteria_unmet / criteria_unknown:** each criterion of P against O's latest fact on the same
  property key observed before t. Unknown is a named missing key, not a failure.
- **eligible:** no unmet criterion.
- **fit:** O's position in the cohort of P's past winners (size, state, topic, prior awards), as a percentile.
- **surface rule:** eligible, window open at t, fit above a stated threshold. A new qualifying pair is a new match row:
  that is the "natural occurrence" the owner asked for.

## 5. Sources (each through one `add_source` approval)

| Source | Gives | State |
|---|---|---|
| SBIR.gov bulk award file | awards across 12 agencies (207,731), employees at award, institutions | proposal `8684c1c9`, open |
| NSF awards API | NSF awards with abstracts, 2024 onward | proposal `97b3c2d5`, open |
| SAM.gov entity data | UEI, size, ownership, NAICS, address: the organization facts the criteria test | next |
| Grants.gov / agency solicitations | opportunities, windows, criteria | next |
| USAspending | all federal awards | later |

## 6. Grading (point-in-time)

Replay a past window: at each solicitation's open date, score every organization in the population using facts known
before it; then ask whether the actual awardees ranked above the rest. The population is the denominator (SAM.gov small
businesses), which is what turns winners-only odds into real ones.

## 7. What exists and what is missing (2026-10-07)

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
