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
