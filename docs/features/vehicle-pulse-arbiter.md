# vehicle_pulse — live-signal routing layer (implementation plan)

> Designed + adversarially verified 2026-06-22 (workflow wf_c2a17b9e-f36: 13 agents, 21 issues
> found / 15 high-crit, all folded). Migration: `supabase/migrations/20260622000000_vehicle_pulse_arbiter.sql`.
> This is the build plan for the rest; the SQL is the artifact.

## DEPLOYED STATE 2026-06-22 (read this before the spec below)

A **demo-safe core** of this design is **LIVE in prod** (project `qkgaybvrernstplzjaam`), applied via
MCP `apply_migration` for a demo and **NOT yet committed to a repo migration file** — this is known
**drift** (see `.claude/rules/production-engineering.md` Law 1; the verified full spec at
`supabase/migrations/20260622000000_vehicle_pulse_arbiter.sql` is the harder, deferred version and is
**NOT deployed**). What's live is a deliberate subset chosen to be safe to run with no live auctions and
no hot-path coupling.

### LIVE (deployed, demo-safe core)
- **Table `public.vehicle_pulse`** — one canonical row per vehicle. Columns as deployed:
  `vehicle_id (PK)`, `mode`, `headline_kind`, `headline_label`, `headline_amount`, `is_live`,
  `live_state`, `liveness`, `urgency_pulse_ms`, `ends_at`, `live_bid`, `bid_count`, `source_platform`,
  `updated_at`. (No `fade_stage`/`last_bid_at`/conflict columns yet — those belong to the deferred sweep + conflict logic.)
- **`arbitrate_vehicle_pulse(p_vehicle_id uuid) → void`** (SECURITY DEFINER, `search_path=public`).
  Reads the latest `vehicle_events` auction/listing row, computes liveness + urgency, and **upserts**
  the pulse row. Hardened invariants that DID ship: `pg_advisory_xact_lock(hashtext('vehicle_pulse:'||id))`
  (no lost update), and a **monotonic** `on conflict` fold — `live_bid=greatest(old,new)`,
  `bid_count=greatest(old,new)` (a bid never rewinds). Liveness uses a 2-second half-open grace on
  `coalesce(ended_at,sold_at)`. The arbiter is **called explicitly** in the demo — there is no trigger.
- **`get_vehicle_pulse(p_vehicle_id uuid) → vehicle_pulse`** — single-row read accessor.
- **RLS** — policy `vehicle_pulse_read` (SELECT) mirrors `vehicles` exactly:
  `is_public = true OR user_id = auth.uid() OR owner_id = auth.uid()`. A private vehicle's pulse stays dark to anon.
- **Realtime** — `vehicle_pulse` is in the `supabase_realtime` publication, so `postgres_changes` fan out.
- **Consumed by iOS** — `VehicleDetailView.swift` (`subscribePulse`/`loadPulse`/`applyPulse`, `liveAuctionBanner`,
  the `bids` storm slot in `PulseStrip`) subscribes to `vehicle_pulse` over a per-vehicle Realtime
  channel (`channel("vp-<id>").postgresChange(AnyAction.self, …, table:"vehicle_pulse",
  filter:"vehicle_id=eq.<id>")`) and **refetches the arbitrated row** on every change (it never
  reconciles raw events client-side). Countdown derives client-side from `ends_at` via `TimelineView`;
  chime + haptic fire ONLY on a real higher live bid (`is_live && live_state=='live' && bid>prev`), never on hydrate/reconnect.
