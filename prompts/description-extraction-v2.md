# Description Extraction v2: Testimony Decomposition

**Version**: 2.0
**Purpose**: Decompose vehicle listing descriptions into timestamped claims with categories, decay rates, and verifiability
**Supersedes**: `description-intelligence-extraction.md` (v1 flat extraction), `discover-description-data/index.ts` (open-ended discovery)

**Core philosophical shift**: A description is TESTIMONY with a HALF-LIFE, not data. Every sentence is a claim made by a person at a point in time. Claims decay: "recently rebuilt engine" meant something in 2019, something different in 2026. This prompt forces the LLM to treat descriptions as depositions, not spec sheets.

---

## System Prompt

```
You are a forensic vehicle listing analyst. You do NOT extract "data" -- you decompose TESTIMONY into individual CLAIMS.

Every statement in a vehicle listing is a claim made by a seller at a specific point in time. Your job is to:

1. ISOLATE each factual claim as a separate unit
2. TIMESTAMP it (when did the claimed event occur, not when it was written)
3. CATEGORIZE it (mechanical, cosmetic, structural, provenance, specification)
4. ASSIGN A DECAY RATE (how quickly does this claim lose reliability over time)
5. ASSESS INITIAL CONFIDENCE (how specific and verifiable is the claim as stated)
6. FLAG vague language that obscures temporal precision

DECAY RATE RULES:
- "fast" = mechanical claims. An engine rebuild loses relevance at ~15% per year. "Runs great" decays fastest.
- "medium" = cosmetic claims. Paint, upholstery, chrome. Degrades but slower than mechanical.
- "slow" = structural claims. Frame work, body panels, rust repair. Years to decades of relevance.
- "permanent" = provenance and specifications. VIN decoding, production numbers, ownership chain, factory options. These do not decay.

CONFIDENCE SCORING:
- 0.95+ = Verifiable fact with specific detail (VIN decoded, dated receipt mentioned, specific mileage)
- 0.80-0.94 = Specific claim with plausible detail ("rebuilt by Acme Machine Shop in 2017")
- 0.60-0.79 = Reasonable claim lacking specifics ("serviced regularly", "garage kept")
- 0.40-0.59 = Vague or self-serving claim ("runs and drives great", "solid truck")
- 0.20-0.39 = Suspiciously vague or contradictory claim
- Below 0.20 = Essentially meaningless ("nice", "must see")

VAGUE LANGUAGE DETECTION:
Flag ANY temporal language that lacks a specific date:
- "recently" (when?)
- "just" (when?)
- "a few years ago" (which years?)
- "new" (installed when?)
- "fresh" (done when?)
- "older restoration" (what year?)

CRITICAL RULES:
1. Extract ONLY what is explicitly stated. Never infer.
2. If a date is ambiguous, use the most conservative interpretation.
3. The sale_date provided is your temporal anchor. All relative language ("recently", "last year") should be interpreted relative to this date.
4. When a VIN is provided, note which claims COULD be verified against VIN decoding but do NOT decode it yourself.
5. Separate what the seller CLAIMS from what is VERIFIABLE.
6. Return valid JSON only. No markdown, no commentary.
```

---

## User Prompt Template

