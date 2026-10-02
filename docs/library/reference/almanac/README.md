# NUKE ALMANAC

Facts, figures, and reference data. Updated when the numbers change.

*Last updated: 2026-03-21*

---

## Platform Scale

| Metric | Count | Notes |
|--------|-------|-------|
| Active vehicles | 292,077 | Entities with status='active' |
| Total vehicles (all statuses) | ~645,000 | Includes sold, merged, inactive, archived |
| Auction comments | 11,624,010 | 99.9% linked to external_identities |
| Vehicle events | 313,539 | Auction/listing events with source tracking |
| Vehicle images | 32,815,883 | All sources combined |
| Nuke Estimates | 503,337 | Valuations computed |
| VIN-decoded vehicles | 104,494 | Active vehicles with full 17-char VIN |
| Field evidence rows | 746,963 | Data-to-source citations |
| External identities | 510,086 | BaT seller/buyer/commenter profiles |
| Claimed identities | 2 | Linked to Nuke user accounts |
| Organizations | 4,973 | Dealers, shops, auction houses |
| Observation sources | 117+ | Registered data sources with trust scores |
| Listing page snapshots | 393,293 | Archived HTML pages |
| Snapshots with markdown | 66,722+ | Ready for AI extraction (growing) |
| Description discoveries | 14,425 | AI-extracted structured fields from descriptions |
| Comment discoveries | ~126,000 | AI + programmatic sentiment analysis |
| Library entries (condition_knowledge) | 1,258 | Including 174 RPO codes |
| Active vehicles missing description | 42,454 | Gap to fill via AI extraction |
| FB Marketplace vintage vehicles | ~144 per 5-city sweep | ~12% vintage rate |

### Per-Source Vehicle Counts

| Source | Active Vehicles | Notes |
|--------|----------------|-------|
| BaT | ~125,000 | Largest single source |
| Mecum | ~67,000 | Volume auctioneer |
| Barrett-Jackson | ~28,000 | Volume auctioneer |
| Cars & Bids | ~19,000 | Growing |
| Facebook Marketplace | ~14,000 | Scraped from 58 metros |
| Craigslist | ~7,000 | Regional classifieds |
| PCarMarket | ~5,600 | Porsche-heavy |
| Gooding | ~5,000 | Premium |
| Bonhams | ~4,200 | Premium |
| KSL | ~2,900 | Utah regional |
| RM Sotheby's | ~2,500 | Premium |
| Others | ~11,000 | BHCC, Hemmings, eBay, etc. |

## Database

| Metric | Value | Notes |
|--------|-------|-------|
| Database size | ~150 GB | Down from 171 GB after triage |
| listing_page_snapshots | ~79 GB | Largest table, needs retention policy |
| Statement timeout (postgres role) | 120s | DO NOT CHANGE |
| Statement timeout (anon/authenticated) | 15s | DO NOT CHANGE |
| Monthly burn estimate | ~$2,500-4,000 | Down from $5,600 |

### Discovery Throughput (Expected Daily Minimums)

| Source | URLs/day | Method |
|--------|---------|--------|
| BaT | ≥20 | RSS feed + HTML scrape + gmail alerts |
| Cars & Bids | ≥5 | HTML scrape |
| KSL | ≥10 | Feed polling (HTML) |
| Craigslist | ≥10 | Feed polling (HTML) |
| Hemmings | ≥1 | Feed polling (HTML) |
| FB Marketplace | ≥50 | Local script (when running) |

## Observation Source Trust Scores

### Vehicle Sources