- **Proven** with a **staged throwaway auction** (a synthetic live `vehicle_events` row → `arbitrate_vehicle_pulse`
  → the iOS header lit LIVE with bid + countdown + chime), then **torn down** to zero residue. No real
  testimony was used (the trust invariant: a demo never writes onto a real vehicle's record).

### GO-LIVE REMAINING (deliberately NOT deployed — would couple to the hot path / need real data)
- **The `vehicle_events` trigger** (the AFTER INSERT/UPDATE arbiter spine, scored 57 in the design). Deferred
  because it's on the ingestion hot path; the demo calls `arbitrate_vehicle_pulse` explicitly instead.
- **The `bid_events` trigger + `pulse_routing_gaps`** dark path.
- **`pg_cron` sweep** (ended-auction → `fade_stage='calming'` tick) — table has no `fade_stage` column yet.
- **`monitored_auctions.vehicle_id` backfill** — still 100% NULL in prod (0 of 800); until a producer
  backfills it (`external_auction_url → vehicle_events.source_url`), live bids can't route to a vehicle.
  **This is the gating data-producer task for a real (non-staged) live loop.**
- **Commit the deployed objects to a repo migration** to close the drift, and **wire the web consumer**
  (`loadVehicleData.ts` / `VehicleProfileContext.tsx` / `VehicleHeader.tsx`) onto the same topic SAME RELEASE
  (FIX-WEB-PARITY) — today iOS is the sole live consumer.

The rest of this file is the original design + the full hardening plan (the harder version that ships at go-live).

## What it is
ONE canonical `vehicle_pulse` row per vehicle. Many producers (BaT / C&B / Mecum / … scrapers)
write typed events into `vehicle_events` / `bid_events`; a DB-trigger arbiter folds them in-txn —
trust × freshness × liveness — into one headline the **web AND iOS subscribe to over the same
Realtime topic** (`vehicle_pulse:<id>`). The arbitration ruleset is the product; the chime is the
visible 10%.

**Architecture decision:** DB-trigger spine (scored 57 vs hybrid 52 vs edge 46). In-transaction fold
before WAL fan-out = ~0ms added; `pg_net` variance (80ms…4s) would *feel broken* on an instant bid.
Edge-function normalizer is a named **Phase-2 seam** (`supabase/functions/pulse-reconciler/`), built
only when a threshold bites (learned trust, write-storm coalescing, the routing backfill).

## The blocker for the live loop (read this first)
- **`monitored_auctions.vehicle_id` is 100% NULL in prod (0 of 800).** Live bids can't route to a
  vehicle. The `bid_events` trigger therefore **ships dark** — it logs a `pulse_routing_gaps` row,
  never a silent no-op. `vehicle_events.current_price` is the live source meanwhile.
  **Go-live = a producer backfills `monitored_auctions.vehicle_id`** (`external_auction_url →
  vehicle_events.source_url`). Data-producer task, not UI.
- **No live auctions exist now** (289 monitored rows stale, last ended 2026-02-24). The end-to-end
  proof is a **staged throwaway auction with mandatory teardown** — never real testimony.

## Build order (smallest-first, each independently verifiable)
1. **Verify RLS shape vs prod** — `select policyname, qual from pg_policies where tablename='vehicles'`;
   confirm `is_public`/`user_id`/`owner_id` (or `vehicle_user_has_access`) before the pulse policy. Repo ≠ prod.
2. **Apply migration on a branch DB** (`create_branch` → `apply_migration` → `list_migrations`). Never hand-apply to prod; deploy via `supabase-deploy.yml`.
3. **Unit-test pure fns:** `canon_platform` maps every >100-row event string to a registry slug or `unknown`; `platform_trust('bat')=(0.95,'registry')`, unknown→`(null,'unknown')`; `reserve_met_canon('reserve_not_met')=false`.
4. **Cardinal regression gate:** run `arbitrate_vehicle_pulse` over the **8,765 `reserve_not_met` rows**; assert ZERO produce `headline_label='Sold'` (RNM → High Bid, structurally). [FIX-10]
5. **Triggers + advisory lock:** concurrent two-session update → no lost update, no downward `live_bid`. [FIX-5/3]
6. **bid_events DARK path:** bid for a NULL-vid auction → a `pulse_routing_gaps` row + NO pulse. [FIX-1/9]
7. **Broadcast + RLS:** anon subscribe to a private vehicle's topic → nothing; public → the row. (channel `isPrivate:true` is load-bearing.) [FIX-RLS-LEAK]
8. **pg_cron sweep:** ended auction → one tick → `fade_stage='calming'`, `last_bid_at` unchanged. [FIX-6]
9. **iOS decodable + service helper:** `VehiclePulse`, `SupabaseService.pulseChannel(id){ isPrivate:true }`. Build clean.
10. **iOS state + loaders + storm slot:** `@State pulse/pulseChannel`, `.task subscribePulse`, `loadPulse/applyPulse/reconnectPulse`, reduced-motion gate, light the `bids` slot (already exists at `VehicleDetailView.swift:121` Kind, `:903-905` slot, `:256` loaders, `:1037` bodies, `:202` state).
11. **Staged end-to-end proof** (below) + screenshot loop (dark → live bid + countdown + chime → post-close High Bid; + reduced-motion branch; + anon-RLS).
12. **Teardown** — delete all staged rows. Zero residue.
13. **Web repoint SAME RELEASE** — point `loadVehicleData.ts:506-532`, `VehicleProfileContext.tsx:521-649`, `buildAuctionPulse.ts`, `VehicleHeader.tsx:534-563` at `vehicle_pulse` off the same topic. Do NOT ship iOS-on-pulse + web-on-events as false parity; if web can't ship same-release, declare iOS the sole consumer explicitly. [FIX-WEB-PARITY]

## iOS chime rule (motion = derivative of data)
Chime + haptic fire ONLY when `last_bid_at` advanced AND `bid_count` rose AND `live_state=='live'` —
never on hydrate / reconnect / optimistic echo, and never under `accessibilityReduceMotion`.
Countdown derives client-side from `ends_at` via `TimelineView`; static text under reduced-motion.

## Hardened invariants (the 21 fixes, in one line each that matters)
Monotonic bid/ends_at (never rewind) · advisory-lock critical section · half-open liveness grace
boundary · observation-time tiebreak (not `updated_at`) · trust null-when-undefendable (no fabricated
floor) · currency-gated headline (USD only, others → conflict) · RNM from `metadata->>'reserve_status'`
(no phantom column) · conflict hysteresis (no flap) · stale-live demotion · gap-table for unroutable
bids · private Realtime channel + per-vehicle `realtime.messages` RLS · reconnect re-hydrate (Broadcast
has no replay).
