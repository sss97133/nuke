/**
 * Document Verification Service - Hybrid Local + AI
 *
 * Priority: Local processing first (free, fast, private)
 * Fallback: AI when local confidence is low
 *
 * Local stack:
 * - Tesseract.js for OCR
 * - Rules-based validation
 * - Future: YOLOv8 for document classification
 *
 * This builds our moat - custom verification that's hard to replicate
 */

import Tesseract from 'tesseract.js';

// Document types we can verify
export type DocumentType = 'title' | 'drivers_license' | 'id_card' | 'passport' | 'registration' | 'unknown';

// Verification result
export interface VerificationResult {
  documentType: DocumentType;
  confidence: number;
  method: 'local' | 'ai' | 'hybrid';
  extracted: {
    name: string | null;
    address: string | null;
    vin: string | null;
    vehicleYear: number | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
    licenseNumber: string | null;
    expirationDate: string | null;
  };
  rawText: string;
  issues: string[];
  processingTimeMs: number;
}

// VIN validation (already have this logic, centralizing here)
export function validateVIN(vin: string): { valid: boolean; normalized: string; errors: string[] } {
  const normalized = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  const errors: string[] = [];

  if (normalized.length !== 17 && (normalized.length < 4 || normalized.length > 17)) {
    errors.push('VIN must be 17 characters (or 4-17 for vintage)');
  }

  // Check for invalid characters (I, O, Q)
  if (/[IOQ]/i.test(vin)) {
    errors.push('VIN cannot contain I, O, or Q');
  }

  // Must contain at least one digit
  if (!/\d/.test(normalized)) {
    errors.push('VIN must contain at least one digit');
  }

  // Check digit validation for 17-char VINs
  if (normalized.length === 17) {
    const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    const transliterations: Record<string, number> = {
      A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
      J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
      S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9
    };

    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const char = normalized[i];
      const value = /\d/.test(char) ? parseInt(char) : transliterations[char] || 0;
      sum += value * weights[i];
    }

    const checkDigit = sum % 11;
    const expectedCheck = checkDigit === 10 ? 'X' : checkDigit.toString();

    if (normalized[8] !== expectedCheck) {
      errors.push(`Check digit mismatch (expected ${expectedCheck}, got ${normalized[8]})`);
    }
  }

  return {
    valid: errors.length === 0,
    normalized,
    errors
  };
}

// Extract VIN from OCR text
function extractVIN(text: string): string | null {
  const upper = text.toUpperCase();

  // Pattern 1: Labeled VIN (e.g., "VIN: WVWZZZ3CZWE123456")
  const labeledPattern = /(?:\bVIN\b|VEHICLE\s*ID|CHASSIS(?:\s*(?:NO|NUMBER))?|SERIAL(?:\s*(?:NO|NUMBER))?)\s*[:.\s]*([A-HJ-NPR-Z0-9]{17})/gi;
  const labeledMatches = [...upper.matchAll(labeledPattern)];
  for (const match of labeledMatches) {
    const result = validateVIN(match[1]);
    if (result.valid) return result.normalized;
  }

  // Pattern 2: Standalone 17-char VIN
  const standalonePattern = /\b([A-HJ-NPR-Z0-9]{17})\b/g;
  const standaloneMatches = [...upper.matchAll(standalonePattern)];
  for (const match of standaloneMatches) {
    const result = validateVIN(match[1]);
    if (result.valid) return result.normalized;
  }

  return null;
}

// Extract name patterns (common on titles and IDs)
function extractName(text: string): string | null {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // Pattern 1: "OWNER:" or "NAME:" labels
  const labelPattern = /(?:OWNER|NAME|REGISTERED\s*TO)\s*[:.\s]*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)/i;
  const labelMatch = text.match(labelPattern);
  if (labelMatch) return labelMatch[1].trim();

  // Pattern 2: All-caps name (common on official docs)
  const capsPattern = /^([A-Z]{2,}\s+[A-Z]{2,}(?:\s+[A-Z]{1,})?)\s*$/m;
  const capsMatch = text.match(capsPattern);
  if (capsMatch) return capsMatch[1].trim();

  // Pattern 3: Name-like line (2-3 words, first letter caps)
  for (const line of lines) {
    if (/^[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/.test(line)) {
      return line;
    }
  }

  return null;
}

