# Receipt — Live Intake Screen (fleet burn watch)

- **Date:** 2026-06-11
- **Change type:** frontend feature + read-model RPC
- **Ask:** "a UI that enables the user to watch their images get analyzed... a screen
  that is truly filling out my timeline." Built while the fleet-wide BYOK burn
  (`scripts/daily-receipt/byok-burn-all.sh`, 43 vehicles) was running.

## Route

`/intake/live` — public route in `DomainRoutes.tsx`.

Deliberately NOT mounted at `/intake`: that route is the existing Janitor-drain
note-intake form (`pages/intake/IntakePage.tsx`) and the `login?returnUrl=/intake`
target for the logged-out homepage flow. Clobbering it would break a live public
funnel. The live screen lives beside it at `/intake/live`.

Linked from vehicle profiles via the sidebar link cluster
(`pages/vehicle-profile/InventoryWidgetLink.tsx` → "LIVE INTAKE (FLEET BURN) →"),
next to the existing per-vehicle "LIVE ANALYSIS STREAM" link.

## Files

| File | What |
|---|---|
| `nuke_frontend/src/pages/intake/LiveIntakeScreen.tsx` | The screen (new) |
| `nuke_frontend/src/routes/DomainRoutes.tsx` | `/intake/live` route (edit) |
| `nuke_frontend/src/pages/vehicle-profile/InventoryWidgetLink.tsx` | profile link (edit) |
| `supabase/migrations/20260611210500_intake_live_state_rpc.sql` | `public.intake_live_state()` RPC (new, applied to prod via psql + `NOTIFY pgrst`) |
| `docs/wiring/output/intake_screen_proof.png` | live proof shot |

## Read model

One RPC per poll (15s), no websockets: `intake_live_state(p_feed_limit, p_sessions_limit)`
returns `{fleet, analyzed_last_30m, feed, sessions_today, server_time}` in ~1.3s as anon.

- Scope = the burn queue's own WHERE: `source='user_upload' AND vision_gate_status='approved'`
  (3,702 frames / 43 vehicles at build time). Fleet-wide jsonb-marker aggregate measured
  1.4s; everything else <300ms.
- "analyzed" = `ai_scan_metadata ? 'byok_deep_analysis'` — the prepare step's skip marker.
  `last_rerun_at IS NOT NULL` undercounts (353 vs 508; pre-column verdicts), so it is used
  only for feed ordering and the 30-min rate window, where it is exact.
- PostgREST aggregates are disabled on the project (PGRST123) — hence the RPC instead of
  43×2 count queries. SECURITY DEFINER; exposure class identical to the public `/journal`
  projection (owner photos + one-line verdicts).

## Screen anatomy

- **TOP — fleet burn ticker:** totals (`ANALYZED a/t (%) · REMAINING · RATE n/30MIN · ETA`),
  ETA = remaining ÷ (analyzed_last_30m/30); per-vehicle bars approved-analyzed/approved-total,
  vehicle with a verdict in the last 15 min inverted + `● BURNING`.
- **CENTER — filling timeline:** newest-first cards: thumbnail via Supabase render API with
  `&resize=contain` (`optimizeImageUrl(url,'small')` — never bare width), DAY link →
  `/vehicle/:id/day/:date`, vehicle link, ANALYZED clock, `narrative_one_line`,
  scene/phase/intent/conf tags. New ids get a 180ms `cubic-bezier(0.16,1,0.3,1)` entry.
- **SIDE — timeline filling out:** `work_sessions` created today (LA day): session day link,
  vehicle, frame count, rollup clock, summary line.
- Design: PAPER light, Arial, 2px solid borders, zero radius/shadow/gradient, 14px content,
  9px caps chrome.

## Verification (live, burn running)

- `tsc --noEmit` 0 errors; `npm run build` clean (12.4s).
- Dev server :5174, `/intake/live`, burn PIDs live (`byok-burn-all.sh 3 15`).
- Proof shot taken through 2+ poll cycles (35s wait): between two shots the burning
  K2500 moved 17/662 → 32/662, RATE 1 → 16/30MIN, fresh frames stamped `ANALYZED 20:55:39`
  (tape-measurement verdicts on the K2500 bedside) appeared at the top of the feed, and the
  side feed showed 21 work sessions rolled up tonight (e.g. 98 frames → 2025-11-04).
- Fix loop applied after first shot: `● BURNING` tag was being truncated by the vehicle-name
  ellipsis (restructured row), and multi-day ETAs now render as `~4D 3H` instead of `~1596H`.
