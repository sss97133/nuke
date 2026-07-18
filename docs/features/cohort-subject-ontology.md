<!-- Authored by the cohort-subject-buildout workflow (2026-06-23). CANON for make/model/year cohort subjects. -->

# Cohort-Subject Ontology — make / model / generation / year

**Status:** CANON. Read before touching any cohort subject (`make_model_profiles`, `vehicle_production_data`, `get_make_model_terminal`).
**Substrate verified live (2026-06-22, project `qkgaybvrernstplzjaam`).** Every table/RPC/column named here exists. We POPULATE; we do not mint.

---

## 0. What this is and the hole it fills

The iOS cohort terminal already ships. It calls `get_make_model_terminal(p_make,p_model,p_year,p_grain)` and lets a user drill **Chevrolet → Blazer → 1977**. Each tap is supposed to land on a real, evidence-backed node. Today it lands on a hollow one:

- `make_model_profiles` has **25 rows, and `cohort_count`, `production_count`, `survival_rate`, `sentiment_score`, `median_price`, `index_sponsor_org_id` are NULL in every single row.** The registry exists; the numbers were never filled.
- `vehicle_production_data` has **35 rows. 16 are real and cited** (Wikipedia, chevellestuff.net, corvsport, Mustang Attitude, stuttcars, Blue Oval Trucks, zhome.com). **19 are contamination:** 15 `data_source='manufacturer'` rows with `source_url IS NULL` (round-number 2020 fabrications — F-150 = 8000 / 180000 / 200000; Civic, Camry, 911, Ferrari 488 duplicated at 1000 and 200) + 4 `data_source='registry'` rows with **conflicting uncited numbers** (K5 Blazer 1977 = 30000 AND 15000; Bronco 1977 = 25000 AND 10000).
- Makes are NOT in `organizations` yet (Chevrolet, Ford, Porsche absent).
- The fleet (`vehicles`, 918,956 rows) is the live denominator and it is real: Chevrolet 158,287 / Ford 112,089 / Porsche 49,241 / Mercedes-Benz 43,138 / BMW 31,302 … down a long tail.

This doc defines what each grain node IS, exactly which numbers it carries, and exactly how each number is sourced — with the cardinal rule that **a production number that has no credible source URL does not exist.**

---

## 1. The grain hierarchy

`make_model_profiles.grain ∈ {make, model, generation, year}`. A subject is uniquely `(canonical_make, canonical_model, grain, year | year_start..year_end)`. Register via `register_make_model_subject(p_make, p_model, p_year, p_grain, p_year_start, p_year_end)`, which resolves the model against `canonical_models` (3,454 models / 213 makes) and sets `canonical_model_id`.

