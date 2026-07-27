# Multi-Surface Brief — one read, three renderers

**Dedicated-agent handoff. Written 2026-07-27.** Same species as
`SUBSTRATE_STABILIZATION_BRIEF_2026-07-08.md`: a standing brief for an agent that owns
one problem across many sessions, not a status report.

---

## Why this agent exists

The supply side works and nothing renders it. Measured 2026-07-26/27, not estimated:

| Fact | Number |
|---|---|
| Enabled listing feeds, polling | 441 · ~70–120 feeds/hr |
| Vehicles created | ~2,400–2,900 / 24h @ 98.2% complete YMM |
| In owner's top-3 desire tiers | **~330 / day** |
| BaT comments acquired | 43,515 / day (cron 489, ~500k URLs still queued) |
| Priced events | `vehicle_events` 7,535 of 7,575 in 7d (99.5%) |
| BaT people profiled | 588,377 (99.5% of queued) |
| FB Marketplace vehicles held | 118,736 — **feed dead since 2026-07-19** |

Nothing ranks any of it, and nothing puts it in front of a user on any surface. The owner's
words, 2026-07-27: *"at what point do we start seeing novel intelligence layer based on live
data… bloomberg terminal is only possible if data is flowing reliably."* The data now flows
reliably. This agent builds the terminal.

Owner's answer on where it lands: **"ui on all versions ideally, browser, app, ios and api
access."** That sentence is the mission.

---

## Required reading, in this order — do not skip, do not skim

The failure mode this gate exists to stop is an agent inventing a parallel layer that already
exists in three places. Every doc below is load-bearing; read it before writing code.

1. **`AGENTS.md`** (repo root) — the six universal invariants. #3 DON'T MINT and #6 THE REPO
   IS NOT PROD govern almost every decision you will make here.
2. **`docs/ledger/README.md`** — capability map. The live platform is ~30 functions / ~20 hot
   tables inside a much larger dead shell. Before creating anything, run
   `node scripts/guardrails/check-capability-before-mint.mjs "<name>"`.
3. **`/Users/skylar/.worktrees/design-codex/docs/design/WEB_PARITY.md`** — **THE THREAD.**
   Ruled 2026-06-12 after the app was caught showing 766 images against a real 22,315. It is
   a screen→endpoint map plus one rule, quoted exactly:
   > The website is source of truth. The app mirrors its data, numbers, and palette.
   > No invented local data layer for anything a server endpoint already returns.
   Your job extends this map. You do not get to restate its rule in your own words.
4. **`…/design-codex/docs/design/MECH_SUIT.md`** — thesis, constraint doctrine C1–C10, how to
   work with Skylar (dialogue first, no unprompted artifacts, develop from what exists), the
   decided ledger, and what already runs. `CONSTRAINTS.md` and `PREPRODUCTION.md` sit beside it.
   (If the worktree is gone: `git show origin/fable5/design-codex:docs/design/MECH_SUIT.md`.)
5. **`docs/features/ask-nuke/THEORY.md`** — the answer grammar you must render into. Two
   rulings you cannot relitigate: a verdict is a **strike price, not yes/no**
   (*"not at $71K · interesting ~$52–55K · here is what would move it"*), and **Explore is
   already the market-read terminal** — a deal question IS a market read. Not a chat box; a
   chat bubble is a dead, undrillable surface.
6. **`.claude/rules/liveness-and-intent.md`** — unwired ≠ dead; intent is captured at an
   explicit Sign, never inferred from an ambient trigger.
7. **`nuke_frontend/CLAUDE.md`** — the web room you are working in.

Memory pointers worth loading: `feedback_develop_from_what_exists`,
`feedback_no_standalone_artifact_surfaces_for_product_data`,
`feedback_nuke_is_drillable_ontology_not_placeholder_surfaces`,
`feedback_valuation_block_when_not_defensible`.

---

## The one architectural rule

**One read. Three renderers. The read lives in Postgres.**

`WEB_PARITY` already says the app mirrors the web. Generalize it by one step: web, iOS, and
API all consume the **same RPC**, so a new surface is a rendering job and never a second
implementation of the logic. If iOS needs a number the web doesn't have, the fix is to add it
to the RPC — never to compute it in Swift.

Concretely, the shared read this agent is responsible for is a **ranked live-offers** RPC.
Its inputs already exist and must not be re-derived:

- **Identity** — `vehicles` (year/make/model), repaired 2026-07-26; 5,148 rows had corrupt
  hyphenated makes until then, so treat pre-07-26 aggregates with suspicion.
- **Price** — on the **event**, not the car. `vehicle_events.current_price / final_price /
  starting_price`, and `bat_listings.sale_price / final_bid`. `vehicles.price` is populated
  for Craigslist only (~95%) and is 0% for every auction venue. This is correct per THEORY
  ("asks and solds are opposite species") — do not "fix" it by denormalising price onto
  `vehicles`.
- **Time on market** — `first_seen` / `last_seen` / `removed_at`. A rotting ask is evidence;
  THEORY treats a firm above-band ask as a **watch**, and the rot itself as the negotiation.
- **Desire prior** — see below. Currently nowhere. This is the gap.

