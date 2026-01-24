# Description Intelligence Extraction Prompt

**Version**: 1.0
**Purpose**: Extract structured data from BaT vehicle descriptions
**Model**: Claude (Haiku for cost, Sonnet for accuracy)

---

## System Prompt

```
You are a vehicle listing data extractor. Your job is to read auction listing descriptions and extract structured data.

CRITICAL RULES:
1. Extract ONLY what is explicitly stated in the text
2. Do NOT infer, assume, or add information not present
3. If information is unclear or ambiguous, use null
4. Dates can be "2017", "2017-03", or "March 2017" - normalize to year or YYYY-MM
5. Return valid JSON only - no markdown, no explanations
```

---

## User Prompt Template

```
Extract structured data from this vehicle listing.

VEHICLE CONTEXT:
Year: {year}
Make: {make}
Model: {model}
Sale Price: ${sale_price}
Mileage: {mileage}

DESCRIPTION:
---
{description}
---

Extract the following fields. Use null for missing information.

{
  "acquisition": {
    "year": <int or null - when seller acquired the vehicle>,
    "source": <"private" | "dealer" | "bat" | "estate" | "auction" | "family" | null>,
    "notes": <string or null - additional acquisition context>
  },

  "previous_bat_sale": {
    "mentioned": <boolean - was a previous BaT sale mentioned?>,
    "date": <string or null - "YYYY-MM" or "YYYY">,
    "price": <number or null>
  },

  "ownership": {
    "count": <1, 2, 3, etc. or null if not stated>,
    "is_original_owner": <boolean or null>,
    "notable_owner": <string or null - only if celebrity, museum, company mentioned>
  },

  "service_events": [
    {
      "date": <"YYYY" or "YYYY-MM" or null>,
      "mileage": <number or null>,
      "description": <string - what work was done>,
      "shop": <string or null - who did the work>
    }
  ],

  "modifications": {
    "is_modified": <boolean>,
    "level": <"stock" | "mild" | "moderate" | "extensive" | null>,
    "items": [
      {
        "component": <string - what was modified>,
        "description": <string - the modification>,
        "reversible": <boolean or null>
      }
    ]
  },

  "documentation": {
    "has_service_records": <boolean or null>,
    "service_records_from_year": <int or null>,
    "has_window_sticker": <boolean or null>,
    "has_owners_manual": <boolean or null>,
    "has_tools": <boolean or null>,
    "items": [<list of documentation items mentioned>]
  },

  "condition": {
    "is_running": <boolean or null>,
    "is_driving": <boolean or null>,
    "is_project": <boolean or null>,
    "known_issues": [<list of disclosed problems>],
    "seller_notes": [<list of condition observations from seller>]
  },

  "provenance": {
    "states": [<list of states/countries where registered>],
    "delivery_dealer": <string or null>,
    "delivery_location": <string or null>,
    "climate": <"dry" | "mixed" | "winter" | "coastal" | null>,
    "rust_free": <boolean or null>
  },

  "authenticity": {
    "matching_numbers": <boolean or null>,
    "matching_components": [<list of matching components if partial>],
    "is_repainted": <boolean or null>,
    "repaint_year": <int or null>,
    "is_original_color": <boolean or null>,
    "replacement_components": [<list of non-original major components>]
  },

  "awards": [
    {
      "name": <string>,
      "year": <int or null>,
      "score": <number or null>
    }
  ],

  "rarity": {
    "production_number": <int or null - e.g., 16 from "#16 of 153">,
    "total_production": <int or null - e.g., 153>,
    "special_edition": <string or null>,
    "notes": [<list of rarity claims>]
  },

  "extraction_notes": [<any ambiguities or uncertainties to flag>]
}

Return ONLY the JSON object. No markdown formatting, no explanations.
```

---

## Comment Analysis Prompt (Separate Pass)

```
Extract seller disclosures and community intelligence from these auction comments.

VEHICLE CONTEXT:
Year: {year}
Make: {make}
Model: {model}

COMMENTS (seller responses marked with [SELLER]):
---
{formatted_comments}
---

Extract:

{
  "seller_disclosures": [
    <facts revealed by seller in response to questions - technical specs, history, etc.>
  ],

  "expert_insights": [
    <technical knowledge shared by community members about the vehicle/model>
  ],

  "comparable_sales": [
    {
      "description": <what was compared>,
      "price": <number>,
      "date": <string or null>,
      "source": <"bat" | "personal" | "other">
    }
  ],

  "condition_concerns": [
    <issues or concerns raised by commenters>
  ],

  "reliability_notes": [
    <ownership experiences shared about this model>
  ]
}

Return ONLY the JSON object.
```

