# The Oracle

*Working paper — 2026-06-16*
*Status: DRAFT / research agenda. Keystone companion to
`2026-06-16_make_model_subject_and_cohort_terminal.md` (esp. Section 5) and
`2026-06-16_proof_of_maintenance.md`.*

> Lending, Reg A+ series-LLC securitization, freeport custody, and a tradable
> cohort index are all **proven, off-the-shelf wrappers.** The one thing nobody
> has is a **defensible, computable, cross-marque oracle** for what a cohort or
> asset is worth, how original and maintained it is, and how many survive. Build
> the oracle and the wrappers snap on. Skip it and there is nothing to wrap.

This paper is the maturation thesis, made concrete against real code. The oracle
is **not a greenfield build.** It is the cohort terminal (`get_make_model_terminal`)
fused with the per-VIN valuation engine (`compute-vehicle-valuation`) and the
proof-of-maintenance projector, hardened to underwriting grade. Five of the six
pillars in the lending/index thesis are de-risked by operating precedent
(Section 5.8). The two genuine frontiers — the cohort as a tradable entity, and
cross-marque computable provenance — **both reduce to the oracle.** This paper
specifies what the oracle is, why it is the gate, and exactly which parts ASSEMBLE,
which BUILD, and which are genuine RESEARCH.

---

## 1. The thesis: the wrappers are bought, the oracle is built

The precedent sweep of this session (RM Sotheby's lending; Rally/Masterworks Reg
A+; Geneva/Le Freeport custody; Marti/Kardex provenance; Hagerty survival data)
established a clean separation:

**Proven, assemble-able off the shelf:**
- **Lending** — asset-based, no-credit-check collateral lending. *Exists:* RM
  Sotheby's Financial, Sotheby's Financial, J.P. Morgan collection lines, $1M–
  $250M at 50–60% LTV.
- **Securitization** — Delaware **series LLC** (each asset its own series) selling
  fractional interests under **SEC Reg A+ Tier 2**, broker-of-record **Dalmore
  Group**, secondary trading on a registered **ATS** (PPEX / North Capital).
  *Exists and is SEC-qualified:* Rally (`RSE Collection, LLC`), Masterworks
  (`Vault 1, LLC`), Collectable, Otis — all verifiable on EDGAR.
- **Custody** — tax-suspended freeport vaulting with title-transfer-in-situ.
  *Exists at ~$100B scale:* Geneva Freeport, Le Freeport.

**The one thing nobody has — the moat:**
- A **defensible, computable, cross-marque price/provenance/survivor oracle.** RM
  Sotheby's underwrites on Marti reports and Kardex extracts — **siloed,
  human-mediated, per-marque PDFs.** No one has made provenance, price, and
  survival *computable across marques at portfolio scale.* That is precisely the
  data asset the subject/projection system produces.

So the strategic claim is narrow and defensible: **do not build a fund, a vault, a
broker, or an exchange.** Build the oracle the funds, vaults, brokers, and
exchanges all lack. Per `platform-hygiene.md`, the deleted exchange/vault/betting
scaffolding is not to be rebuilt — and the reason it failed is exactly that it was
a wrapper with no oracle underneath. We build the oracle; the wrappers snap on as
gated activations when it is trustworthy.

---

## 2. What "defensible" means — precisely

Defensible is not "accurate." It is **citable, conflict-honest, and gap-honest.**
Four properties, each already enforced somewhere in the codebase:

