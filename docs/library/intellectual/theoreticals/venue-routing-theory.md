# Venue Routing Theory: Which Room Sells This Car

**Status**: Proposed model; empirical inputs measured 2026-07-08 (5-agent evidence sweep)
**Author**: Nuke Research
**Dependencies**: auction-price-formation-theory.md (CBT), valuation-methodology.md, habitus-and-the-exchange.md (consecration)
**Origin**: Skylar's 1966 Mustang coupe sale question — "what is the pipeline and what data causes forks?"

---

## The claim

Venue routing is not "which platform is biggest." Per the Competitive Bidder
Threshold (CBT ≈ 4-5 informed bidders, validated on 143K BaT auctions), the
routing function is:

```
Route(asset) = argmax over venues of
  P(venue assembles ≥4 informed bidders for THIS spec)
  × E[clearing price | that room]
  − fees − time_cost − risk(rejection, no-reserve downside, fraud, non-performance)
```

Every fork in the pipeline is a data question about one of those terms.

## Measured inputs (2026-07-08)

### 1. Buyer composition is spec-dependent — the "dealers snatch cheap coupes" hypothesis is refuted

From 993 buyer-identified first-gen Mustang BaT sales (60.7% coverage; note
the bat_listings two-batch trap — titled rows have no buyers, buyer rows have
no titles; join via vehicle_id):

| Cohort | n | Median | won by ≥2-time buyers | ≥5-time |
|---|---|---|---|---|
| First-gen coupe | 341 | $22.0K | **35.5%** | 15.0% |
| First-gen fastback | 278 | $52.4K | 43.2% | 20.1% |
| All-BaT baseline | 70,542 | $23.0K | 44.3% | 16.9% |

Cheap coupes (<$15K) go to repeat buyers only 24.0% vs 42.9% baseline
(~3 SE). 66.4% of <$20K coupe sales go to buyers with exactly one lifetime
purchase and zero sales. Repeat buyers pay slightly MORE (median $22.5K vs
$21.25K). Buy-and-sell flipper share: 9.4% of coupe sales vs 14.4% baseline.

**Mechanism replacing the hypothesis**: cheap coupes are cheap because their
demand pool is one-time retail enthusiasts with shallow reservation prices;
repeat/collector capital concentrates on fastbacks and $40K+ cars. It is a
demand-structure story, not dealer suppression. (Untestable variant: a dealer
bidding per-client from fresh accounts is observationally identical to a
one-time buyer.) Corroborating: Hagerty's repeat-sale study found cars flipped
TO BaT sell 8-24% higher while cars leaving BaT resell ~20% lower — BaT is the
retail ceiling venue in aggregate, not a wholesale pit.

### 2. Cross-venue tier map (Nuke substrate, 9,434 first-gen Mustangs, sold only)

Platform from URL domain (canonical_platform is unreliable; B-J sale year from
URL slug). Medians: specialty-dealer delist $139.9K (n=21) · Gooding $84.4K
(16) · Barrett-Jackson $55.0K (1,635; median sale year 2016 — nominally
understated premium) · Mecum $46.2K (2,505) · **BaT $35.3K (2,148)** · Cars&Bids
$27.3K (13) · Craigslist $23.5K (103) · FB Marketplace $14.0K (32).

Coupe-only: Mecum $42.9K (Shelby/restomod-label pollution) · B-J $24.5K ·
**BaT $21.3K (n=668)**. BaT trades the bottom of every body style and is
coupe-heavy; the venue differential is roughly half selection, half genuine
(~20-25% same-body gap).

Web anchor: '66 hardtop coupe auction median $14,175 vs retail asking ~$28K
(Autotrader Classics). **The wholesale↔retail spread for coupes is ~2x — the
core arbitrage of venue choice.** Auctions clear coupes near wholesale; retail
channels ask (not necessarily get) double.

### 3. Venue economics (2026, cited in evidence sweep)

| Venue | Seller cost | Time-to-cash | Tier-specific risk |
|---|---|---|---|
| BaT | $99 (+5% buyer, capped) | 5-9 weeks | ~40% acceptance; $15-35K commons pushed to no-reserve |
| FB Marketplace / groups | $0 | days-weeks | scam load; no escrow exists; group data unmeasured |
| VMF forums classifieds | $0 (5 posts + 5 days) | unknown | max Mustang-literate audience, min reach |
| Hemmings | $99.95 | ~3-5 weeks | unsold → free 6-mo Make Offer |
| Craigslist | $5 | days-weeks | local only |
| eBay Motors | $19-79 | unbounded | non-binding bids, deadbeats |
| Consignment dealer | 12.5-25% of sale | 90-day exclusive | $3.1-6.3K on a $25K car |
| B-J / Mecum (both run Las Vegas: Sept 10-12 / Nov 12-14, 2026) | $450-1,250 entry + 6-12% | event-gated | no-reserve norm; cheap lots run early when retail bidders are thin |