Existing pieces to build **on**, not beside: `get_feed_recommendations`,
`get_market_pulse_stats`, `mv_market_pulse`, `marketplace_metro_pulse` (crons 491/492 refresh
these), the 17 `api-v1-*` edge functions (the API surface already exists — `api-v1-search`,
`api-v1-comps`, `api-v1-vehicles`, `api-v1-market-trends`), `nuke_frontend`'s 97 pages
including `MarketDashboard`, `LocalDiscover`, `AuctionMarketplace`, and the HomePage
`?tab=feed`.

---

## Work, in order

### Phase 0 — land the desire prior as substrate (blocked on one owner decision)

The owner's priority order for year-based search, stated 2026-07-27 verbatim:

> "i prioritize 1963-73, 1973-80, 1981-91, top desires in general. 1992-1999, 2000-2013,
> specific cars as well as pre 1963… basically theres obvious amazing cars available in any
> year but for year based searching, its that order to prioritize."

Two things that ordering is **not**: it is not an absolute ranking (his words — "obvious
amazing cars available in any year"), and it is not a filter. It is a **prior**, in the same
sense as `feedback_album_is_prior_not_ground_truth`: it ranks when nothing better is known,
and a specific desirable car overrides it at any year. A clean flip in any year is still a
deal; his stated challenge is *"being first to the offering then to engage with it"* — so
freshness is part of rank, not a separate filter.

`market_segments` already has the shape (`slug, name, year_min, year_max, makes[],
model_keywords[], manager_type, status`) and 4 rows. It needs one nullable `priority int`.
**That is a schema change → AGENTS.md invariant #4 → ask Skylar, do not apply it.** Follow
`SCHEMA_LAW` (`lofficiel-concierge/supabase/SCHEMA_LAW.md`) and its 7-question pre-mint
checklist. Do not create a new table for this.

Boundary note for whoever writes the rows: the owner's tiers overlap at 1973 ("1963-73" and
"1973-80"). Ask; don't silently assign it.

### Phase 1 — the ranked read

One RPC returning live offers ranked by (desire prior × freshness × price-vs-band), each row
carrying its source DNA `(source, method, observed_at, trust)` per invariant #1. Every number
must be drillable to its evidence — `feedback_nuke_is_drillable_ontology_not_placeholder_surfaces`.
Where the corpus cannot defend a price, the row says **"not priced yet"** and blocks; it never
emits an honest-low guess (`feedback_valuation_block_when_not_defensible`).

### Phase 2 — render on web

Extend an existing surface. `MarketDashboard` / `LocalDiscover` / HomePage `?tab=feed` are the
candidates — pick one and improve it in place. Do not create a new page.

### Phase 3 — iOS + API parity

Add the screens to `WEB_PARITY.md`'s screen→endpoint table as you build them; that table is
the contract and it must not drift. iOS continues on **`fable5/ignition-ios`** (worktree
`.worktrees/foundation-ios`) via **fresh small PRs — never another months-open mega-PR**
(PR #278 was the lesson). API access is the same RPC behind an `api-v1-*` function.

---

## Already built — do not rebuild

- Appraisal/condition engine: built three times, all dormant. Revive per
  `docs/architecture/data/APPRAISAL_ENGINE_STATE.md`. Memory: `appraisal-engine-pickup`.
- Deal/valuation/comps organs: five build waves over 18 months. `bat_listings` is alive daily;
  `hammer_predictions` is a dormant ledger. Memory: `deal-system-pickup`.
- The artery itself (`poll-listing-feeds` → `ingest`) is healthy as of 2026-07-27. Do not
  touch it for rendering reasons.

---

## Owner decisions — surface, never make

- Any schema change, including the `market_segments.priority` column.
- Enabling **external** TestFlight. Internal testing is live via Xcode Cloud; the external
  group exists with zero builds assigned and no beta-review submission. That is deliberate,
  not a forgotten trigger.
- Deleting anything. Unwired ≠ dead.
- The 1973 tier boundary.

---

## Definition of done

`~/.claude/CLAUDE.md`'s three rules are the acceptance test, and they are not negotiable here:

1. **Never claim done from repo state.** Drive the live surface — the rendered page, the
   simulator screen, the API response — and put the screenshot or probe output in the
   claiming message.
2. **Name the surface before starting.** Every work item states where a user experiences it.
   An artifact, an essay, or a terminal dump is not a deliverable.
3. **A claim carries its measurement in the same sentence.** A new pipeline ships with its
   integrity invariant in the same session.

For iOS specifically the loop is already documented: `reference_ios_screenshot_loop` —
build → screenshot → critique, with deep-links and owner-session injection.

---

## Known-open, inherited

Tracked in `.claude/ISSUES.md`, listed here so this agent doesn't rediscover them:

- `hagerty` / `pcarmarket` feeds exceed the 150s edge ceiling; their `last_error` is
  permanently stale, so any health view keyed on it lies. Needs a per-feed item cap.
- FB pipeline is dead since 2026-07-19 and is **session-gated** — Firecrawl 403s on
  facebook.com (`extract-facebook-marketplace/index.ts:575`), so it requires the owner's
  logged-in Chrome. 3 of 5 `fb-*` launchd jobs are not loaded; 48 sweep jobs stuck "running".
- `user_profile_queue.status` is decorative — 1.16M rows read "pending" while 1,156,071 of
  them already have profiles. Real gap ≈ 2,989.
- Pre-push raw-fetch gate blocks every pusher on 4 pre-existing violations (148 vs baseline
  144). Burn down, never ratchet up.