1. **Every number carries source DNA** — `(amount, source, method, observed_at,
   trust)`. A bare number is a schema failure
   (`feedback_numbers_carry_source_dna.md`, Universal Invariant #1). The valuation
   engine already obeys this: `nuke_estimates.signal_weights` is a JSONB of
   `{signal: {weight, multiplier, sourceCount}}`
   (`…20260208_a_vehicle_valuations.sql:11-73`) — every signal records how many
   real rows backed it.

2. **Consecrated-sale weighting over asking prices.** A consummated sale outweighs
   a listing. The engine already encodes this as explicit consecration weights
   (`compute-vehicle-valuation/index.ts:352-359`):
   ```
   sale_price 1.0   bat_sold_price 1.0   winning_bid 0.9
   high_bid 0.6     asking_price 0.35    current_value 0.25
   ```
   An *ask* is a wish; a *sale* is a fact. The oracle inherits this doctrine
   (rooted in `docs/library/intellectual/contemplations/habitus-and-the-exchange.md`).
   `vehicle_events.event_status='sold'` + `final_price>0` is the consecrated
   substrate (`…20260307_vehicle_events_unification.sql`); `event_status='active'`
   is the discounted ask.

3. **Conflict surfaced, not hidden.** `project_attribute()`
   (`…20260615020000_consensus_and_reputation.sql:27-80`) returns
   `conflict:true` when a runner-up claim holds ≥50% of the winner's support, and
   ships the full `candidates[]` breakdown with per-contributor weights. The
   oracle never collapses a contested value into a false-confident point estimate;
   it shows the distribution and the dispute.

4. **Intake-gap honesty.** A dark signal is **OUR gap, never a market verdict**
   (`feedback_valuation_block_when_not_defensible.md`). The engine already
   distinguishes this: the `is_circular` / `self_price_fallback` path caps
   confidence at 25 and **nulls the deal score** rather than emitting a confident-
   looking number from a vehicle's own asking price (`…valuation…:849-868`). When
   the oracle can't defend a number, it **blocks** ("Not priced yet — N
   independent comps") — it never prints an honest-low fabrication.

This is the difference between the oracle and Zillow's Zestimate. Pricing other
people's belongings is Zillow-scale liability; the defense is not better ML, it is
**provenance on every digit and a hard block when the provenance isn't there.**

---

## 3. The maturation, not the greenfield

The oracle is the convergence of three things that already run:

- **`compute-vehicle-valuation`** — the per-VIN 8-signal engine
  (`supabase/functions/compute-vehicle-valuation/index.ts`). Today it emits
  `nuke_estimates` rows with `estimated_value`, `value_low/high`,
  `confidence_score`, `price_tier`, `signal_weights`, `deal_score`, `heat_score`,
  `comp_method`. It already does consecration weighting, recency-weighted median,
  build-class stratification (restomod → 82nd pct, survivor → 55th, project →
  30th, lines 134-168), and confidence widening near record prices
  (`record_prices`, `…20260208_b…`).

- **`get_make_model_terminal`** — the cohort assembler (Section d of the cohort
  paper; `…20260616120000_make_model_subject_cohort_terminal.sql`). It rolls per-
  VIN signals up to the cohort: count, price distribution, market flow, comps,
  sentiment, production/rarity, dealer behavior, survival floor.

- **`proof_of_maintenance(vehicle_id)`** — the per-VIN care ledger (companion
  paper) that finally lights the two neutral signals (`condition`, `originality`)
  the valuation engine stubs at 1.0.

The oracle is these three, hardened. **The eight signals already exist** — they
are the skeleton of the oracle, not a wishlist:

| # | signal | source table | oracle role | maturity |
|---|---|---|---|---|
| 1 | `comps` | `clean_vehicle_prices` (mat. view) | price anchor, consecration-weighted | ASSEMBLE — populated |
| 2 | `condition` | `vehicle_condition_scores.descriptor_summary` | per-VIN quality; **neutral 1.0 today** | BUILD — needs proof-of-maintenance |
| 3 | `rarity` | `vehicle_production_data.rarity_level` | scarcity multiplier | PARTIAL — ~100 seed rows |
| 4 | `sentiment` | `comment_discoveries.sentiment_score` | demand pressure | ASSEMBLE — populated where comments extracted |
| 5 | `bid_curve` | `auction_comments.bid_amount` | live demand velocity | ASSEMBLE |
| 6 | `market_trend` | `market_segment_stats.price_trend_30d/90d` | cohort momentum | ASSEMBLE |
| 7 | `survival` | `survival_rate_estimates.survival_rate` | the survivor denominator | SPARSE → RESEARCH (the decay model) |
| 8 | `originality` | `descriptor_summary` mod atoms / matching-numbers | provenance multiplier; **neutral 1.0 today** | BUILD/RESEARCH — cross-marque normalization |

The oracle is **signal 1–6 matured + signal 2/8 lit by proof-of-maintenance +
signal 7 completed by a survivor model.** That is a maturation roadmap, not an
invention. (Per `feedback_dont_mint_new_structures_use_the_repo.md` and the
develop-from-what-exists rule.)

---

## 4. The three oracle outputs

The oracle answers exactly three questions about any asset or cohort. Each maps to
existing substrate, and each has a clear maturity verdict.

### Output 1 — PRICE (cohort distribution + per-VIN estimate with confidence)

**What:** the cohort price distribution (median by condition tier, quartiles,
trend) and a per-VIN point estimate with an honest confidence interval and a
sold-vs-ask flag.

**From:** `compute-vehicle-valuation` (per-VIN) + `get_make_model_terminal`'s
price block (cohort), both riding `vehicle_events.final_price` over consecrated
sales and `clean_vehicle_prices`. Confidence is already a first-class output:
`confidence_score` (base 30 + input_count×8 + comp_count×1.5 + method_bonus),
`confidence_interval_pct` (widened near records, widened on weak comp method),
`comp_method` (canonical/exact/normalized/core_model/make_fallback/none).

**Maturity:** ASSEMBLE. This output substantially exists today. The hardening is
the build-class-aware condition/originality multipliers (currently neutral) and
the block-when-undefensible discipline.

### Output 2 — PROVENANCE / ORIGINALITY (matching-numbers, documented history)

**What:** is the drivetrain matching-numbers? Is the history documented? What is
the originality class (all-original / mostly-original / modified / restomod)?

**The precedent and the moat, stated precisely:** the per-marque oracles for this
already exist and are *revered* — **Marti Reports** (Ford, sourced from the
factory invoice database) and **Porsche Kardex** (factory build record) are the
gold standard, and RM Sotheby's underwrites on them. **They are per-marque,
human-mediated, and do not compose.** A Marti tells you nothing about a Camaro; a
Kardex tells you nothing about a Mustang. **The moat is a cross-marque, computable
version of the same attestation** — and Nuke already has the primitives: the
`originality` signal reads matching-numbers and mod atoms from
`vehicle_condition_scores.descriptor_summary`; `analyze-comments-fast` already
pattern-matches `matching numbers` / `non-original engine` / `original drivetrain`
into originality scores (all-original ≥0.8 → restomod <0.2); proof-of-maintenance
supplies the documented-history half.

**Maturity:** BUILD + RESEARCH. The atoms exist. The genuine research is
**cross-marque provenance normalization** — turning "Marti report attached"
(Ford), "Kardex on file" (Porsche), "build sheet present" (Mopar), and "matching-
numbers confirmed by inspection" into one comparable, computable
`originality_class` with a trust grade. No one has done this across marques; it is
the moat precisely because it is hard.

### Output 3 — SURVIVOR DENOMINATOR (surviving count / fixed production)

**What:** the novel first-class number — how many of a fixed-production cohort
still exist. 1966 Mustang: 607,568 produced; ~350,000 1965–66 cars remain
(Hagerty/registry estimates); 1960s survivors attrite ~1–2%/yr.

**The precedent:** Hagerty publishes coarse aggregate survival/attrition data, and
hand-curated halo registries exist for trophy cohorts (Shelby, Hemi). **No one
maintains a per-VIN survivor census for an *ordinary* cohort.** This is genuinely
novel as a *live, first-class, per-cohort* number.

**From:** `survival_rate_estimates` (make, model, year_start/end, total_produced,
estimated_surviving, survival_rate, `estimation_method` ∈
{registry_data, listing_frequency, decay_model}, proxy_signals JSONB)
(`…20260208_c_survival_rate_estimates.sql:6-37`) — the table exists but is
near-empty. The floor is the cohort member-VIN count
(`get_make_model_terminal` uses member count as a lower bound when the estimate is
absent). The completion is the decay/listing-frequency model.

**Maturity:** RESEARCH. The table schema exists; the *estimator does not.* This is
the one true research node — §6.

---

## 5. Why the oracle is the gate

Section 5.2's convergence: two independent analyses (schema design and precedent
sweep) landed on the same chokepoint. A YMM cohort cannot be **priced, lent
against, indexed, or securitized** without a defensible price/provenance/survivor
oracle. The reason is legal-structural:

