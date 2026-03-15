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
| (none) | | |  |

---

## COMPLETED (Mar 15)

| Agent | Task | Completed |
|-------|------|-----------|
| Overnight Research+Build | Library expansion, description extraction, NastyZ28 scrape, BaT data processing strategy | 2026-03-15 09:15 |
| UI Debug Agent | Popups + vehicle loading investigation, search page debugging | 2026-03-15 08:19 |
| Agent Ingestion Design | Plan/measure agent-first ingestion API | 2026-03-15 09:15 |
| Data Quality Cleanup | Phase 1-6 data quality hardening — normalizeVehicle.ts, extractor wiring, batch SQL cleanup, merge guard, quality score | 2026-03-15 10:00 | _shared/normalizeVehicle.ts, import-pcarmarket-listing/, extract-gooding/, extract-barrett-jackson/, haiku-extraction-worker/, merge SQL |
| BaT Description Analysis | COMPLETED — deterministic extraction analysis, see /tmp/bat-deterministic-extraction-report.md | 2026-03-15 10:30 | /tmp/bat-* analysis scripts, read-only |

| GLiNER Extraction | COMPLETED — Modal GLiNER deploy for BaT NER (Layer 3) | 2026-03-15 12:30 | yono/modal_extract.py |
| Data Sanity Agent | Canonical Vehicle Identity (source_alias_mapping, canonical columns, trigger, census view) | 2026-03-15 12:48 | SQL migrations, _shared/normalizeVehicle.ts, pipeline_registry |
| Backfill+VIN+QGate | DONE — 7,697 images backfilled, 5,145 vehicles enriched, VIN decoder expanded (pre-1981 GM cars+50 modern WMIs), quality gate in 4 extractors | 2026-03-15 15:30 | refine-fb-listing, _shared/vin-decoder.ts, extract-cars-and-bids-core, ingest |
| Data-Quality-Followup | Frankenrecord detection, CL data quality, body style cleanup, inactive audit, backup verify | 2026-03-15 15:00 | SQL queries (read-only), vehicles, vehicle_events, origin_metadata |
