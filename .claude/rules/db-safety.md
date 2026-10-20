---
paths:
  - "supabase/migrations/**"
  - "supabase/functions/**"
  - "scripts/**/*.sql"
---

# Database Safety Rules

## Statement Timeout
- NEVER raise `statement_timeout`; narrow the query instead
- Role defaults, read from `pg_roles` on 2026-10-14: postgres=10s (`idle_in_transaction_session_timeout` 15s),
  anon=15s, authenticated=15s, authenticator=60s (`lock_timeout` 8s). `scripts/data/q.sh` runs as postgres.

## Batched Writes
- NEVER run unbounded UPDATE/DELETE on vehicles, vehicle_images, import_queue
- Batch in 1,000-row chunks with `pg_sleep(0.1)` between batches
- Single statements over 60s must be batched

## Lock Awareness
- After EVERY SQL write: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`
- If > 0, you caused a lock cascade. Stop and investigate.
- Before DDL: `SELECT count(*) FROM pg_stat_activity WHERE state='active' AND query ILIKE '%tablename%';` — if > 2, WAIT

## PostgREST
- If you break PostgREST (PGRST002): `NOTIFY pgrst, 'reload schema';`
- No DDL while long UPDATE is running — causes AccessExclusive lock cascades

## Duplicate Queries
- Before `count(*)` or heavy SELECTs: `SELECT left(query,80) FROM pg_stat_activity WHERE state='active' AND pid != pg_backend_pid();`

## Testimony
Testimony is the rows that record what was observed, by whom, from what source and when:
`vehicle_events`, `vehicle_observations`, `vehicle_images`, `auction_comments`, `vehicle_timeline`,
`merge_proposals`, `merge_deleted_rows`, `observation_discoveries`, `comment_discoveries` and
`description_discoveries`.
- NEVER `DELETE` or `TRUNCATE` them, and never `UPDATE` a value in place. Supersede: set `is_superseded`,
  write the new row, point `superseded_by` at it.
- ANY cleanup of misattributed data goes through `unmerge_vehicle()` or `reattribute_observation()`. If neither
  fits the case, stop and report it; do not improvise with DELETE, and do not delete when a stub-creation
  path is blocked (fix the trigger instead).
- Call `merge_into_primary()` only with an approved `merge_proposals` row (`status = 'approved'`,
  `ai_decision = 'merge'`).
- Keep `merged_from_vehicle_id` populated on anything moved across vehicles.
- Why: on 2026-05-01 an agent deleted a wrongly merged auction event instead of relinking it to a stub vehicle,
  and orphaned a real vehicle's history for good. Background: `docs/library/intellectual/contemplations/the-trust-invariant.md`.
- The image evidence store is testimony too: `image_vehicle_candidates`, `image_capture_time_claims`,
  `evidence_links`, `evidence_account_entities`, `vehicle_change_claims`, `vehicle_change_claim_support`,
  `user_day_vehicle_context` and `evidence_decisions`. Their rows are written only by the evidence writers named in
  AGENTS.md "Row writes", called as top-level PostgREST RPC; triggers fired ALWAYS refuse anything else. They are never
  updated in place: a newer row supersedes an older one with the `superseded_by` / `superseded_at` stamp (these tables
  have no `is_superseded`), and `evidence_decisions` is append-only (a later decision wins).
- `evidence_runs` is the store's run log. A run's kind, config and scope never change; only `evidence_close_run`
  closes a running run, once, setting its close columns. The owner's stored answers (`review_answers` runs) are written
  closed, so the guard refuses any later change to them; a review sheet (`review` run) keeps the rows and targets it was
  written with.
- No agent uses or obtains an owner session (his JWT, cookies, a signed-in browser) to record a decision. Owner
  decisions come only from his own step-up (aal2) session; agents transcribe his chat answers through the agent channel
  (`evidence_record_answers`, then `decide_evidence` citing the stored answer).
- A data-only restore of these tables is a reviewed migration written for that restore, in one transaction: drop the 27
  guard triggers, load the rows, recreate the triggers `ENABLE ALWAYS` exactly as
  `20261021220000_image_evidence_tables.sql` does, and check that all 27 fire ALWAYS. Never `DISABLE TRIGGER`.

## Grants, policies and public reads
- A migration that revokes or narrows a grant or policy on a table the public site reads (`vehicle_images`, `vehicles`, `vehicle_events` ...) is not done at "tests pass". Before it merges, grep every consumer: PostgREST filters and computed-column functions that take the whole row (`vehicle_image_gallery_eligible`), `select=*`, joins and RLS policies in other tables. A whole-row reference needs every column, so column grants break it.
- Every public reader (a SECURITY DEFINER function anon can execute, or a view anon can select) states the whole
  visibility test on `vehicles` itself: `is_public = true AND deleted_at IS NULL` (and `listing_kind` when it lists
  vehicles). A filter on `is_public` alone served 298 deleted ghost rows as a make's inventory (2026-10-20,
  `search_vehicles_browse`, fixed in #2345); a matview folded without the test publishes them nightly.
- After it deploys, run `node scripts/ci/logged-out-live.mjs` (also runs on every deploy and every 30 minutes, and opens an issue named "Live site broken for logged-out visitors"). Say "live" only with its output.
- Why: 2026-10-19, #2293 limited anon to column grants; every logged-out gallery failed with 42501 for hours while every check was green. Fixed by #2320 / #2322; the live check is #2323.
