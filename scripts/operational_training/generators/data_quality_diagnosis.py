"""Generate data quality diagnosis training examples.

Teaches the model to identify broken/incomplete vehicle records and prescribe fixes.
"""

import random
from .tool_routing import make_pair


# Source-specific quality expectations
SOURCE_PROFILES = {
    "bat": {
        "name": "Bring a Trailer",
        "expected_vin": 0.95,
        "expected_price": 0.97,
        "expected_description": 0.99,
        "expected_images": 0.97,
        "expected_comments": 0.98,
        "avg_images": 58,
        "avg_comments": 150,
        "notes": "BaT is the gold standard — fully moderated listings with VINs, detailed descriptions, and active comment threads.",
    },
    "barrett-jackson": {
        "name": "Barrett-Jackson",
        "expected_vin": 0.20,
        "expected_price": 0.34,
        "expected_description": 0.90,
        "expected_images": 0.95,
        "expected_comments": 0.0,
        "avg_images": 40,
        "avg_comments": 0,
        "notes": "BJ rarely displays VINs. Many lots don't report final prices. No comment system.",
    },
    "mecum": {
        "name": "Mecum",
        "expected_vin": 0.33,
        "expected_price": 0.47,
        "expected_description": 0.90,
        "expected_images": 0.95,
        "expected_comments": 0.0,
        "avg_images": 30,
        "avg_comments": 0,
        "notes": "Large volume (145K+), but VIN and price coverage is low.",
    },
    "rm-sothebys": {
        "name": "RM Sotheby's",
        "expected_vin": 0.003,
        "expected_price": 0.17,
        "expected_description": 0.95,
        "expected_images": 0.95,
        "expected_comments": 0.0,
        "avg_images": 25,
        "avg_comments": 0,
        "notes": "Almost no VINs published. Many lots have estimates but not final prices.",
    },
    "carsandbids": {
        "name": "Cars & Bids",
        "expected_vin": 0.92,
        "expected_price": 0.95,
        "expected_description": 0.98,
        "expected_images": 0.98,
        "expected_comments": 0.95,
        "avg_images": 45,
        "avg_comments": 80,
        "notes": "Community moderated like BaT. Strong VIN, price, and comment coverage. Focus on modern enthusiast vehicles (1980s+).",
    },
    "bonhams": {
        "name": "Bonhams",
        "expected_vin": 0.01,
        "expected_price": 0.25,
        "expected_description": 0.95,
        "expected_images": 0.90,
        "expected_comments": 0.0,
        "avg_images": 20,
        "avg_comments": 0,
        "notes": "High-end auction house. Detailed lot essays but almost no VINs. Pre-sale estimates often shown instead of hammer prices.",
    },
    "hagerty": {
        "name": "Hagerty Marketplace",
        "expected_vin": 0.80,
        "expected_price": 0.85,
        "expected_description": 0.90,
        "expected_images": 0.95,
        "expected_comments": 0.0,
        "avg_images": 35,
        "avg_comments": 0,
        "notes": "Well-structured dealer/private listings with good VIN coverage. No bidding/comment system.",
    },
    "pcarmarket": {
        "name": "PCarMarket",
        "expected_vin": 0.90,
        "expected_price": 0.93,
        "expected_description": 0.97,
        "expected_images": 0.98,
        "expected_comments": 0.90,
        "avg_images": 50,
        "avg_comments": 40,
        "notes": "Porsche-focused auction site. Very high data quality. Similar to BaT model.",
    },
    "conceptcarz": {
        "name": "ConceptCarz",
        "expected_vin": 0.0,
        "expected_price": 0.0,
        "expected_description": 0.95,
        "expected_images": 0.90,
        "expected_comments": 0.0,
        "avg_images": 15,
        "avg_comments": 0,
        "notes": "Encyclopedia, NOT an auction. 'Prices' are editorial estimates, not real sales. 374K vehicles with fabricated prices were imported — these pollute market comps. Exclude from all price-based queries.",
    },
}

