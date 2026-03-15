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

| Agent | Task | Started | Files/Areas |
|-------|------|---------|-------------|
| BaT Ingestion Pipeline | Phase 1-6 BaT perfect ingestion — shared parser, test harness, quality gate, Tetris writes, price propagation | 2026-03-15 09:30 | _shared/batParser.ts, _shared/batUpsertWithProvenance.ts, _shared/extractionQualityGate.ts, extract-bat-core/, bat-snapshot-parser/, bat-extraction-test-harness/ |

---

## COMPLETED (Mar 15)

| Agent | Task | Completed |
|-------|------|-----------|
| Overnight Research+Build | Library expansion, description extraction, NastyZ28 scrape, BaT data processing strategy | 2026-03-15 09:15 |
| UI Debug Agent | Popups + vehicle loading investigation, search page debugging | 2026-03-15 08:19 |
| Agent Ingestion Design | Plan/measure agent-first ingestion API | 2026-03-15 09:15 |
| Data Quality Cleanup | Phase 1-6 data quality hardening — normalizeVehicle.ts, extractor wiring, batch SQL cleanup, merge guard, quality score | 2026-03-15 10:00 | _shared/normalizeVehicle.ts, import-pcarmarket-listing/, extract-gooding/, extract-barrett-jackson/, haiku-extraction-worker/, merge SQL |
| BaT Description Analysis | Analyzing deterministic extraction potential from BaT descriptions — regex vs LLM | 2026-03-15 10:00 | /tmp/bat-* analysis scripts, read-only |
