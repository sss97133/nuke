/**
 * INTELLIGENCE LAYER
 *
 * Three-decision validation: APPROVE / DOUBT / REJECT
 * - APPROVE: Data passes all validators, proceed to FRAMEWORK
 * - DOUBT: Anomaly detected, needs research before decision
 * - REJECT: Data fails hard constraints, cannot proceed
 *
 * The gold is DOUBT - anomalies trigger research, not automatic rejection.
 * Resolved doubts become learned patterns.
 */

import { decodeVin, type VINDecodeResult } from "./vin-decoder.ts";

// ============================================================================
// TYPES
// ============================================================================

export type Decision = 'APPROVE' | 'DOUBT' | 'REJECT';

export interface FieldDecision {
  field: string;
  value: any;
  decision: Decision;
  confidence: number;  // 0-1
  reason: string;
  doubt_type?: string; // For DOUBT decisions: 'anomaly' | 'conflict' | 'edge_case' | 'unknown_pattern'
  evidence?: Record<string, any>;
}

export interface IntelligenceResult {
  overall_decision: Decision;
  field_decisions: FieldDecision[];
  doubts_requiring_research: FieldDecision[];
  reject_reasons: string[];
  approve_count: number;
  doubt_count: number;
  reject_count: number;
  source_capture_id?: string;
  timestamp: string;
}

export interface ValidationContext {
  source_url?: string;
  source_domain?: string;
  claimed_year?: number;
  claimed_make?: string;
  claimed_model?: string;
  known_patterns?: LearnedPattern[];
}

export interface LearnedPattern {
  pattern_type: string;
  pattern: Record<string, any>;
  resolution: Decision;
  confidence: number;
  examples_count: number;
}

// ============================================================================
// MAIN INTELLIGENCE FUNCTION
// ============================================================================

