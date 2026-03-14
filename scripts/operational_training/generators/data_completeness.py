"""Generate data completeness training examples.

Teaches the model what "complete" means for each source and how to fill gaps.
"""

import random
from .tool_routing import make_pair
from .data_quality_diagnosis import SOURCE_PROFILES


ENRICHMENT_PIPELINE = [
    ("decode-vin-and-update", "VIN decode → fills year, make, model, engine, transmission from NHTSA"),
    ("enrich-factory-specs", "Factory specs → OEM data, original MSRP, production numbers"),
    ("enrich-msrp", "MSRP lookup → writes vehicles.msrp"),
    ("compute-vehicle-valuation", "AI valuation → nuke_estimate, nuke_estimate_confidence"),
    ("calculate-profile-completeness", "Quality audit → completion_percentage, data_quality_score"),
    ("calculate-vehicle-scores", "Performance scores → perf_*, social_positioning_score"),
    ("analyze-market-signals", "Market analysis → signal_score, heat_score, deal indicators"),
]

# Field fixers with detailed explanations
FIELD_FIXERS = {
    "vin": (
        "decode-vin-and-update",
        "If the VIN exists somewhere (description, photos, title document), extract it first with `extract-vin-from-vehicle` (AI OCR from photos) or manually. Then run `decode-vin-and-update` to fill year/make/model/engine from NHTSA.\n\nFor pre-1981 vehicles, there may be a chassis number instead of a 17-digit VIN — that's normal.",
    ),
    "sale_price": (
        "complete-bat-import (re-run)",
        "Check auction status first:\n```sql\nSELECT auction_status, reserve_status FROM vehicles WHERE id = '<id>';\n```\n\n- `reserve_not_met` → no sale occurred, NULL price is correct\n- `ended` + NULL price → extraction missed it, re-run the extractor\n- `active` → auction still running, price not set yet",
    ),
    "description": (
        "Re-run source extractor or enrich-vehicle-profile-ai",
        "1. Find the source URL: `SELECT source_url FROM vehicle_events WHERE vehicle_id = '<id>';`\n2. Re-run the source-specific extractor\n3. If no source URL, use `enrich-vehicle-profile-ai` to generate a description from Y/M/M + available data",
    ),
    "mileage": (
        "Check description or re-extract",
        "Mileage is usually in the listing description. Check:\n```sql\nSELECT description FROM vehicles WHERE id = '<id>';\n```\nSearch for patterns like '45,000 miles', '45K mi', 'indicated 45000'. If found in description but not in the mileage field, the extractor didn't parse it.",
    ),
    "images": (
        "Re-run extraction or photo-pipeline-orchestrator",
        "No images means the image extraction step failed or wasn't run. Re-run the source extractor.\n\nIf images exist but aren't analyzed:\n```sql\nSELECT ai_processing_status, count(*) FROM vehicle_images WHERE vehicle_id = '<id>' GROUP BY ai_processing_status;\n```\n\nIf status='pending', run `photo-pipeline-orchestrator` to analyze them.",
    ),
    "comments": (
        "extract-auction-comments",
        "Only applicable for sources with comment systems (BaT, Cars & Bids, PCarMarket). For auction houses (Mecum, Barrett-Jackson, RM Sotheby's, Bonhams), comments are not expected.\n\n```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/extract-auction-comments\" \\\n  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"vehicle_id\": \"<id>\", \"url\": \"<listing_url>\"}'\n```",
    ),
    "engine_type": (
        "decode-vin-and-update",
        "Engine information comes from VIN decoding via NHTSA. If VIN is present, run `decode-vin-and-update`. If no VIN, check the description for engine mentions or use `enrich-factory-specs` which looks up factory specs by Y/M/M.",
    ),
    "transmission": (
        "decode-vin-and-update or enrich-factory-specs",
        "Transmission info comes from VIN decode or factory spec enrichment. Run `decode-vin-and-update` first (if VIN present), then `enrich-factory-specs` for additional details.",
    ),
    "exterior_color": (
        "Check description or listing photos",
        "Color is often in the listing description but may not be parsed into a structured field. Check:\n```sql\nSELECT description FROM vehicles WHERE id = '<id>';\n```\nLook for color mentions. If found, it's an extraction gap — the parser needs to be improved to capture color.",
    ),
    "nuke_estimate": (
        "compute-vehicle-valuation",
        "nuke_estimate is computed by `compute-vehicle-valuation`. Do NOT write it directly (do_not_write_directly=true).\n\nIt requires:\n- Year, make, model (mandatory)\n- Description (strongly recommended)\n- Comparable sales data in the database\n\nIf the estimate seems wrong, re-run the valuation function — don't manually override.",
    ),
    "data_quality_score": (
        "calculate-profile-completeness",
        "data_quality_score is computed by `calculate-profile-completeness`. Do NOT write it directly.\n\nIt reflects overall field completeness. To improve it, fill the missing fields that contribute to the score. Run `calculate-profile-completeness` after enrichment to update.",
    ),
}

