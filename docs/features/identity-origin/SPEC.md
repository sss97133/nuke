# Identity-Origin Harvest — Stack Spec

**Status:** draft, not launched. **Lane:** proposed, coordinate with data-model lead (owns `external_identities`, `bat_identity_stats_v1` writers).
**Stacks served:** demand-origin (buyer-migration maps) + seller/partner legitimacy — case ledger §13.2.

## 1. The stack, drilled

One member page per person yields **location + full buy/sell history**. From that one raw grain, two computed products:

- **Demand-origin** (buyers): where the bidding money comes from, per live lot / cohort. State-level map.
- **Seller legitimacy** (sellers/partners): sell-through, price-vs-comps, cadence, by location → over/under-performer map and a trust profile.

Subject of the harvest is the **identity (person)**, not "bidder" — both roles fall out of one build.

**Why BaT first:** we model *our own* organizational/data structure from the market structure BaT openly publishes. BaT is the richest free public source of a working marketplace's identity graph; learning its shape (who participates, who closes, how demand moves) is how we build Nuke's structure for ourselves — the template, not the destination.

## 2. Why now: the hole

Scaffolding exists, empty:

| Thing | State (measured 2026-10-06) |
|---|---|
| `bat_identity_stats_v1` purchase/location fields | **a VIEW**, not storage — computes `purchases_count`/`total_spend_usd` from `bat_listings` (sold, keyed by `buyer_external_identity_id`) and `top_purchase_locations` from the **vehicle's** `listing_location` (the car's location, *not* the buyer's home). Empty because its **inputs** are missing: buyer keys (skylar-64's lane) + bat_listings coverage. Not unwired scaffolding — unfed. |
| `external_identities.metadata` location | **457 of 690k** (all seller-sourced), **1 of 1,882** live-lot bidders |
| `auction_events.seller_location` | **2.1%** (5,461 of 256,896 BaT lots; 104,078 distinct sellers) |
| `scrape-bat-profiles.js` | exists, **sellers only**, regex, never scheduled |
| `extract-bat-profile-vehicles` (edge fn) | exists, parses `__INITIAL_STATE__`, **never run across the identity set** |

A whole stack stalled on one empty layer. This spec wires it.

## 3. Platform scope (recon 2026-10-06)

**Correction (owner):** BaT is not the *only* platform — it's the only one that *consistently* publishes the exact field. Location is **multi-evidence**, recoverable elsewhere by investigation, not just read off a member field:
- **The member/profile field** where it exists (BaT).
- **Image + lighting/EXIF analysis** — source a location even when the seller doesn't state one (route through the iOS VisionEngine gate, never a parallel rulebook).
- **Comment mining** — "do you ship to [place]?" / "I'm in [place]" tells where a commenter is (a *closer* near a place has a reason). **Measured (comment-geo, 20k TABLESAMPLE):** a *supplement, not a replacement* — ~150k raw phrase matches corpuswide, but only ~15–20% reveal the commenter's *own* location (the rest is the car's/dealer's location or noise like "I'm in shock"); **~5–10k usable comments** on first-person phrasing, a few thousand distinct people before the bidder filter. Needs a 3-step extraction: (1) tight first-person regex prefilter over non-bid comments from identities that also have `comment_type='bid'` rows (self-join, 99.9% have `external_identity_id`); (2) a model pass (Jev/TypeSafe) returning `{place, whose: commenter|car|dealer|other, confidence}`; (3) keep `whose='commenter'` above threshold, store with the source comment id as an identity-subject observation. Cheap, but build it *small and after* the member-page harvest, which is the primary signal.
- **Absence is itself signal** — a platform that hides this tells us something about that platform. We profile what each one does and doesn't expose.

So the table below is "where the field is handed to us free," not the limit of what's knowable:

| Platform | Bidder handles | Bidder location | Build |
|---|---|---|---|
| **BaT** | yes | yes (member page) | **demand map — this spec** |
| Hagerty | yes (clean JSON) | unknown — profile-page URL 404s, feature-flag on | pending a browser check |
| PCARMARKET | yes (HTML) | no | handles only |
| Cars & Bids | Cloudflare-walled | ? | needs browser pass |
| eBay Motors | masked `a***b` | no | dead end |
| Mecum | no (live floor) | no, robots forbids | dead end |

Seller-legitimacy needs **no bidder location** — it runs on realized outcomes we already ingest from every platform. That's the cross-platform half and is a separate computed layer, not blocked on this harvest.

## 4. Architecture (data-machine shape: log → state)

Per the writer path confirmed by the data-model lead:

