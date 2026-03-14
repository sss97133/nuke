# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## VERCEL BUILD RULE (from 2026-02-27 incident)
> When you create a new component file that another file imports, they MUST be in the same commit.

## CRON RULES (from 2026-02-27 cleanup)
> 1. NEVER create per-minute cron jobs. `*/5` minimum.
> 2. ALWAYS use `get_service_role_key_for_cron()` — NOT `current_setting()`, NOT `vault.decrypted_secrets`.
> 3. Max 2 workers per platform queue.
> 4. Check `SELECT count(*) FROM cron.job WHERE active = true;` before adding crons.

## COORDINATION RULES
- One agent per edge function at a time
- Database: no DROP, TRUNCATE, or DELETE without WHERE
- Git: descriptive commit messages, no force push to main
- Before editing a shared edge function: check this file

---

## CURRENTLY ACTIVE

- **Night shift agent** (2026-03-13 ~midnight–6am) — Vehicle profile context integration, VehicleProfile.tsx slimming, frontend cleanup. Touching: `src/pages/VehicleProfile.tsx`, `src/pages/vehicle-profile/`, `src/components/vehicle/`

- **YONO training pipeline agent** (2026-03-13 ~morning) — DONE. Autonomous daily training pipeline implemented.

- **Modal rearchitecture agent** (2026-03-13 09:30 UTC) — YONO Modal rearchitecture: batch-first, scale-to-zero. Touching: `yono/modal_batch.py`, `yono/modal_api.py`, `yono/modal_serve.py`, edge functions (yono-*), pg_cron jobs.

- **Feed rebuild agent** (2026-03-13 ~afternoon) — DONE. Brand Heartbeat + Chrome Collapse complete. Build passes.

- **Vehicle profile quality agent** (2026-03-13 ~afternoon) — Junk image filtering, source attribution, angle display, timeline fixes. Touching: `ImageGallery.tsx`, `ImageExpandedData.tsx`, `ImageLightbox.tsx`, `BarcodeTimeline.tsx`, new `resolveAngle.ts`

- **Image sessions agent** (2026-03-13 ~afternoon) — DONE. All 6 phases complete: DB schema, session detection, descriptions, narratives, YONO classifier, frontend. Committed `266bb6193`.

- **Surface mapping agent** (2026-03-13 ~evening) — DONE. Schema + backfill + pipeline + templates + NLQ all deployed.

- **Platform health remediation agent** (2026-03-13 ~late evening) — Fixing critical: listing_page_snapshots column errors, dead cron jobs, discover-from-observations 500s, release_stale_locks 400s. Then commits, index cleanup. Touching: `_shared/archiveFetch.ts`, cron jobs, DB indexes.
