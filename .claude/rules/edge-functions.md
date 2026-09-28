---
paths:
  - "supabase/functions/**"
---

# Edge Function Rules

## Creation
- Do NOT create new edge functions without adding to TOOLS.md first
- Confirm no existing function covers the use case
- Maximum ~50 active functions. To add one, identify one to retire.

## Imports
- Do NOT `import { createClient }` directly — use the shared pattern
- Do NOT copy-paste CORS headers — import from `_shared/cors.ts`
- Do NOT use `deno.land/std@0.168.0` — use `jsr:@supabase/functions-js/edge-runtime.d.ts`

## Cron Jobs
- Do NOT create cron jobs more frequent than every 5 minutes
- Most jobs should be 10-15 min