```
Decompose this vehicle listing description into individual timestamped claims.

VEHICLE CONTEXT:
Year: {year}
Make: {make}
Model: {model}
Sale Date: {sale_date}
VIN: {vin_or_null}

DESCRIPTION:
---
{description}
---

Analyze this description as forensic testimony. Every sentence may contain multiple claims. Decompose them ALL.

Return this exact JSON structure:

{
  "claims": [
    {
      "claim_text": "<exact or closely paraphrased text from description>",
      "category": "<mechanical|cosmetic|structural|provenance|specification>",
      "subcategory": "<see list below>",
      "event_date": "<YYYY-MM-DD, YYYY-MM, or YYYY | null if no date determinable>",
      "event_date_precision": "<exact|month|year|decade|relative|none>",
      "relative_time_original": "<original phrasing if relative, e.g. 'recently', 'a few years ago' | null>",
      "decay_rate": "<fast|medium|slow|permanent>",
      "initial_confidence": <0.0 to 1.0>,
      "vague_language": <true|false>,
      "vague_reason": "<why it's vague | null>",
      "verifiable_by": ["<photos|receipts|vin_decode|inspection|title_history|production_records|registry|none>"],
      "source_sentence": "<the sentence or clause this claim was extracted from>"
    }
  ],

  "specifications": {
    "engine": {
      "claimed": "<as described in listing | null>",
      "rpo_code": "<if mentioned | null>",
      "displacement": "<cubic inches or liters if stated | null>",
      "fuel_system": "<carbureted|fuel_injected|null>",
      "verifiable": <true|false>,
      "original_claim": "<does seller claim this is the original engine | null>"
    },
    "transmission": {
      "claimed": "<as described | null>",
      "rpo_code": "<if mentioned | null>",
      "type": "<manual|automatic|null>",
      "speeds": <number|null>,
      "verifiable": <true|false>,
      "original_claim": "<does seller claim original | null>"
    },
    "drivetrain": {
      "claimed": "<2WD|4WD|AWD|null>",
      "transfer_case": "<if mentioned | null>",
      "axle_ratio": "<if mentioned | null>",
      "rpo_code": "<if mentioned | null>"
    },
    "paint": {
      "claimed_color": "<color name as stated | null>",
      "paint_code": "<if mentioned | null>",
      "original_claim": <true|false|null>,
      "repainted": <true|false|null>,
      "repaint_date": "<YYYY or null>"
    },
    "interior": {
      "claimed_color": "<if mentioned | null>",
      "material": "<cloth|vinyl|leather|null>",
      "seat_type": "<bench|bucket|split_bench|null>",
      "trim_code": "<if mentioned | null>",
      "original_claim": <true|false|null>
    },
    "wheels_tires": {
      "wheel_description": "<as stated | null>",
      "tire_description": "<brand/size as stated | null>",
      "original_claim": <true|false|null>
    },
    "brakes": {
      "front": "<disc|drum|null>",
      "rear": "<disc|drum|null>",
      "description": "<as stated | null>"
    },
    "other_codes": [
      {"code": "<RPO, paint, trim, axle, or other code mentioned>", "type": "<rpo|paint|trim|axle|other>", "description": "<what seller says it means | null>"}
    ]
  },

  "trim_evidence": {
    "explicit_trim_mention": "<exact trim name if seller states it: Custom, Custom Deluxe, Scottsdale, Silverado, Cheyenne, etc. | null>",
    "badge_mentions": ["<any badges, emblems, or nameplates mentioned>"],
    "trim_indicators": ["<equipment or features that imply a specific trim level>"],
    "trim_conflicts": ["<any inconsistencies between claimed trim and described equipment>"],
    "equipment_list": ["<every piece of equipment/option mentioned>"],
    "equipment_beyond_trim": ["<options that go beyond the base equipment for the claimed/implied trim>"],
    "trim_confidence": <0.0 to 1.0 - how certain is the trim identification>,
    "trim_reasoning": "<one sentence explaining the trim determination>"
  },

  "ownership_chain": [
    {
      "owner_number": <1|2|3|etc.|null>,
      "location": "<city, state, or region | null>",
      "period_start": "<YYYY | null>",
      "period_end": "<YYYY | null>",
      "duration_stated": "<as described, e.g. '20 years' | null>",
      "relationship": "<original_owner|family|dealer|collector|estate|seller|null>",
      "storage": "<garage_kept|barn_find|outdoor|climate_controlled|null>",
      "notes": "<any other details about this owner's period>"
    }
  ],

  "work_history": [
    {
      "work_type": "<restoration|rebuild|repair|service|modification|refinish|upholstery|bodywork>",
      "scope": "<frame_off|partial|component|full|null>",
      "description": "<what was done>",
      "date": "<YYYY or YYYY-MM | null>",
      "date_precision": "<exact|month|year|approximate|none>",
      "shop_or_person": "<who did the work | null>",
      "cost": <number|null>,
      "documented": <true|false|null>,
      "components_touched": ["<specific parts/systems involved>"],
      "decay_rate": "<fast|medium|slow>",
      "current_relevance": "<high|medium|low - given time elapsed since work>"
    }
  ],

  "documentation_mentioned": [
    {
      "item": "<service records|owner's manual|window sticker|build sheet|title|receipts|photos|etc.>",
      "detail": "<any specifics, e.g. 'dating to 1985' | null>",
      "included_in_sale": <true|false|null>
    }
  ],

  "mileage": {
    "value": <number|null>,
    "type": "<actual|indicated|exempt|unknown>",
    "tmr": "<true_mileage_reading: true|false|null>",
    "confidence": <0.0 to 1.0>,
    "notes": "<any caveats about mileage | null>"
  },

  "numbers": {
    "production_number": {"value": "<e.g. '#16 of 153' | null>", "total_produced": <number|null>},
    "owners_count": {"value": <number|null>, "confidence": <0.0 to 1.0>},
    "price_mentions": [{"context": "<what the price refers to>", "amount": <number>, "date": "<YYYY|null>"}]
  },

  "red_flags": [
    {
      "flag": "<description of the concern>",
      "severity": "<low|medium|high>",
      "category": "<mechanical|structural|provenance|disclosure|inconsistency>",
      "source_text": "<the text that triggered this flag>"
    }
  ],

  "vague_claims_summary": [
    {
      "original_text": "<the vague phrase>",
      "category": "<mechanical|cosmetic|structural|provenance>",
      "what_is_missing": "<what specific information would make this precise>",
      "best_case_interpretation": "<most favorable reading>",
      "worst_case_interpretation": "<least favorable reading>"
    }
  ]
}

SUBCATEGORY REFERENCE (use these for claim subcategories):
- mechanical: engine, transmission, drivetrain, brakes, suspension, cooling, electrical, fuel_system, exhaust, steering
- cosmetic: paint, interior, chrome, glass, trim, upholstery, weatherstripping, emblems, wheels
- structural: frame, body, floors, rocker_panels, fenders, quarters, cab_corners, bed, rust_repair, welding
- provenance: ownership, location, storage, purchase, sale, accident, theft, celebrity, museum
- specification: engine_type, transmission_type, axle_ratio, paint_code, trim_level, vin, rpo_code, production_number, factory_option

Return ONLY the JSON object. No markdown fencing. No explanatory text.
```

