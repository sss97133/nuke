# PLATFORM / INFRASTRUCTURE — theory card

**The model:** The platform is a registry-routed queue machine: evidence lands → a trigger enqueues → a cron'd drainer claims a batch → the registry names the owner → the owner emits cited observations → projections recompute. Nothing concludes inline; everything is enqueue → claim → dispatch → record. The dispatcher (`derive-dispatch`) is deliberately dumb — it knows nothing about titles/receipts/photos; adding a new evidence type is rows in `derivation_queue` + `observation_extractors` plus one reader fn, NEVER a change to dispatch. Labels are projections of stored measurement: store the (claim, source, time, trust) tuple, project categories at render, never bake them into schema.

**The invariant(s):**
- `pipeline_registry` owns every computed field — query it BEFORE writing any computed field; two writers to one field is corruption.
- Writes to testimony go through `ingest-observation`, never raw INSERT (a hook blocks God-mode writes). Every number carries source DNA.
- Claim before work (`claim_derivation_work` etc.) — that's what lets two workers coexist. Don't bypass claiming.
- Cron liveness: only 18 of 136 `cron.job` rows are active. An inactive cron row is NOT evidence a path is alive; check `WHERE active=true`.
- Row counts: use `count(*)`. `pg_stat` n_live_tup goes stale after stats resets.

**Canonical entrypoints:**
- System status / DB stats → `db-stats` edge fn
- Queue-health brief → `ralph-wiggum-rlm-extraction-coordinator` `{action:'brief'}`
- Derivation dispatch → `derive-dispatch` (cron */10) + `observation_extractors` registry
- Derived-field recompute → enqueue into `vehicle_{metric,completion,value,stats}_recompute_queue`; `drain_vehicle_*_queue()` per-minute crons drain
- Enqueue extraction work → insert into `import_queue`; drain = `process-import-queue`
- Site search backend → `universal-search`
- Public APIs → `api-v1-vehicles`, `api-v1-observations`, `api-v1-vision`
- Stuck-work recovery → `reset_stuck_photo_pipeline_images()` (cron */15), `queue_lock_health`, `pipeline_heartbeat()`
- Service URL resolution → `get_service_url()`; event ledger → `app_events`, `field_extraction_log`
- Market aggregate substrate → `mv_market_pulse`, `marketplace_metro_pulse`, `marketplace_velocity` (actively refreshed)

**Do NOT:** Resurrect the graveyard: the deleted ralph/agent fleet ×9, system-health-monitor, pipeline-dashboard, queue-status, data-quality-monitor, backfill-profile-stats, backfill-quality-scores, calculate-profile-completeness (undeployed), continuous-queue-processor. Never hand-roll dispatch or mint a new queue/orchestrator when a registry lane exists. Never run a "clean up missing functions" sweep — ⚠ zombies are deployed with deleted source; recover from git history. Don't write status .md files as product substrate — intelligence lands as DB rows.

**Before you build here:** Read `docs/ledger/CAPABILITY_MAP.md` first — column 2 is THE entrypoint (extend it), column 3 is the trap list. Then query `pipeline_registry` for field ownership, and `cron.job WHERE active=true` for what's actually alive. If a capability seems missing, it almost certainly exists dormant — reactivate, don't mint.
