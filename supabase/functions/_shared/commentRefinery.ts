/**
 * Comment Refinery — shared claim extraction utilities
 *
 * Pipeline: comment → claim_triage (regex pre-filter) → extract_claims (LLM) → field_evidence / vehicle_observations
 *
 * Claim categories:
 *   A: Vehicle Specifications → field_evidence (engine, transmission, drivetrain, etc.)
 *   B: Condition Claims → field_evidence with temporal decay (rust, paint, mechanical)
 *   C: Provenance Claims → vehicle_observations via ingest-observation (sightings, ownership, work records)
 *   D: Market Signals → comment_discoveries (price opinions, comparable references)
 *   E: Library Knowledge → comment_library_extractions (option codes, specs for make/model class)
 */

// ── Claim type definitions ──────────────────────────────────────────────

export interface ExtractedClaim {
  claim_type: string;
  category: 'A' | 'B' | 'C' | 'D' | 'E';
  field_name: string | null;       // null for Category C/D/E
  proposed_value: string;
  confidence: number;              // 0-1, raw from LLM
  temporal_anchor: string | null;  // ISO date or "current" or null
  reasoning: string;
  quote: string;                   // exact substring from comment_text
  contradicts_existing: boolean;
  observation_kind?: string;       // for Category C: sighting, ownership, work_record, etc.
}

export interface ClaimExtractionResult {
  claims: ExtractedClaim[];
  comment_id: string;
  vehicle_id: string;
  model_used: string;
  cost_cents: number;
}

export interface VehicleContext {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  sale_price: number | null;
}

export interface CommentRow {
  id: string;
  comment_text: string;
  author_username: string | null;
  is_seller: boolean;
  posted_at: string;
  bid_amount: number | null;
  word_count?: number;
}

// ── Claim density scoring (Phase 1 pre-filter) ─────────────────────────