| Source | Slug | Category | Base Trust | Supported Kinds |
|--------|------|----------|-----------|----------------|
| Official registry/manufacturer | — | registry | 0.95 | metadata |
| Bring a Trailer | bat | auction | 0.85 | listing, comment, bid, image |
| RM Sotheby's | rm-sothebys | auction | 0.90 | listing, image |
| Gooding & Company | gooding | auction | 0.90 | listing, image |
| Mecum | mecum | auction | 0.75 | listing, image |
| Barrett-Jackson | barrett-jackson | auction | 0.75 | listing, image |
| Cars and Bids | carsandbids | auction | 0.85 | listing, comment, bid, image |
| PCarMarket | pcarmarket | marketplace | 0.80 | listing, image |
| Hagerty | hagerty | marketplace | 0.80 | listing, image |
| Hemmings | hemmings | marketplace | 0.70 | listing, image |
| eBay Motors | ebay | marketplace | 0.50 | listing, image |
| Craigslist | craigslist | marketplace | 0.40 | listing, image |
| Facebook Marketplace | facebook | marketplace | 0.45 | listing, image |
| Rennlist | rennlist | forum | 0.45 | comment |
| iPhoto (owner) | iphoto | owner | 0.60 | image |

### Art Sources (Planned)

| Source | Category | Base Trust | Notes |
|--------|----------|-----------|-------|
| Museum collection API | museum | 0.95 | MoMA, Met, Tate, Pompidou |
| Christie's | auction | 0.90 | Lot data, provenance, results |
| Sotheby's | auction | 0.90 | Lot data, provenance, results |
| Phillips | auction | 0.85 | Contemporary focus |
| Heritage Auctions | auction | 0.80 | Broad, high volume |
| Catalogue raisonné | reference | 0.95 | Definitive artist catalogs |
| Artnet | price_database | 0.85 | Historical pricing |
| Artsy | marketplace | 0.75 | Gallery listings, market data |
| Gallery website | gallery | 0.80 | Artist rosters, exhibitions |
| Artforum | magazine | 0.75 | Reviews, features |
| Art fair (Basel, Frieze) | fair | 0.70 | Booth listings |
| University program | education | 0.65 | Student/faculty data |
| Artist website | self_published | 0.60 | Self-reported |
| Instagram | social | 0.40 | Activity signal |
| Anonymous claim | unverified | 0.20 | Requires identity to gain trust |

## Agent Tier Costs

| Tier | Model | Input $/MTok | Output $/MTok | Max Timeout | Use For |
|------|-------|-------------|--------------|-------------|---------|
| Haiku | claude-haiku-4-5 | $1.00 | $5.00 | 30s | Field extraction, classification |
| Sonnet | claude-sonnet-4-6 | $3.00 | $15.00 | 60s | Quality review, edge cases |
| Opus | claude-opus-4-6 | $5.00 | $25.00 | 120s | Strategy, market intelligence |

**Per-extraction cost**: $0.25-0.50 per vehicle (Haiku primary, Sonnet if escalated)

## Extraction Quality Thresholds

| Threshold | Value | Action |
|-----------|-------|--------|
| Quality score < 0.30 | — | Mark `pending_review` |
| Quality score < 0.40 | ESCALATION_THRESHOLD | Escalate to Sonnet |
| YMM confidence < 0.85 | MIN_YMM_CONFIDENCE | Escalate to Sonnet |
| Entity resolution < 0.80 | — | DO NOT auto-match. Return as candidate. |
| Entity resolution < 0.60 | — | Create new entity. Flag for review. |

## Key Scrape Targets (Art — Planned)

### Museums with Public Collection APIs

| Museum | Location | Collection Size | API/Scrape |
|--------|----------|----------------|-----------|
| MoMA | New York | ~200,000 works | API |
| Metropolitan Museum | New York | ~500,000 works | API (Open Access) |
| Tate | London | ~70,000 works | API |
| Centre Pompidou | Paris | ~120,000 works | API |
| Rijksmuseum | Amsterdam | ~1,000,000 objects | API |
| Art Institute of Chicago | Chicago | ~300,000 works | API |
| National Gallery of Art | Washington DC | ~150,000 works | API |
| Getty | Los Angeles | ~125,000 works | API |
| Smithsonian | Washington DC | ~155,000,000 objects | API |

### Auction Houses (Online Archives)