---

## Example Input/Output

### Input

```
Year: 1965
Make: Chevrolet
Model: Corvette Convertible
Sale Price: $174000
Mileage: 50000

DESCRIPTION:
This 1965 Chevrolet Corvette fuelie convertible was acquired by the seller,
current national NCRS Vice President Tony Stein, in 2021, and it was subsequently
restored over the next four years. An NCRS Duntov Mark of Excellence award was
achieved at the September, 2025 NCRS National Convention in Las Vegas, at which
time it earned its second Top Flight Award of the year with a score of 99.0.
The car is powered by a fuel-injected 327ci L84 V8 paired with a four-speed manual
transmission. Equipment includes service records dating to 1985, the original
window sticker, books, and tool roll.
```

### Output

```json
{
  "acquisition": {
    "year": 2021,
    "source": null,
    "notes": "acquired by seller Tony Stein (NCRS Vice President)"
  },
  "previous_bat_sale": {
    "mentioned": false,
    "date": null,
    "price": null
  },
  "ownership": {
    "count": null,
    "is_original_owner": false,
    "notable_owner": "Tony Stein (NCRS Vice President)"
  },
  "service_events": [
    {
      "date": "2021",
      "mileage": null,
      "description": "Full restoration over four years",
      "shop": null
    }
  ],
  "modifications": {
    "is_modified": false,
    "level": "stock",
    "items": []
  },
  "documentation": {
    "has_service_records": true,
    "service_records_from_year": 1985,
    "has_window_sticker": true,
    "has_owners_manual": true,
    "has_tools": true,
    "items": ["service records dating to 1985", "window sticker", "books", "tool roll"]
  },
  "condition": {
    "is_running": null,
    "is_driving": null,
    "is_project": false,
    "known_issues": [],
    "seller_notes": []
  },
  "provenance": {
    "states": [],
    "delivery_dealer": null,
    "delivery_location": null,
    "climate": null,
    "rust_free": null
  },
  "authenticity": {
    "matching_numbers": null,
    "matching_components": [],
    "is_repainted": null,
    "repaint_year": null,
    "is_original_color": null,
    "replacement_components": []
  },
  "awards": [
    {
      "name": "NCRS Duntov Mark of Excellence",
      "year": 2025,
      "score": null
    },
    {
      "name": "NCRS Top Flight",
      "year": 2025,
      "score": 99.0
    }
  ],
  "rarity": {
    "production_number": null,
    "total_production": null,
    "special_edition": null,
    "notes": ["L84 fuel-injected 327ci V8"]
  },
  "extraction_notes": []
}
```

---

## Cost Estimation

| Model | Input Tokens | Output Tokens | Cost/Vehicle | 100k Vehicles |
|-------|--------------|---------------|--------------|---------------|
| Haiku | ~800 | ~400 | ~$0.0003 | ~$30 |
| Sonnet | ~800 | ~400 | ~$0.005 | ~$500 |

**Recommendation**: Use Haiku for bulk, Sonnet for $50k+ vehicles

---

## Integration Notes

### Calling from Edge Function

```typescript
const response = await anthropic.messages.create({
  model: "claude-3-haiku-20240307",
  max_tokens: 1024,
  system: SYSTEM_PROMPT,
  messages: [
    {
      role: "user",
      content: formatUserPrompt(vehicle)
    }
  ]
});

const extracted = JSON.parse(response.content[0].text);
```

### Validation

After extraction, validate:
1. JSON parses successfully
2. Required fields exist (even if null)
3. Types are correct (numbers are numbers, not strings)
4. Arrays are arrays
5. No hallucinated URLs or specific facts not in source

---

## Iteration Plan

1. **v1.0**: Basic extraction with current prompt
2. **v1.1**: Add edge cases discovered in production
3. **v1.2**: Add comment analysis integration
4. **v2.0**: Fine-tuned patterns based on 10k+ extractions
