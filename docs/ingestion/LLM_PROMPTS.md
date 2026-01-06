# LLM Prompt Pack (Mapper & Validator)

These prompts are fed to Opus 4.5 (mapper) and, later, lighter-weight validators. They must always be bundled with the [schema brief](./SCHEMA_BRIEF.md) and any relevant roster context.

---

## 1. Mapper Prompt (Opus 4.5)

**Goal:** Inspect the site, classify it, map every available field to our DB, identify suppliers/partners, flag missing data, and propose schema additions when the source exposes structured data we do not store yet.

### Input Bundle
- Sanitized HTML + Markdown (from Firecrawl or equivalent).
- Target URL and normalized domain.
- Excerpt from [schema brief](./SCHEMA_BRIEF.md) describing current tables/fields.
- Instructions below.

### Prompt Skeleton
```
You are the Site Mapping Agent for Nuke. Here is the context:
- TARGET_URL: {{url}}
- DOMAIN: {{domain}}

SCHEMA_BRIEF:
{{schema_brief_excerpt}}

SOURCE_MARKDOWN (first 3,000 chars):
{{markdown_snippet}}

SOURCE_HTML (optional compressed summary):
{{html_summary}}

Tasks:
1. Classify the site (builder, manufacturer, dealer_website, broker, auction_house, marketplace, service_shop, supplier, fabricator, platform, directory, other).
2. List consumer-facing similarities vs. structural differences (e.g., “Brabus looks like a dealer but is a builder + engineering house”).
3. Map every detectable field to our DB schema:
   - Provide CSS selectors (primary + fallbacks), regex patterns, extraction methods, sample values, and confidence (0-1).
   - Specify when a field is absent so downstream agents leave it null.
4. Capture supplier/partner references:
   - For each mention, include supplier name, URL, context sentence, role (engine builder, upholstery, etc.), and confidence.
5. Image safety:
   - Identify vehicle/gallery include selectors AND marketing/hero/irrelevant selectors to exclude.
   - Note potential pollution risks (shared CDN paths, testimonial sliders, etc.).
6. Schema proposals:
   - When the site exposes structured data we cannot store, propose new tables/columns.
   - For each proposal include table name, field definitions, types, relationships, and justification.
7. Rarity notes:
   - If the site exposes unique/rare data (custom build stages, dyno sheets), describe it so we preserve it.

Output JSON must follow MAPPER_SCHEMA (below) exactly. Never omit required keys, even if arrays are empty.
```

### Output Schema (`MAPPER_SCHEMA`)
```json
{
  "domain": "velocityrestorations.com",
  "site_classification": {
    "type": "builder",
    "secondary_types": ["manufacturer", "service_shop"],
    "confidence": 0.92,
    "consumer_equivalents": "Looks like a dealer inventory but is a turnkey builder."
  },
  "field_mappings": [
    {
      "db_table": "vehicles",
      "db_field": "asking_price",
      "selectors": [".vr-vehicle-price .amount", ".price .amount"],
      "regex_patterns": ["\\$([\\d,]+)"],
      "extraction_method": "dom",
      "sample_value": "$325,000",
      "confidence": 0.88,
      "notes": "Right column pricing panel",
      "missing": false
    },
    {
      "db_table": "vehicles",
      "db_field": "vin",
      "missing": true,
      "notes": "VIN not published; leave blank."
    }
  ],
  "supplier_references": [
    {
      "name": "Recaro",
      "url": "https://www.recaro-automotive.com/",
      "context": "Hand-stitched Recaro interior supplied by ABC Upholstery.",
      "role": "upholstery_supplier",
      "confidence": 0.81
    }
  ],
  "image_rules": {
    "include_selectors": [".vehicle-gallery img", ".swiper-slide img"],
    "exclude_selectors": [".press-carousel img", ".instagram-feed img", ".brand-carousel img"],
    "pollution_risks": [
      "Press carousel mixes multiple builds",
      "Hero banner repeats same shot on every page"
    ]
  },
  "missing_fields": ["vin", "mileage", "auction_listings.current_bid"],
  "schema_proposals": [
    {
      "name": "builder_projects",
      "description": "Track each bespoke build with stages and donor chassis info.",
      "fields": [
        {"name": "organization_id", "type": "UUID", "references": "businesses.id"},
        {"name": "project_code", "type": "TEXT"},
        {"name": "stage", "type": "TEXT", "notes": "e.g., design, chassis, paint"},
        {"name": "primary_supplier_ids", "type": "UUID[]", "references": "businesses.id"}
      ],
      "justification": "Builder sites expose per-project timelines and supplier chains."
    }
  ],
  "rarity_notes": [
    "Velocity exposes donor VIN + frame-off photo sets per build."
  ]
}
```

---

## 2. Validator Prompt (Cheaper Model Stub)

While fully defined later, the validator prompt will ingest:
- `field_mappings` from the mapper output,
- freshly fetched HTML for a handful of URLs,
- and sample values extracted by a deterministic scraper.

Tasks:
1. Confirm the selector actually returns the expected value and matches the DB field (e.g., mileage is numeric, VIN length is 17, price has currency).
2. Flag mismatches and lower confidence scores.
3. Double-check supplier references exist verbatim.
4. Ensure image include/exclude selectors pull only the target gallery.

The validator writes updated confidence scores and notes back to `schema_data.validation`.

---

## 3. Usage Guidance

- Always attach this prompt file + the roster entry when calling Opus 4.5.
- If the mapper reports low confidence (< 0.75), do not allow the extraction agent to run yet—queue it for human/AI review.
- Schema proposals must be reviewed by the Schema Steward before migrations are applied.
- Store the mapper’s raw JSON in `source_site_schemas.schema_data` so Validators and Extraction agents can consume consistent instructions.
- Insert supplier references into the dedicated `supplier_references` table (and summarize them in `source_site_schemas.supplier_references`).