# Vehicle examples for parameterized scenarios
VEHICLE_EXAMPLES = [
    {"year": 1972, "make": "Porsche", "model": "911S Targa", "source": "bat"},
    {"year": 1967, "make": "Ford", "model": "Mustang Fastback", "source": "bat"},
    {"year": 1985, "make": "Toyota", "model": "Land Cruiser FJ60", "source": "bat"},
    {"year": 1955, "make": "Mercedes-Benz", "model": "300SL Gullwing", "source": "rm-sothebys"},
    {"year": 1969, "make": "Chevrolet", "model": "Camaro Z/28", "source": "mecum"},
    {"year": 2001, "make": "BMW", "model": "M3 E46", "source": "carsandbids"},
    {"year": 1988, "make": "Porsche", "model": "959", "source": "bonhams"},
    {"year": 1957, "make": "Chevrolet", "model": "Bel Air", "source": "barrett-jackson"},
    {"year": 1992, "make": "Acura", "model": "NSX", "source": "bat"},
    {"year": 1984, "make": "Chevrolet", "model": "K10", "source": "bat"},
    {"year": 1970, "make": "Plymouth", "model": "Hemi 'Cuda", "source": "mecum"},
    {"year": 1989, "make": "Ferrari", "model": "328 GTS", "source": "bat"},
    {"year": 1994, "make": "Toyota", "model": "Supra Turbo", "source": "bat"},
    {"year": 1971, "make": "Datsun", "model": "240Z", "source": "bat"},
    {"year": 2005, "make": "Ford", "model": "GT", "source": "bat"},
    {"year": 1987, "make": "Porsche", "model": "930 Turbo", "source": "bat"},
    {"year": 1966, "make": "Ford", "model": "Bronco", "source": "bat"},
    {"year": 1963, "make": "Chevrolet", "model": "Corvette Sting Ray", "source": "barrett-jackson"},
    {"year": 2003, "make": "Porsche", "model": "996 Turbo", "source": "pcarmarket"},
    {"year": 1986, "make": "Porsche", "model": "944 Turbo", "source": "bat"},
]