/** Regex patterns that indicate a comment contains extractable claims */
const CLAIM_PATTERNS: Record<string, { pattern: RegExp; weight: number; category: string }> = {
  // Category A: Specifications
  matching_numbers:  { pattern: /matching\s+numbers?|numbers?\s+match/i, weight: 2.0, category: 'A' },
  engine_spec:       { pattern: /\b(\d{3,4})\s*(ci|cubic\s*inch|cc|liter|L)\b|\b(v[468]|inline|flat|boxer|hemi|big\s*block|small\s*block|ls\d?)\b/i, weight: 1.5, category: 'A' },
  transmission_spec: { pattern: /\b(\d[\s-]?speed|muncie|tremec|turbo\s*\d{3}|powerglide|th[- ]?\d{3}|nv\d{4}|t[- ]?\d{1,2}|c[- ]?[456]|zf|getrag|borg[\s-]?warner)\b/i, weight: 1.5, category: 'A' },
  drivetrain:        { pattern: /\b(posi|positraction|limited\s*slip|locking\s*diff|dana\s*\d{2}|eaton|detroit\s*locker|4wd|4x4|awd|2wd|rwd|fwd)\b/i, weight: 1.0, category: 'A' },
  vin_reference:     { pattern: /\bvin\b.*\b[A-HJ-NPR-Z0-9]{17}\b|vin\s*(decode|check|number)/i, weight: 2.0, category: 'A' },
  paint_code:        { pattern: /paint\s*code|color\s*code|\b(hugger|rallye|cortez|fathom|ascot|verdoro|tuxedo|ermine|lemans|daytona)\b/i, weight: 1.5, category: 'A' },
  option_code:       { pattern: /\b(rpo|option\s*code|[a-z]\d{2})\b.*\b(code|option|package)\b|\b(z28|z\/28|ss|rs|copo|yenko|l\d{2}|m\d{2})\b/i, weight: 1.5, category: 'A' },
  mileage:           { pattern: /\b(\d{1,3}[,.]?\d{3})\s*(mi|mile|km|kilo)/i, weight: 1.0, category: 'A' },
  production_fact:   { pattern: /\b(1\s*of\s*\d+|only\s*\d+\s*(made|built|produced)|\d+\s*(total\s*)?(production|built|made))\b/i, weight: 1.5, category: 'A' },

  // Category B: Condition
  rust_mention:      { pattern: /\b(rust|rusty|rot|corrosion)\b.*\b(in|on|under|around|near|at)\b|\b(rust[\s-]?free|no\s*rust)\b/i, weight: 1.5, category: 'B' },
  paint_condition:   { pattern: /\b(original\s*paint|factory\s*paint|repaint|respray|patina|clear[\s-]?coat|single[\s-]?stage|base[\s-]?coat)\b/i, weight: 1.5, category: 'B' },
  body_condition:    { pattern: /\b(straight\s*body|no\s*dents|body\s*filler|bondo|panel\s*(fit|gaps?)|shut\s*lines?|frame[\s-]?(damage|rust|rot))\b/i, weight: 1.5, category: 'B' },
  mechanical:        { pattern: /\b(runs?\s*(strong|great|well|smooth)|oil\s*leak|smoke|misfire|needs?\s*work|rebuilt|freshened)\b/i, weight: 1.0, category: 'B' },
  restoration:       { pattern: /\b(concours|frame[\s-]?off|rotisserie|bare[\s-]?metal|nut[\s-]?and[\s-]?bolt|ground[\s-]?up|amateur|maaco)\b/i, weight: 1.5, category: 'B' },

  // Category C: Provenance
  sighting:          { pattern: /\b(i\s*(saw|seen|spotted)|saw\s*(this|it)\s*(at|in)|was\s*at\s*(the|a)\b|amelia|pebble\s*beach|goodwood|monterey|concours|car\s*show)\b/i, weight: 2.0, category: 'C' },
  ownership:         { pattern: /\b(my\s*(dad|uncle|grandfather|friend|neighbor|buddy)|i\s*(owned|had|bought|sold)|previous\s*owner|original\s*owner|first\s*owner)\b/i, weight: 1.5, category: 'C' },
  previous_sale:     { pattern: /\b(sold\s*(on|at|for|previously)|previously\s*listed|was\s*on\s*(bat|ebay|hemmings)|traded\s*hands)\b/i, weight: 1.5, category: 'C' },
  work_record:       { pattern: /\b(rebuilt|restored\s*by|work\s*(done|performed)|serviced\s*(at|by)|shop\s*(did|built|rebuilt))\b/i, weight: 1.5, category: 'C' },

  // Category E: Library knowledge
  general_spec:      { pattern: /\b(these\s*(came|had|were|used)|factory\s*(option|standard|spec)|all\s*\w+\s*(had|came|were)|common\s*(issue|problem|failure))\b/i, weight: 1.0, category: 'E' },
};

/**
 * Compute claim density score for a comment (0-1).
 * Higher scores = more likely to contain extractable claims.
 */
export function computeClaimDensity(
  commentText: string,
  wordCount: number,
  isSeller: boolean,
  authorExpertiseScore?: number
): { score: number; matchedPatterns: string[] } {
  const matched: string[] = [];
  let totalWeight = 0;

  for (const [name, { pattern, weight }] of Object.entries(CLAIM_PATTERNS)) {
    if (pattern.test(commentText)) {
      matched.push(name);
      totalWeight += weight;
    }
  }

  // Normalize by comment length (longer comments get proportionally less credit per match)
  const lengthFactor = Math.max(1, wordCount / 30);
  let density = totalWeight / lengthFactor;

  // Seller comments are higher signal
  if (isSeller) density *= 1.5;

  // Author expertise boosts density
  if (authorExpertiseScore && authorExpertiseScore > 0.5) {
    density *= (1 + (authorExpertiseScore - 0.5));
  }

  return { score: Math.min(1, density), matchedPatterns: matched };
}

