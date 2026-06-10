# Production Engineering Rules (SRE practice)

The discipline: **measure, don't guess.** Probe the live system → measure →
hypothesize → verify → fix the MEASURED bottleneck → re-measure → put the
numbers in the commit message. A fix without before/after numbers is a guess
that compiled.

## The Laws

1. **The repo is not prod.** This codebase has confirmed drift: SQL functions
   and cron jobs applied directly to the live DB that exist in no migration
   (`count_vehicles_search`, `search_vehicles_deep`, jobs applied "via
   execute_sql RPC"). Any reasoning done purely from the repo may be fiction.
   Verify the load-bearing claim against the live system before acting.

2. **Time it before you theorize.** One `curl -w "%{http_code} %{time_total}"`
   is worth an hour of code reading. Measure twice — cold AND warm — they are
   different bugs.

3. **Audit reports are hypotheses, not facts.** Agent and human audits in this
   repo have been wrong in both directions (claimed-missing things that exist,
   claimed-broken things already fixed). Verify the one claim your fix depends
   on. Everything else can stay unverified.

4. **Fix the measured bottleneck, not the plausible one.** If the profile says
   5.2s is a broken count query, do not start by refactoring the UI.

5. **Re-measure after deploy.** The fix isn't done when it merges; it's done
   when the same probe shows the new number. Put before → after in the commit.

6. **Silent failure is the house style of broken systems.** The three biggest
   stalls found here (photo pipeline, BaT ingestion, MCP attach) were all
   *silent*: catch-and-continue, 404ing cron workflows, SPA swallowing API
   routes. When adding any fire-and-forget path, also add the thing that
   notices it failing (cron drain, health check, funnel event).

## The Probe Kit

The anon key is public by design (it's shipped in the frontend bundle); find
it in `nuke_frontend/src/lib/supabase.ts` env fallbacks. Project URL:
`https://qkgaybvrernstplzjaam.supabase.co`.

```bash
# Time an edge function (run twice: cold, then warm)
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 30 \
  -X POST "$SUPA/functions/v1/universal-search" \
  -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  -H "Content-Type: application/json" -d '{"query":"porsche 911","limit":20}'

# Time a single RPC in isolation (pinpoints which piece burns the time)
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 30 \
  -X POST "$SUPA/rest/v1/rpc/<rpc_name>" \
  -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  -H "Content-Type: application/json" -d '{...args}'

# Check a domain route serves an API, not the SPA (HTML response = rewrite bug)
curl -sS https://nuke.ag/<path> | head -c 200

# Is the function even deployed? (404 = no; 401 = yes, wants auth)
curl -sS -o /dev/null -w "%{http_code}\n" "$SUPA/functions/v1/<name>"
```

## Case Law (what these rules already caught, 2026-06-10)

- **MCP "could not attach"**: server healthy; the DEPLOYED vercel.json lacked
  the /mcp + OAuth rewrites (they existed only in the root config Vercel
  ignores). Found by curling the domain, not by reading code.
- **universal-search 20s warm**: 5.2s broken count RPC (returns 0) + ~13s
  ILIKE seq scan (trigram indexes existed but as lower() expression indexes
  the query shape can't use) + 2.9s deep search on every query. Found by
  timing each RPC separately.
- **BaT ingestion dead for months**: scheduled workflow called an edge
  function that never existed — silent 404 every 6 hours.

## Drift Repair (standing task)

Until prod SQL is dumped back into the repo (`supabase db dump` of functions
+ cron jobs, committed), treat every "function doesn't exist" conclusion as
unverified. When you discover an applied-but-uncommitted object, commit its
definition or note it here.

## Fleet Rules (workflows / crons / daemons)

- **Probe before you schedule.** A workflow may only call endpoints verified
  to exist in PROD (curl it; 404 = you are scheduling a void). 9 workflows
  died of this on 2026-06-10.
- **Success = rows landed, not exit 0.** Every acquisition automation must
  check its own throughput after running (did the count move?) or it is
  theater. The pulse board (get_pipeline_pulse) is the arbiter.
- **One workflow per organ.** One-off chores are scripts run once, not
  schedules. If it won't run monthly forever, it doesn't get a cron.
- **Deploys belong to supabase-deploy.yml** — never hand-applied, never a
  new bespoke deploy workflow.