# Vehicle examples for generating specific scenarios
VEHICLE_EXAMPLES = [
    {"year": 1972, "make": "Porsche", "model": "911S Targa", "vin": "9112301234"},
    {"year": 1967, "make": "Ford", "model": "Mustang Fastback", "vin": None},
    {"year": 1985, "make": "Toyota", "model": "Land Cruiser FJ60", "vin": "JT2BJ69V0F0100234"},
    {"year": 1955, "make": "Mercedes-Benz", "model": "300SL Gullwing", "vin": None},
    {"year": 1969, "make": "Chevrolet", "model": "Camaro Z/28", "vin": "124379N600123"},
    {"year": 1973, "make": "BMW", "model": "2002 Turbo", "vin": None},
    {"year": 1988, "make": "Porsche", "model": "959", "vin": "WP0ZZZ95ZJS900123"},
    {"year": 1957, "make": "Chevrolet", "model": "Bel Air", "vin": None},
    {"year": 2001, "make": "BMW", "model": "M3 E46", "vin": "WBSBL93471JR12345"},
    {"year": 1984, "make": "Chevrolet", "model": "K10", "vin": "1GCEK14L9EJ147915"},
    {"year": 1992, "make": "Acura", "model": "NSX", "vin": "JH4NA1156NT000123"},
    {"year": 1970, "make": "Plymouth", "model": "Hemi 'Cuda", "vin": None},
    {"year": 1963, "make": "Chevrolet", "model": "Corvette Sting Ray", "vin": None},
    {"year": 1987, "make": "Porsche", "model": "930 Turbo", "vin": "WP0JB0932HS050234"},
    {"year": 1966, "make": "Ford", "model": "Bronco", "vin": None},
    {"year": 1989, "make": "Ferrari", "model": "328 GTS", "vin": "ZFFXA20A6K0080123"},
    {"year": 1975, "make": "Lamborghini", "model": "Countach LP400", "vin": None},
    {"year": 1994, "make": "Toyota", "model": "Supra Turbo", "vin": "JT2JA82J8R0012345"},
    {"year": 1971, "make": "Datsun", "model": "240Z", "vin": "HLS30012345"},
    {"year": 2005, "make": "Ford", "model": "GT", "vin": "1FAFP90S45Y400123"},
    {"year": 1953, "make": "Jaguar", "model": "XK120", "vin": None},
    {"year": 1961, "make": "Aston Martin", "model": "DB4 GT", "vin": None},
    {"year": 1986, "make": "Porsche", "model": "944 Turbo", "vin": "WP0AA0956GN150234"},
    {"year": 1978, "make": "Datsun", "model": "280Z", "vin": "HS30123456"},
    {"year": 2003, "make": "Porsche", "model": "996 Turbo", "vin": "WP0AD29933S680123"},
    {"year": 1969, "make": "Ford", "model": "Boss 302", "vin": None},
    {"year": 1995, "make": "Mitsubishi", "model": "3000GT VR-4", "vin": "JA3XE74C1SY012345"},
    {"year": 1983, "make": "Porsche", "model": "911 SC Targa", "vin": "WP0EB0910DS160234"},
]

# Missing field diagnoses by field
FIELD_DIAGNOSES = {
    "vin": {
        "high_expected": (
            "Missing VIN on a source that normally provides it. Possible causes:\n"
            "1. **Extraction failure**: The parser didn't find the VIN in the page HTML\n"
            "2. **Pre-1981 vehicle**: No standardized 17-digit VIN — uses chassis/serial number\n"
            "3. **Parts listing**: Non-vehicle items don't have VINs\n\n"
            "Fix attempts:\n"
            "- Check the description: `SELECT left(description, 500) FROM vehicles WHERE id = '<id>';`\n"
            "- Try AI extraction: `extract-vin-from-vehicle` on listing photos\n"
            "- Re-run source extractor if description mentions a VIN"
        ),
        "low_expected": (
            "Missing VIN is expected for this source — they typically don't publish VINs.\n"
            "No action needed unless you have the VIN from another source (e.g., vehicle_observations from a different platform)."
        ),
    },
    "sale_price": {
        "high_expected": (
            "Missing price on a source that normally reports it. Check auction status:\n"
            "```sql\nSELECT auction_status, reserve_status FROM vehicles WHERE id = '<id>';\n```\n\n"
            "- `reserve_not_met` → No sale occurred, NULL price is correct\n"
            "- `ended` + NULL price → Extraction missed the final price. Re-run extractor.\n"
            "- `active` → Auction still running, no price yet\n\n"
            "For BaT: `complete-bat-import` on the listing URL should capture the final price."
        ),
        "low_expected": (
            "Missing price is common for this source. Many lots don't report final hammer prices.\n"
            "If the lot has an estimate range, check `vehicle_observations` for price estimate data."
        ),
    },
    "description": {
        "high_expected": (
            "Missing description indicates incomplete extraction — this is a skeleton record.\n\n"
            "Fix:\n"
            "1. Find source URL: `SELECT source_url FROM vehicle_events WHERE vehicle_id = '<id>';`\n"
            "2. Re-run the source-specific extractor\n"
            "3. If no source URL: use `enrich-vehicle-profile-ai` to generate from Y/M/M + available data"
        ),
        "low_expected": (
            "Missing description may indicate the source doesn't provide detailed listings, "
            "or the extraction didn't capture it. Try re-running the extractor."
        ),
    },
    "mileage": {
        "high_expected": (
            "Mileage usually appears in the listing description. Check:\n"
            "```sql\nSELECT description FROM vehicles WHERE id = '<id>';\n```\n"
            "Search for patterns like '45,000 miles', '45K mi', 'indicated 45000'.\n"
            "If present in description but not in the mileage field, the parser didn't extract it."
        ),
        "low_expected": (
            "Mileage may not be reported for this source or this type of vehicle. "
            "Pre-war and many European auction vehicles often don't report mileage."
        ),
    },
    "images": {
        "high_expected": (
            "No images means the image extraction step failed or wasn't run. Re-run the source extractor.\n\n"
            "If images exist but aren't analyzed:\n"
            "```sql\nSELECT ai_processing_status, count(*) FROM vehicle_images\nWHERE vehicle_id = '<id>' GROUP BY ai_processing_status;\n```\n"
            "If status='pending', run `photo-pipeline-orchestrator` to process them."
        ),
        "low_expected": (
            "Low image count may be normal for this source. Check if images exist but weren't linked:\n"
            "```sql\nSELECT count(*) FROM vehicle_images WHERE vehicle_id = '<id>';\n```"
        ),
    },
    "comments": {
        "high_expected": (
            "Missing comments on a community-driven platform is a red flag. The comment extraction likely didn't run.\n\n"
            "Fix:\n"
            "```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/extract-auction-comments\" \\\n"
            "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
            "  -H \"Content-Type: application/json\" \\\n"
            "  -d '{\"vehicle_id\": \"<id>\", \"url\": \"<listing_url>\"}'\n```"
        ),
        "low_expected": (
            "This source doesn't have a comment system. Missing comments is expected — no action needed.\n"
            "Only BaT, Cars & Bids, and PCarMarket have community comment threads."
        ),
    },
}

