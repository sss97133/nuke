/**
 * extraction-prompt-v3.mjs — Testimony-grade extraction prompt
 *
 * Every claim extracted from a description must be self-aware:
 * - WHAT was claimed (the value)
 * - WHERE in the text (character position or quote)
 * - HOW CONFIDENT the LLM is (0.0-1.0)
 * - WHAT REFERENCE DATA supports or contradicts it
 * - WHAT CATEGORY it falls into (specification, condition, provenance, etc.)
 *
 * This replaces the freeform "extract everything" prompt with structured
 * testimony output that maps directly to vehicle_observations.
 */

/**
 * Build a v3 extraction prompt for a vehicle description.
 *
 * @param {string} description - The listing description text
 * @param {object} vehicle - { year, make, model, sale_price }
 * @param {string} libraryContext - Formatted reference data from build-extraction-context.mjs
 * @returns {string} The complete prompt
 */
export function buildV3Prompt(description, vehicle, libraryContext) {
  const year = vehicle.year || 'Unknown';
  const make = vehicle.make || 'Unknown';
  const model = vehicle.model || 'Unknown';
  const price = vehicle.sale_price ? `$${Number(vehicle.sale_price).toLocaleString()}` : 'Unknown';

  let prompt = `You are a forensic vehicle data analyst. Extract structured claims from this auction listing description.

VEHICLE: ${year} ${make} ${model}
SALE PRICE: ${price}

DESCRIPTION:
---
${description.substring(0, 6000)}
---
`;

  if (libraryContext) {
    prompt += `
${libraryContext}
`;
  }

  prompt += `
Extract ALL factual claims into the EXACT JSON structure below. Every claim must include:
- "value": the extracted fact
- "quote": the exact text snippet from the description (max 60 chars) that supports this claim
- "confidence": your confidence this extraction is correct (0.0-1.0)

Return this EXACT structure. Use null for fields not mentioned. Empty arrays for categories with no findings.

{
  "specification": {
    "engine_type": { "value": null, "quote": null, "confidence": 0 },
    "engine_detail": { "value": null, "quote": null, "confidence": 0 },
    "horsepower": { "value": null, "quote": null, "confidence": 0 },
    "torque": { "value": null, "quote": null, "confidence": 0 },
    "displacement_ci": { "value": null, "quote": null, "confidence": 0 },
    "displacement_liters": { "value": null, "quote": null, "confidence": 0 },
    "engine_code": { "value": null, "quote": null, "confidence": 0 },
    "transmission_type": { "value": null, "quote": null, "confidence": 0 },
    "transmission_detail": { "value": null, "quote": null, "confidence": 0 },
    "transmission_speeds": { "value": null, "quote": null, "confidence": 0 },
    "drivetrain": { "value": null, "quote": null, "confidence": 0 },
    "exterior_color": { "value": null, "quote": null, "confidence": 0 },
    "interior_color": { "value": null, "quote": null, "confidence": 0 },
    "interior_material": { "value": null, "quote": null, "confidence": 0 },
    "body_style": { "value": null, "quote": null, "confidence": 0 },
    "fuel_type": { "value": null, "quote": null, "confidence": 0 },
    "doors": { "value": null, "quote": null, "confidence": 0 },
    "mileage": { "value": null, "quote": null, "confidence": 0 },
    "vin": { "value": null, "quote": null, "confidence": 0 },
    "matching_numbers": { "value": null, "quote": null, "confidence": 0 }
  },
  "condition": {
    "overall_grade": { "value": null, "quote": null, "confidence": 0 },
    "condition_notes": { "value": null, "quote": null, "confidence": 0 },
    "title_status": { "value": null, "quote": null, "confidence": 0 },
    "known_flaws": [
      { "flaw": null, "severity": null, "quote": null, "confidence": 0 }
    ]
  },
  "provenance": {
    "owner_count": { "value": null, "quote": null, "confidence": 0 },
    "documentation": [
      { "item": null, "quote": null, "confidence": 0 }
    ],
    "awards": [
      { "award": null, "quote": null, "confidence": 0 }
    ],
    "matching_numbers_evidence": { "value": null, "quote": null, "confidence": 0 },
    "authenticity_claims": [
      { "claim": null, "quote": null, "confidence": 0 }
    ]
  },
  "work_history": [
    {
      "description": null,
      "date": null,
      "shop": null,
      "location": null,
      "quote": null,
      "confidence": 0
    }
  ],
  "modifications": [
    { "mod": null, "quote": null, "confidence": 0 }
  ],
  "equipment": [
    { "item": null, "quote": null, "confidence": 0 }
  ],
  "people": [
    { "name": null, "role": null, "quote": null, "confidence": 0 }
  ],
  "locations": [
    { "name": null, "context": null, "quote": null, "confidence": 0 }
  ],
  "option_codes": [
    { "code": null, "description": null, "system": null, "quote": null, "confidence": 0 }
  ],
  "rarity_claims": [
    { "claim": null, "evidence": null, "quote": null, "confidence": 0 }
  ],
  "red_flags": [
    { "flag": null, "severity": "low|medium|high", "quote": null, "confidence": 0 }
  ],
  "reference_validation": {
    "codes_matched": [],
    "codes_unrecognized": [],
    "paint_code_match": null,
    "trim_identified": null,
    "known_issues_addressed": [],
    "known_issues_unaddressed": []
  }
}

RULES:
- Every "quote" must be copied EXACTLY from the description text above (max 60 chars). If you cannot point to the exact words in the DESCRIPTION, do not include the claim.
- "confidence" is YOUR confidence the extraction is correct (0.0 = guessing, 1.0 = certain)
- CRITICAL — option_codes: ONLY include codes that appear LITERALLY in the DESCRIPTION text. The REFERENCE DATA is for VALIDATION ONLY — use it to identify what a code means, NOT to generate codes. If a code appears in reference but NOT in the description, it does NOT go in option_codes.
- CRITICAL — Do NOT copy items from REFERENCE DATA into option_codes, equipment, work_history, or any extraction field. REFERENCE DATA exists so you can RECOGNIZE and VALIDATE what you find in the description — like a decoder ring, not a shopping list.
- For red_flags, include anything suspicious: odometer discrepancies, missing documentation, vague provenance, non-matching claims
- reference_validation: compare what you EXTRACTED from the description against the REFERENCE DATA. "codes_matched" = codes you found in the description that ALSO appear in reference. "codes_unrecognized" = codes in the description NOT found in reference.
- Return ONLY valid JSON. No explanation outside the JSON.`;

  return prompt;
}

