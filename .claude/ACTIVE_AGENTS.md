# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## CURRENTLY ACTIVE

*(Empty — add your entry here when starting work)*

Format:
```
### [Task Name] — ACTIVE [DATE TIME]
- **Task**: What you're doing (1-2 sentences)
- **Touching**: Which files / edge functions / areas
```

Remove your entry when done. Add results to DONE.md.

---

## COORDINATION RULES

- One agent per edge function at a time
- Database: no DROP, TRUNCATE, or DELETE without WHERE
- Git: descriptive commit messages, no force push to main
- Before editing a shared edge function: check this file

---

## COMPLETED THIS WEEK (reference)

### Agent Safety & Pipeline Documentation — COMPLETED 2026-02-25
- TOOLS.md, pipeline_registry (63 entries), column comments (86), CHECK constraints (6 columns)
- release_stale_locks() + queue_lock_health view + hourly cron job 188
- Released 375 stuck records on deploy (367 vehicle_images since Dec 2025)

### Cars & Bids Extractor Rewrite — COMPLETED 2026-02-25
- extract-cars-and-bids-core: direct HTML parsing, cache-first markdown, all fields, sale_price fix

### FB Marketplace Sprint — COMPLETED 2026-02-25
- HTML fallback, residential-IP scraper, seller blocklist, refine-fb-listing (og: tags + bingbot fetch)
- Discovery gap fixed, CL private-seller filter

### Nuke.ag + Rebrand — COMPLETED 2026-02-24
- Marque → Nuke complete, nuke.ag live, /offering dynamic investor page, contact inbox

### Acquisition Pipeline — COMPLETED 2026-02-19
- Market proof page, CL discovery, batch processing, acquisition dashboard