# Misclassification patterns
MISCLASSIFICATION_PATTERNS = [
    {
        "model_value": "911 18x8 And 9.5 Wheels By Speedline",
        "diagnosis": "NOT a vehicle — it's a parts listing (wheels). The model field contains product specs, not a vehicle model.",
        "fix": "UPDATE vehicles SET status = 'rejected' WHERE id = '<id>';",
        "prevention": "Haiku extraction should classify document type before extracting. Keywords: 'wheels', 'rims', 'parts'.",
    },
    {
        "model_value": "Owner's Manual and Pouch",
        "diagnosis": "NOT a vehicle — it's literature/memorabilia. Owner's manuals are auction items but not vehicles.",
        "fix": "UPDATE vehicles SET status = 'rejected' WHERE id = '<id>';",
        "prevention": "Filter on keywords: 'manual', 'literature', 'brochure', 'poster', 'memorabilia'.",
    },
    {
        "model_value": "Pedal Car",
        "diagnosis": "NOT a real vehicle — it's a toy/collectible pedal car. Year is usually NULL because pedal cars don't have model years.",
        "fix": "UPDATE vehicles SET status = 'rejected' WHERE id = '<id>';",
        "prevention": "Filter: 'pedal car', 'go-kart', 'model car', 'scale model'.",
    },
    {
        "model_value": "356 Engine",
        "diagnosis": "NOT a vehicle — it's a standalone engine being auctioned as a part. Missing year and VIN are clues.",
        "fix": "UPDATE vehicles SET status = 'rejected' WHERE id = '<id>';",
        "prevention": "Filter: model field containing 'engine', 'motor', 'transmission' without year.",
    },
    {
        "model_value": "Neon Sign - Porsche Service",
        "diagnosis": "NOT a vehicle — it's automotive memorabilia (neon sign). Misclassified by the extractor.",
        "fix": "UPDATE vehicles SET status = 'rejected' WHERE id = '<id>';",
        "prevention": "Filter: 'sign', 'neon', 'clock', 'artwork', 'painting'.",
    },
    {
        "model_value": "Tool Kit and Jack for 911",
        "diagnosis": "NOT a vehicle — it's an accessories listing. The '911' in the model caused misclassification.",
        "fix": "UPDATE vehicles SET status = 'rejected' WHERE id = '<id>';",
        "prevention": "Filter: 'tool kit', 'jack', 'car cover', 'luggage set', 'accessories'.",
    },
]

# Placeholder VIN patterns
PLACEHOLDER_VINS = [
    ("00000", "Zeroed placeholder — not a real VIN"),
    ("12345", "Sequential placeholder — not a real VIN"),
    ("XXXXXXXXXXXXXXXXX", "X-filled placeholder — not a real VIN"),
    ("TBD", "Placeholder text — not a real VIN"),
    ("N/A", "Not-applicable marker — not a real VIN"),
    ("UNKNOWN", "Unknown marker — not a real VIN"),
    ("00000000000000000", "17-zero placeholder — not a real VIN"),
]

# Auction status scenarios
AUCTION_STATUS_SCENARIOS = [
    {
        "status": "reserve_not_met",
        "description": "Reserve Not Met (RNM)",
        "meaning": "The bidding didn't reach the seller's reserve price. The vehicle did NOT sell.",
        "price_expected": False,
        "action": "NULL sale_price is correct. Do NOT fabricate a price from the highest bid. Mark as no-sale in reporting.",
    },
    {
        "status": "ended",
        "description": "Auction Ended (with null price)",
        "meaning": "The auction completed but no price was captured.",
        "price_expected": True,
        "action": "Extraction likely missed the price. Re-run the source extractor on the listing URL.",
    },
    {
        "status": "active",
        "description": "Auction Still Active",
        "meaning": "The auction hasn't finished yet.",
        "price_expected": False,
        "action": "No action — price will be set when the auction ends. Don't extract a 'current bid' as the sale price.",
    },
]