---

## Example Input

```
Year: 1984
Make: Chevrolet
Model: K10
Sale Date: 2024-08-15
VIN: 1GCEK14H3EF123456

DESCRIPTION:
This 1984 Chevrolet K10 Scottsdale short-bed pickup was acquired by the seller
in 2019 from the original owner's family in Arizona. Finished in two-tone Frost
White over dark blue, the truck is powered by a 350ci V8 paired with a TH400
automatic transmission and a part-time four-wheel-drive transfer case. The
seller states that a frame-off restoration was completed in 2017 during the
previous ownership. Recent service included a carburetor rebuild and new
fuel pump. The odometer shows 87,000 miles, believed to be original. Equipment
includes air conditioning, tilt steering, AM/FM radio, and a sliding rear
window. The truck is said to be rust-free, having spent its entire life in
Arizona. Service records dating to 1990 and the owner's manual accompany
the sale.
```

---

## Example Output

```json
{
  "claims": [
    {
      "claim_text": "K10 Scottsdale short-bed pickup",
      "category": "specification",
      "subcategory": "trim_level",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.90,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["vin_decode", "photos"],
      "source_sentence": "This 1984 Chevrolet K10 Scottsdale short-bed pickup was acquired by the seller in 2019 from the original owner's family in Arizona."
    },
    {
      "claim_text": "Acquired by the seller in 2019 from the original owner's family in Arizona",
      "category": "provenance",
      "subcategory": "purchase",
      "event_date": "2019",
      "event_date_precision": "year",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.88,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["title_history"],
      "source_sentence": "This 1984 Chevrolet K10 Scottsdale short-bed pickup was acquired by the seller in 2019 from the original owner's family in Arizona."
    },
    {
      "claim_text": "Original owner's family in Arizona implies single-family ownership 1984-2019",
      "category": "provenance",
      "subcategory": "ownership",
      "event_date": "1984",
      "event_date_precision": "year",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.75,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["title_history"],
      "source_sentence": "This 1984 Chevrolet K10 Scottsdale short-bed pickup was acquired by the seller in 2019 from the original owner's family in Arizona."
    },
    {
      "claim_text": "Finished in two-tone Frost White over dark blue",
      "category": "cosmetic",
      "subcategory": "paint",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "medium",
      "initial_confidence": 0.85,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["photos", "vin_decode"],
      "source_sentence": "Finished in two-tone Frost White over dark blue, the truck is powered by a 350ci V8 paired with a TH400 automatic transmission and a part-time four-wheel-drive transfer case."
    },
    {
      "claim_text": "Powered by a 350ci V8",
      "category": "specification",
      "subcategory": "engine_type",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.85,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["photos", "vin_decode", "inspection"],
      "source_sentence": "Finished in two-tone Frost White over dark blue, the truck is powered by a 350ci V8 paired with a TH400 automatic transmission and a part-time four-wheel-drive transfer case."
    },
    {
      "claim_text": "TH400 automatic transmission",
      "category": "specification",
      "subcategory": "transmission_type",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.85,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["inspection"],
      "source_sentence": "Finished in two-tone Frost White over dark blue, the truck is powered by a 350ci V8 paired with a TH400 automatic transmission and a part-time four-wheel-drive transfer case."
    },
    {
      "claim_text": "Part-time four-wheel-drive transfer case",
      "category": "specification",
      "subcategory": "drivetrain",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.90,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["vin_decode", "inspection"],
      "source_sentence": "Finished in two-tone Frost White over dark blue, the truck is powered by a 350ci V8 paired with a TH400 automatic transmission and a part-time four-wheel-drive transfer case."
    },
    {
      "claim_text": "Frame-off restoration completed in 2017 during previous ownership",
      "category": "structural",
      "subcategory": "restoration",
      "event_date": "2017",
      "event_date_precision": "year",
      "relative_time_original": null,
      "decay_rate": "slow",
      "initial_confidence": 0.70,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["photos", "receipts"],
      "source_sentence": "The seller states that a frame-off restoration was completed in 2017 during the previous ownership."
    },
    {
      "claim_text": "Recent carburetor rebuild",
      "category": "mechanical",
      "subcategory": "fuel_system",
      "event_date": null,
      "event_date_precision": "relative",
      "relative_time_original": "Recent",
      "decay_rate": "fast",
      "initial_confidence": 0.55,
      "vague_language": true,
      "vague_reason": "No specific date for 'recent' -- could be months or years before the August 2024 sale",
      "verifiable_by": ["receipts"],
      "source_sentence": "Recent service included a carburetor rebuild and new fuel pump."
    },
    {
      "claim_text": "New fuel pump",
      "category": "mechanical",
      "subcategory": "fuel_system",
      "event_date": null,
      "event_date_precision": "relative",
      "relative_time_original": "Recent",
      "decay_rate": "fast",
      "initial_confidence": 0.55,
      "vague_language": true,
      "vague_reason": "No specific date for 'new' -- grouped under 'recent service'",
      "verifiable_by": ["receipts"],
      "source_sentence": "Recent service included a carburetor rebuild and new fuel pump."
    },
    {
      "claim_text": "Odometer shows 87,000 miles, believed to be original",
      "category": "provenance",
      "subcategory": "ownership",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.70,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["title_history", "inspection"],
      "source_sentence": "The odometer shows 87,000 miles, believed to be original."
    },
    {
      "claim_text": "Equipped with air conditioning",
      "category": "specification",
      "subcategory": "factory_option",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.90,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["photos", "inspection"],
      "source_sentence": "Equipment includes air conditioning, tilt steering, AM/FM radio, and a sliding rear window."
    },
    {
      "claim_text": "Equipped with tilt steering",
      "category": "specification",
      "subcategory": "factory_option",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.90,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["photos", "inspection"],
      "source_sentence": "Equipment includes air conditioning, tilt steering, AM/FM radio, and a sliding rear window."
    },
    {
      "claim_text": "Equipped with AM/FM radio",
      "category": "specification",
      "subcategory": "factory_option",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.90,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["photos", "inspection"],
      "source_sentence": "Equipment includes air conditioning, tilt steering, AM/FM radio, and a sliding rear window."
    },
    {
      "claim_text": "Equipped with sliding rear window",
      "category": "specification",
      "subcategory": "factory_option",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.90,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["photos", "inspection"],
      "source_sentence": "Equipment includes air conditioning, tilt steering, AM/FM radio, and a sliding rear window."
    },
    {
      "claim_text": "Rust-free, having spent entire life in Arizona",
      "category": "structural",
      "subcategory": "rust_repair",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "slow",
      "initial_confidence": 0.80,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["photos", "inspection", "title_history"],
      "source_sentence": "The truck is said to be rust-free, having spent its entire life in Arizona."
    },
    {
      "claim_text": "Service records dating to 1990 accompany the sale",
      "category": "provenance",
      "subcategory": "ownership",
      "event_date": "1990",
      "event_date_precision": "year",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.90,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["receipts"],
      "source_sentence": "Service records dating to 1990 and the owner's manual accompany the sale."
    },
    {
      "claim_text": "Owner's manual accompanies the sale",
      "category": "provenance",
      "subcategory": "ownership",
      "event_date": null,
      "event_date_precision": "none",
      "relative_time_original": null,
      "decay_rate": "permanent",
      "initial_confidence": 0.92,
      "vague_language": false,
      "vague_reason": null,
      "verifiable_by": ["photos"],
      "source_sentence": "Service records dating to 1990 and the owner's manual accompany the sale."
    }
  ],

  "specifications": {
    "engine": {
      "claimed": "350ci V8",
      "rpo_code": null,
      "displacement": "350ci",
      "fuel_system": "carbureted",
      "verifiable": true,
      "original_claim": null
    },
    "transmission": {
      "claimed": "TH400 automatic",
      "rpo_code": null,
      "type": "automatic",
      "speeds": 3,
      "verifiable": true,
      "original_claim": null
    },
    "drivetrain": {
      "claimed": "4WD",
      "transfer_case": "part-time",
      "axle_ratio": null,
      "rpo_code": null
    },
    "paint": {
      "claimed_color": "two-tone Frost White over dark blue",
      "paint_code": null,
      "original_claim": null,
      "repainted": null,
      "repaint_date": null
    },
    "interior": {
      "claimed_color": null,
      "material": null,
      "seat_type": null,
      "trim_code": null,
      "original_claim": null
    },
    "wheels_tires": {
      "wheel_description": null,
      "tire_description": null,
      "original_claim": null
    },
    "brakes": {
      "front": null,
      "rear": null,
      "description": null
    },
    "other_codes": []
  },

  "trim_evidence": {
    "explicit_trim_mention": "Scottsdale",
    "badge_mentions": ["Scottsdale"],
    "trim_indicators": ["AM/FM radio", "air conditioning", "tilt steering"],
    "trim_conflicts": [],
    "equipment_list": ["air conditioning", "tilt steering", "AM/FM radio", "sliding rear window"],
    "equipment_beyond_trim": ["air conditioning", "tilt steering"],
    "trim_confidence": 0.90,
    "trim_reasoning": "Seller explicitly names Scottsdale trim. Equipment list (A/C, tilt) is consistent with Scottsdale plus optional packages."
  },

  "ownership_chain": [
    {
      "owner_number": 1,
      "location": "Arizona",
      "period_start": "1984",
      "period_end": "2019",
      "duration_stated": null,
      "relationship": "original_owner",
      "storage": null,
      "notes": "Seller acquired from original owner's family, implying original owner may have died or transferred to family"
    },
    {
      "owner_number": 2,
      "location": null,
      "period_start": "2019",
      "period_end": "2024",
      "duration_stated": null,
      "relationship": "seller",
      "storage": null,
      "notes": "Current seller, acquired 2019"
    }
  ],

  "work_history": [
    {
      "work_type": "restoration",
      "scope": "frame_off",
      "description": "Frame-off restoration completed during previous ownership",
      "date": "2017",
      "date_precision": "year",
      "shop_or_person": null,
      "cost": null,
      "documented": null,
      "components_touched": ["frame", "body"],
      "decay_rate": "slow",
      "current_relevance": "high"
    },
    {
      "work_type": "service",
      "scope": "component",
      "description": "Carburetor rebuild",
      "date": null,
      "date_precision": "none",
      "shop_or_person": null,
      "cost": null,
      "documented": null,
      "components_touched": ["carburetor"],
      "decay_rate": "fast",
      "current_relevance": "medium"
    },
    {
      "work_type": "repair",
      "scope": "component",
      "description": "New fuel pump installed",
      "date": null,
      "date_precision": "none",
      "shop_or_person": null,
      "cost": null,
      "documented": null,
      "components_touched": ["fuel pump"],
      "decay_rate": "fast",
      "current_relevance": "medium"
    }
  ],

  "documentation_mentioned": [
    {
      "item": "service records",
      "detail": "dating to 1990",
      "included_in_sale": true
    },
    {
      "item": "owner's manual",
      "detail": null,
      "included_in_sale": true
    }
  ],

  "mileage": {
    "value": 87000,
    "type": "indicated",
    "tmr": null,
    "confidence": 0.70,
    "notes": "Seller says 'believed to be original' -- not confirmed actual, hence 'indicated' type"
  },

  "numbers": {
    "production_number": {"value": null, "total_produced": null},
    "owners_count": {"value": 2, "confidence": 0.80},
    "price_mentions": []
  },

  "red_flags": [
    {
      "flag": "Frame-off restoration claimed but no shop name, receipts, or documentation mentioned for the restoration itself",
      "severity": "low",
      "category": "disclosure",
      "source_text": "The seller states that a frame-off restoration was completed in 2017 during the previous ownership."
    },
    {
      "flag": "Hedged mileage language: 'believed to be original' rather than confirmed TMR",
      "severity": "low",
      "category": "provenance",
      "source_text": "The odometer shows 87,000 miles, believed to be original."
    }
  ],

  "vague_claims_summary": [
    {
      "original_text": "Recent service included a carburetor rebuild and new fuel pump",
      "category": "mechanical",
      "what_is_missing": "Specific date or mileage when service was performed",
      "best_case_interpretation": "Service performed within weeks of the August 2024 sale date",
      "worst_case_interpretation": "Service performed years ago; 'recent' is relative to the restoration timeline, not the sale"
    }
  ]
}
```

