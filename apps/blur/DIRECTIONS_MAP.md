# Blur — Directions Map (what to even think about)

*The divergent menu. Each direction is a "place" you can point me at to develop
conceptually + into a build plan. Grounded in three research sweeps (market,
on-device/policy reality, reusable nuke assets) run 2026-06-30 — sources in
those reports. Read §0 first: it's where research changed our assumptions.*

---

## 0. What the research changed (read before picking)

Three findings move load-bearing assumptions. Honesty first:

1. **The Anthropic/OpenAI referral revenue (Decision D8) is not grounded.** As
   of mid-2026 there is **no public, app-embeddable consumer affiliate program**
   from either. Anthropic's "Claude Partner Network" is **enterprise/services
   only**; the consumer affiliate listings are unverified aggregator claims.
   → **D8 downgraded from "locked revenue path" to "unverified."** Don't
   architect money around it without written confirmation from Anthropic.
   Monetization should lean on a **managed subscription** instead (see C).

2. **"Automatic organization" is two very different problems, and only one is
   cheap.** Apple's Vision feature-prints give you near-duplicate / same-event
   grouping cheaply (and we already have perceptual-hash dedup in nuke). But
   **true "cluster all 80k photos by subject" is your own ANN/k-means problem**
   — feature prints are a 2048-d distance, not a label, pairwise doesn't scale,
   and the vectors aren't even stable across iOS versions. **However**, the
   *stray-finder* ("given my existing Truck album, find the ones I missed") is
   the **tractable, high-value** version: distance-to-album-centroid, no
   full-library clustering. That's the smart wedge.

3. **The market is big, monetized, and badly served on exactly our axes.**
   ~$40M/month category, 95% on iOS — but owned by *manual* swipe-to-clean apps
   with *predatory weekly pricing*. **Privacy-first + no-account + passive** is
   validated by tiny players (EASY, Utiful, Mylio) and **owned by no one at
   scale.** That gap is the opportunity. Pricing sweet spot: **~$20–30/yr**.

---

## A. Product & UX directions

- **A1 — The single magic moment.** Three candidate hooks: (a) "it organized
  itself + found the strays," (b) "flip-to-show, everything else blurred," (c)
  "find any photo instantly." *We can't lead with all three.* Which is the
  10-second wow? **Lean:** (a) stray-finder as the paid magic, (b) blur/show as
  the free hook that gets it installed.
