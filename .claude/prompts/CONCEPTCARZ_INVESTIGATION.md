# Agent Task: ConceptCarz Data Investigation & Remediation

## Context

On 2026-02-06, a single bulk import created **347,912 vehicle records** with `auction_source = 'conceptcarz'`. This is 27% of our entire vehicles table. The import left zero provenance trail — no `discovered_by`, `automation_script`, `import_method`, or `import_source` fields were set.

All records use fake URLs like `conceptcarz://event/{event_id}/{title}` — not real web URLs. There are zero images, zero descriptions, zero VINs, and zero real listing URLs. The data has year/make/model and sale_price (270K of 348K rows have a price).

ConceptCarz.com is an **auction results aggregator** — it catalogs results from live auction events (Mecum, Barrett-Jackson, RM Sotheby's, Bonhams, Gooding, etc.). These 348K records represent historical auction lots across ~2,200+ events spanning 1900-2026, with 4,628 distinct makes and 107K distinct models.

## The Problem

These records are:
1. Inflating our vehicle count from ~950K real to 1.3M reported
2. Dragging down every quality metric (0% images, 0% descriptions, 0% VINs)
3. Likely **duplicating vehicles we already have** from the actual auction platforms (Mecum, B-J, etc.)
4. Polluting search results with empty shells that have no images or detail

## Your Mission

### Phase 1: Investigate the Source (DO NOT MODIFY DATA YET)

1. **Find the ingestion script.** Search the codebase for anything that created these records:
   ```bash
   grep -r "conceptcarz" scripts/ supabase/functions/ --include="*.ts" --include="*.js" --include="*.mjs" --include="*.cjs" -l
   ```
   Also check git log:
   ```bash
   git log --all --oneline --grep="conceptcarz"
   git log --all --oneline --since="2026-02-05" --until="2026-02-07"
   ```

2. **Investigate conceptcarz.com itself.** Use Firecrawl to scrape a few pages:
   - Homepage: `https://www.conceptcarz.com/`
   - A sample event page (find a real event URL)
   - A sample vehicle/lot page

   Answer: What data does ConceptCarz actually provide per vehicle? Images? Descriptions? VINs? Chassis numbers? Condition reports? Links to the actual auction house page?

3. **Measure overlap with existing data.** How many ConceptCarz records duplicate vehicles we already have from the actual auction sources?
   ```sql
   -- Fuzzy match: same year + make + similar model + similar price from another source
   SELECT COUNT(*) FROM vehicles c
   JOIN vehicles o ON c.year = o.year
     AND LOWER(c.make) = LOWER(o.make)
     AND o.auction_source != 'conceptcarz'
     AND c.auction_source = 'conceptcarz'
     AND ABS(COALESCE(c.sale_price,0) - COALESCE(o.sale_price,0)) < 1000
   WHERE c.auction_source = 'conceptcarz'
   LIMIT 1;  -- just check if join works first
   ```

   **Be careful with this query — it could be expensive.** Sample first:
   ```sql
   -- Start with a small sample
   WITH sample AS (
     SELECT id, year, make, model, sale_price
     FROM vehicles
     WHERE auction_source = 'conceptcarz' AND sale_price IS NOT NULL
     ORDER BY random() LIMIT 100
   )
   SELECT s.year, s.make, s.model, s.sale_price,
     o.id as match_id, o.auction_source as match_source, o.sale_price as match_price, o.listing_url
   FROM sample s
   JOIN vehicles o ON s.year = o.year
     AND LOWER(s.make) = LOWER(o.make)
     AND o.auction_source != 'conceptcarz'
     AND ABS(COALESCE(s.sale_price,0) - COALESCE(o.sale_price,0)) < 500
   LIMIT 20;
   ```

4. **Check what ConceptCarz has that we DON'T.** Some of these 348K records might represent vehicles/auction results from platforms we haven't scraped yet. That's valuable signal — not junk.
   ```sql
   -- Makes that ONLY appear in conceptcarz
   SELECT c.make, COUNT(*) as conceptcarz_count
   FROM vehicles c
   WHERE c.auction_source = 'conceptcarz'
     AND NOT EXISTS (
       SELECT 1 FROM vehicles o WHERE LOWER(o.make) = LOWER(c.make) AND o.auction_source != 'conceptcarz'
     )
   GROUP BY c.make
   ORDER BY conceptcarz_count DESC
   LIMIT 20;
   ```

### Phase 2: Determine the Right Strategy

Based on Phase 1 findings, recommend ONE of these approaches:

**Option A: Reclassify as Reference Data**
- Move to a `auction_results_reference` table (or add a flag like `entry_type = 'reference'`)
- Keep as comps/pricing signal, exclude from main vehicle search
- Link to matching vehicles from other sources as additional price observations

**Option B: Enrich from ConceptCarz.com**
- If ConceptCarz pages have images, descriptions, chassis numbers → build extractor
- Map `conceptcarz://event/{id}` to real URLs on conceptcarz.com
- Re-extract with full data

**Option C: Merge into Existing Records**
- If most overlap with Mecum/BJ/Bonhams records we already have → merge the sale_price as an additional observation
- Delete the duplicate shell, preserve the signal

**Option D: Hybrid**
- Unique vehicles (no overlap): Enrich from source OR reclassify as reference
- Duplicates: Merge price signal into existing record
- Non-vehicles (memorabilia, signs, gas pumps): Quarantine or reclassify

### Phase 3: Execute (ONLY after founder reviews Phase 1-2 findings)

Do NOT bulk modify or delete any data without explicit approval. Present your findings and recommendation first.

## Important Rules

- **BATCHED OPERATIONS ONLY.** Never run unbounded UPDATE/DELETE. Always LIMIT 1000 + loop.
- **Read CLAUDE.md** before starting — especially the Batched Migration Principle.
- **Register yourself** in `.claude/ACTIVE_AGENTS.md` as working on "conceptcarz investigation".
- **Log everything.** When you run queries, note the results. This IS the transparency paper.
- **Do not create new tables or migrations** without approval.
- The data we sample includes memorabilia ("1948 Original Gulf Motor Oil Tin Sign", "1936 Texaco Gas Pump") — these are NOT vehicles. Quantify how many are non-vehicle lots.

## Key Queries to Have Ready

```sql
-- Total conceptcarz breakdown
SELECT COUNT(*) as total,
  COUNT(*) FILTER (WHERE sale_price IS NOT NULL) as has_price,
  COUNT(*) FILTER (WHERE nuke_estimate IS NOT NULL) as has_estimate,
  COUNT(*) FILTER (WHERE make IN ('Original', 'Texaco', 'Coca-Cola', 'Gulf', 'Mobil', 'Shell', 'Sinclair', 'Standard')) as likely_memorabilia
FROM vehicles WHERE auction_source = 'conceptcarz';

-- Distinct events
SELECT COUNT(DISTINCT SUBSTRING(listing_url FROM 'conceptcarz://event/(\d+)/')) as event_count
FROM vehicles WHERE auction_source = 'conceptcarz';
```

## Deliverable

Write your findings to `.claude/CONCEPTCARZ_FINDINGS.md` with:
1. What the ingestion script was and how it ran
2. What conceptcarz.com actually offers per lot (with screenshots/examples)
3. Overlap % with existing sources
4. Non-vehicle lot count
5. Your recommended strategy (A/B/C/D) with justification
6. Proposed SQL migration plan (batched, reversible)