1. **Read** — extend `extract-bat-profile-vehicles` (keeps handle case, already fetches member pages, parses the embedded JSON). Do **not** mint a parallel fetcher.
2. **Log — RESOLVED (data-model lead), split in two on existing structures:**
   - **The fetch = a page receipt.** Land in `listing_page_snapshots`: `platform='bat'`, `listing_url=` member URL, `fetched_at`, `http_status`, `html_sha256`, `content_length`, `success`, `fetch_method='firecrawl'`, `metadata={page_type:'bat_member'}`. **`html`/`markdown` left NULL** — receipt only; the DB indexes BaT's public data, never copies it. (Verified: the table has no `kind` column — page type goes in `metadata` — and it *can* store body, which we deliberately don't. No schema proposal needed here.)
   - **The facts = observations about the person.** Extend `vehicle_observations.subject_type` CHECK with `'external_identity'` via a **`schema_proposals` row (add_value)**; write via `ingest-observation` with `subjectType='external_identity'`, `subjectId=external_identities.id`, `source=` the snapshot receipt id, `observedAt=` fetch time, trust per the house table. Facts logged: location (state/country), and each purchased/listed lot. Never log identity facts against the lot vehicle — the fact is about the person (user stacks, case ledger §13.3, need identity-subject observations anyway).
   - **Masking:** check `observation_is_public()` + the `vehicle_observations` read policy for the new subject before merge — identity location is public **only at state/country grain, never a street**.