- **A2 — Organization model.** Subject-cluster vs event/time vs dedup-cleanup
  vs improve-existing-albums. Apple already does event/face/scene; our edge is
  **stray-finding + scale (past Apple's ~50-album choke) + blur-to-show.**
- **A3 — The blur/show surface.** Depth-of-field for your whole library; guest
  mode; hand-the-phone safety. Headline or feature? **Lean:** it's the free
  hook and the name — make it the headline of v0.
- **A4 — Retrieval/search.** "Flip to the exact group with confidence." Real
  semantic text→image search needs a shipped CLIP Core ML model (net-new).
  Cheaper v1: search over album titles + Apple scene tags + OCR text.
- **A5 — First-run magic.** Must wow in seconds, must respect iOS limited-photo
  access mode. What's the very first screen after permission?
- **A6 — People/faces.** Apple's named-people graph is **walled off** — we'd
  rebuild from raw face detection. Big feature, big effort. In or out?

## B. Technology & architecture directions

- **B1 — The clustering engine (the real engineering).** Feature-prints + a
  blocking/ANN strategy for 80k; pHash dedup (reusable from nuke); the
  stray-finder (centroid distance) as the tractable first cut. Revision-aware
  vector cache in SQLite.
- **B2 — The intelligence stack (3 tiers).** On-device Apple **Foundation
  Models** (iOS 26, A17 Pro+, free, 4k context, guided structured output) →
  DIY local model (MLX/llama.cpp, wider devices) → cloud. WWDC26: Foundation
  Models is becoming the **unified door to Claude on-device** too — one code
  path. Worth designing toward.
- **B3 — Local persistence/index.** SQLite vector + dedup cache; what's stored,
  how it's invalidated, how it stays anonymous.
- **B4 — The thin separate backend.** Only what truly needs a server:
  entitlement/purchase validation, optional managed inference, opt-in
  anonymous analytics. Never nuke-prod. (nuke's `track.ts`/`app_events` =
  reusable anonymous funnel.)
- **B5 — Reuse vs rebuild ledger.** Reusable from nuke: pHash dedup,
  `apple-vision-classifier.swift`, anonymous analytics, `llmRouter.ts`
  (multi-provider + BYO-key + preferLocal). Net-new: subject clustering, the
  iOS UI, CLIP search, StoreKit.

## C. Business model & monetization directions

- **C1 — Free/paid boundary.** Free = anonymous local (Apple-seed galleries +
  blur/show + manual). Paid = automatic handling (stray-finder, dedup,
  auto-galleries). Is that the right line?
- **C2 — Pricing.** Research says **~$20–30/yr or ~$3–5/mo** managed sub is the
  proven, sustainable band; weekly pricing is the predatory outlier we
  *undercut as positioning*. One-time/lifetime underprices recurring AI compute.
- **C3 — BYO-intelligence as a power-user lane, not the mass tier.** BYO-key is
  a developer pattern; average users won't paste keys. Keep it as an option for
  the privacy-maximalist/pro user; make **managed the default paid path.**
- **C4 — Referral, reframed.** Since no consumer referral program exists (§0.1),
  the realistic "Nuke earns from intelligence" model is **reselling managed
  inference at margin** (we hold the provider relationship) — not affiliate
  payouts. Or: don't monetize AI at all in v1; monetize convenience.
- **C5 — Is revenue even the point for v1?** Stated goal is *prove Nuke can ship
  + learn first-mile hangups + acquire users.* Maybe v1 optimizes **users &
  learning**, not ARPU, and monetization is a later instrument.

## D. Privacy & trust directions

- **D1 — Anonymity as the brand.** No-account, Data-Not-Collected card, runs in
  airplane mode. This is the wedge incumbents left open — how loudly do we lead
  with it?
- **D2 — Compliance reality.** If/when any AI touches data: **guideline
  5.1.2(i)** requires naming the exact AI provider + explicit opt-in (the #1 AI
  rejection vector now). BYO-key must be Keychain-only and must not gate our own
  paywall. Limited-photo-library mode must be designed for.
- **D3 — Positioning vs the field.** Not a vault (Keepsafe), not a predatory
  cleaner — a *private passive organizer*. What's the one-line claim?

## E. Go-to-market & positioning directions

- **E1 — Which category/ASO.** "Photo & Video" vs "Productivity" vs
  "Utilities"; keyword strategy against cleaners/vaults.
- **E2 — Name/brand.** "Blur" almost certainly taken on the App Store; bundle
  `ag.nuke.blur` can stay regardless. Sub-brand of Nuke or standalone identity?
- **E3 — The wedge message.** "Private. Passive. Finds the photos you missed."
  — which promise leads?
- **E4 — Growth without accounts.** How does an anonymous app go viral? (share
  a curated gallery? the blur/show "hand someone your phone" moment is
  inherently social.)
- **E5 — The learning loop.** Anonymous first-mile funnel (install → grant →
  first gallery → first blur → show-mode → upgrade view) via the reusable
  `track.ts` pattern. What are the 5 metrics that tell us if it's working?

## F. Strategic / portfolio directions (Nuke as a studio)

- **F1 — Blur as the reusable template.** What hardens into the "Nuke app shell"
  (auth-optional, PhotoKit, BGTask, build tooling, analytics) that products
  #2/#3 fork? Blur is the first proof *and* the mold.
- **F2 — The shared engine as an internal platform.** nuke's image-intelligence
  (grouping, hero, quality, dedup) becomes a reusable Nuke capability, not a
  vehicle-only thing.
- **F3 — Success criteria.** What does "this proved we can ship" mean
  concretely? (Shipped to App Store? N anonymous users? A first-mile learnings
  doc? First dollar?) Define the win before building more.
- **F4 — Kill criteria.** What signal says stop? (e.g., can't clear Apple
  Photos' free bar; clustering quality feels noisy; no retention.)

---

## How to use this map

Pick the directions you want developed — by ID (e.g. "go deep on A1, B1, C2,
F3"). For each, I'll produce the conceptual development + a concrete build plan,
grounded against the research (and verifying any load-bearing claim before we
lean on it). The directions are deliberately independent so we can pursue any
subset in any order. v0 (the free local app) stands on its own regardless of
which paid/strategy directions we chase.