### 4. FB/local instrument audit — "barren" is now a measurement

228 FB classic-Mustang listings captured (Feb-Jun 2026), **zero defensible
sold prices** (all 'sold' statuses are batch flips or ask-echo backfills, incl.
$1,234 placeholders), **zero time-on-market** (sighting time-series never ran),
Las Vegas = 3 usable classic-Mustang asks in 5 months, FB groups = zero tables
and 1 group-sourced Mustang item ever. Only citable FB signal: national ask
distribution '65-66 non-fastback/conv coupes, n=98: median ask **$16,000**
(p25 $11.0K / p75 $21.8K) — at or below BaT's sold median for the same spec.
Capability exists (fb-scraper via owner session; squarebody group saves prove
the mechanic); coverage does not.

### 5. Creative path — sized honestly

Influencer association raises price (Doug's Effect, HICSS 2025 — direction
confirmed, no public effect size). Celebrity premiums (16,000% Bullitt) are
non-transferable. Famous-on-YouTube non-celebrity cars routinely hammer at
market (Cleetus fleet, VGG Cadillac, Hartford C8). Picture-car rental for a
'60s Mustang: $350-750/day, realistic $1-4K/yr gross, coupes below convertibles.
Content: ~$3-4 RPM → hobby money below ~50K subs; **the media value attaches to
the person/channel/platform, not the title.** Realistic story premium ON THE
ASSET: +10-30% within its band. Story moves you along the band; spec moves you
between bands.

## The routing forks (what data decides each)

1. **Body/spec tier** → which venue's pool holds collector capital (buyer-composition table).
2. **Build class** → median vs tail: BaT modified-coupe median is only +$3K over stock; the $60K+ tail exists but is tail, not expectation.
3. **Documentation depth** → the +10-30% in-band premium; also the acceptance-gate asset at curated venues.
4. **Wholesale↔retail spread for the spec** → when ~2x (coupes), retail-side channels carry the theoretical premium IF the seller can perform buyer-discovery themselves.
5. **Time-to-cash need** → auctions are 5-9 weeks; events are calendar-gated; local is days.
6. **Curation risk** → BaT 40% acceptance + no-reserve pressure exactly at the $15-35K common-car tier.
7. **Fee structure** → flat-fee auction ≪ percentage consignment at this tier.
8. **Fraud/performance friction** → FB/eBay burdens are seller labor, not fees.
9. **Geography** → same-city events (B-J/Mecum Vegas) kill transport cost but not entry+commission.
10. **Seller goal** → max-$ vs fast-$ vs story-continuation (creative path pays the platform/person, not the car).

## What Nuke uniquely adds (the portal thesis)

Nobody publishes venue × spec × buyer-composition. We computed it from our own
substrate in one evening. The routing function is buildable today from:
`bat_listings` buyers (needs post-Feb-2026 enrichment re-run), the cross-venue
tier map (needs the platform-from-URL fix productized), and consecrated
outcomes (`vlva_verified_sales` is the only tier-1 dealer-retail ledger we
hold — the family dealership is itself a routable venue with cited sales).

Missing instruments, in priority order: (1) FB sighting time-series (dwell =
the retail-demand signal), (2) FB group coverage via owner-session scraping,
(3) dealer retail price capture (dealer_inventory has 68 first-gen Mustangs,
zero prices), (4) post-sale outcome feedback into the estimate loop
(projection_outcomes already logs projections; close the loop on realized
sales).

## Open questions

- Can buyer-composition be maintained live (BaT buyer scrape stopped 2026-02-22)?
- Is the coupe wholesale↔retail spread realizable, or does retail-ask survivorship
  (unsold $28K asks) explain most of it? Needs FB/CL dwell + delist-vs-sold data.
- Does the family-dealership fork (0% external commission, cited VLVA retail
  spreads of +$20-38K on comparable classics) dominate all third-party
  consignment at every tier? On current evidence, yes trivially — but it prices
  Skylar's labor and floor time at zero.
