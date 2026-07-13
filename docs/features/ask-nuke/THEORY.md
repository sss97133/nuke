# Ask Nuke — Theory, Delivery Goal, R&D Program

**Born 2026-07-09.** Skylar: "I'd rather develop the habit of turning to the Nuke app to
ask my automotive questions." Session ran archetype #1 by hand before writing any code.
This doc is the frozen theory; it grows one archetype at a time.

## Thesis

Answers in a chat die in that chat. An answer in Nuke is a **living row**: grounded in
the owner's substrate first, cited at every claim, landed back into the DB so the corpus
compounds, and **recomputed when the world changes**. Asking Claude does not compound.
Asking Nuke does. Skylar is user #1; his real questions are the only authentic product
spec the platform has.

## The answer, structurally

An answer is a **projection** (same species as `project_invoice`), never prose-from-priors.

**The three-rung source ladder** (checked in order, every claim carries source DNA):
1. **Owner substrate** — receipts, observations, work sessions, specs. ("What steering
   box is in my K5" = `receipt_items`, not research.)
2. **Nuke market corpus** — sold comps, listing lifecycle, velocity/pulse surfaces.
3. **External research** — fetched, cited, and **landed back as atoms** so it is never
   fetched twice. The fallback rung; designed to wither as the corpus fattens.

**Verdict grammar = strike price, not yes/no.** "Good buy?" resolves to: *not at $71K ·
interesting ~$52–55K · here is what evidence would move it.* A price, a confidence, and
the conditions that change it. Composes with the existing worth-bracket grammar
(`{low·mid·high}` + basis, block with "not priced yet" when the corpus can't defend a
number — never an honest-low guess).

**Mandatory rungs proven by archetype #1:**
- **Vision.** The text-only pass was materially wrong (called a pickup-config truck a
  wagon) and blind to the strongest evidence both ways (interior corroborated 19K mi;
  open hood + dangling connector impeached "like new"). No verdict renders without a
  photo pass. (= `feedback_look_at_images_first`, productized.)
- **Negative space is testimony.** The listing's most load-bearing atom was the missing
  sentence "runs and drives." Schema: expected-claims checklist per vehicle class;
  absences recorded with the same provenance as claims.
- **Asks and solds are opposite species.** Cleared prices are floors of reality; asks
  that rot are proof of where reality isn't. `first_seen/last_seen/removed_at` makes
  time-on-market ceiling evidence for free. A firm above-band ask becomes a **watch**,
  and the listing's own rot is the negotiation.
- **Staleness is structural.** Every comp carries `observed_at`; confidence decays. The
  20-month-old $49K comp was the verdict's weakest joint until a live auction covered it.

## In-app theory (translation into the existing doctrine)

**Not a chat box.** A chat bubble is a dead, undrillable surface — the opposite of the
grammar. The translation uses primitives that already ship:

- **Entry**: Explore's search (Explore is already the market-read terminal); a deal
  question IS a market read. iOS Ask field only after the verb is proven headless.
- **Worklight streams the ladder** as it runs ("your ledger… 0 · corpus… 2 solds ·
  live asks… 2 · fetching…"). Motion is a derivative of data, never a spinner.
- **Verdict renders as rooted atoms**: strike-price bracket + trust glyphs + decay
  marks; **every comp is a button** that drills to its sold listing/source (tenet 1).
- **Asking creates the entity.** The subject of a question becomes a real node (the
  Hemet H1 is now row `20f429b4` with verdict attached) — drillable ontology, no
  scrollback. The question's answer lives on the subject, in the asker's watches.
- **The answer recomputes.** When the Jul-15 benchmark auction lands, the verdict
  recalcs and the change is visible as data-motion. No notification cards (tenet 6);
  the surface natively shows the freshest state.

## The two arteries (scale architecture)

Ruling from Skylar 2026-07-09: aggregators (classic.com) are **not** the solution at
scale — stale, taxonomy-blind (they'd file the Hemet truck as "1995 H1", losing the
body-config/drivetrain/runs-and-drives facts that set price), dependency-fragile, and
the middleman Nuke exists to obsolete.

- **Sold-side artery (the missing organ).** Two lanes:
  - **Web-native results** (BaT, Cars & Bids): published publicly at finite daily
    volume. Nightly parser, same species as the CL artery. Lands cleared-price atoms
    with source DNA **including story features** (comments, reserve behavior).
  - **Video-native results (Skylar 2026-07-09: "all the live auctions are on
    YouTube").** Mecum / Barrett-Jackson stream every lot with a stable chyron
    (lot# · vehicle · price) in a fixed frame region. Harness: yt-dlp → ~1 fps frames
    → fixed-region OCR (tesseract/Apple Vision, LOCAL, zero API spend) → lot-transition
    detection → result atom `(venue, event, lot#, title, hammer|no-sale, ts,
    video_url+t=)`. Lot# keys deterministically to the venue lot-page URL — two
    provenance legs per atom. The surrounding frames ARE the condition/story evidence
    every results site strips: the hammer price drills to the moment it hammered.
    Venue official results pages = the VALIDATOR (delayed, stripped), not the source —
    OCR-vs-official diff gives measured ingestion precision per venue.
  - Volume: Mecum ~10 majors/yr × 1–3K lots + BJ ~4-5 × ~2K + BaT ~150-200/day ≈
    **30–50K cleared prices/yr with video condition evidence** — a corpus aggregators
    structurally cannot have.
  Aggregators store what things sold for; Nuke stores **why**. That is the moat.
- **Ask-side stays browsing-native.** CL artery live (hourly). FB can't be crawled at
  scale and doesn't need to be: **the user's attention is the crawler** — every question
  ingests its object with lifecycle tracking.
- **Demand-paged depth.** First H1 question triggers a one-time H1 sold-history
  backfill; the second is a sub-second DB read. Questions are the curation function;
  no ocean-boiling (autonomous-work gate stays intact).

**Schema debt found by the run:** `marketplace_listings.facebook_id` is NOT NULL — the
substrate structurally believes marketplace = Facebook. Venue-generalize (listing-event
atom: any venue + lifecycle + provenance). BaT watch landed under synthetic id
`bat:<slug>` as the stopgap. Question-as-atom currently rides `review_notes` (hack);
gets a real home after ~5 archetypes show their shape — don't mint early.

## R&D program (each phase built the day a question demands it)

1. **NOW — hand-run every question.** Every automotive question goes through the ladder
   in-session. Cheap; each run writes archetype rows and exposes the next gap. Expected
   archetypes: deal eval (#1 ✓), fitment/parts, own-build valuation, sell-timing,
   diagnosis, VIN/history decode.
2. **Substrate organs, demand-paged**: venue-generalized listing events → sold-results
   artery (nightly BaT/C&B) → question-atom home.
3. **The `ask` verb** (edge function): question atom → ladder → cited projection →
   gap-landing. Proven headless via MCP/Claude Desktop before any UI.
4. **Surface last**: Explore/iOS rendering of existing primitives (WorthBracketView,
   RootedValueView, Worklight, drill sheets). Outcome ≠ engine: done = Skylar asks from
   the shop floor and trusts the strike price.

**Open experiments:**
- Do BaT story features predict clearing price? (the "why" corpus)
- How often does the vision rung flip a verdict? (n=1: it did)
- Does absence-detection (expected-claims) survive contact with more listing classes?
- Validate time-on-market as ceiling evidence against eventual price cuts.
- **Video artery accuracy (the gating experiment):** one recent Mecum VOD → 1-fps
  chyron OCR → results table → diff vs the event's official results page. One number
  (extraction precision/recall) decides whether the video artery is real. Local OCR
  only; no API spend.

## Deeper layers (2026-07-09, second pass)

- **Prediction ledger.** Every strike price is falsifiable with a maturity date (sale /
  delist / rot). Record predicted vs actual; verdicts are born `projected` and get
  promoted `proven` / stamped `refuted` by the market — the platform trust ladder
  applied to the engine itself. The system renders its own calibration ("median error
  ±12% on trucks, n=47") instead of asking to be trusted; no incumbent (KBB/Hagerty/
  classic.com) shows its misses. Also the R&D instrument: measures whether vision rung /
  story features / negative-space earn their compute. Prediction #1 matures 2026-07-15
  (Glendale BaT, row `89e5fd50`).
- **Recompute = derived-recalc tenet with time as the axis.** Answer = materialized view
  over an evidence set; artery deliveries append; appends recalc all answers subscribed
  to the touched **cohort** (year-band × model × body-config — questions bind to
  cohorts, not listings). At n=1: a recalc pass after each nightly artery run, no
  streaming infra. Product consequence: a chat answer decays; a Nuke answer appreciates.
- **Archetype space (pre-data sketch, router NOT to be built yet):** deal eval ·
  fitment · own-build valuation (WorthArc) · sell-timing/venue · diagnosis · sourcing
  (= standing question = watch + strike price; auto-buy's front door) · decode ·
  procedure/spec. Each = ladder weighting + mandatory-evidence rule (deal eval can't
  render without vision; diagnosis without vehicle substrate; procedure without a
  citable source). Expect ~80% of real questions in 3 archetypes; build there first.
- **The internal scar this cures:** the condition-blind comp model ($400 parts-truck
  K20 → $32K) is the same disease as aggregator pricing. Comps set the band; pixels
  move the verdict. Quality bar for the sold artery: results land WITH condition/story
  features or it's KBB with extra steps.
- **Economics stay laser-tag/BYOK.** Caller owns compute (Skylar's session today, any
  agent via the MCP verb later); Nuke owns substrate + protocol + prediction ledger.

## Peer-review amendments (2026-07-09, adversarial Fable pass — accepted)

1. **Verdict asymmetry rule (overturns the original strike grammar).** Rejections and
   entries have asymmetric evidence requirements. "Not at $X" renders at thin evidence
   (cited ceiling + rot). An ENTRY price renders only past a defensibility bar (k fresh
   in-cohort comps + vision-adjusted); below the bar: **"strike pending <evidence>"**.
   Archetype #1's "~$52–55K" was an honest-low guess wearing trust glyphs — the exact
   thing `feedback_valuation_block_when_not_defensible` bans. Same rule the Mustang
   brief already applies to Skylar's own car; strangers' cars get it too.
2. **Ledger honesty rules.** (a) Define *resolvable* now (public-result auction /
   owner-confirmed sale); everything else is CENSORED, never counted — FB delistings
   are ambiguous and the censoring is informative. (b) Interval scoring: coverage +
   band width, chosen before n=5 — never point-error medians alone. (c) Two registers,
   never commingled: live predictions vs hindcast/backtest (freeze corpus at T, predict
   T+1, honest cold-start n from the existing BaT corpus in a weekend). (d) **A private
   ledger proves nothing** — externally timestamp predictions at creation (public post
   passes the content-curation gate: hard problem + real artifact + non-obvious claim).
   Prediction #1 must be externally timestamped BEFORE 2026-07-15, and is a **band
   test, not a strike test** (different vehicle; mapping requires the condition model
   under validation). (e) THE MOAT IS THE LEDGER, NOT THE CORPUS — solds are scrapable
   by anyone; a timestamped miss-included prediction record cannot be backdated by a
   2028 competitor.
3. **Sold-artery inversion (overturns the video pipeline as source).** Official venue
   results pages = the PRICE ATOMS (nightly parser, same species as CL artery). Video
   = **demand-paged condition enrichment** keyed by lot# — hammer-moment frames fetched
   only for lots an open question touches, stored as OWNED artifacts (a `youtube&t=`
   drill target dies with the VOD → tenet-1 failure; also don't rebuild classic.com's
   dependency-fragility on YouTube's ToS). Integrity: every price atom carries
   `convention` (hammer vs with-premium — unmarked mixing = silent ~10% bias); stream/
   ambiguous results born `projected`, promoted `proven` on official validation (Mecum
   reserve + post-block deals make on-stream "sold" occasionally false — landing it as
   cleared-price = C0 violation). Verdicts computed on unpromoted atoms inherit
   `projected` visibly. One-VOD OCR experiment survives as bounded curiosity; peer's
   prediction on record: it will prove the results page was the source.
4. **Recompute must carry condition or degrade loudly.** Cohort-append recalc with no
   pixel pass reintroduces aggregator condition-blindness at the recompute layer (a
   rusty no-title comp drags a clean truck's verdict). Appends carry condition features,
   or the verdict renders "band moved · condition adjustment stale · re-run vision" —
   never a silent recalc. Otherwise "answers appreciate" becomes "answers silently
   degrade toward KBB."
5. **V1 thesis restated.** Not "Nuke answers automotive questions" — **"a personal,
   cohort-concentrated market instrument for the vehicles its user works"** (his
   questions already cluster: 1965–95 American 4x4 + first-gen Mustang). General
   GRAMMAR, personal CORPUS; scale = more users, not more coverage. Corollary:
   "attention is the crawler" is an ingestion truth, not a coverage strategy — the
   sourcing/auto-buy archetype has NO FB sensory organ and is scoped to CL+BaT or
   out-of-scope until one exists.
6. **Sell-side is the flagship archetype.** On strangers' listings rung 1 is empty;
   the ladder's full power expresses only on owned vehicles (receipts + photos + the
   prediction matures as a real hammer under the owner's handle). Buy-side deal eval =
   the demo; own-build sell-side (strike/reserve/venue/timing) = the business.
   **Prediction #2 = the Mustang's own hammer band, logged before listing goes live.**
   Also record the advice→action→outcome triple when money moves on a verdict; the
   register stays "evidence assembled for your judgment," not "we say pay $X."
7. **Question atoms are demand-side market data**, not a query log: (cohort, price
   context, intent, ts) — the demand curve BaT structurally can't see (it only observes
   bids on existing inventory). Design the eventual question-atom home accordingly.
8. **Don't-mint audit.** Four nouns proposed in one session (ledger, cohort
   subscriptions, expected-claims, watches). Watches already live as synthetic-id
   listing rows; the ledger is plausibly observation/projection rows with a maturity
   date; each noun must prove it can't live in an existing organ before minting.

### Revised v1 cut (peer, accepted — every item is weeks-to-payback or un-backdatable)
1. Prediction ledger as ROWS this week (un-backdatable): #1 H1/Glendale (band test) +
   #2 Mustang hammer band — both externally timestamped.
2. Hand-run SELL-SIDE on the Mustang (strike/reserve/venue/timing; cite the existing
   sale brief, don't re-derive), then the K10 ("what does $30K require").
3. Nightly BaT sold-results parser scoped to his 4–5 cohorts. That IS sold-artery v1.
4. Narrow schema fix only: facebook_id nullable + venue discriminator.
5. One weekend of hindcasting → real n behind the open experiments.
NOT for 6 months: standing video-OCR, the `ask` edge function, ANY UI surface, the
archetype router, recompute infra (manual recalc on maturity), FB-scale anything,
sourcing/auto-buy.

## Substrate audit (2026-07-09 — measured, not assumed)

**Headline: the theory re-derived a system that half-exists.** The audit found live
organs, dark roots, and forks — per-item disposition:

| Theory noun | Reality in prod | State |
|---|---|---|
| Sold-side BaT artery | `bat_listings` 157K rows, **101,343 with sale_price, scraped 2026-07-09 (TODAY), last sale 07-08** | **ALIVE — v1 item #3 already built.** Find the process that feeds it before touching anything. |
| Venue-generalized listings | `external_listings` 139K: bat 104K (81K sold, stale 03-07), **barrett-jackson 25,752 (25,431 sold, stale 03-06)**, pcarmarket 6K (04-14), C&B 610 sold (02-17), **mecum 273/5 sold** | **HALF-DEAD FORK** — second BaT store diverged from `bat_listings`; multi-venue ingestion stopped ~March 2026. Seam decision needed. |
| Prediction ledger | `hammer_predictions` 50,534 rows (31 cols: predicted low/mid/high, confidence, comp basis, buy_recommendation, actual_hammer, error scoring), ran **2026-02-19 → 04-01 then died**; 607 scored | **DORMANT — revive, don't mint.** |
| Calibration record | `prediction_accuracy`: v13 median abs error **48.2%**, bias **+32%**, 0 within 5%; v24 median **33.2%**, bias −12.5%, 36/399 within 10% | **EXISTS, and it MEASURED the condition-blind failure** — comps-only models fail at ±33-48%; the vision/condition rung isn't theory, it's the cure this table already demanded. |
| Question atoms / archetype router | `question_taxonomy` 62 rows, L1/L2 + regex + `answerable_from_db` + counts — derived from the MARKET's questions (BaT comment corpus: tires 141K, paint 82K…) | **EXISTS as demand-side corpus** (peer idea 2A already built, for strangers' questions). Skylar's ask-log still has no home. |
| Story features | `bat_listings.comment_count/bid_count` **all 0**; `auction_comments` **13.9M rows** unlinked | **GAP: schema present, ingestion never fills it; the story corpus exists but is orphaned.** |
| Venue entities + fee conventions | `auction_venues` 9 rows (BaT 5%, BJ 10%, Mecum 10%, C&B 4.5%, RM/Gooding/Bonhams/Hagerty/PCarMarket) w/ premium/commission cols | **EXISTS** — atom-level `convention` field still missing, venue-level home ready. |
| Lifecycle tracking | `fb_listing_disappearances` 4,224 / `fb_listing_sightings` 5; `marketplace_listings` first/last_seen | Partial; FB-only, mostly idle. |
| Live-auction integration | `live_auction_sources` 18 venues (websocket/sse/api config, anti-bot notes), `monitored_auctions` 1,549, `betting_markets` | Designed far past current need — evidence of a previous over-build wave. |

**Cohort reality check:** the corpus already answered today's H1 question better than
my web search did — e.g. turbodiesel '93 H1 two-door **sold $41K on BaT 2026-06-24**
(in `bat_listings`, not surfaced because the ask ladder queried the wrong tables).
Rung-2 failure mode identified: **the ladder must enumerate its own substrate** —
`bat_listings` + `external_listings` + `marketplace_listings`, not just `vehicles`.

**What today's theory adds that genuinely does NOT exist:** the source ladder itself
(owner substrate → corpus → research, with mandatory rungs), verdict asymmetry rule,
condition features on comps (the ±33-48% error is the measured cost of their absence),
negative-space testimony, censored-vs-resolvable prediction taxonomy + two registers +
external timestamping, recompute semantics, and Mecum results (the ONE venue genuinely
missing — Skylar's video instinct pointed at the real gap; 25K BJ results were already
ingested the boring way, supporting the peer's official-results-first inversion).

**Revised v1 implications:** (1) item #3 becomes "find + verify the live bat_listings
feeder, extend to fill comment_count/bid_count from auction_comments"; (2) the ledger
revives `hammer_predictions` with the amendments (intervals scored for coverage,
censored marking, condition features per comp) instead of new rows elsewhere; (3) the
fork between `bat_listings` and `external_listings` needs a canonical-seam ruling
before any new writes; (4) Mecum backfill = official results pages, demand-paged.

## The file-corpus thesis (Skylar, 2026-07-09: "those files represent the incompleteness of each vehicle profile")

Measured: **823 md files** (715 nuke/docs + 108 memory) vs **405 tables already keyed
by vehicle_id**. The failure is not schema capacity — it's missing NOUNS: wide in
mechanism, shallow in the vehicle's life. When an agent holds a fact with no receiving
noun it writes prose; **every file is a witnessed schema gap**, and anything in a file
is invisible to the app BY CONSTRUCTION (the app renders the DB). "Handle it from the
app, not the CLI" ≡ "the vehicle profile must hold everything the files hold" ≡
Ask-Nuke rung-1 depth. R&D method: mine the file corpus as demand data — cluster by
missing-noun, rank by incident frequency. First clusters: per-system build state
(K5_WIRING_STATE.md), sale plan + cohort binding (mustang-sale-pickup.md),
**obligations/liens against a vehicle** (Kenan ~$9K / Tommy $3-5K on the Mustang —
repay-from-proceeds has no organ), verdicts (today's went into review_notes),
structured condition/body-config (the ±40% calibration killer; the H1's deciding fact
has no column in 405 tables), open-questions/negative-space per vehicle. Going
forward: prose-reach = gap-discovery tripwire — name the organ, file a schema ticket
instead of a document. Delivery goal restated: the APP is the ask surface; the CLI is
scaffolding.

## RULING (Skylar 2026-07-09, supersedes emphasis above): data handling is the product; predictions are a free byproduct

"Who cares about predictions — we care about prediction ALGORITHMS and that the data is
QUERYABLE; that makes predictions cheap/programmatic/free. The indexing and handling of
data is what's costly." Evidence from this session: the H1 answer's cost was ~all
data-location/shaping (fork archaeology, title regex — `bat_listings` has NO
year/make/model columns on 101K sold prices), ~zero prediction arithmetic. The dead
ledger's ±40% error and death-by-3-versions is the same story: algorithm iteration was
expensive because features were never queryable. Priority stack therefore:
1. **Cohort-normalize the sold corpus** — programmatic title-parse backfill →
   year/make/model/cohort columns + indexes on bat_listings (parsing maps exist in
   scraper skills; deterministic, local, free).
2. **Canonical seam view** over bat_listings + external_listings + marketplace_listings
   (sold|ask discriminated) so the fork history disappears from every future query.
3. **Prediction algorithm = a view/RPC** (band/median/n/freshness per cohort), computed
   at query time — swappable, regenerable, free. No "model runs." (= the platform's own
   derived-recalc thesis applied to market reads.)
Ledger/prediction rows = cheap byproduct bookkeeping only (era-2 row `98fc0c07`, one
INSERT). External-timestamping/moat framing stays but rides on top; it is NOT the
priority. Era-2 rule kept: predictions snapshot their subject in-row (era-1's 50K rows
were severed when their subject vehicles were deleted — 4,583 predicted vehicles → 617
survive).

## Archetype log

**#1 — Deal eval (2026-07-09).** FB Hemet CA 1995 H1 "slantback" $71K firm, 19,199 mi,
plum, 30-yr barn find → rows `20f429b4` (listing+verdict) & `89e5fd50` (benchmark watch:
live BaT '95 H1 17K-TMU Glendale, **ends 2026-07-15** — record result, recalc verdict).
Verdict: not at $71K (year-matched sold band $47.5–65K; closest running comps $49K
11/2024, ~$46K 1/2026 at 7K mi); flip needs ~$35–40K entry; $100K+ H1s are 2000-era
1-of-39 slantbacks / Alphas, not '95 NA-diesels. Vision pass flipped body-config and
surfaced "runs and drives" unsaid.

## Explore surface grounding (2026-07-13) — PROPOSED, two forks open for Skylar

R&D item #4 ("surface last: Explore rendering") got a grounding pass after the live-ask
artery was widened 2→~441 feeds. 4-lane read-only codebase map (workflow
`wf_3c80fee5-e60`) + a direct re-read of this doc. **This section is analysis + a
proposed build order; the two forks at the end are Skylar's to steer before anything
gets built or enshrined as doctrine.**

**Finding: Explore isn't missing — it's mislabeled.** The tab exists twice and both
shells are well-built and Skylar-approved:
- Web: squarified treemap (brand→model→year→vehicle), `CohortTerminal`
  (`get_make_model_terminal`, honest `resolved:false = intake gap` discipline), `/browse`,
  `/live`.
- iOS: full market-read terminal, already the leftmost/front-door tab, anon-safe;
  `CohortTerminalView` is the app's gold-standard populated-flag-honest surface. The
  "market read terminal" IS `ExploreView.swift` (MetroDetailView is a struct inside it).
  Live app: `/Users/skylar/.worktrees/foundation-ios`, branch `fable5/ignition-ios`.

**The cardinal-rule violation (live in prod now):** every "market" surface aggregates the
`vehicles` census (dominated by ~165k BaT auction rows + ~149k historical SOLD events),
then labels it *"the live listings market — where vehicles move, what they cost, how
fast."* `avg_price` = SOLD hammer price; `active` = active BaT auction (~1,292
nationwide); Scottsdale renders 56% turnover with 5 active of 5,953 (a sales archive as a
hot live market). Facade-by-label = sabotage per C0. **Supply and consumer are wired to
different substrates:** `marketplace_metro_pulse` / `marketplace_velocity` / `mv_market_*`
all read `vehicles`; none read the live artery flow.

**Why the 441 feeds don't fix it (measured):** artery lands in `vehicles` via `ingest` as
`status='discovered'` stubs that are unfit to render — **geo-less** (~96% of CL vehicles
no city/state; 0/65 recent), **unpriced** (BaT lands `price=0`; price lives in
`bat_listings`; no unified asking-price w/ source DNA), **un-deduped** (`dedup-vehicles-batch`
cron OFF → same car on CL+eBay+KSL triple-counts), **never-expired**
(`reconcile-listing-status` cron OFF → CL "active" frozen at 2026-03-16, 4mo stale). Also
OFF: all `enrich-*` (geo/vin/ymm), `refresh-clean-vehicle-prices`. The read layer that
IS fresh (`refresh-market-pulse` 30m, `refresh-market-views` 20m) refreshes the BaT-comp
facade, not live asks.

**Thesis (from this doc, not re-derived):** Explore = the market-read terminal; a deal
question IS a market read. The differentiator is the JOIN — live ASK (artery) × SOLD-comp
band (`bat_listings`: 168k rows, refreshed daily, the ONE genuinely deal-ready asset) →
strike-price read on a drillable entity. Reverse-chron listings = the anti-pattern all 5
prior waves died on + a worse Craigslist.

**The tension (owed honestly):** the 441-feed widening = max coverage; this doc's V1 is
cohort-concentrated ("scale = more users, not more coverage") and warns against
ocean-boiling. Reconcile only if broad supply is FUEL for cohort-first reads, never a feed
to render. Cost: 441 unenriched feeds enlarge the enrichment debt. Lean: sold-side wide
(comps want coverage), ask-side enrichment concentrated on his cohorts + top metros first.

**Proposed build order (develop-from-what-exists; mint nothing — matches this doc's own
"data handling is the product" ruling, independently re-derived by the substrate lane):**
1. **Fix the ask-side atoms** (the OFF-cron enrichment): geocode CL, turn on
   `reconcile-listing-status` (expire stale/gone), turn on dedup (one physical car = one
   entity), unify `asking_price` w/ source DNA. Nothing honest renders until this exists.
2. **Canonical seam read** — one cohort-keyed view/RPC discriminating SOLD (`bat_listings`)
   vs ASK (live `vehicles`); "is this ask a deal / what's this cohort doing" = a query.
   Extend `mv_market_position` (p25/p50/p75 + auction_med vs market_med — closest existing
   primitive). Don't mint. (= this doc's ruling items #2–3.)
3. **Repoint the surface, LAST** — add a live-ask variant MV to the two active refresh
   crons (existing Swift structs `MarketMetro`/`MarketMake` decode it w/ minimal change);
   **relabel every SOLD aggregate as sold.** A repoint + relabel, not a rebuild.

**Cheap do-now (independent, high-integrity):** the mislabeling ships today on the iOS
front-door tab. Even before the pipeline work, labels must tell the truth (sold comps /
market history, not "live"). First pickup item.

**Develop-from candidates (don't rebuild):** `ExploreView` terminal shell + NavigationStack;
`CohortTerminalView` populated-flag discipline; `mv_market_position`;
`marketplace_metro_pulse`/`velocity` view DEFINITIONS (swap `FROM vehicles` → live table,
`listing_status='active'`, asking-price agg, real seller field); `market_map_points()` /
`county_density_all()` (anon-granted geo layer — add a LIVE-ASK variant, don't mint a map);
`bat_listings` sold-comp spine.

**Data-quality landmines (any live rollup must handle):** metro_pulse/velocity are BaT
SOLD aggregates not listings; CL 4mo stale; CL ~96% geo=Unknown; BaT price=0; `active`
in `marketplace_listings` means "never marked removed" not "currently live" (111k phantom
FB rows, 14 re-seen/7d); `avg_hours_on_market` hardcoded NULL; `unique_sellers` =
distinct `bat_seller` (BaT-only); pulse-vs-velocity make-rows under-sum ~12-20% (disclose,
never silently sum); `pg_stat` n_live_tup is badly wrong here — always `count(*)`.

**TWO FORKS FOR SKYLAR (unanswered — do not build past these):**
1. Ask-side scope: enrich all 441 feeds, or concentrate cohorts + top metros first?
   (recommendation: concentrate.)
2. Explore's headline: the DEAL READ (ask × sold-comp band, per this doc), or the
   GEOGRAPHY MAP (what the built iOS surface currently leads with)?