3. **State** — one bounded SQL function (`set_config('app.writer',…)` in the *body* — the deploy role can't set a custom GUC in the header), writes location to:
   - `external_identities.metadata` — jsonb **merge** (`metadata || new`, e.g. `{location:{state,country,source:'bat_member_page',observed_at}}`), never replace, never touch `platform`/`handle` (keeps it off the lead's live key-backfill). Pre-approved path.
   - **Do not write `bat_identity_stats_v1` — it's a view.** Instead *feed its inputs*: emit "this identity bought lot `<url>`" as **identity-subject observations** (lot URL + member page as source). The Keys lane keys `bat_listings.buyer_external_identity_id` from them under the #705 rule (exact match, not contradicted by the lot's own comments, + receipt) — we never write `bat_listings` directly. The view then yields `purchases_count`/`total_spend_usd`. Its `top_purchase_locations` is car-location, not buyer-home; buyer-home is the new `external_identities.metadata.location` signal.
   Each computed field gets a `pipeline_registry` row; each run writes a `write_receipts` row; PG17 contract, same shape as #705.
4. **Pre-work:** check `pipeline_registry` for existing rows on these tables first; add a `LANES.md` row before pushing; hand the lead the PR number for the deploy slot.

## 5. Fetch & cost

**Firecrawl is already set up** — `FIRECRAWL_API_KEY` present, `archiveFetch({ useFirecrawl: true })` wrapper, `enrich-firecrawl.yml`, cost tracking (`FIRECRAWL_COST_CENTS`). **Reuse that wrapper**, don't mint a fetcher and don't call the API raw (the CI raw-fetch ratchet, #677, and the cost-tracking both live in the wrapper path). Member pages are not Cloudflare-walled (plain fetch returns 200 with the JSON) → 1 credit/page.

**Posture (owner 2026-10-06): live-first, throttle, blast later.**
- **Phase 1 + ongoing live capture run on the existing monthly plan** (owner: ~100k credits/mo). ~1,882 pages for the current board is a rounding error; ongoing live ingestion fits easily. **No new spend.**
- **Tune for *full* ingestion, then throttle down** until the day we go full blast. Prioritize catching **live** lots and **new members** (§5b); the backfill is what paying buys, not the live signal.
- **The 690k backfill is a deliberate one-time "go full blast" button** (one-month Scale burst, ~$599) — pulled only at a proven-return moment (e.g. an important meeting / a known payoff), never speculatively. Also: ask Firecrawl for free credits, and buy extra credits à la carte before escalating the plan.

### 5b. Never miss a new member (continuous capture)

New BaT members are a first-class signal, not a backfill afterthought.
- Member pages expose **join month/year** → capture it on every read.
- A standing pass watches for **handles we've never seen** (new bidders/commenters on live lots) and reads their page at once, so we see new users enter close to real time.
- Computed layer: **speed-to-market-entry**, and **closer-conversion** — which user types and which early activities predict a member becoming a *closer* (one who actually buys/sells), vs. a watcher who never transacts.

## 6. Phasing

1. **Phase 1 — active bidders on live lots (~1,882).** Soonest-closing first. ~hours. Lights up a real demand map on current auctions; refreshes as lots open.
2. **Phase 2 — backfill 690k** behind it at a bounded idle rate.
3. **Phase 3 — seller-legitimacy computed layer** on the same observations (+ realized outcomes), cross-platform.

## 7. Surface

State-level choropleth / dot map on the vehicle + cohort page. Coverage labeled honestly (`mapped N of M bidders`). Granularity = state + country, dense for repeat buyers (the serious money), blank for one-time lurkers — that sparsity is truthful, not a defect.

## 9. Participant typing (the computed payoff)

Demand geography is the **#1 interest**. Sellers are a **discovery layer** — a lone seller means little until joins accrue (repeat volume, sell-through, geography, comment/image evidence) that say whether they're a one-off or a real opportunity in their area. The types to separate:
- **The real builder** — cool, often low-volume, middle-of-nowhere, builds genuinely good vehicles. We like them.
- **Low-volume occasional private seller** — not professional, wonderful. We like them.
- **Perpetual bidders who never buy** — constant bids, no closes. A named behavior class.
- **Peddlers / pushers / phonies — bad actors hidden in plain sight.** The ones to watch out for; identifying them is a core job.

**"Partner" ≠ dealer. Never infer it.** BaT's "Partner" label means *partner* — nothing more. Dealer status is **provable only by a dealer license number** (often reported in the auction listing), and the number alone is not enough:
1. Capture the license number where reported (storage exists: `organizations.dealer_license`, `businesses.dealer_license`, `profiles.dealer_license`, `v_dealer_registry`, `expiring_licenses`, `shop_licenses` — coverage unverified).
2. **Verify against public ledger data** — is the license *active*, and does it *genuinely correspond to the business running the sale*?
3. If it doesn't, the license is likely **sub-licensed** and the operator is signed as a salesman, not the principal. That gap is the finding.

This must be **100% accurate — more checks and balances, never an assumption.** Public records make it provable; a dead end just means we haven't reached the endpoint of that data node yet. (Enforcement/outreach — "are you operating legally?" — is a sensitive downstream idea the owner flagged, not built here.)

Closer-conversion (§5b), bad-actor detection, and license verification are the same machinery: accrued evidence over time, keyed to identity + location, each datum sourced.

**Framing — archetypes, not enemies.** These types are presented as **archetypes/character types**, scored on cold facts — e.g. the perpetual non-closer becomes a *participation award* ("most bids, never won"), which is funny, not hostile. We're not making enemies; we expose the truth the way a movie tells a story — and people love the tool that tells it well. Even the bad-actor finding is stated as sourced fact, never accusation.

## 10. The broader program this feeds

This stack is step one of **company/platform profiling — the "pecking order" the owner wants fully understood.**

**This is not new — it's the dormant Organization entity, to be developed, not minted.** Nuke's ontology already defines three entity types sharing one observation structure — **Vehicle, Actor, Organization** (theory: `docs/ledger/theory/organizations-identity.md`; also `ORG_AND_VEHICLE_CLAIMS_MODEL.md`). The `organizations` table exists (5,733 rows, actively written, 146/146 columns described) but is **underdeveloped relative to the work**: ~104,078 distinct BaT sellers alone are unmodeled as organizations, and `actors`/profile layers sit near-empty. The pecking order is built by **developing the Organization entity** so it represents *what an entity does professionally* — something a shop's own website could never capture — accreting it from the same identity/seller observations this harvest produces. Everything these businesses openly publish is material:
- **All sources are equal *as sources*; BaT is just the highest-signal one.** We don't rank platforms by assumption — we **tier them on cold measured facts** (volume, money, geographic reach, sell-through, market impact). Then we **publish the ranking and award the winners** ("best platform for sales"), which makes typically non-competing entities compete on the record: Pebble Beach vs BaT vs Goodguys car-show auction vs the rest.
- **Platform profiles:** volume, money made, geographic strengths (does Hagerty outperform in some regions? nobody can say today — that's the gap we fill), market impact. Compute BaT's and each house's take.
- **Live-auction analysis:** every catalogue/event is published; estimate attendance from **video footage (head counts)**, compute money moved and net market impact, compare live-house business structures to BaT's online model.
- **Print:** Hagerty publishes a magazine — OCR the issue PDFs to capture seller/market info that never hits the web.
- **Downstream (offshoot):** once we can profile a platform's performance, we can sell *them* software/subscriptions ("you'll perform better if you add this"). The core product underneath all of it stays **the data.**
- **Other sources (reminders):** `classic.com/data` (cross-platform realized sales; we struggled to extract it before — throttling was the blocker, which is exactly the budget-gated live-first problem below).

## 11. Operating constraint — budget-gated, live-first

Hard financial limit. The system **monitors the live action within a live throttle set by budget**, and backfills *progressively faster as we can afford to*. The live throttle is the dominant design factor (it's what defeated the early extraction push). One source is limiting — but we widen by **cost per signal**, live-first, not by blasting everything. Paying buys backfill speed; it never buys the live signal, which must run cheaply and forever.

## 8. Open decisions (owner)

- Firecrawl **Hobby $16/mo** to run Phase 1 on the real pipeline (then $599 Scale burst only when Phase 1 proves out).
- Hagerty profile-page browser check — decides whether demand-map #2 is possible.
