## Public research sources for “how many were made”

This doc is for **real-world production volumes** (not counts of rows in our DB). It prioritizes **public, primary sources** first, then high-quality public aggregates.

### Key clarifications (so we don’t mix apples and oranges)

- **Production**: units built by factories in a period (often disclosed at *company/brand/region* level, rarely at *model* level).
- **Sales / Deliveries / Wholesales**: units shipped/sold into the channel (more commonly disclosed, sometimes by model in certain markets).
- **Registrations**: units registered with a government agency (excellent proxy for “units in-market”; often the best public path to model-level counts in some regions).

### Tier 1 (best): OEM filings + official investor relations

These are usually the most defensible “public data” sources and are the right starting point for “all makes likely have reports”.

- **Regulatory filings (structured + archived)**
  - **US**: SEC EDGAR (10‑K, 10‑Q, 8‑K, 20‑F, 6‑K) via the EDGAR site and APIs ([EDGAR](https://www.sec.gov/edgar), [SEC API docs](https://www.sec.gov/edgar/sec-api-documentation)).
  - **Canada**: SEDAR+ (public filings).
  - **UK**: Companies House (company accounts; usually less operational detail than investor decks).
  - **EU/other**: country-specific market regulators (varies by issuer listing venue).

- **OEM investor relations (often has the operational nuggets)**
  - **Earnings releases + slide decks**: frequently include “units wholesaled”, “deliveries”, and sometimes plant/region production commentary.
  - **Prepared remarks / transcripts**: the most “public” transcript source is often the **company’s own IR site** (webcast replay + PDF remarks). Third-party transcript aggregators can be useful but are often **license/ToS constrained**.
  - **Annual report (shareholder letter / MD&A)**: good for high-level volume trends; model-level production is uncommon.

**What you can reliably extract here**
- Company/segment production constraints, plant output commentary, quarterly delivery/wholesale volumes, regional volumes, sometimes key model run-rate commentary.

### Tier 2: Industry associations (high coverage, lower granularity)

Best for **manufacturer/country/region** production totals; rarely model-level.

- **OICA** (global production statistics): great baseline for “how many vehicles produced” by country/region and sometimes manufacturer aggregates ([OICA](https://www.oica.net/)).
- **ACEA** (EU market statistics, registrations/market volumes) ([ACEA](https://www.acea.auto/)).
- **National associations** (examples; coverage and granularity vary):
  - US: Auto Innovators (sales/industry stats)
  - Japan: JAMA
  - China: CAAM
  - India: SIAM
  - UK: SMMT
  - Germany: VDA

**What you can reliably extract here**
- Annual/monthly totals by market and sometimes by manufacturer/brand, useful for sanity checks and “backstops”.

### Tier 3: Government datasets (best route to model-level counts in some markets)

When you truly need **make+model counts** and the OEM doesn’t publish model-level production, **registrations** are often the most scalable public substitute.

- **EU / EEA**: European Environment Agency (EEA) vehicle monitoring datasets often include **counts** tied to vehicle attributes and can be used to approximate model-level volumes ([EEA datasets](https://www.eea.europa.eu/data-and-maps)).
- **Country vehicle registration agencies**: some publish open data (or publish tables) with make/model counts; availability varies widely by country.

**What you can reliably extract here**
- Model-level counts (registrations) for specific markets/years where published.

### Tier 4: OEM pressrooms + sales releases (model-level in some markets)

Many manufacturers (or national sales orgs) publish monthly/quarterly sales summaries. This is often **sales**, not production — but it’s frequently the best public model-level signal.

- OEM pressroom “monthly sales” pages (US market has historically been the most common place for this).
- Market-specific distributor releases (e.g., “Brand X UK sales by model”).

### Tier 5 (fallback): Reference sites + enthusiast registries

Use these when nothing else exists, but treat as **lower confidence** unless the page cites primary documentation.

- Wikipedia (Infobox “production” often exists but is commonly a *year range*, not units).
- Wikidata (sometimes has “total produced” style properties; coverage is inconsistent).
- Model-specific clubs/registries and marque historians (excellent for certain classics; not universal).

### Practical strategy for “all makes and models”

If the goal is to backfill production-like numbers across the entire DB:

1. **Pick the metric per use-case**: produced vs sold vs registered vs delivered. Don’t force one metric to answer every question.
2. **Map make → parent company (issuer)** so you can harvest filings/IR consistently.
3. **Store provenance**: `source_type`, `source_url`, `as_of_period`, `geo_market`, and an explicit `metric_kind`.
4. **Use a tiered resolver**:
   - Tier 1: OEM filings/IR for official volumes (usually brand/company level)
   - Tier 3/4: registrations/sales for model-level where available
   - Tier 5: Wikipedia/Wikidata for long-tail fallback (flagged as low confidence)