/**
 * Check if a comment passes the pre-filter thresholds.
 */
export function passesClaimFilter(
  density: number,
  wordCount: number,
  isSeller: boolean
): boolean {
  if (density >= 0.3 && wordCount >= 15) return true;
  if (density >= 0.1 && wordCount >= 30 && isSeller) return true;
  return false;
}

// ── Prompt builder (Phase 2 LLM extraction) ─────────────────────────────

/**
 * Build the claim extraction prompt for a batch of comments.
 */
export function buildClaimExtractionPrompt(
  vehicle: VehicleContext,
  comments: CommentRow[],
  existingFieldNames: string[]
): string {
  const vehicleDesc = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Unknown Vehicle';
  const vinLine = vehicle.vin ? `VIN: ${vehicle.vin}` : 'VIN: unknown';
  const priceLine = vehicle.sale_price ? `SALE PRICE: $${vehicle.sale_price.toLocaleString()}` : '';
  const existingLine = existingFieldNames.length > 0
    ? `FIELDS ALREADY KNOWN: ${existingFieldNames.slice(0, 20).join(', ')}`
    : 'FIELDS ALREADY KNOWN: none';

  const commentBlocks = comments.map((c, i) => {
    const prefix = c.is_seller ? '[SELLER] ' : '';
    const user = c.author_username || 'anon';
    const bid = c.bid_amount ? ` [BID: $${Number(c.bid_amount).toLocaleString()}]` : '';
    const date = c.posted_at ? ` (${c.posted_at.substring(0, 10)})` : '';
    return `[${i + 1}] ${prefix}@${user}${bid}${date}:\n${c.comment_text}`;
  }).join('\n\n');

  return `You are extracting FACTUAL CLAIMS from auction comments about a specific vehicle.
Each comment may contain 0-5 distinct claims about this vehicle's specifications, condition, history, or provenance.

VEHICLE: ${vehicleDesc}
${vinLine}
${priceLine}
${existingLine}

COMMENTS (${comments.length}):
---
${commentBlocks}
---

For each comment, extract ALL factual claims. Return a JSON array where each element corresponds to a comment by index:

[
  {
    "comment_index": 1,
    "claims": [
      {
        "claim_type": "engine_identity|matching_numbers|transmission_type|drivetrain|mileage_claim|paint_identity|production_fact|rust_condition|paint_condition|mechanical_condition|body_condition|interior_condition|sighting|ownership_claim|previous_sale|work_performed|option_code|general_spec",
        "category": "A|B|C|E",
        "field_name": "engine_type|mileage|transmission|exterior_color|...",
        "proposed_value": "427 big block",
        "confidence": 0.85,
        "temporal_anchor": "2019-01-01|current|null",
        "reasoning": "Commenter explicitly identifies engine",
        "quote": "matching numbers 427",
        "contradicts_existing": false,
        "observation_kind": "sighting|ownership|work_record|null"
      }
    ]
  }
]

RULES:
1. Only extract FACTUAL claims — not opinions, greetings, or emotional reactions
2. "quote" MUST be an exact substring from the comment text (for verification)
3. "temporal_anchor" = when the claim REFERS TO, not when the comment was posted. "original paint" in a 2020 comment → "2020-01-01". Specifications like engine type → null (timeless).
4. "confidence" reflects how certain the commenter is and how specific the claim is (0.5-0.95 range)
5. Seller comments get +0.10 confidence bonus (they know their car)
6. If a claim contradicts the FIELDS ALREADY KNOWN, set contradicts_existing=true
7. For Category C (sighting, ownership, work_performed), set observation_kind
8. Skip: bid amounts, congratulations, jokes, questions without assertions, price opinions
9. Return empty claims array for comments with no factual claims
10. Do NOT invent claims — only extract what is explicitly stated

Return ONLY the JSON array, no other text.`;
}

// ── Response parser ─────────────────────────────────────────────────────

