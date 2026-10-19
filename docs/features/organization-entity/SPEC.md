# Organization Entity — Pecking-Order Stack Spec

**Status:** draft, not launched. **Reads first:** `docs/ledger/theory/organizations-identity.md`, `docs/ledger/CAPABILITY_MAP.md` §ORGS & IDENTITY, `docs/ledger/CANONICAL_LEDGER.md` §6. **Lane:** coordinate with data-model lead.
**Feeds / fed by:** the identity-origin harvest (`../identity-origin/SPEC.md`) supplies location + buy/sell history per `external_identities` row; this stack turns that into company profiles.

## 0. The one rule that governs this stack

**Measure the evidence; project the category at render. Never bake a taxonomy into schema.** (Theory card; the deleted `classify-organization-type` fn + 7 DROPPED org tables are the graveyard.) Dealer status, "bad actor," "best platform," "participation award" — all are *projections of measured facts*, computed on read, never a stored `entity_type` or tier column. This is the same lesson as the dealer-license correction: we don't label, we prove and project.

## 1. The ambition

The **pecking order** — profile every house/platform and every professional entity on cold measured facts: volume, money moved, sell-through, geographic strength, market impact. Tier them, publish the ranking, award the winners; make non-competing entities (Pebble Beach, BaT, Goodguys, Hagerty…) compete on the record. Nobody can say today whether Hagerty wins certain regions — that gap is the product.

## 1.5 The entity model: person ⇄ organization, over time (owner, 2026-10-06)

An **organization is a business entity**; a **user is a person**. The thing that makes us different: **old systems force a choice — you are a user *or* a business. We never force it. We surface the same documented facts to the correct endpoints, and we respect the passage of time.** A person's role is read from the data, not declared.

- **A BaT handle can be a person, a business, or both — and which one shifts over time.** A common real case: someone runs their BaT page under an *organization* profile name and never enters themselves as a user — so *both* entities end up under-represented. The person with "feet in two developments, never committed to one" is not a data problem to resolve away; **it is itself a valuable, measurable data point** (role ambiguity / commitment).
- **Actions build the entity, on both ledgers.** Any documented action, by any user, in any role, at any point in time, accretes onto *both* the person's ledger and the org's ledger. "a technician (user) performed work for a shop (org)" is one action documented on two entities. The org entity *is* the accumulation of such documented actions — not a profile someone authored.
- **Legal ground truth vs. evidence signals.** The provable spine is **bank accounts, tax, titles** — watch how those operate and patterns emerge. Softer evidence: BaT's own structured "**seller is selling on behalf of**" field; consignment statements; ownership-documentation mentions in comments; "I'm representing …". These are attributed claims, accrued, each sourced.
- **Make space for the nth option.** It starts as a binary (user/business), then a third, fourth, many roles appear in the data. The schema/data model must **expand to hold them as they're revealed** (SCHEMA_LAW stable-expansion; §0 project-don't-bake). Reacting to the third/fourth option *is* how the model develops over time.

**Structural blocker (known, deferred):** this dual-ledger needs a first-class **person** subject distinct from both `user` (auth) and `external_identity` (a platform handle). The 2026-07-20 subject_type proposal explicitly deferred it — `mag_people`'s TEXT primary key makes a person "permanently inexpressible" as an observation subject — calling person-identity "a separate and larger proposal." **Skylar's vision here *is* that larger proposal.** The identity-origin harvest can proceed on `external_identity` (uuid, addressable) without it; the full person⇄org dual-ledger waits on person-identity representation.

**Scope note:** the dual-ledger *documentation mechanism* is a large build of its own, with substantial prior writing that "never graduated into the data model" (owner: "a massive massive issue"). It's a separate agent/conversation — developed *from* the existing docs, not greenfield. Parked here as the theory this stack grows toward.

## 2. This is dormant, not missing — develop, don't mint

### Operating evidence and first repair, 2026-10-10

Live reading at 2026-10-11 03:10 UTC: **5,734 organizations**, 4,540 public and
1,194 private; one organization created in seven days. The actual constraint
graph has 105 incoming foreign keys from 92 tables. This establishes structural
capacity, not operating depth. Only 303 organizations have vehicle relationships
(not every organization should); the seller cache has eight rows, last calculated
April 14. The seller rollup, seller-intelligence, classic seller queue and location
jobs are paused. Active vehicle feed polling does not prove organization monitoring.
A separate indexed reading at 03:38 UTC found 208 organizations with native
organization-attributed listing evidence; nine had rows created or extracted in
the prior 24 hours. These are data-record clocks, not proof of new business events. This is real activity, but the eight old seller caches do not
reflect it.
There are 576 legacy dealer sources with no organization keys and 76 external
organization profiles with no recorded sync. These are separate intake repair
cohorts, not permission to enable stale writers or mint guessed organizations.

The first implementation extends **compute-org-seller-stats** and
**organization_seller_stats**, rather than adding a competing organization engine.
`compute_organization_listing_activity(uuid)` folds the complete indexed retained
public-vehicle listing population, keyed by platform and exact source URL, falling back to a
native listing ID only when URL is missing. Missing identities remain unresolved
rows; conflicting parents, native IDs, outcomes, prices and currencies remain
coverage exclusions. Ended/cancelled does not mean an unsold result. A native
reserve-not-met claim can establish an unsold result. Explicit currencies stay
separate, with unknown units retained; associated vehicle prices do not establish
organization sales or corporate revenue. The source records are unchanged.