---

## Implementation Notes

### Token Budget Estimation

For the example description above (roughly 800 characters of description text):
- System prompt: ~850 tokens
- User prompt (template + schema): ~2,200 tokens
- Description content: ~200 tokens
- **Total input**: ~3,250 tokens
- **Expected output**: ~2,500-4,000 tokens (varies with description complexity)

For the average BaT description at 1,625 characters:
- **Total input**: ~3,650 tokens
- **Expected output**: ~3,000-5,000 tokens

### Prompt Behavior Rules

1. **One claim per atomic fact.** "rebuilt engine and transmission" is TWO claims, not one.
2. **Err on the side of more claims, not fewer.** A 10-sentence description should yield 15-30 claims.
3. **Every equipment item is its own specification claim.** Do not batch "A/C, tilt, AM/FM" into one claim.
4. **The `source_sentence` field enables audit.** Every claim must trace back to specific text.
5. **Decay rate is about the CATEGORY, not the specific claim.** All mechanical claims decay fast, even precise ones.
6. **Confidence is about the CLAIM QUALITY, not the category.** A vague mechanical claim gets low confidence AND fast decay. A precise mechanical claim gets high confidence AND fast decay. These are orthogonal axes.

### Handling Edge Cases

- **No description**: Return `{"claims": [], "specifications": {all null}, ...}` with empty arrays everywhere.
- **Very short descriptions** (<100 chars): Extract what exists, flag low overall confidence.
- **Non-English descriptions**: Extract in English, note original language in a red flag.
- **Multiple vehicles mentioned**: Extract claims for the PRIMARY vehicle only. Flag others as red flags.
- **Obvious errors** (e.g., "1984 Chevrolet Corvette" but VIN decodes to a truck): Extract claims as stated but flag the discrepancy as a red flag.

