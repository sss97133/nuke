# Journal Plumbing Audit — `/api/journal/:date` Returns 404

**Date**: 2026-05-24
**Scope**: Report-only, no deploy. Per Skylar 2026-05-24: "Audit the broken journal plumbing... Report only — no deploy."
**Related**: `docs/library/working/field-notes/2026-05-24_journal-page-assessment.md` (the discovering audit)

---

## The Break

`https://nuke.ag/journal/:date` loads the React shell, the shell calls `/api/journal/:date`, gets HTTP 404, renders `ERROR · fetch failed: 404`.

Root cause: `vercel.json` rewrites `/api/:path+` → `https://qkgaybvrernstplzjaam.functions.supabase.co/mailbox/:path+`. There is no `mailbox` edge function deployed. The rewrite resolves to a non-existent function.

```
nuke_frontend/src/pages/journal/JournalPage.tsx:118 → fetch(`/api/journal/${date}`)
vercel.json (catch-all rule)                       → /mailbox/journal/${date}
                                                   → 404 (function not found)
```

## The Substrate Works

Calling `mcp-connector` directly with `project_work_log` returns real, well-structured data. Best demo date verified by the audit agent: **2026-05-03 scoped to vehicle `afcfef94-895f-436b-b66c-acb2e2f46973` (1979 Chevy K10)** — 4 engine-bay teardown iPhoto photos, each carrying 4-5 atoms attributed to `claude-opus-4-7-via-byok`. The per-photo atom attribution that PROJECT_STATE.md claims is real; only the public surface plumbing is broken.

The default unscoped call returns 200 photos with BaT auction-listing scrapes whose `taken_at` got backfilled to recent dates, with zero atoms. If the API were fixed without scope filtering, users would see a junk feed.

## Three Fix Options

### Option A — narrow Vercel rewrite to existing mcp-connector
**Effort**: 1 vercel.json edit, no edge function deploy.

Add a specific rewrite *before* the catch-all:
```json
{ "source": "/api/journal/:date", "destination": "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/mcp-connector?tool=project_work_log&date=:date" }
```
Pros: zero new edge functions (honors Hard Rule #1). Reuses live infrastructure.
Cons: `mcp-connector` is a POST-only RPC harness; GET-with-query-string-as-tool-args contract is not its native shape. JournalPage's `fetch()` is a GET. Would need a wrapping function or a JournalPage code change to POST.

### Option B — ship a dedicated `journal-day` edge function
**Effort**: ~50 LOC TS, deploy, update `TOOLS.md`, retire one function per Hard Rule #1 (which function to retire?).

A thin edge function at `supabase/functions/journal-day/index.ts` that calls `project_work_log` internally and returns the `WorkLog` shape JournalPage expects.

Pros: API contract matches JournalPage exactly (no frontend change). Filterable scope server-side (mandatory per the audit — unscoped default returns junk).
Cons: Violates Hard Rule #1 unless we retire something (which?). One more function in the 50-target ceiling.

### Option C — change JournalPage to POST `/api/mcp` directly
**Effort**: ~15 LOC change in JournalPage.tsx + a request-shape adapter.

JournalPage calls `mcp-connector` via the already-wired `/api/mcp` rewrite (vercel.json:23). Skip the broken `/api/journal/:date` path entirely. The MCP harness already routes tool calls.

Pros: no new edge functions, no vercel.json changes. Aligns JournalPage with the substrate-as-projection axiom (every projection is an `mcp-connector` tool call). All future projection pages do the same.
Cons: changes a working-in-dev frontend code path. JournalPage doesn't currently know about MCP framing. ~15 LOC plus a small `callTool(name, args)` helper.

## Recommendation

**Option C — change JournalPage to POST `/api/mcp` directly.** Why:
- No new edge functions (honors Hard Rule #1).
- No vercel.json gymnastics (the `/api/mcp` rewrite is already proven).
- Codifies the substrate-as-projection pattern in the frontend (per `docs/library/technical/design-book/frontend-doctrine.md` §1 and §4): every projection page calls an MCP tool by name. Reusable for `/u/:handle/day/:date`, `/u/:handle`, every future binding.
- Cheapest reversible. If wrong, revert JournalPage to its current fetch.

## The User-Pivoted Variant Is the Real Move

Per Skylar 2026-05-24, the primary entry surface is `/u/:handle`, and the user-pivoted day view is `/u/:handle/day/:date` (per amended frontend-doctrine §3). The current `/journal/:date` is vehicle-pivoted. **Fixing the broken plumbing on a vehicle-pivoted view that the new doctrine partially deprecates is low-leverage.** The higher-leverage path: design `/u/:handle/day/:date` correctly the first time, calling `project_work_log` with a user filter (multi-vehicle), and let `/journal/:date` be a different lens binding (public unbounded or public vehicle-scoped) that gets fixed later.

If we ship Option C against the user-pivoted route directly, the broken `/journal/:date` becomes a deprecation candidate, not a fix-it task.

## Required Substrate Work (Not Done Here)

For `/u/:handle/day/:date` to render Skylar's day across multiple vehicles, `project_work_log` needs to accept either `user_id` or `(user_id, date)` as scope (in addition to `vehicle_id, date`). That's an `mcp-connector` change, not a new edge function — proposed in a separate substrate note when Skylar greenlights this path.

## Hard Rules Honored

- **Hard Rule #1** (no new edge functions without retirement): Option C adds none.
- **Hard Rule #10** (no dead feature code deployed): the broken `/api/journal/:date` path becomes a deprecation candidate; if the user-pivoted route ships and the vehicle-pivoted journal page is unused, delete JournalPage.tsx in the same PR.
- **`agent-trust-invariants.md`**: no testimony touched, no SQL writes proposed.

## Next Concrete Step (When Skylar Approves)

1. Add a `callTool(name, args)` helper at `nuke_frontend/src/lib/mcp.ts` (~20 LOC).
2. Modify `JournalPage.tsx` to call `callTool('project_work_log', { date, vehicle_id })` instead of `fetch('/api/journal/:date')`.
3. Local dev verify it renders for `2026-05-03` + K10 vehicle_id.
4. Production smoke: hit `/journal/2026-05-03?vehicle_id=afcfef94-...` after deploy.
5. Then design `/u/:handle/day/:date` as the canonical user-pivoted variant.

---

*Audit complete. No code modified. No deploys. No DDL. Awaiting Skylar's approval before any of the next steps execute.*
