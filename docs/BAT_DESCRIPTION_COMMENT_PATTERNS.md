# BaT Description & Comment Pattern Analysis

**Generated**: 2026-01-23
**Sample Size**: 50+ descriptions, 50+ comments
**Purpose**: Define extraction targets for structured data from unstructured text

---

## DESCRIPTION PATTERNS

### 1. Acquisition History
Phrases indicating how/when seller obtained the vehicle.

**Patterns:**
```
- "acquired by the seller in [YEAR]"
- "purchased by the seller in [YEAR]"
- "purchased new by the seller"
- "was initially delivered to [DEALER]"
- "remained registered in [STATE] through the seller's purchase in [YEAR]"
- "purchased on BaT in [DATE]"
- "one-owner example"
- "acquired by the seller from [SOURCE] in [YEAR]"
- "purchased from the original owner"
```

**Extractable Fields:**
- `acquisition_date`: Date seller acquired vehicle
- `acquisition_source`: Where they got it (dealer, private, BaT, estate, etc.)
- `seller_ownership_duration_years`: Calculated from acquisition date
- `previous_bat_sale`: Boolean + URL if mentioned

---

### 2. Ownership History
Information about previous owners.

**Patterns:**
```
- "first owned by [ENTITY]"
- "originally owned by [PERSON/COMPANY]"
- "one-owner example"
- "remained registered to the original owner in [STATE] through [DATE]"
- "[Nth] owner since new"
- "purchased from the [Nth] owner"
- "single-family ownership"
```

**Extractable Fields:**
- `owner_count`: Number of owners (1, 2, 3, etc. or null)
- `original_owner_type`: individual, dealer, museum, company, celebrity
- `original_owner_name`: If notable (celebrity, company, museum)
- `ownership_chain`: Array of ownership periods

---

### 3. Service & Modification History
Work performed on the vehicle.

**Patterns:**
```
- "work since then included..."
- "service in preparation for the sale..."
- "work performed since involved..."
- "refinished in [COLOR]"
- "reupholstered in [YEAR]"
- "rebuilt in [YEAR]"
- "replaced the [COMPONENT]"
- "was fitted with..."
- "has been modified with..."
- "overhauling the [SYSTEM]"
- "rebuilt by [SHOP] in [YEAR]"
- "at [MILEAGE] miles"
```

**Extractable Fields:**
- `service_events[]`: Array of {date, mileage, description, shop, cost}
- `modifications[]`: Array of {component, description, date, reversible}
- `parts_replaced[]`: Array of parts mentioned as replaced
- `is_modified`: Boolean
- `modification_level`: stock, mild, moderate, extensive

---

### 4. Documentation
Records and paperwork included.

**Patterns:**
```
- "owner's manuals"
- "window sticker"
- "manufacturer's Certificate of Origin"
- "binder with records"
- "service records dating to [YEAR]"
- "sales documents"
- "clean [STATE] title"
- "Carfax report"
- "tool roll"
- "spare tire"
- "jack"
```

**Extractable Fields:**
- `documentation[]`: Array of document types
- `has_service_records`: Boolean
- `service_records_from_year`: Earliest year
- `has_window_sticker`: Boolean
- `has_owners_manual`: Boolean
- `has_tools`: Boolean
- `title_status`: clean, salvage, rebuilt, etc.

---

### 5. Condition & Issues
Current state and disclosed problems.

**Patterns:**
```
- "the seller notes..."
- "is missing"
- "has seepage"
- "are leaking"
- "has cracks"
- "areas of corrosion"
- "blemishes in the finish"
- "is weak"
- "not recently tested"
- "does not run"
- "running-and-driving project"
- "needs [WORK]"
```

**Extractable Fields:**
- `known_issues[]`: Array of disclosed problems
- `condition_notes[]`: Seller observations
- `is_running`: Boolean
- `is_driving`: Boolean
- `is_project`: Boolean
- `needs_work[]`: Array of work needed

---

### 6. Registration/Location History
Where the vehicle has been.

**Patterns:**
```
- "spent time in [STATE]"
- "remained registered in [STATE]"
- "following registration history in [STATE] and [STATE]"
- "delivered to [DEALER] of [CITY], [STATE]"
- "California car since new"
- "never seen snow"
- "dry climate"
- "rust-free"
```

**Extractable Fields:**
- `registration_history[]`: Array of states/countries
- `original_delivery_dealer`: Dealer name and location
- `climate_history`: dry, mixed, winter
- `rust_belt_exposure`: Boolean

