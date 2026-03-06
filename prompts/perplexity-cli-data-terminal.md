# Perplexity Research Prompt: CLI Data Terminal for Vehicle Auction Intelligence

I'm building a natural language CLI tool — a "Bloomberg terminal for the car auction market" — on top of a production Supabase Postgres database with significant scale. I need architecture guidance for the NL-to-SQL layer, output formatting, and guardrails.

## The Database (Real Numbers)

**1.29 million vehicles** across 112 auction sources, spanning years 1886–2027.

Core stats:
- **30.2M** vehicle images
- **11.7M** auction comments
- **4.1M** individual bid records (bat_bids)
- **797K** AI-computed valuations (nuke_estimates)
- **769K** vehicles with sale prices ($0–$43.2M, avg $49K)
- **659K** price history records (vehicle_price_history)
- **567K** valuation feed entries
- **507K** bidder/seller profiles (bat_user_profiles)
- **320K** cleaned/normalized prices (clean_vehicle_prices)
- **242K** verified VINs
- **228K** auction events
- **127K** AI sentiment analyses on comments (comment_discoveries)
- **1.35M** vehicle observations (source-agnostic event store)
- **839K** archived listing page snapshots

**Top makes by volume:**
Chevrolet (193K), Ford (138K), Porsche (86K), Mercedes-Benz (74K), BMW (51K), Ferrari (30K), Toyota (30K), Dodge (29K), Pontiac (29K), Jaguar (25K), Cadillac (23K), VW (21K), Honda (19K), Jeep (18K), Land Rover (18K)

**Auction platforms:** BaT (618K), Mecum (175K), Barrett-Jackson (106K), Cars & Bids (41K), Bonhams (41K), RM Sotheby's (19K), Silver Auctions (18K), Gooding (12K), Craigslist (8K), Facebook Marketplace (7K), Collecting Cars (7K), + 100 more

**Computed scores on vehicles:** heat_score (791K), nuke_estimate (791K), deal_score (10K), signal_score (2.6K)

## The Vehicles Table (Primary Entity)

The `vehicles` table has **195+ columns**. Key queryable dimensions:

**Identity:** year, make, model, trim, series, generation, vin, era (antique/prewar/classic/muscle/malaise/90s/2000s/modern)
**Pricing:** sale_price, asking_price, msrp, high_bid, winning_bid, nuke_estimate, deal_score, cz_estimated_value
**Auction:** auction_source, auction_status (active/ended/sold), reserve_status (no_reserve/reserve_met/reserve_not_met), auction_outcome, bid_count, view_count, comment_count, bat_watchers
**Scores:** heat_score, signal_score, deal_score, quality_grade, investment_quality_score, overall_desirability_score, social_positioning_score, provenance_score, data_quality_score
**Specs:** engine_type, engine_liters, horsepower, torque, transmission_type, drivetrain, body_style, weight_lbs, zero_to_sixty, quarter_mile, top_speed_mph
**Location:** state, city, zip_code, country, bat_location, listing_location
**Condition:** condition_rating (1-10), mileage, is_modified, known_flaws
**Provenance:** previous_owners, bat_seller, bat_buyer, platform_source, discovery_source

## Key Related Tables

| Table | Rows | Join Key | What It Has |
|-------|------|----------|-------------|
| auction_comments | 11.7M | vehicle_id | comment_text, username, posted_at — full comment corpus |
| bat_bids | 4.1M | vehicle_id | bid_amount, bidder, bid_time — individual bid-level data |
| comment_discoveries | 127K | vehicle_id | overall_sentiment, sentiment_score, raw_extraction (themes, market signals, condition signals, key quotes) |
| nuke_estimates | 798K | vehicle_id | estimated_value, confidence, comparable_count, methodology |
| vehicle_price_history | 660K | vehicle_id | price snapshots over time |
| clean_vehicle_prices | 320K | vehicle_id | normalized/cleaned sale prices for analytics |
| bat_user_profiles | 507K | username | buyer/seller history, reputation |
| auction_events | 229K | vehicle_id | platform, event_date, result |
| vehicle_observations | 1.35M | vehicle_id | source-agnostic event store (listings, comments, bids, sightings) |
| listing_page_snapshots | 840K | url | archived HTML/markdown of every page fetched |

## Example Queries I Want to Support

Natural language → SQL → formatted terminal output:

```
> show me all tesla sells
→ Query vehicles WHERE make='Tesla' AND auction_status='sold', format as table with price/model/year

> bid velocity on porsche 911s over time
→ Join vehicles + auction_comments, group by month, compute comments/hour and late surge %, show trend

> market curve for land rovers in the USA
→ vehicles WHERE make='Land Rover', group by year, compute avg/median/min/max sale_price, show depreciation

> what's the sentiment on air-cooled 911s vs water-cooled
→ Join comment_discoveries, filter by year ranges (pre-1999 vs post), compare sentiment_score distributions

> highest bid velocity auctions this month
→ Join vehicles + auction_comments, compute comments/hour, rank, show top 20

> which makes have the most bidding wars
→ Compute late_surge_pct (comments in final 25% of auction duration), rank makes

> ferrari values over the last 5 years
→ vehicle_price_history or clean_vehicle_prices, filter make='Ferrari', group by quarter, show trend

> who are the biggest BaT buyers
→ bat_user_profiles or vehicles.bat_buyer, group by buyer, sum purchases

> deal score leaders — underpriced trucks right now
→ vehicles WHERE deal_score IS NOT NULL AND body_style LIKE '%truck%', ORDER BY deal_score DESC

> compare 911 turbo depreciation to 911 GT3
→ Two subqueries on vehicles, group by age, overlay curves
```

## What I Need Perplexity to Research

### 1. NL-to-SQL Architecture (2025-2026 best practices)

What's the current state of the art for letting an LLM generate SQL against a known schema? Specifically:

- **Claude tool_use with SQL execution** vs **structured intermediate query DSL** vs **pre-built query templates the LLM selects from** — which approach works best for a 195-column table with 12+ join targets?
- Should I send the full schema in the system prompt, or use a compressed schema summary? The vehicles table alone is 195 columns — that's a lot of tokens. What's the recommended compression strategy?
- How do production NL-to-SQL systems handle the "semantic gap" — e.g., "sells" means auction_status='sold', "bid velocity" means comments/hour, "market curve" means group-by-year price aggregation? Semantic layer? Few-shot examples? Fine-tuned embeddings?
- What's the failure mode distribution? How often does Claude/GPT-4 generate syntactically valid but semantically wrong SQL, and what are the mitigation patterns?

### 2. Existing Tools & Frameworks

- **Is there a production-quality open source NL-to-SQL CLI** that I should build on instead of from scratch? Interested in: text2sql, pgai, Vanna AI, SQLcoder, DuckDB + LLM combos, or anything else current.
- **Terminal visualization libraries** for Node.js or Python that can render ASCII bar charts, tables, sparklines, and heatmaps — like what a Bloomberg terminal would show. Not TUIs, just rich formatted output to stdout.
- Any **Claude-specific** patterns or examples of NL-to-SQL with Anthropic's tool_use / function calling that are documented?

### 3. Query Safety & Performance

- My production database has 1.29M vehicles and 11.7M comments. What guardrails prevent an LLM-generated query from doing a sequential scan on 30M images or a cross-join that takes down the DB?
- Read-only enforcement: Supabase read-only API key, or Postgres role with SELECT-only grants, or query parsing/validation before execution?
- Query cost estimation: can I use EXPLAIN (without ANALYZE) to pre-check LLM-generated SQL before running it? What's the token cost vs latency tradeoff for a "plan, validate, execute" pipeline?
- Statement timeout: what's a reasonable ceiling (5s? 15s?) for an interactive CLI querying tables this size?

### 4. Presentation Layer

- Should the LLM generate the ASCII visualization directly (it's surprisingly good at this), or should I separate SQL generation from output formatting? What are the tradeoffs?
- How do I handle follow-up queries that refine the previous result — e.g., "now filter that to just California" or "break that down by trim"? Conversation context management in a CLI.

### 5. Ambiguity & Domain Knowledge

- "911" could mean Porsche 911 or year 911. "sells" means sold. "air-cooled" means pre-1999 Porsche. "muscle era" means 1964-1973. How should I encode this domain knowledge — in the system prompt, as a lookup table the LLM can reference, or as a RAG layer?
- The `era` column already buckets vehicles into antique/prewar/classic/muscle/malaise/90s/2000s/modern. Should the LLM know about this column explicitly?

## Constraints

- **Stack:** Node.js primary, Python acceptable for ML/analytics layer. Supabase (Postgres 15). macOS CLI.
- **LLM:** Anthropic Claude (I have an API key). Open to using Claude for the NL-to-SQL layer. Not interested in OpenAI.
- **Latency target:** <3 seconds from query to first output for simple queries. Complex aggregations can stream.
- **This is a data terminal, not a chatbot.** Dense, formatted output. No "Sure! Here's what I found..." fluff. Think `psql` meets Bloomberg meets natural language.

Give me a concrete architecture recommendation with specific libraries, not just concepts.