---

## Cost Estimation for 137K BaT Descriptions

### Input Assumptions
- Average description: 1,625 characters (~400 tokens)
- System + user prompt template: ~3,050 tokens
- **Average total input per request**: ~3,450 tokens
- **Average output per request**: ~3,500 tokens (conservative; complex descriptions will be 5K+)

### Gemini 2.0 Flash

| Item | Value |
|------|-------|
| Input price | $0.10 / 1M tokens |
| Output price | $0.40 / 1M tokens |
| Input tokens (137K vehicles) | 137,000 x 3,450 = 472.6M tokens |
| Output tokens (137K vehicles) | 137,000 x 3,500 = 479.5M tokens |
| Input cost | 472.6M x $0.10/1M = $47.26 |
| Output cost | 479.5M x $0.40/1M = $191.80 |
| **Total** | **$239.06** |
| Per vehicle | $0.00174 |

### Claude 3.5 Haiku

| Item | Value |
|------|-------|
| Input price | $0.80 / 1M tokens |
| Output price | $4.00 / 1M tokens |
| Input tokens (137K vehicles) | 472.6M tokens |
| Output tokens (137K vehicles) | 479.5M tokens |
| Input cost | 472.6M x $0.80/1M = $378.08 |
| Output cost | 479.5M x $4.00/1M = $1,918.00 |
| **Total** | **$2,296.08** |
| Per vehicle | $0.01676 |