The fold excludes private/deleted vehicle parents and hidden/rejected organization
associations. The existing public profile reader admits only this explicitly scoped
qualified cache contract for a public canonical organization. Page loads read the cache, never fold the event
history. The profile retains the calculation and input extraction/creation clocks,
unknown outcomes, identity conflicts and amount coverage. This is **current retained
evidence**, not a historical point-in-time reconstruction or complete world-market
inventory. The oldest-cache candidate selector admits at most 50 indexed
organization keys per existing worker invocation. Failed folds preserve the prior
cache. No paused job is enabled by this migration.

Acceptance is executable in `supabase/sql/test_organization_listing_activity.sql`
and `scripts/test-organization-listing-activity.mjs`: populations beyond both old
client caps, repeated aliases, separate listings for one vehicle, conflicts,
unknown units, mixed currencies, known zero counters, atomic failure, concurrent
cohort isolation, private-parent gating and actual public consumer SQL. Local
tests are implementation evidence; merge, deployment and live admission still
require their own receipts.

Operating depth remains open until source binding and recurring admission feed
organization activity; attributed people/roles, organization relationships,
locations and work/service records reach their readers; and coverage, freshness,
failure retention and growth are measured per organization. Schema breadth and
a populated listing cache do not close those requirements. The person/organization
dual ledger in §1.5 retains its separate representation proposal.

### Release and recurring refresh proposal, 2026-10-11

PR #957 is deployed and its public profile reader is runtime-verified. The sanctioned
worker refreshed 208 public organization activity caches. PR #961 repaired the
selector's production timeout; its deployed `all:true` path subsequently refreshed
50 caches with zero errors. These are retained-listing folds, not proof of fresh
organization source acquisition.

The next prepared migration targets only existing job 263,
`compute-org-seller-stats-daily`: preserve its exact worker command, credentials,
`all:true` body and 120-second HTTP timeout; replace the daily cadence with one
bounded invocation every ten minutes. The worker selects at most 50 oldest caches,
skips qualified caches less than one hour old and isolates failed folds. At the
measured 208-key cohort, five successful batches cover a sweep; a two-hour freshness
target is an initial operating target, not a proven guarantee or a fleet-size promise.

Activation requires the owner's separate approval because this job is paused.
The migration rejects a changed command, job, access contract or cadence, and
reapplication cannot undo a later pause on the ten-minute cadence. All other
paused jobs remain untouched. After approval and CI deployment, verify actual
cache-clock movement over scheduled runs and HTTP response outcomes; pg_cron's
successful request enqueue alone does not prove a successful fold. Source binding,
new organization acquisition and people/relationship admission remain open.

The entity already exists and precipitates from the extraction crons:

| Layer | What exists | State |
|---|---|---|
| Orgs | `organizations` (keyed by canonical website domain; FK hub for 25+ tables) | 5,733 rows, actively written, 146/146 described |
| Identity graph | `external_identities` (platform, handle; claimable) | ~690k rows, written daily — **IS** the graph, never re-mint |
| Org↔vehicle | `organization_vehicles` | ~285k links |
| Create/enrich | `create-org-from-url` (idempotent by canonical domain; non-destructive enrich) | live (v62) |
| Seller stats | `compute-org-seller-stats` | **dormant — reactivate/extend its cron** (verify live first) |
| UI | `Organizations.tsx` /org, `OrganizationProfile.tsx` /org/:id | live; **but /org pages call 3 UNdeployed fns (silent 404s)** — fix before trusting |

**Why underdeveloped:** ~104,078 distinct BaT sellers alone are unmodeled as orgs; the seller-stats engine is dormant; classic.com's dealer index is a prod-orphan (`index-classic-com-dealer`, no source) — the org side never got fed. The identity-origin harvest is what finally feeds it.

**Do NOT** resurrect the graveyard (`classify-organization-type`, `build-identity-graph`, `ingest-org-complete`, `scrape-organization-site`, …), read dead views (`org_profiles`, `organizations_compat` — 0 refs), or hardcode any registry of shops/dealers/channels. Every one is an org row with observed provenance. Check the ledger before minting anything.

## 3. What to build (all projection + measurement on existing tables)

1. **Org performance metrics** — reactivate/extend `compute-org-seller-stats`: per org, realized sell-through, price-vs-comps, volume, cadence, geographic spread, recency. Store as measured stats with source + observed_at, not categories.
2. **Participant archetypes (render-time projection)** — the real builder / lovely occasional seller / perpetual non-closer ("participation award") / bad-actor-hidden-in-plain-sight. Computed from behavior over time keyed to identity + location. Presented as archetypes, scored on facts, never accusations (movie-tells-a-story framing).
3. **Dealer-license verification layer** — capture reported license numbers; verify against public ledger (active? corresponds to the operating business? else sub-licensed/salesman). A *finding with evidence*, projected — never a stored "is_dealer" flag.
4. **Platform/house profiles** — aggregate each source into volume/money/geo/market-impact; compute each house's take; tier + rank + award. Material includes web, live-auction video (head counts), published catalogues, print OCR (Hagerty magazine), and `classic.com/data` (cross-platform realized sales — the orphaned index is the unfinished node).
5. **Location** comes from the identity-origin harvest (`external_identities.metadata.location`, buyer-home) — distinct from `top_purchase_locations` (car-location).

## 4. Sequencing

Gated on the identity-origin harvest feeding `external_identities` + buyer-keys. Order: (1) verify-live the dormant seller-stats engine + the /org undeployed-fn 404s; (2) performance metrics; (3) archetype + platform projections; (4) dealer-license verification; (5) publish/award surface. Budget-gated, live-first, same as identity-origin §11.

## 5. Open questions (owner / lead)

- Reactivate `compute-org-seller-stats` cron, or supersede it? (verify its live state first)
- The 3 UNdeployed fns the /org pages call — deploy or retire?
- `index-classic-com-dealer` orphan — revive classic.com intake (throttled) or leave for later?