# Quality score scenarios
QUALITY_SCENARIOS = [
    {
        "score": 95, "grade": "A",
        "profile": "Year, make, model, VIN, price, description (1,200 chars), 65 images (all analyzed), 180 comments, factory specs, Nuke estimate, condition score",
        "diagnosis": "Excellent — fully extracted and enriched. No action needed.",
    },
    {
        "score": 82, "grade": "A",
        "profile": "Year, make, model, VIN, price, description (800 chars), 42 images (30 analyzed), 95 comments, factory specs, no Nuke estimate",
        "diagnosis": "Good extraction, missing valuation. Run `compute-vehicle-valuation` to generate the Nuke estimate. Also queue remaining 12 images for analysis.",
    },
    {
        "score": 65, "grade": "B",
        "profile": "Year, make, model, VIN, price, description (200 chars), 20 images (0 analyzed), no comments, no factory specs, no estimate",
        "diagnosis": "Decent extraction but enrichment hasn't run. Pipeline steps needed:\n1. `enrich-factory-specs` → OEM data\n2. `compute-vehicle-valuation` → price estimate\n3. `photo-pipeline-orchestrator` → analyze 20 images\n4. `extract-auction-comments` → if BaT/C&B/PCarMarket\n5. `calculate-profile-completeness` → recalculate score",
    },
    {
        "score": 45, "grade": "C",
        "profile": "Year, make, model, no VIN, no price, description (100 chars), 5 images, no comments",
        "diagnosis": "Basic extraction only — skeleton with minimal data.\n\n1. Try to find VIN from description or photos: `extract-vin-from-vehicle`\n2. Check auction status for price: `SELECT auction_status, reserve_status FROM vehicles WHERE id = '<id>';`\n3. Re-run source extractor for full description\n4. Run full enrichment pipeline after fixing gaps",
    },
    {
        "score": 25, "grade": "D",
        "profile": "Year, make, model, nothing else",
        "diagnosis": "Skeleton record — only title was parsed. Full extraction never ran.\n\n1. Get source URL: `SELECT source_url FROM vehicle_events WHERE vehicle_id = '<id>';`\n2. Re-run the source-specific extractor\n3. If no source URL: manual data entry or `enrich-vehicle-profile-ai`",
    },
    {
        "score": 10, "grade": "F",
        "profile": "Make only, no year, no model, no other fields",
        "diagnosis": "Nearly empty record. Likely a mis-extraction or partial import.\n\nCheck if this is even a vehicle:\n```sql\nSELECT make, model, description FROM vehicles WHERE id = '<id>';\n```\n\nIf model contains parts/memorabilia keywords, reject it. Otherwise, find the source and re-extract completely.",
    },
]

# Question templates
PIPELINE_TEMPLATES = [
    "What's the full enrichment pipeline for a new vehicle?",
    "Walk me through the enrichment steps after initial extraction.",
    "How do I fully enrich a vehicle record?",
    "What steps should I run after extracting a vehicle?",
    "I just extracted a vehicle — what enrichment should I run next?",
]

MISSING_FIELD_TEMPLATES = [
    "How do I fill in a missing {field} on a vehicle record?",
    "Vehicle is missing {field}. How do I fix it?",
    "What's the best way to get {field} data for a vehicle?",
    "The {field} field is empty. What tool should I run?",
    "How do I populate the {field} field?",
]

COMPLETENESS_TEMPLATES = [
    "This vehicle has a data_quality_score of {score}. What should I do?",
    "Quality score is {score} — how do I improve it?",
    "Vehicle scored {score}/100 on completeness. What's missing?",
    "data_quality_score={score}. Is this good enough?",
]

SOURCE_COMPLETENESS_TEMPLATES = [
    "What fields should a {source} extraction fill?",
    "What does a complete {source} vehicle look like?",
    "Expected data quality for {source} listings?",
    "How complete should a {source} record be?",
]