---

### 7. Paint/Refinish History
Color and finish information.

**Patterns:**
```
- "Finished in [COLOR] over [INTERIOR]"
- "refinished in [COLOR]"
- "repainted in [COLOR]"
- "repainted in the original color"
- "wears [COLOR] paint"
- "paint touch-ups"
- "factory color code ([CODE])"
```

**Extractable Fields:**
- `is_repainted`: Boolean
- `repaint_year`: Year if mentioned
- `repaint_color`: Color if different from original
- `is_original_color`: Boolean
- `factory_color_code`: Paint code

---

### 8. Matching Numbers / Authenticity
Factory originality status.

**Patterns:**
```
- "numbers-matching"
- "matching numbers drivetrain"
- "replacement [ENGINE/TRANS]"
- "original [COMPONENT]"
- "date-coded"
- "correct [COMPONENT]"
- "period-correct"
```

**Extractable Fields:**
- `matching_numbers`: Boolean or partial
- `matching_components[]`: Which parts match
- `replacement_components[]`: Which parts are replacements
- `authenticity_level`: all-original, mostly-original, restored, modified

---

### 9. Awards & Certifications
Competition results and authenticity verification.

**Patterns:**
```
- "NCRS Top Flight"
- "NCRS Duntov Mark of Excellence"
- "Bloomington Gold"
- "concours"
- "with a score of [X]"
- "PCA concours"
```

**Extractable Fields:**
- `awards[]`: Array of {name, year, score}
- `certifications[]`: Array of authentication certs
- `concours_history`: Boolean

---

### 10. Rarity / Special Editions
Production numbers and special variants.

**Patterns:**
```
- "one of [X] produced"
- "#[X] of [TOTAL]"
- "limited edition"
- "[NAME] Edition"
- "one of approximately [X] built"
- "rare [FEATURE]"
```

**Extractable Fields:**
- `production_number`: Vehicle's number in series
- `total_production`: Total built
- `special_edition_name`: Edition name
- `rarity_notes[]`: Array of rarity claims

---

## COMMENT PATTERNS

### 1. Seller Q&A
Questions and answers revealing facts.

**Patterns:**
```
- "@[user]" reply format
- "(The Seller)" indicator
- "Question to seller:"
- Technical specs revealed in answers
```

**Extractable Fields:**
- `seller_disclosures[]`: Facts revealed in answers
- `technical_specs_confirmed[]`: Specs confirmed by seller
- `seller_username`: For linking

---

### 2. Expert Knowledge
Community members sharing expertise.

**Patterns:**
```
- "This is one of approximately [X] built"
- "The VIN decodes to..."
- "Factory records show..."
- "These were only available with..."
- Production/specification details
```

**Extractable Fields:**
- `expert_insights[]`: Array of expert comments
- `production_details_mentioned`: From knowledgeable comments
- `vin_decode_notes`: VIN interpretation from community

---

### 3. Comparable Sales
Price references to similar vehicles.

**Patterns:**
```
- "Similar car sold here [TIME] for $[PRICE]"
- "I sold mine for $[PRICE]"
- "These usually go for..."
- "cheap/expensive compared to..."
```

**Extractable Fields:**
- `comparable_mentions[]`: Array of {description, price, date}
- `market_sentiment`: cheap, fair, expensive

---

### 4. Condition Observations
Third-party condition notes.

**Patterns:**
```
- "looks pretty rusty to me"
- "that [ISSUE] could be a concern"
- "appears [CONDITION]"
- Technical observations
```

**Extractable Fields:**
- `condition_observations[]`: Third-party observations
- `concerns_raised[]`: Issues noted by commenters

---

### 5. Personal Experience
First-hand ownership experiences.

**Patterns:**
```
- "I own/owned a [SIMILAR]..."
- "mine has [X] miles"
- "I've driven [X] miles"
- "never had a problem"
```

**Extractable Fields:**
- `ownership_experiences[]`: Array of relevant experiences
- `reliability_mentions[]`: Reliability comments

---

## RECOMMENDED EXTRACTION SCHEMA

