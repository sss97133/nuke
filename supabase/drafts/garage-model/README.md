# Garage model drafts — NOT APPLIED

Everything under `supabase/drafts/garage-model/` is a **draft**. Nothing here is applied to any database.

## Why it is outside `supabase/migrations/`

`.github/workflows/supabase-deploy.yml` applies every new file under `supabase/migrations/**` (and deploys every changed folder under
`supabase/functions/**`) the moment it reaches `main`. A draft there would be live minutes after merge. Drafts stay here until Skylar
approves, then a single migration is moved into `supabase/migrations/` in its own commit and push (AGENTS.md "Writes and deploys").

## What is here

| File | What it is |
|---|---|
| `migrations/20261112100000_garage_core.sql` | SPEC lane. The CONTRACT tables (`garages`, `garage_sites`, `garage_members`, `garage_join_links`, `garage_vehicle_stays`, `garage_stay_evidence`, `garage_stay_assertions`) plus `garage_organizations`; constraints, indexes, `garage_role_rank`, RLS on, read-only policies, and read-function signatures. |

Real bodies: `garage_role_rank`, `garage_member_rank`, `create_garage`, `garage_record_assertion`, `garage_my_garages`,
`garage_members_read`. **Stubs** (raise `0A000`, or fail closed): `garage_now`, `garage_timeline`, `garage_stay_evidence_read`,
`garage_inbound_feed` (PRESENCE lane) and `can_see_vehicle_via_garage` (VISIBILITY lane). Join-link functions belong to the JOIN lane.
Timestamp lanes: SPEC `20261112100000-099`, PRESENCE `…100100-199`, JOIN `…100200-299`, VISIBILITY `…100300-399`.

**PRESENCE lane** (apply in this order, after the core): `migrations/20261112100100_garage_presence_signals.sql` (read-only signal layer, derivation
versions, three additive citation columns), `…100110_garage_stays_fold.sql` (`garage_stays_dry_run`, `garage_fold_stays`),
`…100120_garage_now_timeline.sql` (real bodies for `garage_now`, `garage_timeline`, `garage_stay_evidence_read`; they replace the core stubs).
`garage_inbound_feed` is still a stub. Contract: `supabase/sql/test_garage_presence.sql`
(`PG_BINDIR=/workspace/claude-swarm/pgbin bash scripts/ci/run-db-contracts.sh test_garage_presence.sql`). Backfill plan, undercount reasons and
problems found in the spec: `docs/garage-model/PRESENCE.md`.

Design, reasons and open questions: `docs/garage-model/SPEC.md`.

## How to test

```bash
PG_BINDIR=/workspace/claude-swarm/pgbin bash scripts/ci/run-db-contracts.sh test_garage_core.sql
```

`supabase/sql/test_garage_core.sql` creates an empty disposable PG17 database (`dm_refinement_garage_core`), stubs only the live tables the
draft references (`organizations`, `organization_locations`, `user_sites`, `external_identities`, `vehicles`, `auth.users`), `\ir`s the
draft migration, and checks: rank ordering, invalid role/status/relationship rejected, one live membership per person per garage,
a returning car is a second stay, a lower rank cannot overwrite a higher-rank assertion, no client can write a garage table directly,
a non-member/pending applicant/anon reads nothing, and the stubs fail loud.

Note: `run-db-contracts.sh` with no arguments runs every `test_*.sql`, so this contract will also run in CI once merged; it depends only
on this draft path existing.

## Before it can move to `supabase/migrations/`

Skylar's approval; the PRESENCE, JOIN and VISIBILITY drafts reviewed against it; `gh run list --workflow supabase-deploy.yml` idle;
one migration per commit; a live check afterwards. Applying it changes no existing table, policy or grant.