/**
 * Parse a v3 extraction response into decomposed observations.
 * Each field becomes its own observation with citation.
 */
export function parseV3Response(responseText) {
  const match = responseText.match(/\{[\s\S]*\}/);
  if (!match) return { parsed: null, error: 'no JSON found' };

  let raw;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    try {
      const fixed = match[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      raw = JSON.parse(fixed);
    } catch {
      return { parsed: null, error: 'JSON parse failed' };
    }
  }

  return { parsed: raw, error: null };
}

/**
 * Count total claims with non-null values in a v3 extraction.
 */
export function countV3Claims(parsed) {
  if (!parsed) return 0;
  let count = 0;

  // Specification fields
  if (parsed.specification) {
    for (const v of Object.values(parsed.specification)) {
      if (v && typeof v === 'object' && v.value !== null && v.value !== undefined) count++;
    }
  }

  // Condition
  if (parsed.condition) {
    if (parsed.condition.overall_grade?.value) count++;
    if (parsed.condition.condition_notes?.value) count++;
    if (parsed.condition.title_status?.value) count++;
    if (Array.isArray(parsed.condition.known_flaws)) {
      count += parsed.condition.known_flaws.filter(f => f.flaw).length;
    }
  }

  // Array sections
  for (const key of ['work_history', 'modifications', 'equipment', 'people', 'locations', 'option_codes', 'rarity_claims', 'red_flags']) {
    if (Array.isArray(parsed[key])) {
      count += parsed[key].filter(item => {
        const firstVal = Object.values(item)[0];
        return firstVal !== null && firstVal !== undefined;
      }).length;
    }
  }

  // Provenance
  if (parsed.provenance) {
    if (parsed.provenance.owner_count?.value) count++;
    if (Array.isArray(parsed.provenance.documentation)) count += parsed.provenance.documentation.filter(d => d.item).length;
    if (Array.isArray(parsed.provenance.awards)) count += parsed.provenance.awards.filter(a => a.award).length;
    if (Array.isArray(parsed.provenance.authenticity_claims)) count += parsed.provenance.authenticity_claims.filter(c => c.claim).length;
  }

  return count;
}

/**
 * Extract average confidence from a v3 extraction.
 */
export function avgV3Confidence(parsed) {
  if (!parsed) return 0;
  const confidences = [];

  function collect(obj) {
    if (!obj) return;
    if (typeof obj === 'object' && 'confidence' in obj && typeof obj.confidence === 'number') {
      if (obj.confidence > 0) confidences.push(obj.confidence);
    }
    if (Array.isArray(obj)) obj.forEach(collect);
    else if (typeof obj === 'object') Object.values(obj).forEach(collect);
  }

  collect(parsed);
  return confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
}