| House | Archive Depth | Lot Data Quality | Provenance Published |
|-------|-------------|-----------------|---------------------|
| Christie's | 1998-present | High | Yes (most lots) |
| Sotheby's | 2000-present | High | Yes (most lots) |
| Phillips | 2010-present | High | Yes |
| Bonhams | 2005-present | Medium | Partial |
| Heritage | 2001-present | Medium-High | Partial |

### Price Databases

| Source | Coverage | Access |
|--------|---------|--------|
| Artnet Price Database | 1985-present, 16M+ results | Subscription |
| Artsy | Contemporary focus | Free (limited) |
| MutualArt | 2000-present | Subscription |
| Invaluable | Broad, 50M+ results | Subscription |

## Project History

| Date | Milestone |
|------|-----------|
| 2025-10-21 | Project start (first prompt) |
| 2025-11-02 | BaT extraction begins |
| 2025-12-26 | Vision: "bot like Claude Code for photos" |
| 2026-01-30 | Tool transition (Cursor → Claude Code) |
| 2026-02-01 | YONO named and conceptualized |
| 2026-02-26-27 | Peak sprint: 905 prompts, 31.9 hours, 128 commits |
| 2026-03-07-08 | Platform triage: 171→156 GB, 464→440 functions, $3K/mo savings |
| 2026-03-18-19 | Digital Twin Architecture formalized |
| 2026-03-20 | NUKE ENCYCLOPEDIA written. Library structure established. Art + publishing verticals specced. |

**Total as of 2026-03-20**: 541+ sessions, 13,758+ prompts, 2,045+ commits, 142 calendar days.

## Mecum broadcast discovery assay — 2026-10-02

Source: cached timed captions for YouTube `c9fxArnD3IY`; source-backed scope assay in
`output/mecum/audio-discovery/bounded-miss-audit.json`. Counts describe offline
language review leads, not verified vehicle facts or database intake.

| Metric | Measured value | Scope |
|---|---:|---|
| Video duration | 22,028 seconds | Source metadata supplied to pass |
| Caption cues / word tokens | 2,964 / 49,114 | Entire cached transcript scanned |
| Simultaneous adjacent onset pairs | 5 | Preserved by caption index |
| Version 1 / version 2 candidate grains | 2,540 / 2,544 | One category hit per caption |
| Version 1 / version 2 transition leads | 18 / 23 | Unverified navigation language |
| Bounded review groups | 223 | Gap <=20 seconds, onset span <=180 seconds; not lots |
| Distinct cues in manual scope audit | 60 | Deterministic overlapping strata |
| Overbroad category draws | 6 of 24 | Inspected sample only |
| Non-model years | 2 of 5 | Event/racing context in inspected sample |
| Recoverable avenues among unhit sample | 6 of 8 | Inspected sample only |
| Recovered literal next-car leads | 5 of 5 | Lexical follow-up assay, not recall estimate |
| Original WAV / local ASR runtime | 99.9735 / 3.559 seconds | One CPU/int8 base.en clip |
| ASR segments / timestamped words | 18 / 210 | Source seek and speaker roles unresolved |
| New production observations from discovery | 0 | Review-only artifacts |

See the [caption discovery study](../../intellectual/studies/README.md#mecum-caption-and-original-audio-discovery-assay--2026-10-02)
for methodology, limits and reproducibility. No accepted-bid count, auction duration,
crowd emotion or global precision/recall was established by this assay.

The subsequent durable six-source cached-caption batch produced 8,850 candidate
grains and 184 pending scope-review items. Sources span RM Sotheby's, Barrett-Jackson,
Broad Arrow and Bonhams. A second process resumed six completed checkpoints with
zero new rows. These figures are distinct from the 2,544-grain Mecum benchmark and
from previously verified production observations; the discovery writer stays disabled.

Final snapshot for the bounded 30-source selection: 22 completed caption passes,
76,662 cues, 512,662 word tokens, 27,325 candidates and 732 pending review items.
All 22 replay digests passed. Seven routes exhausted bounded retries and one source
was upcoming. See `output/mecum/audio-discovery/loop-final-receipt.json`; these are
caption discovery results, with zero production promotions or paid model API calls.
