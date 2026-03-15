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

(none)

---

## COMPLETED (Mar 14)

| Agent | Task | Completed |
|-------|------|-----------|
| Condition Encyclopedia | Full rebuild: manual ingest, knowledge extraction, taxonomy expansion, bridge v2, score-all | 2026-03-14 |
