# PRE-PRODUCTION — the "wtf are we even doing" document

*2026-06-12. The step we were sidestepping. Method: start from what exists (named
files, live RPCs, measured coverage), score it against the two big rules, then a
staged shot list that makes the existing thing great before developing it further.
No one-shotting. The emulsion harness is retired to reference material — its three
useful findings (drill grammar, develop-in texture, the 3.4MB-originals bug) are
absorbed below.*

## The two big rules (acceptance criteria for every surface)

1. **FULL IMAGE ANALYSIS** — every image is *understood*, not just displayed: vision
   atoms (what's in frame), day/site/vehicle attribution, provenance (who/what/when
   analyzed), owner intent confirmation where value rides on it.
2. **FULL END-TO-END DATA DRILLING** — from any aggregate a user can reach the
   original evidence with zero broken links: number → rows → document → testimony
   (C10). A break anywhere in the chain fails the surface.

## What exists (the standard timeline family — the thing to make great)

| Surface | Organ (file / RPC) | State today |
|---|---|---|
| User profile timeline | `UserBarcodeTimeline.tsx` + `get_user_contribution_days` + `get_user_day_receipt` day-receipt drawer | LIVE, verified on prod; **the navigation benchmark** — drill: bar → drawer (photos, sessions) → /journal/:date |
| Vehicle profile timeline | `pages/vehicle-profile/*` + `get_vehicle_contribution_days` | LIVE but broken for visitors: layout traps page under a void; day-click opens nothing significant; default window shows emptiest years |
| Journal day page | `/journal/:date` + `/api/journal/[date]` + per-day OG | LIVE as of last night (was 404 for weeks) |
| Journal index | `JournalIndex.tsx` + `vw_journal_density` 90-day grid | LIVE, unaudited against the two rules |
| Vehicle images | `vehicle_images` (59K rows / 33GB) + render endpoint | Display sloppy: grids/heroes load multi-MB originals (measured 3.4MB where 24KB render exists); no evidence rail; no analysis surfaced |
| Image analysis pipeline | BYOK harness + `process-photo-cascade` + day rollups | K5 drain **34%** (920/2,686), provenance typed on **0.3%**, intent-confirmation **0%**, pipeline idle since 06-02 |
| iOS timeline | `ProfileTab.swift` day list + day sheet (PR #278) | BUILT; plain list, not yet the same document grammar as web |

## The flow, defined once (every surface must implement this chain)

```
ENTRY (profile / vehicle / journal / map pin / share link)
  → TIMELINE (the standard one: bars/cells with counts — Shelf 0)
    → DAY DOCUMENT (drawer: photos, span, sessions, $ — Shelf 2)
      → IMAGE (full-bleed + evidence rail: taken_at · site · vehicle · atoms — Shelf 2)
        → ORIGINAL (full-res file / receipt scan / source URL — Shelf 3, the end)
```

Rule-2 audit = walk this chain on each surface and log every break.
Rule-1 audit = at the IMAGE step, is there anything intelligent to show? (Today:
usually no — 0.3% provenance. The viewer can ship before the analysis backfills, but
the rail renders whatever atoms exist — facet rule, no empty shells.)

## The shot list, staged (make it great → then develop it)

**STAGE 1 — repair the standard (in flight, branch fable5/profile-depth):**
1. Vehicle profile layout bug (visitors can't scroll) — launch gate.
2. Hero renders (render endpoint, latest owner-trust image, fallback chain).
3. Every thumbnail slot platform-wide → render endpoint; originals only at Shelf 3.
   (One sweep: grep `image_url` usages in grids/heroes.)
4. Day-click on vehicle profile = the same day-receipt drawer the user profile has
   (reuse, don't fork). Default window anchored to data density.
5. Anon paint < 3s on the K5 profile.

**STAGE 2 — complete the drill (web, after Stage 1 verifies):**
6. Image click anywhere = lightbox with evidence rail (taken_at · site · day-link ·
   vehicle · source · atoms-if-any), URL-addressable, ESC/click-out. One component,
   mounted on profile + journal + drawer.
7. /journal/:date gets the same lightbox + Shelf-3 link; journal index cells deep-link
   to day documents (audit vw_journal_density chain).
8. iOS ProfileTab day sheet renders the SAME document fields as the web drawer (it
   already calls the same RPC — parity is fields, not pixels).

**STAGE 3 — restart and surface the analysis (rule 1 becomes visible):**
9. Resume the BYOK image pipeline (idle since 06-02; 66% of K5 undrained) with typed
   provenance landing (the known crack), so the evidence rail starts filling.
10. Day documents gain the work story + $ lines where work_sessions/receipt_items
    exist (the $410-class data, owner-confirmed only).

**STAGE 4 — develop it into something better (only now does taste work return):**
11. Texture on the EXISTING bars/cells: develop-in render on first paint, grain
    density inside day cells (the emulsion material applied to the standard timeline,
    not beside it).
12. The portrait line (computed caption: N exposures · M days · biggest day · longest
    run) on profile headers — data painting the user.
13. iOS: same texture pass on ProfileTab once web grammar settles.

## What we are NOT doing

- No new timeline components, no new harness pages, no parallel navigation grammars.
- No Stage-4 polish before Stage-1/2 chains verify end-to-end on prod.
- No image surface ships without the render-endpoint rule.