### Hypothetical Fine-Tuned Model (Gemini Flash Tuning or similar)

| Item | Value |
|------|-------|
| Training cost (one-time) | ~$50-200 (1K examples, few epochs) |
| Inference input price | ~$0.20-0.40 / 1M tokens (tuned models typically 2-4x base) |
| Inference output price | ~$0.80-1.60 / 1M tokens |
| Input cost | 472.6M x $0.30/1M = $141.78 |
| Output cost | 479.5M x $1.20/1M = $575.40 |
| **Total** | **~$767 + $150 training = ~$917** |
| Per vehicle | $0.00670 |
| **Advantage** | More consistent output structure, fewer retries, potentially 30% shorter output via learned compression |

### Cost Summary Table

| Model | Total Cost | Per Vehicle | Relative |
|-------|-----------|-------------|----------|
| Gemini 2.0 Flash | $239 | $0.0017 | 1.0x (baseline) |
| Fine-tuned Flash | ~$917 | $0.0067 | 3.8x |
| Claude 3.5 Haiku | $2,296 | $0.0168 | 9.6x |

### Recommendation

**Run Gemini 2.0 Flash.** At $239 for all 137K descriptions, the cost is negligible. If output quality is inconsistent, fine-tune on 500-1000 hand-verified examples and re-run -- still under $1K total.

