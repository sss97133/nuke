# Active Agents

*Register yourself when starting. Remove yourself when done.*
*Format: `HH:MM | AGENT-NAME | task description | files/areas touched`*

---

## Currently Active (2026-03-23)

23:00 | CWTFO (Opus) | Orchestrator — triaging all uncommitted work, spinning up subagents | .claude/, DONE.md
23:01 | AGENT-1 | Apply 9 pending DB migrations | supabase/migrations/
23:01 | AGENT-2 | Deploy 9 new edge functions | supabase/functions/
23:01 | AGENT-3 | Commit all uncommitted work in logical groups | git, all untracked files
23:01 | AGENT-4 | Homepage treemap — real squarified algorithm + drill-down | nuke_frontend/src/pages/HomePage.tsx
23:01 | AGENT-5 | API perf — fix api-v1-comps 6s + db-stats 7s | supabase/functions/
23:01 | AGENT-6 | Drop unused vehicle_images indexes — recover 17GB | DB indexes

---

## Completed This Session (2026-03-23)

**PERPLEXITY-TASKS** — 6-task package from claude-code-nuke-package. All done.
- 4 RPCs: schema_stats(), source_vehicles(), make_stats(), mv_source_quality
- Garbage audit: 289K flagged, zero deleted
- VIN extraction: 11,855 promoted from conceptcarz chassis numbers
- Batch extraction: 86 vehicles enriched