The four grains roll **down** for fleet aggregates (a make's cohort = sum of its models' cohorts) and roll **up** for citation (a year's production is the citable atom; the generation/model figure is a *sum or range of cited years*, never an independent guess).

### MAKE — e.g. Chevrolet
- **IS:** the manufacturer as an org-entity. The drill root. Also a row in `organizations` (see §4). `canonical_model` is left as the make sentinel the RPC expects for a make-grain node (model omitted / make-level).
- **cohort_count:** `COUNT(*) FROM vehicles WHERE upper(make)=upper($make)`. Real today (Chevrolet = 158,287). This is fleet membership in Nuke, NOT global production.
- **production_count:** **NULL by design.** "How many Chevrolets ever made" is not a defensible single number; never fabricate one. The make node's rarity/survival come from its children, not a make-level production figure.
- **median_price:** median of children's `median_price` where present, or median listing price of the make's fleet rows that carry a price — sourced, never invented.
- **sentiment_score:** rolled up from child sentiment (see §1 YEAR). NULL until children have it.
- **rarity_tier:** NULL at make grain (a make is not rare).

### MODEL — e.g. Blazer / K5 Blazer (spans generations)
- **IS:** the nameplate across its whole life. `canonical_model_id` → `canonical_models` row, which already carries `year_start`, `year_end`, `body_styles[]`, `aliases[]`, `generation`. **This is where the body-style-split canonicalization lives (§6).**
- **cohort_count:** `COUNT(*)` of all fleet rows whose `model` canonicalizes to this model (after alias/body-style folding, §6). Real today.
- **production_count:** sum of the model's **cited** year/generation production figures **only if the set of cited years is complete enough to be honest**; otherwise NULL with `rarity_reason='model-total requires complete cited year set; have N of M years'`. A model total is a *derived sum of citations*, never a standalone number.
- **survival_rate:** computable only when `production_count` is known+cited (§3).
- **rarity_tier:** from `production_count` if known (§5), else NULL.

### GENERATION — e.g. K5 Blazer 1973–1991 (`year_start`..`year_end`)
- **IS:** an engineering-distinct run. Registered with `p_grain='generation'`, `year_start`/`year_end` set (the existing K5 generation row 1973–1991 already does this). Generation boundaries come from `canonical_models.generation` / `year_start`/`year_end`, not invented.
- **cohort_count:** fleet rows for the model within `[year_start, year_end]`.
- **production_count:** sum of the **cited** per-year figures inside the generation window; NULL if the cited set is incomplete. Many sources publish a single generation-total with one URL — that is a valid single citation and is stored as a generation-grain `vehicle_production_data`-equivalent (a generation production atom carrying `source_url`).
- **survival_rate / rarity_tier:** as model, gated on cited production.

### YEAR — e.g. K5 Blazer 1977 (the finest grain, the terminal leaf)
- **IS:** the citable production atom and the most common terminal tap. `p_grain='year'`, `year` set.
- **cohort_count:** `COUNT(*) FROM vehicles WHERE make+model+year match` (post-canonicalization). Real today.
- **production_count:** the value from the **single best cited row** in `vehicle_production_data` for that `(make, model, year)` — `total_produced` whose `source_url IS NOT NULL` and is credible. If no cited row exists → **NULL**, and the node honestly reads "production unknown" (§3). Never the round-number guess.
- **survival_rate:** `cohort_count / production_count`, ONLY when production is cited (§3). Note this is *Nuke-fleet survival into our dataset*, not absolute road survival — label it as such on the surface; it is a real ratio of two real numbers.
- **sentiment_score:** derived from real observations about this cohort (listing/auction comment sentiment, `collector_demand_score`, watch/bid density) — a sourced aggregate, NULL until those observations are wired. Never a vibe.
- **rarity_tier:** from cited `production_count` via §5; NULL ("rarity unknown") if production unknown.

### Number-sourcing summary (every value carries source DNA)

| number | grain(s) | source | fabricate-able? |
|---|---|---|---|
| cohort_count | all | `COUNT(*)` over `vehicles` (live fleet) | no — it's a query |
| production_count | year (atom); gen/model (cited sum/range) | `vehicle_production_data.total_produced` **WITH `source_url`** | **NEVER** — cited or NULL |
| survival_rate | model/gen/year | `cohort_count / production_count`, cited denom only | no — derived, gated |
| rarity_tier | model/gen/year | thresholds on cited `production_count` (§5) | no — derived, gated |
| median_price | all | median of priced fleet/listing rows | no — from data or NULL |
| sentiment_score | all | aggregate of real observations | no — from data or NULL |

---

## 2. Production-citation discipline — cited-URL-or-UNKNOWN

**The cardinal rule, mechanized:** a `vehicle_production_data` row is *trusted* iff `source_url IS NOT NULL` AND the source is credible (manufacturer report, marque registry/encyclopedia, well-known production database). A round number with `source_url IS NULL` is contamination by definition.

The read path (`get_make_model_terminal` and any backfill) MUST filter:
```sql
WHERE source_url IS NOT NULL
  AND coalesce(quarantined, false) = false
```
so a node's `production_count` can ONLY ever be a cited figure.

### Quarantine, never delete (flag / supersede)
We do not DELETE the 19 bad rows — deletion erases the evidence that we caught contamination, and a future scrape could re-create them. We **flag and supersede**:

1. Add two columns to `vehicle_production_data` (additive migration, no data loss): `quarantined boolean DEFAULT false`, `quarantine_reason text`. (And, if not present, `superseded_by uuid` to point a bad row at its cited replacement.)
2. **Flag the 15 `manufacturer` fabrications:** `quarantined=true, quarantine_reason='fabricated: round number, no source_url (2026-06 audit)'` for every `data_source='manufacturer' AND source_url IS NULL` row.
3. **Flag the 4 `registry` conflicts:** `quarantined=true, quarantine_reason='uncited + internally conflicting (K5 1977 30000 vs 15000; Bronco 1977 25000 vs 10000)'`.
4. When a real cited figure is later found for K5 Blazer 1977 / Bronco 1977 / F-150 2020 / etc., insert the **new cited row** and set the quarantined rows' `superseded_by` to it. The contamination stays as a tombstone; the live read never sees it.

Result: zero fabricated numbers reach a node, and we retain a provable audit trail of what was wrong.

---

## 3. Survival rate — honest denominator or none

`survival_rate = cohort_count / production_count`. It is computed **only** where `production_count` came from a cited row. Where production is unknown:
- `survival_rate = NULL`
- the node surfaces **"production unknown — needs a cited figure"** with `rarity_reason` naming what's missing (e.g. `'no cited production_data row for Chevrolet/K5 Blazer/1977 — quarantined registry rows conflict 30000/15000'`).

**Never** invent a denominator to make the ratio render. A blank survival field is an intake gap (ours), not a market verdict. On the surface, label the computed value as *"share of production present in the Nuke fleet"* so the ratio is not mistaken for absolute road-survival.

---

## 4. Makes as organizations

Makes are org-entities, consistent with "everything is an entity." For each make that has fleet membership:
- Upsert an `organizations` row: `name`/`business_name` = canonical make, `org_type='manufacturer'` (also set `entity_type='manufacturer'`), `source`/`source_url` to the marque's authority page, `is_public=true`. Do not fabricate financial/shop columns — leave them NULL.
- Link the make-grain `make_model_profiles` row via **`index_sponsor_org_id`** → that org id. (The column exists and is the natural FK to the make org. If product later wants a paying *sponsor* distinct from the manufacturer identity, that's a separate concern; for identity-linkage `index_sponsor_org_id` is what we have and it is NULL today.)
- This makes the make node drillable into the org surface (logo, country, founded_year) without minting a new "manufacturers" table.

Order of operations: create make-orgs for the top makes by fleet membership first (Chevrolet, Ford, Porsche, Mercedes-Benz, BMW, Ferrari, Dodge, Pontiac, Jaguar, Toyota…).

---

## 5. Rarity tier from cited production (defensible thresholds)

Derived ONLY from a cited `production_count`. No production → `rarity_tier=NULL` ("rarity unknown"), never a guess. Thresholds (total produced, the unit the cited sources publish):

| tier | total_produced |
|---|---|
| ULTRA_RARE | < 1,000 |
| RARE | 1,000 – 9,999 |
| UNCOMMON | 10,000 – 49,999 |
| COMMON | 50,000 – 249,999 |
| MASS_PRODUCTION | ≥ 250,000 |

These reproduce the *cited* rows correctly (Corvette 1963 = 21,513 → UNCOMMON; Camaro 1967 = 220,906 → COMMON; Chevelle 1969 = 503,352 → MASS_PRODUCTION; 911 1987 = 17,567 → UNCOMMON; Bronco 1971 = 19,784 → UNCOMMON). Store both `make_model_profiles.rarity_tier` and `vehicle_production_data.rarity_level` from the SAME cited number so they never diverge. The contaminated rows' existing `rarity_level` values are void on quarantine.

---

## 6. Body-style split canonicalization (Corvette problem)

The fleet stores body-style and trim INSIDE the model string. Live counts: `Corvette` 14,867, `Corvette Convertible` 5,782, `Corvette Coupe` 4,067, `Corvette Custom Convertible` 988, `Corvette Z06` 861, `Corvette Roadster` 778, `Corvette ZR1`/`ZR-1`, `Corvette Stingray`, `Corvette Split Window Coupe`, etc. — dozens of variants of ONE model.

**Rule:** these all roll up to the canonical model **Corvette**. Body style is an attribute, not a separate model.
- The fold lives in `canonical_models`: `canonical_model='Corvette'`, with `body_styles[]` and `aliases[]` capturing the variants (the columns already exist). Canonicalization = "does this fleet `model` string map, via alias/prefix, to a canonical_model?"
- `cohort_count` for the Corvette model node = COUNT over ALL folded variants (≈ tens of thousands), not just bare "Corvette".
- We record the body-style breakdown as **structured sub-counts on the node** (e.g. how many convertible vs coupe), but we do NOT register `Corvette Convertible` as its own `make_model_profiles` model subject. One model, many body styles.
- `vehicle_production_data` keeps `body_style`/`trim_level`/`engine_option` columns so a *cited* figure can be body-style-specific when the source publishes it (e.g. a source giving convertible-only counts) — body style is legitimate at the citation level; it just doesn't fork the model identity.
- Watch the alias collisions: `ZR1` vs `ZR-1`, `Stingray` vs `Sting Ray`, `Z06` vs `Z-06`. Normalize in aliases, don't create duplicate canon rows.

---

## 7. Build / backfill plan — all 213 makes, 3,454 canon models

Prioritized by **fleet membership** (where users actually drill). Every step maps to existing substrate.

### Phase 0 — Stop the bleeding (do first, no research needed)
1. Additive migration: `vehicle_production_data.quarantined`, `quarantine_reason`, `superseded_by` (and on `make_model_profiles` confirm `rarity_reason`-style provenance is reachable; if not, lean on `index_status`/notes).
2. Flag the 15 `manufacturer`+null-url and 4 `registry`-conflict rows (§2). Re-confirm the 16 cited rows remain `quarantined=false`.
3. Patch the read path: every production read filters `source_url IS NOT NULL AND NOT quarantined`. After this, the worst case a node shows is honest "unknown," never a fabricated number.

### Phase 1 — Fleet aggregates for the whole long tail (cheap, all real)
For every `(make)`, `(make,model)`, and the heavy `(make,model,year)` cells, register the subject via `register_make_model_subject` and set `cohort_count`/`median_price` from `vehicles` (and listings for price). This is pure SQL over the live fleet — no fabrication risk — and lights up drill-everywhere with real fleet numbers immediately. Start with the top makes (Chevrolet 158K, Ford 112K, Porsche 49K, Mercedes 43K, BMW 31K, Ferrari 27K, Dodge 23K, Pontiac 22K, Jaguar 20K, Toyota 20K…) then descend the tail. Cohorts below a small floor (e.g. < 3 fleet rows) get registered lazily on demand, not pre-built.

### Phase 2 — Make-orgs (top makes first)
Upsert `organizations` manufacturer rows and link `index_sponsor_org_id` (§4) for the makes above, then the rest.

### Phase 3 — Cited production, cohort by cohort (the slow, careful part)
A **focused future agent** takes ONE cohort `(make, model, year-or-generation)` at a time and runs this loop:
1. Pull the existing cited rows; if production already cited+unquarantined, compute survival + rarity and write the profile. Done.
2. Else research a credible figure: marque registry/encyclopedia, manufacturer report, established production database (the same class as our 16 good sources — chevellestuff.net, corvsport, Mustang Attitude, stuttcars, Blue Oval Trucks, zhome.com, Wikipedia with a primary cite).
3. **Found a credible figure WITH URL** → insert `vehicle_production_data` row carrying `(total_produced, data_source, source_url, verification_date, verified_by)`; if it supersedes a quarantined row, set `superseded_by`. Then set `make_model_profiles.production_count`, derive `survival_rate` (§3) and `rarity_tier` (§5), set `header_refreshed_at`.
4. **No credible figure** → leave `production_count=NULL`, write `rarity_reason` naming exactly what's needed. Do NOT guess. UNKNOWN is a valid, shippable state.
5. Body-style canonicalization per §6 before counting cohort.

Prioritize Phase 3 by: (a) cohorts already registered (the 25), (b) highest fleet `cohort_count`, (c) collector-relevant nameplates (Corvette, Mustang, Camaro, 911, Bronco, K5 Blazer, Chevelle, Charger/Challenger/Barracuda, 240Z, Land Cruiser). The first 25 already have cited cousins for several years — close those, then expand.

### Done-test (per the drillable-ontology cardinal rule)
Tap Chevrolet → Blazer → 1977 and every field is either a real cited/queried number **or** an honest "unknown — needs X." No placeholder that looks like data. Every production number drills to a `source_url`. If you can't make a node real, it shows UNKNOWN — you do not put a fabricated surface up.

---

## Appendix — substrate map (verified live)

- **Fleet / denominator:** `vehicles` (918,956), indexed `(make,model)`,`(make,year)`,`ymm`.
- **Registry:** `make_model_profiles` (25 hollow rows). Write via `register_make_model_subject(...)`; read via `get_make_model_terminal(p_make,p_model,p_year,p_grain)`.
- **Production atoms:** `vehicle_production_data` (35 rows: 16 cited / 15 fabricated / 4 conflicting). Carries `total_produced, body_style, trim_level, engine_option, rarity_level, msrp, current_market_value_low/high, collector_demand_score, data_source, source_url, verified_by, verification_date`.
- **Model canon / body-style fold:** `canonical_models` (3,454 / 213 makes): `canonical_model, body_styles[], aliases[], generation, year_start, year_end`.
- **Make identity:** `organizations` (5,287) — make rows to be created `org_type/entity_type='manufacturer'`, linked from `make_model_profiles.index_sponsor_org_id` (NULL today; no make-orgs exist yet).
