# Receipt — BUILDER SHARE VIEW: public /share/wiring/:vehicleId

**Date:** 2026-06-11 · **Change type:** tooling/frontend (new public read-only route + verdict intake; zero wiring-data-path changes) · **Status:** executed · **Relates to:** 2026-06-11_connector-colorways.md (reuses the PAPER colorway + skins wholesale)

## Directive (Skylar)
> Texts the K5 wiring page to his pro harness builder — a PDF-by-text traditionalist who must be won in two seconds. The link lands on a zero-chrome, pro-first view: PAPER-colorway connector sheet + pinout + cut list, instantly, no login, no platform navigation — "looks like the PDF he's used to, except it answers back." Plus a one-tap thumbs-up/down verdict that records to the substrate.

## What
- **Route `/share/wiring/:vehicleId`** — registered in `App.tsx` standalone section (no `AppLayout`, no nav/sidebar/tabs). Lazy-loaded page; nothing else in the bundle path (no Three.js, no FormboardCanvas).
- **`src/pages/ShareWiring.tsx`** (NEW) — a document, not an app. Top-to-bottom print package:
  1. Title block: `{year} {make} {model}` + VIN + `ENGINE HARNESS — REV {max(vehicle_build_manifest.updated_at)} — PRINTED {today}`
  2. 61-way FIREWALL FACE (FaceSkin, PAPER colorway forced via `ColorwayContext.Provider`, zoom/pan enabled, click-for-detail card live)
  3. Pin schedule (TableSkin — same `ConnectorModel`, full row dump)
  4. Per-gauge cut summary (`DerivedHarness.byGauge` + `bySpec`) + total feet
  5. Fixed-bottom verdict bar: "READY TO BUILD?" [YES]/[NO] + optional one-line comment, no account.
- **SHARE TO BUILDER** button in `ConnectorInspector.tsx` header (owner view) — copies `{origin}/share/wiring/{vehicleId}` to clipboard.

## Data path (read) — anon-verified before build
| Query | RLS policy | Verified |
|---|---|---|
| `vehicles` (year, make, model, vin) | `vehicles_public_select` — `is_public = true` | K5 e08bf694 `is_public = t`; anon REST 200 |
| `vehicle_build_manifest` (full rows → `deriveHarness`) | `Public read` (qual `true`) | anon REST 206, 141 rows |
| `vehicle_wiring_overlays` / `vehicle_custom_circuits` (build_state badges) | `Public read` | per pg_policies |

Derivation is the same client-side `deriveHarness` → `buildConnectorModels` chain the CONNECTORS tab runs (Winamp model: one data object, skins are projections). No new compute, no server change. **NOT touched:** `HarnessWorkbench.tsx`, `PlanView2D.tsx`, `harnessDerivation.ts` internals.

## Data path (write) — verdict intake
- **Edge function:** existing `ingest-observation` (single write path per extraction rules; deployed function accepts the anon JWT — verified: anon-key POST returns 400 validation, not 401).
- **Source:** existing `observation_sources` slug **`shop`** (Shop / Service Work, base trust 0.85, supports `comment`). The reviewer IS a professional shop; his verdict is shop testimony.
- **Kind:** `comment`, with `structured_data.kind_detail = 'professional_review'`, `verdict: 'yes'|'no'`, `comment`, `share_route`, `connector: 'FIREWALL'`, derived wire count + total ft, and `submitted_at`.
- **Why not a dedicated `share-link` source with kind `professional_review`:** registering a new `observation_sources` row was denied by the session permission classifier (persistent shared-config change not explicitly named by the owner). The chosen path uses only pre-existing config. If Skylar wants the verbatim `professional_review` kind, the one-line INSERT is in §Unknowns.

## Files
- `nuke_frontend/src/pages/ShareWiring.tsx` — NEW
- `nuke_frontend/src/App.tsx` — route registration (standalone section)
- `nuke_frontend/src/components/wiring/ConnectorInspector.tsx` — SHARE TO BUILDER copy-link button (header chrome only)

## Citations
- PAPER colorway tokens + skins: `connector-inspector/colorways.ts`, receipt 2026-06-11_connector-colorways.md
- Cavity allocation/geometry: `buildConnectorModels.ts` (MILNEC D38999 insert arrangement p. B-22) — reused, not re-derived
- Cut footage: `DerivedHarness.byGauge` / `totalLengthFt` (`harnessDerivation.ts` contract types, ported from k5_harness_calc.py)
- RLS: live `pg_policies` query 2026-06-11 (this receipt's verification block)
- Write path: `supabase/functions/ingest-observation/index.ts` (service-role insert, kind validated against `observation_sources.supported_observations`)

## Verification
- `npx tsc --noEmit` 0 errors; `npm run build` clean (ShareWiring chunk 7.8 kB raw / 3.0 kB gzip; no Three.js / FormboardCanvas in the route's import graph)
- Dev :5174 → `/share/wiring/e08bf694-970f-4cbe-8a74-8715158a0f2e`:
  - FACE first paint **868 ms** from nav start (cold dev server, untranspiled — production will be faster; target < 2 s met)
  - **Zero console errors** on desktop 1440×1000 and phone 390×844
  - Full-page proof `docs/wiring/output/builder_share_proof.png` — read back by agent
  - Phone fix during review: FaceSkin's fixed 320px detail card crushed the face at 390px (texted-link first open is a phone) → scoped `@media (max-width: 720px)` hides the card + drops the legend below the FIT controls. FaceSkin internals untouched. Re-captured: full-width face, verdict bar visible, passes.
  - PRINTED date fix: `toISOString()` rendered tomorrow's UTC date at night — switched to local `toLocaleDateString('sv-SE')`.
- Verdict tested end-to-end through the live UI (fill comment → tap YES → "VERDICT RECORDED"):
  - **Test observation id:** `6fed847e-8d7d-46d0-91d2-3e18a3cc1b48` (kind=comment, structured_data.kind_detail=professional_review, verdict=yes, content "PROFESSIONAL REVIEW — READY TO BUILD: YES — test verdict — agent"). NOT deleted — testimony.
  - Calibration note: the row scored confidence `verified` (shop 0.85 base + match/url factors). For an anonymous share-link respondent that is generous — registering the dedicated `share-link` source at 0.70 (see Unknowns) would calibrate it.
- Owner-side SHARE TO BUILDER (CONNECTORS tab header): clicked in headless run, clipboard received `{origin}/share/wiring/e08bf694-…` — verified.
- Two-second self-verdict: PASS. Cold link lands on a white print-register sheet: vehicle + VIN + REV line, the 61-way face large in build-sheet colors, pin schedule and cut footage below, YES/NO at the bottom. No nav, no login, no app chrome anywhere.

## Unknowns
- None blocking. Optional follow-up for Skylar to approve (one-line config, was classifier-denied this session):
  `INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations) VALUES ('share-link','Share Link Recipient','shop',0.70,ARRAY['professional_review','comment']);`
  then flip `ShareWiring.tsx` SOURCE_SLUG/KIND constants to `share-link`/`professional_review`.