/**
 * Parse LLM response and validate claims against source comments.
 * Rejects claims where quote is not a substring of the original comment.
 */
export function parseClaimResponse(
  llmOutput: string,
  comments: CommentRow[]
): { claims: Array<ExtractedClaim & { comment_id: string; comment_index: number }>; parseErrors: string[] } {
  const errors: string[] = [];

  // Extract JSON array from response
  const jsonMatch = llmOutput.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    errors.push('No JSON array found in LLM response');
    return { claims: [], parseErrors: errors };
  }

  let parsed: any[];
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    errors.push(`JSON parse error: ${e}`);
    return { claims: [], parseErrors: errors };
  }

  if (!Array.isArray(parsed)) {
    errors.push('Parsed result is not an array');
    return { claims: [], parseErrors: errors };
  }

  const validClaims: Array<ExtractedClaim & { comment_id: string; comment_index: number }> = [];

  for (const entry of parsed) {
    const idx = (entry.comment_index ?? 0) - 1; // 1-indexed in prompt
    if (idx < 0 || idx >= comments.length) {
      errors.push(`Invalid comment_index: ${entry.comment_index}`);
      continue;
    }

    const comment = comments[idx];
    const claims = entry.claims;
    if (!Array.isArray(claims)) continue;

    for (const c of claims) {
      // Validate required fields
      if (!c.claim_type || !c.proposed_value || !c.quote) {
        errors.push(`Missing required fields in claim for comment ${idx + 1}`);
        continue;
      }

      // Validate quote is actual substring (case-insensitive, whitespace-normalized)
      const normalizedComment = comment.comment_text.toLowerCase().replace(/\s+/g, ' ');
      const normalizedQuote = String(c.quote).toLowerCase().replace(/\s+/g, ' ');
      if (!normalizedComment.includes(normalizedQuote)) {
        errors.push(`Quote not found in comment ${idx + 1}: "${c.quote}"`);
        continue;
      }

      // Clamp confidence
      const confidence = Math.max(0, Math.min(0.95, Number(c.confidence) || 0.5));

      validClaims.push({
        claim_type: c.claim_type,
        category: c.category || inferCategory(c.claim_type),
        field_name: c.field_name || null,
        proposed_value: String(c.proposed_value),
        confidence: confidence + (comment.is_seller ? 0.05 : 0),
        temporal_anchor: c.temporal_anchor || null,
        reasoning: c.reasoning || '',
        quote: c.quote,
        contradicts_existing: !!c.contradicts_existing,
        observation_kind: c.observation_kind || undefined,
        comment_id: comment.id,
        comment_index: idx,
      });
    }
  }

  return { claims: validClaims, parseErrors: errors };
}

function inferCategory(claimType: string): 'A' | 'B' | 'C' | 'D' | 'E' {
  const catMap: Record<string, 'A' | 'B' | 'C' | 'D' | 'E'> = {
    engine_identity: 'A', matching_numbers: 'A', transmission_type: 'A', drivetrain: 'A',
    mileage_claim: 'A', paint_identity: 'A', production_fact: 'A', option_code: 'A', vin_reference: 'A',
    rust_condition: 'B', paint_condition: 'B', mechanical_condition: 'B', body_condition: 'B', interior_condition: 'B',
    sighting: 'C', ownership_claim: 'C', previous_sale: 'C', work_performed: 'C',
    general_spec: 'E',
  };
  return catMap[claimType] || 'D';
}

// ── Confidence computation ──────────────────────────────────────────────

/**
 * Compute final confidence for a claim, factoring in author trust and temporal decay.
 */
