# Partner onboarding & the asset backbone

Status: **drift reconciliation in progress.** This document is the north star for
turning the partner-onboarding idea ("nuke is the engine, partners plug in via an
agent") into committed, reviewable infrastructure. Read the drift section first —
it changes what "build the gate" means.

## The premise

nuke is the engine. Partner-facing brands (l'Officiel Concierge, etc.) are
*clients* of that engine, not forks of it. Partners — restaurants, villa rentals,
fashion retail, groups — onboard by connecting a channel (Shopify, Square, CSV, …).
An agent running on the **partner's** side authenticates, honors their `mandate`
and `consent`, and emits **cited observations** into nuke's schema. It never writes
canonical values directly; the provenance projection decides truth. Partners
contribute *claims*, nuke owns *facts*.

Every entity — vehicle, villa, retail SKU, org-held asset — is an `asset` with an
`asset_type`. The vehicle stack (`vehicles`, `vehicle_observations` @ 7.5M rows) is
the **reference implementation**, not the center of gravity. New verticals get the
same spine (`assets` + `asset_observations` + source-trust + provenance), only as
much type-specific extension as they actually need.

## Drift: the repo is not prod (Law #1)

The partner pipe and the polymorphic observation substrate **already exist in the
live database and were never committed**. Verified against project
`qkgaybvrernstplzjaam` on 2026-07-03; confirmed absent from the repo (zero CREATE
statements, zero references).

Applied-but-uncommitted objects, now captured in
`supabase/migrations/20260703120000_capture_concierge_partner_pipe_drift.sql`:

| Object | Prod state | Notes |
|---|---|---|
| `concierge_partner_connections` | 5 rows | `mandate ∈ {display,quote,sell}`, `access_tier_default ∈ {public,member,gated}`, `channel ∈ {shopify,square,lightspeed,woocommerce,csv,manual,api}` |
| `concierge_partner_invitations` | 3 rows | token-hash invites, 14-day expiry, redeem → connection |
| `concierge_partner_sync_runs` | 7 rows | funnel telemetry: `items_seen / items_landed / items_superseded` |
| `asset_observations` | 0 rows | polymorphic twin of `vehicle_observations`, FK → `assets(id)` |

All four have **RLS enabled with no policies** (deny-all except service_role). The
capture preserves that exactly. Explicit org-scoped policies are deliberate future
work — do not open these tables without designing the policies.

### Still-drifted, not yet captured (next commits)
- **Deployed edge functions** `concierge-ground`, `concierge-house`,
  `concierge-partner`, `concierge-partner-invite` exist in prod but not in the repo.
  Their source must be pulled (`get_edge_function`) before the gate is built on top
  of them — building blind would duplicate or break the live sync.
- **Partial drift** to diff prod-vs-repo: `assets` (prod has `garment_id` /
  `publication_id` columns), `ingestion_ledger`, `vfc_changesets`, `org_assets`,
  `contract_assets`, `existence_tier_staging` (vehicle-keyed; needs generalizing).

## The choke (why this matters)

The pipe is plumbed and has fired (5 connections, 7 sync runs). The **governance
gate is empty**: `ingestion_ledger` (0 rows), `vfc_changesets` (0), no PII/volatile
classifier anywhere. Partner data can arrive with no validation funnel, no
attribution guarantee, no personal/volatile filter. Mass-onboarding into that is
the failure mode. The gate is the product.

## Build sequence (safe order)

1. **Capture drift** so the repo reflects reality — *this PR* (tables) + follow-up
   (edge-function source, partial-drift diffs). Nothing new is designed until the
   ground is real.
2. **Backbone**: promote `assets` + `asset_observations` to load-bearing; express
   villa / retail as `asset_type`s with thin extension tables; generalize
   `existence_tier_staging` and provenance off `vehicle_id` → `subject`.
3. **Gate**: wire `ingestion_ledger` (received → ingested → validated → failed) +
   a PII/volatile classifier + source-trust scoring, sitting between partner sync
   and `asset_observations`. Reuse `_shared/observationWriter.ts`,
   `_shared/apiKeyAuth.ts`, `_shared/extractionQualityGate.ts`.
4. **Partner-agent harness**: MCP tool surface (`list_missing_fields`,
   `submit_observation`, `get_confidence`) + the agent rulebook (emit cited
   observations only; never canonical writes; refuse personal/volatile; honor
   `mandate`/`consent`). Runs on the partner's own Claude seat — their raw data
   stays behind their credential; only emitted observations cross the boundary.
5. **Scale invites** only after 2–4 exist. The 5 live connections are a pilot; a
   hundred is a flood.

## Deploy note

All schema changes land as migrations under `supabase/migrations/` and deploy via
`supabase-deploy.yml` — never hand-applied. That discipline is exactly what the
drift above violated.