// Extract address
function extractAddress(text: string): string | null {
  // US address pattern: number + street + city, state zip
  const addressPattern = /(\d+\s+[A-Za-z\s]+(?:ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|RD|ROAD|DR|DRIVE|LN|LANE|WAY|CT|COURT|PL|PLACE)[.,]?\s*(?:[A-Za-z\s]+,?\s*)?[A-Z]{2}\s*\d{5}(?:-\d{4})?)/i;
  const match = text.match(addressPattern);
  return match ? match[1].trim() : null;
}

// Extract vehicle info from title
function extractVehicleInfo(text: string): { year: number | null; make: string | null; model: string | null } {
  const yearPattern = /(?:YEAR|YR|MODEL\s*YEAR)\s*[:.\s]*(\d{4})/i;
  const yearMatch = text.match(yearPattern);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  // Common makes to look for
  const makes = ['PORSCHE', 'FERRARI', 'LAMBORGHINI', 'BMW', 'MERCEDES', 'AUDI', 'VOLKSWAGEN',
                 'FORD', 'CHEVROLET', 'DODGE', 'TOYOTA', 'HONDA', 'NISSAN', 'MAZDA', 'SUBARU',
                 'JAGUAR', 'ASTON MARTIN', 'BENTLEY', 'ROLLS ROYCE', 'MASERATI', 'ALFA ROMEO'];

  const upper = text.toUpperCase();
  let make: string | null = null;
  for (const m of makes) {
    if (upper.includes(m)) {
      make = m;
      break;
    }
  }

  // Model is harder - often after make
  let model: string | null = null;
  if (make) {
    const modelPattern = new RegExp(`${make}\\s+([A-Z0-9]+(?:\\s+[A-Z0-9]+)?)`, 'i');
    const modelMatch = text.match(modelPattern);
    if (modelMatch) model = modelMatch[1].trim();
  }

  return { year, make, model };
}

// Detect document type from text patterns
function detectDocumentType(text: string): { type: DocumentType; confidence: number } {
  const upper = text.toUpperCase();

  // Title indicators
  const titleKeywords = ['CERTIFICATE OF TITLE', 'TITLE', 'VEHICLE TITLE', 'MOTOR VEHICLE',
                         'DEPARTMENT OF MOTOR', 'DMV', 'LIENHOLDER', 'OWNER', 'VIN'];
  const titleScore = titleKeywords.filter(k => upper.includes(k)).length;

  // Driver's license indicators
  const dlKeywords = ['DRIVER', 'LICENSE', 'CLASS', 'DOB', 'DATE OF BIRTH', 'EXP', 'EXPIRES',
                      'DL', 'OPER', 'RESTRICTIONS', 'ENDORSEMENTS'];
  const dlScore = dlKeywords.filter(k => upper.includes(k)).length;

  // Passport indicators
  const passportKeywords = ['PASSPORT', 'UNITED STATES OF AMERICA', 'NATIONALITY', 'GIVEN NAMES',
                            'SURNAME', 'DATE OF ISSUE', 'AUTHORITY'];
  const passportScore = passportKeywords.filter(k => upper.includes(k)).length;

  // Registration indicators
  const regKeywords = ['REGISTRATION', 'REGISTERED', 'PLATE', 'LICENSE PLATE', 'EXPIRES', 'VALID'];
  const regScore = regKeywords.filter(k => upper.includes(k)).length;

  const scores = [
    { type: 'title' as DocumentType, score: titleScore, threshold: 3 },
    { type: 'drivers_license' as DocumentType, score: dlScore, threshold: 3 },
    { type: 'passport' as DocumentType, score: passportScore, threshold: 3 },
    { type: 'registration' as DocumentType, score: regScore, threshold: 2 },
  ];

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  if (best.score >= best.threshold) {
    return { type: best.type, confidence: Math.min(0.95, 0.5 + best.score * 0.1) };
  }

  return { type: 'unknown', confidence: 0.3 };
}

/**
 * Main verification function - tries local first, AI fallback
 */