export function evaluateExtraction(
  extractedData: Record<string, any>,
  context: ValidationContext = {}
): IntelligenceResult {
  const decisions: FieldDecision[] = [];

  // Evaluate critical fields
  if ('vin' in extractedData) {
    decisions.push(evaluateVIN(extractedData.vin, context));
  }

  if ('year' in extractedData) {
    decisions.push(evaluateYear(extractedData.year, context));
  }

  if ('sale_price' in extractedData || 'price' in extractedData) {
    const price = extractedData.sale_price ?? extractedData.price;
    decisions.push(evaluatePrice(price, context));
  }

  if ('mileage' in extractedData) {
    decisions.push(evaluateMileage(extractedData.mileage, context));
  }

  // Cross-field validation
  if (extractedData.vin && extractedData.year) {
    const vinDecision = evaluateVINYearConsistency(
      extractedData.vin,
      extractedData.year,
      context
    );
    if (vinDecision) decisions.push(vinDecision);
  }

  // Aggregate results
  const approves = decisions.filter(d => d.decision === 'APPROVE');
  const doubts = decisions.filter(d => d.decision === 'DOUBT');
  const rejects = decisions.filter(d => d.decision === 'REJECT');

  // Overall decision logic:
  // - ANY reject = REJECT (hard failure)
  // - ANY doubt = DOUBT (needs research)
  // - ALL approve = APPROVE
  let overall: Decision = 'APPROVE';
  if (rejects.length > 0) {
    overall = 'REJECT';
  } else if (doubts.length > 0) {
    overall = 'DOUBT';
  }

  return {
    overall_decision: overall,
    field_decisions: decisions,
    doubts_requiring_research: doubts,
    reject_reasons: rejects.map(r => r.reason),
    approve_count: approves.length,
    doubt_count: doubts.length,
    reject_count: rejects.length,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// VIN VALIDATION
// ============================================================================

function evaluateVIN(vin: any, context: ValidationContext): FieldDecision {
  const field = 'vin';

  // NULL/empty handling
  if (!vin || String(vin).trim() === '') {
    return {
      field,
      value: vin,
      decision: 'DOUBT',
      confidence: 0.5,
      reason: 'VIN is missing or empty',
      doubt_type: 'unknown_pattern'
    };
  }

  const vinStr = String(vin).toUpperCase().trim();

  // Modern VIN: exactly 17 characters
  if (vinStr.length === 17) {
    // Check for invalid characters (I, O, Q)
    if (/[IOQ]/.test(vinStr)) {
      return {
        field,
        value: vinStr,
        decision: 'REJECT',
        confidence: 0.99,
        reason: `VIN contains invalid characters (I, O, or Q are never used): ${vinStr}`
      };
    }

    // Validate checksum (position 9)
    const checksumValid = validateVINChecksum(vinStr);
    if (!checksumValid) {
      // Invalid checksum is DOUBT not REJECT - could be data entry error
      return {
        field,
        value: vinStr,
        decision: 'DOUBT',
        confidence: 0.7,
        reason: 'VIN checksum failed validation',
        doubt_type: 'anomaly',
        evidence: { checksum_position: 9, expected_algorithm: 'MOD 11' }
      };
    }

    // Decode and check consistency
    const decoded = decodeVin(vinStr);
    return {
      field,
      value: vinStr,
      decision: 'APPROVE',
      confidence: 0.95,
      reason: 'Valid 17-character VIN with correct checksum',
      evidence: {
        decoded_year: decoded.year,
        decoded_make: decoded.make,
        manufacturer: decoded.manufacturer
      }
    };
  }

  // Pre-1981 VIN: shorter, varied formats
  if (vinStr.length >= 6 && vinStr.length < 17) {
    // This is the "vintage VIN edge case" from our architecture discussion
    // DOUBT - needs research to confirm it's legitimate
    const decoded = decodeVin(vinStr);

    if (decoded.year && decoded.year < 1981) {
      return {
        field,
        value: vinStr,
        decision: 'DOUBT',
        confidence: 0.6,
        reason: `Pre-1981 VIN format (${vinStr.length} chars) - needs verification`,
        doubt_type: 'edge_case',
        evidence: {
          vin_length: vinStr.length,
          decoded_year: decoded.year,
          decoded_make: decoded.make,
          era: 'pre-standardization'
        }
      };
    }

    // Short VIN but no year decoded - suspicious
    return {
      field,
      value: vinStr,
      decision: 'DOUBT',
      confidence: 0.4,
      reason: `Non-standard VIN length (${vinStr.length} chars)`,
      doubt_type: 'anomaly',
      evidence: { vin_length: vinStr.length }
    };
  }

  // Too short - REJECT
  if (vinStr.length < 6) {
    return {
      field,
      value: vinStr,
      decision: 'REJECT',
      confidence: 0.95,
      reason: `VIN too short (${vinStr.length} chars, minimum 6 for any era)`
    };
  }

  // Too long - REJECT
  return {
    field,
    value: vinStr,
    decision: 'REJECT',
    confidence: 0.95,
    reason: `VIN too long (${vinStr.length} chars, maximum 17)`
  };
}

/**
 * VIN checksum validation (MOD 11 algorithm for position 9)
 */
function validateVINChecksum(vin: string): boolean {
  const transliteration: Record<string, number> = {
    'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
    'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7, 'R': 9,
    'S': 2, 'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9
  };

  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const char = vin.charAt(i);
    let value: number;

    if (/\d/.test(char)) {
      value = parseInt(char);
    } else {
      value = transliteration[char] ?? 0;
    }

    sum += value * weights[i];
  }

  const remainder = sum % 11;
  const checkDigit = vin.charAt(8);
  const expectedCheckDigit = remainder === 10 ? 'X' : String(remainder);

  return checkDigit === expectedCheckDigit;
}

// ============================================================================
// YEAR VALIDATION
// ============================================================================

function evaluateYear(year: any, context: ValidationContext): FieldDecision {
  const field = 'year';
  const currentYear = new Date().getFullYear();

  // NULL/empty
  if (year === null || year === undefined || year === '') {
    return {
      field,
      value: year,
      decision: 'DOUBT',
      confidence: 0.5,
      reason: 'Year is missing',
      doubt_type: 'unknown_pattern'
    };
  }

  const yearNum = Number(year);

  // Not a number
  if (isNaN(yearNum)) {
    return {
      field,
      value: year,
      decision: 'REJECT',
      confidence: 0.99,
      reason: `Year is not a valid number: ${year}`
    };
  }

  // Future year (more than 1 year ahead)
  if (yearNum > currentYear + 1) {
    return {
      field,
      value: yearNum,
      decision: 'REJECT',
      confidence: 0.95,
      reason: `Year is in the future: ${yearNum}`
    };
  }

  // Pre-automobile era
  if (yearNum < 1885) {
    return {
      field,
      value: yearNum,
      decision: 'REJECT',
      confidence: 0.99,
      reason: `Year predates automobiles: ${yearNum} (first car was 1885)`
    };
  }

  // Very old but valid - DOUBT for verification
  if (yearNum < 1920) {
    return {
      field,
      value: yearNum,
      decision: 'DOUBT',
      confidence: 0.6,
      reason: `Pre-1920 vehicle (${yearNum}) - rare, verify authenticity`,
      doubt_type: 'edge_case',
      evidence: { era: 'brass_era', rarity: 'very_high' }
    };
  }

  // Valid year
  return {
    field,
    value: yearNum,
    decision: 'APPROVE',
    confidence: 0.95,
    reason: `Valid year: ${yearNum}`
  };
}

// ============================================================================
// PRICE VALIDATION
// ============================================================================

function evaluatePrice(price: any, context: ValidationContext): FieldDecision {
  const field = 'sale_price';

  // NULL/empty - not always required
  if (price === null || price === undefined || price === '') {
    return {
      field,
      value: price,
      decision: 'APPROVE',
      confidence: 0.7,
      reason: 'Price not provided (may be reserve not met or no sale)'
    };
  }

  const priceNum = Number(price);

  // Not a number
  if (isNaN(priceNum)) {
    return {
      field,
      value: price,
      decision: 'REJECT',
      confidence: 0.95,
      reason: `Price is not a valid number: ${price}`
    };
  }

  // Negative price
  if (priceNum < 0) {
    return {
      field,
      value: priceNum,
      decision: 'REJECT',
      confidence: 0.99,
      reason: `Negative price: ${priceNum}`
    };
  }

  // Suspiciously low (under $100)
  if (priceNum > 0 && priceNum < 100) {
    return {
      field,
      value: priceNum,
      decision: 'DOUBT',
      confidence: 0.7,
      reason: `Suspiciously low price: $${priceNum} - may be bid increment or error`,
      doubt_type: 'anomaly',
      evidence: { threshold: 100, unit: 'USD' }
    };
  }

  // Extremely high (over $50M) - like the $2.3M Porsche 959 example
  if (priceNum > 50000000) {
    return {
      field,
      value: priceNum,
      decision: 'DOUBT',
      confidence: 0.5,
      reason: `Extremely high price: $${priceNum.toLocaleString()} - verify authenticity`,
      doubt_type: 'anomaly',
      evidence: { threshold: 50000000, note: 'could_be_legitimate_record_sale' }
    };
  }

  // High but plausible ($2M-$50M)
  if (priceNum > 2000000) {
    return {
      field,
      value: priceNum,
      decision: 'DOUBT',
      confidence: 0.6,
      reason: `High-value sale: $${priceNum.toLocaleString()} - verify source reliability`,
      doubt_type: 'anomaly',
      evidence: { category: 'high_value' }
    };
  }

  // Normal price range
  return {
    field,
      value: priceNum,
    decision: 'APPROVE',
    confidence: 0.95,
    reason: `Price in normal range: $${priceNum.toLocaleString()}`
  };
}

// ============================================================================
// MILEAGE VALIDATION
// ============================================================================

function evaluateMileage(mileage: any, context: ValidationContext): FieldDecision {
  const field = 'mileage';

  // NULL/empty
  if (mileage === null || mileage === undefined || mileage === '') {
    return {
      field,
      value: mileage,
      decision: 'APPROVE',
      confidence: 0.7,
      reason: 'Mileage not provided'
    };
  }

  const milesNum = Number(mileage);

  // Not a number
  if (isNaN(milesNum)) {
    return {
      field,
      value: mileage,
      decision: 'DOUBT',
      confidence: 0.5,
      reason: `Mileage may contain text: ${mileage}`,
      doubt_type: 'unknown_pattern'
    };
  }

  // Negative
  if (milesNum < 0) {
    return {
      field,
      value: milesNum,
      decision: 'REJECT',
      confidence: 0.99,
      reason: `Negative mileage: ${milesNum}`
    };
  }

  // Extremely high (over 1M miles)
  if (milesNum > 1000000) {
    return {
      field,
      value: milesNum,
      decision: 'DOUBT',
      confidence: 0.7,
      reason: `Extremely high mileage: ${milesNum.toLocaleString()} - verify accuracy`,
      doubt_type: 'anomaly',
      evidence: { threshold: 1000000, possible_cause: 'data_entry_error_or_commercial_vehicle' }
    };
  }

  // Low mileage on older car - suspicious but not invalid
  if (context.claimed_year && milesNum < 10000) {
    const vehicleAge = new Date().getFullYear() - context.claimed_year;
    if (vehicleAge > 30 && milesNum < 5000) {
      return {
        field,
        value: milesNum,
        decision: 'DOUBT',
        confidence: 0.6,
        reason: `Very low mileage (${milesNum.toLocaleString()}) for ${vehicleAge}-year-old vehicle`,
        doubt_type: 'anomaly',
        evidence: {
          vehicle_age: vehicleAge,
          avg_miles_per_year: Math.round(milesNum / vehicleAge)
        }
      };
    }
  }

  // Normal mileage
  return {
    field,
    value: milesNum,
    decision: 'APPROVE',
    confidence: 0.9,
    reason: `Mileage: ${milesNum.toLocaleString()}`
  };
}

// ============================================================================
// CROSS-FIELD VALIDATION
// ============================================================================

function evaluateVINYearConsistency(
  vin: string,
  claimedYear: number,
  context: ValidationContext
): FieldDecision | null {
  const vinStr = String(vin).toUpperCase().trim();

  // Only validate modern VINs
  if (vinStr.length !== 17) return null;

  const decoded = decodeVin(vinStr);
  if (!decoded.year) return null;

  // Year mismatch
  if (decoded.year !== claimedYear) {
    return {
      field: 'vin_year_consistency',
      value: { vin_year: decoded.year, claimed_year: claimedYear },
      decision: 'DOUBT',
      confidence: 0.8,
      reason: `VIN decodes to ${decoded.year} but claimed year is ${claimedYear}`,
      doubt_type: 'conflict',
      evidence: {
        vin_position_10: vinStr.charAt(9),
        decoded_year: decoded.year,
        claimed_year: claimedYear,
        possible_causes: ['data_entry_error', 'model_year_vs_build_year', 'vin_error']
      }
    };
  }

  return null; // Consistent, no additional decision needed
}

// ============================================================================
// DOUBT QUEUE HELPER
// ============================================================================

export interface DoubtQueueItem {
  capture_id: string;
  field: string;
  value: any;
  doubt_type: string;
  reason: string;
  evidence: Record<string, any>;
  priority: 'high' | 'medium' | 'low';
  created_at: string;
}

export function createDoubtQueueItem(
  captureId: string,
  decision: FieldDecision
): DoubtQueueItem {
  // Determine priority based on doubt type and confidence
  let priority: 'high' | 'medium' | 'low' = 'medium';

  if (decision.doubt_type === 'conflict') {
    priority = 'high'; // Cross-field conflicts need immediate attention
  } else if (decision.doubt_type === 'anomaly' && decision.confidence > 0.7) {
    priority = 'high';
  } else if (decision.doubt_type === 'edge_case') {
    priority = 'low'; // Edge cases are usually resolvable with research
  }

  return {
    capture_id: captureId,
    field: decision.field,
    value: decision.value,
    doubt_type: decision.doubt_type || 'unknown',
    reason: decision.reason,
    evidence: decision.evidence || {},
    priority,
    created_at: new Date().toISOString()
  };
}