```typescript
interface VehicleIntelligence {
  // From Description
  acquisition: {
    date: string | null;
    source: string | null;
    seller_ownership_years: number | null;
    previous_bat_sale_url: string | null;
  };

  ownership: {
    count: number | null;
    original_owner_type: string | null;
    original_owner_name: string | null;
    notable_owners: string[];
  };

  service_history: {
    events: ServiceEvent[];
    last_service_date: string | null;
    last_service_mileage: number | null;
  };

  modifications: {
    is_modified: boolean;
    level: 'stock' | 'mild' | 'moderate' | 'extensive';
    items: Modification[];
  };

  documentation: {
    items: string[];
    has_service_records: boolean;
    has_window_sticker: boolean;
    has_owners_manual: boolean;
    has_tools: boolean;
  };

  condition: {
    is_running: boolean;
    is_driving: boolean;
    is_project: boolean;
    known_issues: string[];
    seller_notes: string[];
  };

  provenance: {
    registration_states: string[];
    delivery_dealer: string | null;
    climate_history: string | null;
    rust_exposure: boolean | null;
  };

  authenticity: {
    matching_numbers: boolean | null;
    is_repainted: boolean | null;
    repaint_year: number | null;
    replacement_components: string[];
  };

  awards: Award[];

  rarity: {
    production_number: number | null;
    total_production: number | null;
    special_edition: string | null;
    rarity_notes: string[];
  };

  // From Comments
  community_intel: {
    seller_disclosures: string[];
    expert_insights: string[];
    comparable_sales: ComparableSale[];
    condition_concerns: string[];
    reliability_notes: string[];
  };

  // Metadata
  extraction_confidence: number;  // 0-1
  extracted_at: string;
  source_description_length: number;
  source_comment_count: number;
}

interface ServiceEvent {
  date: string | null;
  mileage: number | null;
  description: string;
  shop: string | null;
}

interface Modification {
  component: string;
  description: string;
  date: string | null;
}

interface Award {
  name: string;
  year: number | null;
  score: number | null;
}

interface ComparableSale {
  description: string;
  price: number;
  date: string | null;
  source: 'bat' | 'other' | 'personal';
}
```

---

## IMPLEMENTATION NOTES

### Tier 1: Regex Extraction (Free, Fast)
These patterns are deterministic enough for regex:
- Owner count ("one-owner", "third owner")
- Matching numbers boolean
- Is repainted boolean
- Has service records boolean
- State mentions
- Year mentions in context
- BaT previous sale mentions

### Tier 2: LLM Extraction (Paid, Accurate)
These require understanding context:
- Service event details
- Modification descriptions
- Issue severity assessment
- Seller Q&A consolidation
- Expert insight identification
- Comparable sale parsing

### Recommended Approach
1. Run Tier 1 regex on all 126k descriptions ($0)
2. Store raw description + comments for later analysis
3. Run Tier 2 LLM on high-value vehicles (>$50k sale price) first (~$500 for 10k vehicles)
4. Expand LLM extraction based on analysis needs

---

## EXAMPLE EXTRACTIONS

### Example 1: 1965 Corvette

**Description excerpt:**
> "This 1965 Chevrolet Corvette fuelie convertible was acquired by the seller, current national NCRS Vice President Tony Stein, in 2021, and it was subsequently restored over the next four years. An NCRS Duntov Mark of Excellence award was achieved at the September, 2025 NCRS National Convention in Las Vegas, at which time it earned its second Top Flight Award of the year with a score of 99.0."

**Extracted:**
```json
{
  "acquisition": {
    "date": "2021",
    "source": "unknown"
  },
  "ownership": {
    "original_owner_name": "Tony Stein",
    "original_owner_type": "collector"
  },
  "awards": [
    {"name": "NCRS Duntov Mark of Excellence", "year": 2025},
    {"name": "NCRS Top Flight", "year": 2025, "score": 99.0}
  ],
  "service_history": {
    "events": [
      {"description": "Full restoration", "date": "2021-2025"}
    ]
  }
}
```

### Example 2: 1987 Porsche 911 Turbo

**Description excerpt:**
> "The turbocharged 3.3-liter flat-six has been modified with a K27 turbocharger, a Kokeln intercooler, and a Billy Boat exhaust system with headers. An engine rebuild was carried out in 2017. The clutch was replaced in 2017."

**Extracted:**
```json
{
  "modifications": {
    "is_modified": true,
    "level": "moderate",
    "items": [
      {"component": "turbocharger", "description": "K27 turbocharger"},
      {"component": "intercooler", "description": "Kokeln intercooler"},
      {"component": "exhaust", "description": "Billy Boat exhaust system with headers"}
    ]
  },
  "service_history": {
    "events": [
      {"description": "Engine rebuild", "date": "2017"},
      {"description": "Clutch replacement", "date": "2017"}
    ]
  }
}
```