export async function verifyDocument(
  imageSource: File | Blob | string,
  options: {
    useAIFallback?: boolean;
    expectedType?: DocumentType;
  } = {}
): Promise<VerificationResult> {
  const startTime = Date.now();
  const issues: string[] = [];

  try {
    // Step 1: OCR with Tesseract (local, free)
    console.log('[DocVerify] Starting local OCR...');
    const { data: { text, confidence: ocrConfidence } } = await Tesseract.recognize(
      imageSource,
      'eng',
      {
        // Optimize for document text
        tessedit_pageseg_mode: '6', // Assume single block of text
      }
    );

    console.log('[DocVerify] OCR complete, confidence:', ocrConfidence);

    // Step 2: Detect document type
    const docType = detectDocumentType(text);

    // Step 3: Extract fields based on detected type
    const vin = extractVIN(text);
    const name = extractName(text);
    const address = extractAddress(text);
    const vehicleInfo = docType.type === 'title' ? extractVehicleInfo(text) : { year: null, make: null, model: null };

    // Step 4: Calculate confidence
    let confidence = docType.confidence;

    // Boost confidence if we found expected fields
    if (docType.type === 'title') {
      if (vin) confidence += 0.15;
      if (name) confidence += 0.1;
      if (vehicleInfo.year) confidence += 0.05;
    } else if (docType.type === 'drivers_license') {
      if (name) confidence += 0.15;
      if (address) confidence += 0.1;
    }

    confidence = Math.min(0.95, confidence);

    // Step 5: Validate extracted data
    if (vin) {
      const vinResult = validateVIN(vin);
      if (!vinResult.valid) {
        issues.push(...vinResult.errors);
        confidence -= 0.1;
      }
    }

    // Step 6: Check if we need AI fallback
    const needsAI = options.useAIFallback && confidence < 0.6;

    if (needsAI) {
      console.log('[DocVerify] Low confidence, AI fallback would be needed');
      issues.push('Low local confidence - AI analysis recommended');
    }

    return {
      documentType: docType.type,
      confidence,
      method: 'local',
      extracted: {
        name,
        address,
        vin,
        vehicleYear: vehicleInfo.year,
        vehicleMake: vehicleInfo.make,
        vehicleModel: vehicleInfo.model,
        licenseNumber: null, // TODO: extract DL number
        expirationDate: null, // TODO: extract expiration
      },
      rawText: text,
      issues,
      processingTimeMs: Date.now() - startTime
    };

  } catch (error: any) {
    console.error('[DocVerify] Error:', error);
    return {
      documentType: 'unknown',
      confidence: 0,
      method: 'local',
      extracted: {
        name: null,
        address: null,
        vin: null,
        vehicleYear: null,
        vehicleMake: null,
        vehicleModel: null,
        licenseNumber: null,
        expirationDate: null,
      },
      rawText: '',
      issues: [`Processing error: ${error.message}`],
      processingTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Quick VIN verification from image
 */
export async function verifyVINPlate(imageSource: File | Blob | string): Promise<{
  vin: string | null;
  confidence: number;
  valid: boolean;
  errors: string[];
}> {
  const { data: { text } } = await Tesseract.recognize(imageSource, 'eng');
  const vin = extractVIN(text);

  if (!vin) {
    return { vin: null, confidence: 0, valid: false, errors: ['No VIN found in image'] };
  }

  const validation = validateVIN(vin);
  return {
    vin: validation.normalized,
    confidence: validation.valid ? 0.9 : 0.5,
    valid: validation.valid,
    errors: validation.errors
  };
}

/**
 * Verify title document specifically
 */
export async function verifyTitle(imageSource: File | Blob | string): Promise<{
  isTitle: boolean;
  ownerName: string | null;
  vin: string | null;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  confidence: number;
  issues: string[];
}> {
  const result = await verifyDocument(imageSource, { expectedType: 'title' });

  return {
    isTitle: result.documentType === 'title',
    ownerName: result.extracted.name,
    vin: result.extracted.vin,
    vehicleYear: result.extracted.vehicleYear,
    vehicleMake: result.extracted.vehicleMake,
    vehicleModel: result.extracted.vehicleModel,
    confidence: result.confidence,
    issues: result.issues
  };
}

/**
 * Future: Train YOLOv8 model on our title images
 * This would be server-side, returning:
 * - Document type classification
 * - Bounding boxes for key fields (VIN, owner name, etc.)
 * - Then OCR just the relevant regions for better accuracy
 */
export interface YOLOv8Prediction {
  class: DocumentType;
  confidence: number;
  boxes: {
    label: string; // 'vin_field', 'owner_name', 'vehicle_info', etc.
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  }[];
}

// Placeholder for future YOLOv8 integration
export async function classifyDocumentWithYOLO(imageSource: File | Blob): Promise<YOLOv8Prediction | null> {
  // TODO: Call local Python server running YOLOv8
  // For now, return null to fall back to OCR-based detection
  console.log('[DocVerify] YOLOv8 not yet configured, using OCR fallback');
  return null;
}