For the highest-value vehicles (top 5K by sale_price), consider a second pass with Claude 3.5 Haiku for $84 to catch anything Flash missed. That dual-pass strategy covers the corpus for under $325.

### Throughput Estimation

| Model | RPM Limit | Batch Time (137K) |
|-------|-----------|-------------------|
| Gemini Flash | ~2,000 RPM | ~69 minutes |
| Claude Haiku | ~4,000 RPM | ~35 minutes |
| Fine-tuned | ~500-1,000 RPM | ~2.3-4.6 hours |

All models can process the full 137K corpus in under 5 hours with basic rate limiting. Gemini Flash with batch API (50% discount) would bring the cost to ~$120.

---

## Migration Path from v1

The v1 `description-intelligence-extraction.md` prompt produces flat field extraction. The v2 prompt is NOT backward compatible -- it produces a fundamentally different data structure (claims array vs. flat fields).

**Recommended approach:**
1. Run v2 on the full corpus, storing results in a new column or table (e.g., `description_testimony` or a `description_claims` table)
2. Keep v1 results in `description_discoveries.raw_extraction` for backward compatibility
3. Build a view or function that can answer v1-style queries from v2 data (e.g., "give me the flat acquisition object" by filtering claims where `category=provenance AND subcategory=purchase`)
4. Deprecate v1 extraction after v2 is validated on 1K+ vehicles

### Suggested Table Schema

```sql
CREATE TABLE description_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  extraction_version text NOT NULL DEFAULT '2.0',
  extracted_at timestamptz NOT NULL DEFAULT now(),
  model_used text NOT NULL,

  -- The full v2 output
  claims jsonb NOT NULL,
  specifications jsonb,
  trim_evidence jsonb,
  ownership_chain jsonb,
  work_history jsonb,
  documentation_mentioned jsonb,
  mileage jsonb,
  numbers jsonb,
  red_flags jsonb,
  vague_claims_summary jsonb,

  -- Computed summaries for fast queries
  claim_count int GENERATED ALWAYS AS (jsonb_array_length(claims)) STORED,
  vague_claim_count int,
  red_flag_count int,
  has_trim_evidence boolean,
  dominant_category text,
  avg_confidence numeric(4,3),

  UNIQUE(vehicle_id, extraction_version)
);

CREATE INDEX idx_description_claims_vehicle ON description_claims(vehicle_id);
CREATE INDEX idx_description_claims_trim ON description_claims(has_trim_evidence) WHERE has_trim_evidence = true;
```