def generate_data_completeness(loader, registry: list, limit: int = 2000) -> list[dict]:
    pairs = []

    # 1. Enrichment pipeline — ordered steps (multiple phrasings)
    pipeline_text = "\n".join(f"{i+1}. `{func}` — {desc}" for i, (func, desc) in enumerate(ENRICHMENT_PIPELINE))
    for template in PIPELINE_TEMPLATES:
        pairs.append(make_pair(
            template,
            f"After initial extraction, run these in order:\n\n{pipeline_text}\n\n"
            f"The first step (VIN decode) provides the foundation. Each subsequent step builds on previous data. "
            f"Don't skip steps — `compute-vehicle-valuation` needs description and comps to produce meaningful estimates.",
            "data_completeness",
        ))

    # 2. Source comparison table
    rows = []
    for key, profile in SOURCE_PROFILES.items():
        rows.append(
            f"| {profile['name']} | {profile['expected_vin']*100:.0f}% | "
            f"{profile['expected_price']*100:.0f}% | {profile['expected_description']*100:.0f}% | "
            f"{profile['avg_images']} | {profile['avg_comments']} |"
        )
    table = "| Source | VIN | Price | Description | Avg Images | Avg Comments |\n|--------|-----|-------|-------------|------------|-------------|" + "\n" + "\n".join(rows)

    pairs.append(make_pair(
        "How does data quality vary by auction source?",
        f"Each source has different completeness expectations:\n\n{table}\n\n"
        f"Don't compare Barrett-Jackson VIN rates to BaT — they're fundamentally different sources. "
        f"BaT is community-driven with moderated listings. Barrett-Jackson is a traditional auction house.",
        "data_completeness",
    ))

    # 3. "This vehicle is missing X, what do I do?" — parameterized
    for field, (fixer, explanation) in FIELD_FIXERS.items():
        for template in random.sample(MISSING_FIELD_TEMPLATES, min(3, len(MISSING_FIELD_TEMPLATES))):
            question = template.format(field=field)
            pairs.append(make_pair(
                question,
                f"**Missing `{field}`** — Use `{fixer}`\n\n{explanation}",
                "data_completeness",
            ))

    # 4. Source-specific completeness expectations
    for source_key, profile in SOURCE_PROFILES.items():
        for template in random.sample(SOURCE_COMPLETENESS_TEMPLATES, min(2, len(SOURCE_COMPLETENESS_TEMPLATES))):
            question = template.format(source=profile['name'])

            expected_fields = []
            if profile['expected_vin'] > 0.8:
                expected_fields.append(f"VIN ({profile['expected_vin']*100:.0f}% expected)")
            if profile['expected_price'] > 0.5:
                expected_fields.append(f"Sale price ({profile['expected_price']*100:.0f}% expected)")
            expected_fields.append(f"Description ({profile['expected_description']*100:.0f}% expected)")
            expected_fields.append(f"Images (avg {profile['avg_images']}/listing)")
            if profile['expected_comments'] > 0:
                expected_fields.append(f"Comments (avg {profile['avg_comments']}/listing)")

            answer = (f"A complete {profile['name']} record should have:\n\n"
                     + "\n".join(f"- {f}" for f in expected_fields)
                     + f"\n\n{profile['notes']}")

            pairs.append(make_pair(question, answer, "data_completeness"))

    # 5. Completeness scoring — quality score scenarios
    pairs.append(make_pair(
        "How is data_quality_score calculated?",
        "The `calculate-profile-completeness` function computes `data_quality_score` (0-100) based on:\n\n"
        "- Year, make, model present (weighted high)\n"
        "- VIN present and decoded\n"
        "- Sale price present\n"
        "- Description present and length > 100 chars\n"
        "- Images present (count > 0, ideally > 10)\n"
        "- Mileage present\n"
        "- Engine/transmission/color fields\n"
        "- Comments extracted (for BaT/C&B)\n"
        "- Factory specs enriched\n"
        "- Nuke estimate computed\n\n"
        "Score thresholds:\n"
        "- 80+ = A grade (fully extracted and enriched)\n"
        "- 60-79 = B grade (good extraction, some enrichment missing)\n"
        "- 40-59 = C grade (basic extraction done)\n"
        "- 20-39 = D grade (skeleton record)\n"
        "- < 20 = F grade (almost empty)\n\n"
        "Don't write this field directly — it's owned by `calculate-profile-completeness` (do_not_write_directly=true).",
        "data_completeness",
    ))

    # 6. Quality score scenarios — parameterized with vehicles
    for scenario in QUALITY_SCENARIOS:
        for template in random.sample(COMPLETENESS_TEMPLATES, min(2, len(COMPLETENESS_TEMPLATES))):
            question = template.format(score=scenario['score'])
            pairs.append(make_pair(
                question,
                f"Score {scenario['score']}/100 = **Grade {scenario['grade']}**\n\n"
                f"Typical profile at this score: {scenario['profile']}\n\n"
                f"**Diagnosis:** {scenario['diagnosis']}",
                "data_completeness",
            ))

    # 7. Vehicle-specific completeness reviews
    for vehicle in VEHICLE_EXAMPLES:
        profile = SOURCE_PROFILES.get(vehicle["source"], {})
        if not profile:
            continue

        # Generate some missing fields
        all_fields = ["vin", "sale_price", "description", "mileage", "images", "comments"]
        num_missing = random.randint(1, 3)
        missing = random.sample(all_fields, num_missing)

        present = [f"year={vehicle['year']}", f"make={vehicle['make']}", f"model={vehicle['model']}"]
        for f in all_fields:
            if f not in missing:
                present.append(f"has {f}")
            else:
                present.append(f"no {f}")

        fix_steps = []
        for f in missing:
            if f in FIELD_FIXERS:
                fixer, _ = FIELD_FIXERS[f]
                fix_steps.append(f"- **{f}**: Run `{fixer}`")
            else:
                fix_steps.append(f"- **{f}**: Check source extractor")

        pairs.append(make_pair(
            f"Review this record: {vehicle['year']} {vehicle['make']} {vehicle['model']} from {profile['name']}. {', '.join(present)}.",
            f"Missing: {', '.join(missing)}\n\n"
            f"For {profile['name']}, the following fields need attention:\n"
            + "\n".join(fix_steps)
            + f"\n\nAfter fixing, run `calculate-profile-completeness` to update the quality score.",
            "data_completeness",
        ))

    # 8. Batch completeness check
    pairs.append(make_pair(
        "How do I find which vehicles need enrichment?",
        "Query by enrichment status:\n\n"
        "```sql\n-- Vehicles with extraction but no enrichment\n"
        "SELECT id, year, make, model, auction_source,\n"
        "  data_quality_score, completion_percentage,\n"
        "  CASE WHEN nuke_estimate IS NULL THEN 'needs_valuation' END,\n"
        "  CASE WHEN vin IS NOT NULL AND engine_type IS NULL THEN 'needs_vin_decode' END\n"
        "FROM vehicles\n"
        "WHERE status = 'active'\n"
        "  AND data_quality_score < 60\n"
        "  AND year IS NOT NULL AND make IS NOT NULL\n"
        "ORDER BY data_quality_score ASC\n"
        "LIMIT 100;\n```\n\n"
        "Or use bulk enrichment:\n"
        "- `enrich-bulk` — batch calls to `enrich-vehicle-profile-ai`\n"
        "- `batch-vin-decode` — batch VIN decoding\n"
        "- `auto-fix-vehicle-profile` — automated repair of common issues",
        "data_completeness",
    ))

    # 9. Observation system completeness
    pairs.append(make_pair(
        "How does the observation system track data completeness?",
        "The `vehicle_observations` table is a unified event store. Each observation has:\n"
        "- `kind`: media, comment, bid, listing, specification, condition, work_record\n"
        "- `confidence_score`: 0-1 (how reliable this data point is)\n"
        "- `is_processed`: whether AI analysis has run on it\n"
        "- `content_hash`: SHA256 for deduplication\n\n"
        "To check observation completeness for a vehicle:\n"
        "```sql\nSELECT kind, count(*), \n"
        "  count(*) FILTER (WHERE is_processed) as processed,\n"
        "  avg(confidence_score) as avg_confidence\n"
        "FROM vehicle_observations\n"
        "WHERE vehicle_id = '<id>'\n"
        "GROUP BY kind;\n```\n\n"
        "A fully observed vehicle should have: listing (1+), media (10+), comment (varies by source), specification (1+ after VIN decode).",
        "data_completeness",
    ))

    # 10. Enrichment pipeline ordering scenarios
    ordering_scenarios = [
        ("Can I run compute-vehicle-valuation before decode-vin-and-update?",
         "You can, but the valuation will be lower quality. VIN decoding fills engine, transmission, and trim data that improves valuation accuracy.\n\nRecommended order:\n1. `decode-vin-and-update` (foundation data)\n2. `enrich-factory-specs` (OEM context)\n3. `compute-vehicle-valuation` (uses all available data)\n\nThe valuation function works with Y/M/M alone but performs better with complete specs."),
        ("What happens if I skip enrich-factory-specs?",
         "The pipeline still works, but downstream functions lose context:\n- `compute-vehicle-valuation` won't have original MSRP for depreciation curves\n- `calculate-vehicle-scores` won't have production numbers for rarity\n- No factory paint/option codes for provenance verification\n\nFactory specs are cheap to fetch and significantly improve downstream quality."),
        ("Should I run the enrichment pipeline on ConceptCarz vehicles?",
         "No — ConceptCarz is an encyclopedia, not an auction source. Don't waste enrichment API calls on it.\n\nConceptCarz vehicles have editorial estimates (not real prices) and no VINs. Running VIN decode will fail, valuation will be meaningless, and you'll burn API credits.\n\nExclude from enrichment: `WHERE auction_source != 'conceptcarz'`"),
        ("How do I enrich vehicles in bulk?",
         "Use the bulk enrichment functions:\n\n1. **VIN decode**: `batch-vin-decode` — processes vehicles with VINs but missing decoded data\n2. **Profile enrichment**: `enrich-bulk` — calls `enrich-vehicle-profile-ai` for multiple vehicles\n3. **Auto-fix**: `auto-fix-vehicle-profile` — automated repair of common data issues\n\nAlways filter to vehicles that actually need enrichment:\n```sql\nSELECT id FROM vehicles\nWHERE status = 'active' AND vin IS NOT NULL AND engine_type IS NULL\nLIMIT 100;\n```"),
    ]
    for q, a in ordering_scenarios:
        pairs.append(make_pair(q, a, "data_completeness"))

    # 11. Complete vs incomplete side-by-side
    side_by_side = [
        ("Show me a complete vs incomplete BaT record.",
         "**Complete BaT record (Grade A, score 95+):**\n"
         "- Year: 1972, Make: Porsche, Model: 911S Targa\n"
         "- VIN: 9112301234 (decoded → engine, trans, trim)\n"
         "- Sale price: $185,000 (auction ended, sold)\n"
         "- Description: 1,200 chars (detailed listing text)\n"
         "- Images: 65 (all AI-analyzed)\n"
         "- Comments: 180 (sentiment analyzed)\n"
         "- Factory specs: enriched (original MSRP, production numbers)\n"
         "- Nuke estimate: $178,000 (confidence: 0.85)\n"
         "- Condition score: 72/100\n\n"
         "**Skeleton BaT record (Grade D, score 25):**\n"
         "- Year: 1972, Make: Porsche, Model: 911S Targa\n"
         "- VIN: NULL, Price: NULL, Description: NULL\n"
         "- Images: 0, Comments: 0\n"
         "- No enrichment ran\n\n"
         "**Gap:** Full extraction never ran. Find the source URL from `vehicle_events` and run `complete-bat-import`."),
        ("Show me a complete vs incomplete Barrett-Jackson record.",
         "**Complete Barrett-Jackson record (Grade B, score 70):**\n"
         "- Year: 1963, Make: Chevrolet, Model: Corvette Sting Ray\n"
         "- VIN: NULL (expected — BJ only 20%)\n"
         "- Sale price: $165,000\n"
         "- Description: 500 chars\n"
         "- Images: 40\n"
         "- Comments: 0 (expected — no comment system)\n\n"
         "Note: This is Grade B, not A — VIN and comments are missing. But for Barrett-Jackson, this IS complete.\n\n"
         "**Skeleton Barrett-Jackson record (Grade D, score 20):**\n"
         "- Year: 1963, Make: Chevrolet, Model: Corvette Sting Ray\n"
         "- Everything else NULL\n\n"
         "**Gap:** Source extractor didn't run fully. Re-run `extract-barrett-jackson` on the lot URL."),
    ]
    for q, a in side_by_side:
        pairs.append(make_pair(q, a, "data_completeness"))

    # 12. Enrichment dependency questions
    dependency_questions = [
        ("What does compute-vehicle-valuation need to run?",
         "`compute-vehicle-valuation` requires:\n- Year, make, model (mandatory — won't run without)\n- Description (strongly recommended for context)\n- Comparable sales in the database (same Y/M/M ± 3 years)\n\nOptional but improves quality:\n- VIN-decoded specs (engine, transmission)\n- Mileage\n- Condition score\n- Factory specs (original MSRP for depreciation curves)\n\nDon't write `nuke_estimate` directly — it's do_not_write_directly."),
        ("What does calculate-profile-completeness check?",
         "`calculate-profile-completeness` checks ~15 field categories:\n\n"
         "**High weight:** year+make+model, VIN, sale_price, description length\n"
         "**Medium weight:** images (count), mileage, engine/transmission\n"
         "**Lower weight:** comments, factory specs, condition score, valuation\n\n"
         "Output: `data_quality_score` (0-100) and `completion_percentage` (0-1).\n"
         "Both are do_not_write_directly — only this function should set them."),
        ("What does decode-vin-and-update fill?",
         "`decode-vin-and-update` queries the NHTSA VIN decoder API and fills:\n\n"
         "- `year` (confirms/corrects)\n- `make` (standardized name)\n- `model` (with trim level)\n"
         "- `engine_type` (displacement, cylinders, fuel type)\n- `transmission` (auto/manual, speeds)\n"
         "- `body_type`\n- `drive_type` (FWD/RWD/AWD)\n- `plant_country` / `plant_city`\n\n"
         "Only works for vehicles with a valid 17-digit VIN (1981+). Pre-1981 vehicles use chassis numbers that NHTSA can't decode."),
    ]
    for q, a in dependency_questions:
        pairs.append(make_pair(q, a, "data_completeness"))

    # 13. "After I fix X, what should I run next?"
    for field, (fixer, _) in FIELD_FIXERS.items():
        pairs.append(make_pair(
            f"I just fixed the {field} for a vehicle. What should I run next?",
            f"After filling `{field}`, run the downstream enrichment steps that depend on it:\n\n"
            + ("1. `decode-vin-and-update` → decode the VIN to fill specs\n" if field == "vin" else "")
            + ("1. `enrich-factory-specs` → look up OEM data\n" if field in ("vin", "engine_type") else "")
            + "2. `compute-vehicle-valuation` → recalculate the Nuke estimate\n"
            + "3. `calculate-profile-completeness` → update the quality score\n\n"
            + "The quality score should improve after adding the missing data.",
            "data_completeness",
        ))

    # 14. Concrete vehicle records from DB
    try:
        vehicles = loader.vehicles()
        for v in random.sample(vehicles, min(100, len(vehicles))):
            fields = []
            if v.get("year"): fields.append(f"year={v['year']}")
            if v.get("make"): fields.append(f"make={v['make']}")
            if v.get("model"): fields.append(f"model={v['model']}")
            if v.get("vin"): fields.append("has VIN")
            else: fields.append("no VIN")
            if v.get("sale_price"): fields.append(f"price=${v['sale_price']:,.0f}")
            else: fields.append("no price")
            if v.get("description") and len(v.get("description", "")) > 100: fields.append("has description")
            else: fields.append("no description")

            missing = []
            if not v.get("vin"): missing.append("VIN")
            if not v.get("sale_price"): missing.append("sale_price")
            if not v.get("description"): missing.append("description")
            if not v.get("mileage"): missing.append("mileage")

            if missing and v.get("year") and v.get("make"):
                source = v.get("auction_source", "unknown")
                pairs.append(make_pair(
                    f"Review this record: {', '.join(fields)}. Source: {source}.",
                    f"Missing fields: {', '.join(missing)}.\n\n" +
                    "\n".join(
                        f"- **{f}**: " + (
                            FIELD_FIXERS[f][1][:150] if f in FIELD_FIXERS
                            else f"Run the appropriate enrichment function"
                        ) for f in missing
                    ),
                    "data_completeness",
                ))
    except Exception:
        pass

    random.shuffle(pairs)
    return pairs[:limit]