export function computeClaimConfidence(
  rawConfidence: number,
  authorTrustScore: number | null,  // 0-1 from author_personas
  claimCategory: string,
  anchorDate: Date | null
): number {
  let conf = rawConfidence;

  // Author trust adjustment: trusted authors boost, unknown authors neutral, low-trust penalizes
  if (authorTrustScore !== null) {
    conf *= (0.7 + 0.6 * authorTrustScore); // range: 0.7x to 1.3x
  }

  // Temporal decay for condition claims
  if (anchorDate && ['paint_condition', 'mechanical_condition', 'body_condition',
    'rust_condition', 'interior_condition'].includes(claimCategory)) {
    const ageMs = Date.now() - anchorDate.getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    const halfLifeYears: Record<string, number> = {
      paint_condition: 2, mechanical_condition: 3, body_condition: 4,
      rust_condition: 5, interior_condition: 3,
    };
    const hl = halfLifeYears[claimCategory] || 5;
    conf *= Math.pow(0.5, ageYears / hl);
  }

  return Math.max(0, Math.min(1, conf));
}

// ── Corroboration engine ────────────────────────────────────────────────

export interface CorroborationResult {
  field_name: string;
  proposed_value: string;
  corroborating_count: number;
  contradicting_count: number;
  boost: number;
  penalty: number;
  final_confidence: number;
  status: 'pending' | 'accepted' | 'conflicted' | 'rejected';
}

/**
 * Cross-reference a set of claims against existing evidence for a vehicle.
 * Returns updated confidence and status for each claim.
 */
export async function runCorroboration(
  supabase: any,
  vehicleId: string,
  claims: Array<{ field_name: string; proposed_value: string; confidence: number }>
): Promise<CorroborationResult[]> {
  if (claims.length === 0) return [];

  const fieldNames = [...new Set(claims.map(c => c.field_name).filter(Boolean))];
  if (fieldNames.length === 0) return claims.map(c => ({
    ...c, corroborating_count: 0, contradicting_count: 0,
    boost: 0, penalty: 0, final_confidence: c.confidence, status: 'pending' as const,
  }));

  // Fetch existing evidence for these fields
  const { data: existingEvidence } = await supabase
    .from('field_evidence')
    .select('field_name, proposed_value, source_type, source_confidence, status')
    .eq('vehicle_id', vehicleId)
    .in('field_name', fieldNames);

  const evidenceByField = new Map<string, any[]>();
  for (const e of (existingEvidence || [])) {
    const arr = evidenceByField.get(e.field_name) || [];
    arr.push(e);
    evidenceByField.set(e.field_name, arr);
  }

  return claims.map(claim => {
    const existing = evidenceByField.get(claim.field_name) || [];
    let corroborating = 0;
    let contradicting = 0;

    for (const e of existing) {
      if (e.source_type === 'auction_comment_claim') continue; // Don't self-corroborate
      const matches = normalizeForComparison(e.proposed_value) === normalizeForComparison(claim.proposed_value);
      if (matches) {
        corroborating++;
        // VIN decode corroboration is extra strong
        if (e.source_type === 'nhtsa_vin_decode') corroborating += 2;
      } else if (e.status === 'accepted' || (e.source_confidence ?? 0) >= 80) {
        contradicting++;
        if (e.source_type === 'nhtsa_vin_decode') contradicting += 3;
      }
    }

    const boost = Math.min(0.30, corroborating * 0.10);
    const penalty = contradicting * 0.20;
    const final_confidence = Math.max(0, Math.min(1, claim.confidence * (1 + boost - penalty)));

    let status: 'pending' | 'accepted' | 'conflicted' | 'rejected' = 'pending';
    if (final_confidence >= 0.70 && contradicting === 0) status = 'accepted';
    else if (contradicting > 0 && existing.some(e => (e.source_confidence ?? 0) >= 50)) status = 'conflicted';
    else if (final_confidence < 0.30) status = 'rejected';

    return {
      field_name: claim.field_name,
      proposed_value: claim.proposed_value,
      corroborating_count: corroborating,
      contradicting_count: contradicting,
      boost, penalty, final_confidence, status,
    };
  });
}

function normalizeForComparison(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}