**Cohort-as-collateral and cohort-as-tradable-index have no off-the-shelf legal
template precisely because there is no price/provenance oracle to anchor them.**
Series LLC + Reg A+ exists for a *single named asset* (Rally's one specific
'55 Gullwing is `RSE Collection` series). It does **not** exist for a *cohort as a
priced, tradable basket*, because a basket needs a continuously-defensible NAV, and
NAV needs a per-constituent oracle. Securitization lawyers can paper a single
appraised car; they cannot paper "the 1966 Mustang cohort" without a number that
says what the cohort is worth, how the constituents grade on originality, and how
many survive to bound the float.

The oracle is **what makes the cohort a priced, tradable entity.** It converts the
knowledge subject (the always-on cohort `make_model` subject of the cohort paper)
into a financial-grade reference: a basket with a defensible NAV, per-tranche
quality grading (a numbers-matching survivor and a driver-grade example are
different tranches of the same subject — Section 5.4), and a survivor-bounded
float. With the oracle, the proven wrappers attach: lending underwrites on the
per-VIN price+provenance+proof-of-maintenance; the Reg A+ series securitizes the
oracle-priced constituents; the freeport custodies the high-tier units; the index
NAVs off the cohort distribution.

This is why the verdict (Section 5.8) holds: **build the oracle, the rest is
already proven and waiting to snap on.** The single gated action remains issuing
fractional interests (needs counsel, Section 5.7); the oracle itself is legally
neutral to build — it is a measurement, not an offer.

---

## 6. The honest research agenda

Separated by kind, with no hand-waving about which is which.

### ASSEMBLE (exists — plumb it)
- **Price distribution & per-VIN estimate** — `compute-vehicle-valuation` +
  `get_make_model_terminal` price block over `vehicle_events.final_price` /
  `clean_vehicle_prices`. Consecration weighting, recency-weighted median,
  confidence intervals: all live.
- **Market trend / momentum** — `market_segment_stats.price_trend_30d/90d`.
- **Sentiment / demand pressure** — `comment_discoveries` aggregated over members.
- **Bid velocity** — `auction_comments.bid_amount`.
- **Dealer behavior** — `get_seller_analytics` over `vehicle_events.seller_identifier`.
- **Comps** — `get_comps_combined` / `api-v1-comps`.

### BUILD (substrate exists, structure is empty or stubbed)
- **Light the `condition` and `originality` signals** — both neutral 1.0 today
  ("pending build-class-aware scoring," `…valuation…:410-411, 620-623`). The input
  is `proof_of_maintenance(vehicle_id)` (companion paper) +
  `vehicle_condition_scores.descriptor_summary`. This is the single highest-
  leverage build: it lights two of eight signals and is the per-VIN half of the
  provenance output.
- **`vehicle_production_data` beyond the seed** — ~100 rows today; most cells
  empty. Demand-scoped backfill (not speculative — per the autonomous-work gate).
- **Cohort-NAV assembler** — roll the per-VIN oracle outputs into a cohort
  distribution with per-tranche grading. Mostly a query over existing outputs.

### RESEARCH (genuinely unknown — these are the frontiers)
1. **The survivor decay model.** `survival_rate_estimates.estimation_method`
   enumerates `decay_model` but **the estimator does not exist.** The research:
   given fixed `total_produced`, observed unique-VIN sightings over time
   (`proxy_signals.unique_vins_seen`, `listing_frequency_annual`), and an attrition
   prior (~1–2%/yr for 1960s steel, marque- and era-dependent), produce a per-
   cohort `estimated_surviving` with a calibrated confidence. This is the
   first-class survivor denominator, and it is real statistics, not a query.
2. **Cross-marque provenance normalization.** Turn Marti (Ford), Kardex (Porsche),
   Mopar build sheets, and inspection-confirmed matching-numbers into one
   comparable, trust-graded `originality_class` that composes across marques. The
   moat. No precedent — that is exactly why it defends.
3. **Production-figure sourcing per marque.** Where do authoritative production
   counts come from, per make? Marti for Ford, factory registries for Porsche,
   Galpin/registry data elsewhere — sourcing is unsolved and per-marque, and it is
   the denominator the survivor number divides into. (Tagged in the cohort paper's
   build sequence step 10 as RESEARCH.)

---

## 7. Verdict

The oracle is not an invention to be discovered; it is a **maturation to be
finished.** Six of eight signals assemble from live substrate. The two dark
signals (condition, originality) are lit by the proof-of-maintenance ledger. The
three outputs (price, provenance, survivor) map cleanly to existing tables, with
exactly three genuine research nodes: the survivor decay model, cross-marque
provenance normalization, and per-marque production-figure sourcing.

The strategic point stands: **the wrappers are bought, the oracle is built, and
the oracle is the gate.** Everything financial — lending, securitization, freeport,
the tradable cohort index — is a proven template waiting on one input: a number it
can defend. Build the oracle. The rest snaps on.