# Question templates for variety
DIAGNOSIS_TEMPLATES = [
    "This {source} vehicle has: {fields}. What's wrong?",
    "Review this {source} record: {fields}. Is it complete?",
    "Vehicle from {source}: {fields}. Diagnose any issues.",
    "{source} listing shows: {fields}. What's missing?",
    "Data quality check on this {source} vehicle: {fields}.",
    "Is this {source} extraction complete? Fields: {fields}.",
]

FIX_TEMPLATES = [
    "How do I fix a missing {field} on a {source} vehicle?",
    "This {source} vehicle is missing {field}. What should I do?",
    "{source} listing has no {field}. Is that a problem?",
    "Vehicle from {source} — {field} is null. How do I fill it?",
    "Missing {field} on {source}. Normal or broken?",
]


def generate_data_quality_diagnosis(loader, limit: int = 3000) -> list[dict]:
    pairs = []

    # 1. Source completeness profiles — what "good" looks like per source
    for source_key, profile in SOURCE_PROFILES.items():
        pairs.append(make_pair(
            f"What should a complete {profile['name']} vehicle record look like?",
            f"**{profile['name']} Quality Expectations:**\n\n"
            f"| Field | Expected Fill Rate |\n|-------|--------------------|\n"
            f"| VIN | {profile['expected_vin']*100:.0f}% |\n"
            f"| Sale Price | {profile['expected_price']*100:.0f}% |\n"
            f"| Description | {profile['expected_description']*100:.0f}% |\n"
            f"| Images | {profile['expected_images']*100:.0f}% (avg {profile['avg_images']}/listing) |\n"
            f"| Comments | {profile['expected_comments']*100:.0f}% (avg {profile['avg_comments']}/listing) |\n\n"
            f"{profile['notes']}",
            "data_quality_diagnosis",
        ))

        # Source-specific data quality expectations
        pairs.append(make_pair(
            f"What's the data quality like for {profile['name']}?",
            f"{profile['name']}: {profile['notes']}\n\n"
            f"Key metrics: VIN {profile['expected_vin']*100:.0f}%, Price {profile['expected_price']*100:.0f}%, "
            f"Description {profile['expected_description']*100:.0f}%, Images {profile['expected_images']*100:.0f}% "
            f"(avg {profile['avg_images']}/listing).",
            "data_quality_diagnosis",
        ))

        # "Is it broken?" scenarios for sources with low expected fields
        if profile["expected_vin"] < 0.5:
            pairs.append(make_pair(
                f"This {profile['name']} vehicle has no VIN. Is the extraction broken?",
                f"No — this is expected for {profile['name']}. Only {profile['expected_vin']*100:.0f}% of their listings include VINs.\n\n"
                f"To get the VIN:\n"
                f"1. Check vehicle_observations for VIN data from other sources\n"
                f"2. Use `extract-vin-from-vehicle` if there are photos showing the VIN plate\n"
                f"3. Manual lookup via NHTSA if you have enough identifying info\n\n"
                f"Don't flag this as a data quality issue unless it's a source that normally provides VINs.",
                "data_quality_diagnosis",
            ))

        if profile["expected_price"] < 0.5:
            pairs.append(make_pair(
                f"This {profile['name']} lot has no sale price. Should I investigate?",
                f"Not necessarily — {profile['name']} only reports final prices for {profile['expected_price']*100:.0f}% of lots.\n\n"
                f"Check if there's an estimate range instead:\n"
                f"```sql\nSELECT estimate_low, estimate_high FROM vehicles WHERE id = '<id>';\n```\n\n"
                f"Many high-end auction houses show pre-sale estimates but not final hammer prices.",
                "data_quality_diagnosis",
            ))

        if profile["expected_comments"] == 0.0:
            pairs.append(make_pair(
                f"Why does this {profile['name']} vehicle have zero comments?",
                f"{profile['name']} doesn't have a comment system — zero comments is expected.\n\n"
                f"Comment-based platforms: Bring a Trailer, Cars & Bids, PCarMarket.\n"
                f"No-comment platforms: Barrett-Jackson, Mecum, RM Sotheby's, Bonhams, Hagerty.",
                "data_quality_diagnosis",
            ))

    # 2. Combinatorial: source × missing field diagnosis
    for source_key, profile in SOURCE_PROFILES.items():
        for field, diagnosis in FIELD_DIAGNOSES.items():
            # Determine if field is expected for this source
            expected_key = f"expected_{field}" if field != "images" else "expected_images"
            if field == "comments":
                expected_key = "expected_comments"
            elif field == "mileage":
                expected_rate = 0.5  # rough estimate
            else:
                expected_rate = profile.get(expected_key, 0.5)

            if field == "mileage":
                expected_rate = 0.5

            is_expected = expected_rate > 0.5

            for template in random.sample(FIX_TEMPLATES, min(2, len(FIX_TEMPLATES))):
                question = template.format(field=field, source=profile['name'])
                if is_expected:
                    answer = diagnosis["high_expected"].replace("<id>", "<vehicle_id>")
                else:
                    answer = diagnosis["low_expected"]
                pairs.append(make_pair(question, answer, "data_quality_diagnosis"))

    # 3. Missing field scenarios — parameterized with real vehicle examples
    fields_list = ["vin", "sale_price", "description", "mileage"]
    for vehicle in VEHICLE_EXAMPLES:
        for source_key, profile in random.sample(list(SOURCE_PROFILES.items()), min(3, len(SOURCE_PROFILES))):
            # Generate a random subset of missing fields
            num_missing = random.randint(1, 3)
            missing = random.sample(fields_list, min(num_missing, len(fields_list)))

            present_parts = []
            if vehicle["year"]:
                present_parts.append(f"year={vehicle['year']}")
            present_parts.append(f"make={vehicle['make']}")
            present_parts.append(f"model={vehicle['model']}")
            if vehicle.get("vin") and "vin" not in missing:
                present_parts.append(f"vin={vehicle['vin']}")
            for m in missing:
                present_parts.append(f"{m}=NULL")

            fields_str = ", ".join(present_parts)

            # Determine diagnosis based on source expectations
            diagnosis_parts = []
            for m in missing:
                expected_key = f"expected_{m}" if m != "images" else "expected_images"
                if m == "comments":
                    expected_key = "expected_comments"
                expected_rate = profile.get(expected_key, 0.5)

                if expected_rate > 0.7:
                    diagnosis_parts.append(f"- **{m}**: Unexpected gap for {profile['name']} ({expected_rate*100:.0f}% expected). "
                                          f"Re-run extraction or check extraction logs.")
                elif expected_rate > 0.3:
                    diagnosis_parts.append(f"- **{m}**: Somewhat expected for {profile['name']} ({expected_rate*100:.0f}% fill rate). "
                                          f"Try enrichment but don't flag as broken.")
                else:
                    diagnosis_parts.append(f"- **{m}**: Expected gap for {profile['name']} (only {expected_rate*100:.0f}% fill rate). Normal.")

            template = random.choice(DIAGNOSIS_TEMPLATES)
            question = template.format(source=profile['name'], fields=fields_str)
            answer = f"Source: {profile['name']}\n\n" + "\n".join(diagnosis_parts)

            pairs.append(make_pair(question, answer, "data_quality_diagnosis"))

    # 4. Misclassification patterns
    for pattern in MISCLASSIFICATION_PATTERNS:
        pairs.append(make_pair(
            f"This vehicle record has model='{pattern['model_value']}' and year=NULL. What's wrong?",
            f"**{pattern['diagnosis']}**\n\nFix:\n```sql\n{pattern['fix']}\n```\n\nPrevention: {pattern['prevention']}",
            "data_quality_diagnosis",
        ))

        pairs.append(make_pair(
            f"Should I try to enrich a record with model='{pattern['model_value']}'?",
            f"No — this is not a vehicle. {pattern['diagnosis']}\n\n"
            f"Reject it: `{pattern['fix']}` and move on. Don't waste enrichment API calls on non-vehicles.",
            "data_quality_diagnosis",
        ))

    # 5. Placeholder VIN detection
    for vin, description in PLACEHOLDER_VINS:
        for vehicle in random.sample(VEHICLE_EXAMPLES, min(3, len(VEHICLE_EXAMPLES))):
            pairs.append(make_pair(
                f"Vehicle {vehicle['year']} {vehicle['make']} {vehicle['model']} has VIN '{vin}'. Valid?",
                f"No — '{vin}' is a {description}.\n\n"
                f"Fix:\n```sql\nUPDATE vehicles SET vin = NULL WHERE id = '<id>' AND vin = '{vin}';\n```\n\n"
                + (f"For pre-1981 vehicles (like a {vehicle['year']} {vehicle['make']}), there may be a chassis number instead of a 17-digit VIN — "
                   f"check the description for 'chassis' or 'serial' numbers." if vehicle['year'] < 1981 else
                   f"For a {vehicle['year']} {vehicle['make']}, a proper 17-digit VIN should exist. "
                   f"Try `extract-vin-from-vehicle` on the listing photos."),
                "data_quality_diagnosis",
            ))

    # 6. Auction status scenarios
    for scenario in AUCTION_STATUS_SCENARIOS:
        for vehicle in random.sample(VEHICLE_EXAMPLES, min(4, len(VEHICLE_EXAMPLES))):
            pairs.append(make_pair(
                f"This {vehicle['year']} {vehicle['make']} {vehicle['model']} has reserve_status='{scenario['status']}' and sale_price=NULL.",
                f"**{scenario['description']}**: {scenario['meaning']}\n\n"
                f"Price expected: {'Yes' if scenario['price_expected'] else 'No'}.\n\n"
                f"Action: {scenario['action']}",
                "data_quality_diagnosis",
            ))

        # Generic version
        pairs.append(make_pair(
            f"What does reserve_status='{scenario['status']}' mean?",
            f"**{scenario['description']}**: {scenario['meaning']}\n\nAction: {scenario['action']}",
            "data_quality_diagnosis",
        ))

    # 7. General diagnostic questions
    general_diagnostics = [
        (
            "How do I find all vehicles with incomplete data?",
            "Query by `data_quality_score` or check specific fields:\n\n"
            "```sql\nSELECT id, year, make, model, auction_source, data_quality_score,\n"
            "  CASE WHEN vin IS NULL THEN 'no_vin' END,\n"
            "  CASE WHEN sale_price IS NULL THEN 'no_price' END,\n"
            "  CASE WHEN description IS NULL THEN 'no_desc' END\n"
            "FROM vehicles\nWHERE status = 'active' AND data_quality_score < 50\n"
            "ORDER BY data_quality_score ASC\nLIMIT 100;\n```\n\n"
            "Or use the data quality monitor:\n"
            "```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/data-quality-monitor\" \\\n"
            "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
            "  -H \"Content-Type: application/json\" \\\n"
            "  -d '{\"action\": \"alerts\"}' | jq\n```",
        ),
        (
            "How do I check if a vehicle's extraction is complete?",
            "A \"complete\" extraction depends on the source. For BaT (gold standard):\n\n"
            "```sql\nSELECT v.id,\n"
            "  v.year IS NOT NULL as has_year,\n"
            "  v.make IS NOT NULL as has_make,\n"
            "  v.vin IS NOT NULL as has_vin,\n"
            "  v.sale_price IS NOT NULL as has_price,\n"
            "  v.description IS NOT NULL AND length(v.description) > 100 as has_desc,\n"
            "  (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) as image_count,\n"
            "  (SELECT count(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) as comment_count,\n"
            "  v.data_quality_score,\n"
            "  v.completion_percentage\n"
            "FROM vehicles v WHERE v.id = '<vehicle_id>';\n```\n\n"
            "Expected for BaT: Y/M/M (99%), VIN (95%), price (97%), description (99%), images (58 avg), comments (150 avg).",
        ),
        (
            "What's the difference between status 'rejected', 'deleted', and 'duplicate'?",
            "**`rejected`** — Failed quality checks. Parts listings, memorabilia, non-vehicle items misextracted as vehicles.\n\n"
            "**`deleted`** — Explicitly removed by user or cleanup. Should not appear in queries.\n\n"
            "**`duplicate`** — Same vehicle under another ID. Canonical record has status='active'. Child records merged before marking.\n\n"
            "Other statuses: `active`, `pending`, `sold`, `discovered`, `inactive`, `archived`, `pending_backfill`.",
        ),
        (
            "How do I compare data quality across sources?",
            "Query per-source quality metrics:\n\n"
            "```sql\nSELECT auction_source,\n"
            "  count(*) as total,\n"
            "  avg(data_quality_score)::int as avg_quality,\n"
            "  count(*) FILTER (WHERE vin IS NOT NULL) * 100.0 / count(*) as vin_pct,\n"
            "  count(*) FILTER (WHERE sale_price IS NOT NULL) * 100.0 / count(*) as price_pct,\n"
            "  count(*) FILTER (WHERE description IS NOT NULL) * 100.0 / count(*) as desc_pct\n"
            "FROM vehicles\nWHERE status = 'active'\n"
            "GROUP BY auction_source\nORDER BY avg_quality DESC;\n```\n\n"
            "Compare against SOURCE_PROFILES expectations — if BaT VIN rate drops below 90%, something's broken.",
        ),
        (
            "How do I find skeleton records that need re-extraction?",
            "Skeleton records have Y/M/M but nothing else:\n\n"
            "```sql\nSELECT v.id, v.year, v.make, v.model, v.auction_source,\n"
            "  v.data_quality_score\n"
            "FROM vehicles v\n"
            "WHERE v.status = 'active'\n"
            "  AND v.year IS NOT NULL\n"
            "  AND v.make IS NOT NULL\n"
            "  AND v.description IS NULL\n"
            "  AND NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)\n"
            "ORDER BY v.created_at DESC\nLIMIT 100;\n```\n\n"
            "These vehicles had their title parsed but full extraction never ran. Get their source URLs from `vehicle_events` and re-run the appropriate extractor.",
        ),
        (
            "What causes a low data_quality_score?",
            "data_quality_score (0-100) reflects field completeness. Main contributors:\n\n"
            "- Year/make/model missing (high weight) → very low score\n"
            "- No VIN → drops by ~15 points\n"
            "- No sale price → drops by ~10 points\n"
            "- No description or < 100 chars → drops by ~15 points\n"
            "- No images → drops by ~10 points\n"
            "- No mileage → drops by ~5 points\n"
            "- No enrichment (factory specs, valuation) → drops by ~10 points\n\n"
            "Thresholds: 80+ = A, 60-79 = B, 40-59 = C, 20-39 = D, <20 = F.\n\n"
            "Don't write data_quality_score directly — it's computed by `calculate-profile-completeness`.",
        ),
        (
            "How do I distinguish real sales from no-sales in the data?",
            "Check auction_status and reserve_status:\n\n"
            "```sql\nSELECT\n"
            "  CASE\n"
            "    WHEN sale_price IS NOT NULL AND auction_status = 'ended' THEN 'sold'\n"
            "    WHEN reserve_status = 'reserve_not_met' THEN 'no_sale_rnm'\n"
            "    WHEN auction_status = 'active' THEN 'still_active'\n"
            "    WHEN auction_status = 'ended' AND sale_price IS NULL THEN 'ended_no_price'\n"
            "    ELSE 'unknown'\n"
            "  END as sale_status,\n"
            "  count(*)\n"
            "FROM vehicles\nWHERE auction_source = 'bat'\n"
            "GROUP BY 1;\n```\n\n"
            "Important: Reserve Not Met (RNM) vehicles should NEVER be counted as sales or included in price comparables. "
            "The highest bid is NOT the sale price — the vehicle didn't sell.",
        ),
        (
            "What's the ConceptCarz data quality issue?",
            "ConceptCarz is an encyclopedia, NOT an auction. Their 374K vehicles have fabricated 'prices' that are editorial estimates.\n\n"
            "**Problem:** These were imported as if they were auction results, polluting market comparables.\n\n"
            "**Fix:** Null out prices and mark as editorial:\n"
            "```sql\nUPDATE vehicles SET sale_price = NULL, price_source = 'editorial_estimate'\n"
            "WHERE auction_source = 'conceptcarz' AND sale_price IS NOT NULL;\n```\n\n"
            "**Prevention:** Always exclude ConceptCarz from price-based queries:\n"
            "`WHERE auction_source != 'conceptcarz'`",
        ),
        (
            "How do I check for duplicate vehicle records?",
            "Duplicates occur when the same listing is extracted multiple times. Find them:\n\n"
            "```sql\n-- By source URL (most reliable)\n"
            "SELECT source_url, count(*) as dupes\n"
            "FROM vehicle_events\nWHERE source_url IS NOT NULL\n"
            "GROUP BY source_url\nHAVING count(*) > 1\nORDER BY dupes DESC\nLIMIT 50;\n\n"
            "-- By VIN + year + make (for cross-source)\n"
            "SELECT vin, year, make, model, count(*) as dupes\n"
            "FROM vehicles\nWHERE vin IS NOT NULL AND status = 'active'\n"
            "GROUP BY vin, year, make, model\nHAVING count(*) > 1;\n```\n\n"
            "BaT had 3.9x duplication before dedup. Keep the record with highest `completion_percentage`, merge children, mark others as 'duplicate'.",
        ),
        (
            "How do I verify extraction quality for a batch of new vehicles?",
            "Quick quality audit query:\n\n"
            "```sql\nSELECT\n"
            "  auction_source,\n"
            "  count(*) as total,\n"
            "  count(*) FILTER (WHERE data_quality_score >= 80) as grade_a,\n"
            "  count(*) FILTER (WHERE data_quality_score BETWEEN 60 AND 79) as grade_b,\n"
            "  count(*) FILTER (WHERE data_quality_score BETWEEN 40 AND 59) as grade_c,\n"
            "  count(*) FILTER (WHERE data_quality_score < 40) as grade_d_f\n"
            "FROM vehicles\nWHERE created_at > now() - interval '24 hours'\n"
            "  AND status = 'active'\n"
            "GROUP BY auction_source;\n```\n\n"
            "If a source shows > 50% grade D/F, extraction is broken for that source.",
        ),
    ]
    for q, a in general_diagnostics:
        pairs.append(make_pair(q, a, "data_quality_diagnosis"))

    # 8. Source comparison questions
    source_pairs = [
        (("bat", "barrett-jackson"), "BaT has much higher data quality across all fields. VIN: 95% vs 20%. Price: 97% vs 34%. Plus BaT has community comments (avg 150/listing) while BJ has none."),
        (("bat", "rm-sothebys"), "Completely different profiles. BaT is community-driven with high completeness. RM Sotheby's is a premium auction house — almost no VINs (0.3%), sparse pricing, but excellent provenance descriptions."),
        (("mecum", "barrett-jackson"), "Both are traditional auction houses with similar profiles: low VIN rates, moderate pricing, no comments. Mecum has higher volume (145K+ lots) but lower price capture (47% vs 34%)."),
        (("bat", "carsandbids"), "Similar community-driven model. Both have high VIN, price, description, and comment rates. BaT skews older/pricier vehicles, C&B focuses on modern enthusiast cars (1980s+)."),
        (("bat", "pcarmarket"), "Very similar data quality — both are community auction platforms. PCarMarket is Porsche-only. Slightly fewer images and comments than BaT but still high quality."),
        (("conceptcarz", "bat"), "Incompatible sources. ConceptCarz is an encyclopedia with editorial estimates (NOT real sales). BaT is a live auction with real transaction prices. NEVER mix ConceptCarz 'prices' into BaT-based market analysis."),
    ]
    for (s1, s2), comparison in source_pairs:
        p1 = SOURCE_PROFILES.get(s1, {})
        p2 = SOURCE_PROFILES.get(s2, {})
        pairs.append(make_pair(
            f"How does {p1.get('name', s1)} compare to {p2.get('name', s2)} for data quality?",
            comparison,
            "data_quality_diagnosis",
        ))

    # 9. Extended parameterized questions — source × vehicle × question type
    question_types = [
        ("What's wrong with this {source} record for a {year} {make} {model}?",
         "Review the record against {source} expectations:\n\n{analysis}"),
        ("Is this {source} extraction complete for the {year} {make} {model}?",
         "Compare to {source} benchmarks:\n\n{analysis}"),
        ("Grade this {source} data: {year} {make} {model}.",
         "Quality assessment for {source}:\n\n{analysis}"),
    ]

    for vehicle in VEHICLE_EXAMPLES:
        for source_key, profile in SOURCE_PROFILES.items():
            # Skip combinations that don't make sense (e.g., Ferrari on Craigslist)
            if source_key == "conceptcarz":
                continue

            analysis_parts = []
            if profile["expected_vin"] > 0.8:
                if vehicle.get("vin"):
                    analysis_parts.append(f"- VIN: Present ✓ ({profile['expected_vin']*100:.0f}% expected for {profile['name']})")
                else:
                    analysis_parts.append(f"- VIN: MISSING ✗ ({profile['expected_vin']*100:.0f}% expected — should have VIN)")
            else:
                analysis_parts.append(f"- VIN: Missing (OK — only {profile['expected_vin']*100:.0f}% expected for {profile['name']})")

            analysis_parts.append(f"- Price: {profile['expected_price']*100:.0f}% fill rate expected")
            analysis_parts.append(f"- Images: avg {profile['avg_images']}/listing")
            if profile['avg_comments'] > 0:
                analysis_parts.append(f"- Comments: avg {profile['avg_comments']}/listing (community platform)")
            else:
                analysis_parts.append(f"- Comments: None expected (no comment system)")
            analysis = "\n".join(analysis_parts)

            for qt, at in random.sample(question_types, 1):
                q = qt.format(source=profile['name'], year=vehicle['year'], make=vehicle['make'], model=vehicle['model'])
                a = at.format(source=profile['name'], year=vehicle['year'], make=vehicle['make'], model=vehicle['model'], analysis=analysis)
                pairs.append(make_pair(q, a, "data_quality_diagnosis"))

    # 10. Query real deficient vehicles from DB
    try:
        vehicles = loader.vehicles()
        no_vin = [v for v in vehicles if v.get("year") and v.get("make") and not v.get("vin")]
        for v in random.sample(no_vin, min(50, len(no_vin))):
            source = v.get("auction_source", "unknown")
            expected = SOURCE_PROFILES.get(source, {}).get("expected_vin", 0.5)
            is_expected = expected < 0.5
            pairs.append(make_pair(
                f"Vehicle {v['year']} {v['make']} {v.get('model', 'Unknown')} from {source} has no VIN.",
                f"{'This is expected' if is_expected else 'This may indicate incomplete extraction'}. "
                f"{source.upper()} typically has {expected*100:.0f}% VIN fill rate.\n\n"
                + ("No action needed for this source." if is_expected else
                   f"Try: `decode-vin-and-update` if you can find the VIN from description or photos. "
                   f"Or `extract-vin-from-vehicle` for AI-powered VIN plate detection."),
                "data_quality_diagnosis",
            ))

        no_desc = [v for v in vehicles if v.get("year") and v.get("make") and not v.get("description")]
        for v in random.sample(no_desc, min(50, len(no_desc))):
            pairs.append(make_pair(
                f"Vehicle {v['year']} {v['make']} {v.get('model', 'Unknown')} has no description.",
                f"Missing description means the full extraction likely didn't run. This is a skeleton record.\n\n"
                f"Fix:\n1. Find the source URL: `SELECT source_url FROM vehicle_events WHERE vehicle_id = '{v['id']}';`\n"
                f"2. Re-run the extractor for {v.get('auction_source', 'the source')}\n"
                f"3. If no source URL exists, try `enrich-vehicle-profile-ai` to generate a description from available data",
                "data_quality_diagnosis",
            ))
    except Exception:
        pass

    random.shuffle(pairs)
    return pairs[:limit]
