/**
 * Phone Number Extractor
 * Extracts and normalizes phone numbers from text, handling common obfuscation techniques
 */

import * as crypto from 'crypto';

export interface ExtractedPhone {
  raw: string;          // Original text that matched
  normalized: string;   // E.164 format (+1XXXXXXXXXX)
  hash: string;         // SHA256 hash for deduplication
  confidence: number;   // 0-1 confidence score
}

// Word to digit mapping for obfuscated numbers
const WORD_TO_DIGIT: Record<string, string> = {
  'zero': '0',
  'one': '1',
  'two': '2',
  'three': '3',
  'four': '4',
  'five': '5',
  'six': '6',
  'seven': '7',
  'eight': '8',
  'nine': '9',
  'oh': '0',
  'o': '0',   // Only when clearly in phone context
  'won': '1', // Common misspelling
  'too': '2',
  'to': '2',  // Only in phone context
  'for': '4',
  'ate': '8',
};

// Regex for standard phone formats
const PHONE_PATTERNS = [
  // Standard formats: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxx xxx xxxx
  /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,

  // 10 consecutive digits
  /\b\d{10}\b/g,

  // With country code: +1-xxx-xxx-xxxx, 1-xxx-xxx-xxxx
  /\+?1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,

  // Spaces between all digits: x x x x x x x x x x
  /\b(\d\s){9}\d\b/g,
];

// Pattern for numbers with word substitutions
// e.g., "four oh five - five five five - one two three four"
const WORD_NUMBER_PATTERN = new RegExp(
  `\\b(${Object.keys(WORD_TO_DIGIT).join('|')}|\\d)` +
  `([-\\s.,]*(${Object.keys(WORD_TO_DIGIT).join('|')}|\\d)){9,}\\b`,
  'gi'
);

/**
 * Extract all phone numbers from text
 */
export function extractPhoneNumbers(text: string): ExtractedPhone[] {
  const results: ExtractedPhone[] = [];
  const seenHashes = new Set<string>();

  // Normalize text for easier matching
  const normalizedText = text
    .toLowerCase()
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ');

  // First, try standard patterns
  for (const pattern of PHONE_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const result = processMatch(match[0], 0.9);
      if (result && !seenHashes.has(result.hash)) {
        results.push(result);
        seenHashes.add(result.hash);
      }
    }
  }

  // Then try word-number patterns
  const wordMatches = normalizedText.matchAll(WORD_NUMBER_PATTERN);
  for (const match of wordMatches) {
    const result = processWordMatch(match[0]);
    if (result && !seenHashes.has(result.hash)) {
      results.push(result);
      seenHashes.add(result.hash);
    }
  }

  // Look for obfuscated patterns like "4o5" or "call 4055551234"
  const obfuscatedMatches = findObfuscatedNumbers(normalizedText);
  for (const match of obfuscatedMatches) {
    const result = processMatch(match.text, match.confidence);
    if (result && !seenHashes.has(result.hash)) {
      results.push(result);
      seenHashes.add(result.hash);
    }
  }

  return results;
}

/**
 * Process a standard phone number match
 */
function processMatch(raw: string, confidence: number): ExtractedPhone | null {
  // Extract only digits
  const digits = raw.replace(/\D/g, '');

  // Validate length
  if (digits.length < 10 || digits.length > 11) {
    return null;
  }

  // Normalize to E.164
  let normalized: string;
  if (digits.length === 10) {
    normalized = '+1' + digits;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    normalized = '+' + digits;
  } else {
    return null;
  }

  // Validate area code (shouldn't start with 0 or 1)
  const areaCode = normalized.substring(2, 5);
  if (areaCode.startsWith('0') || areaCode.startsWith('1')) {
    return null;
  }

  // Create hash for deduplication
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');

  return {
    raw: raw.trim(),
    normalized,
    hash,
    confidence,
  };
}

/**
 * Process a word-based phone number (e.g., "four oh five five five five one two three four")
 */
function processWordMatch(raw: string): ExtractedPhone | null {
  // Convert words to digits
  let digits = '';
  const parts = raw.toLowerCase().split(/[-\s.,]+/);

  for (const part of parts) {
    if (/^\d$/.test(part)) {
      digits += part;
    } else if (WORD_TO_DIGIT[part]) {
      digits += WORD_TO_DIGIT[part];
    }
  }

  if (digits.length < 10 || digits.length > 11) {
    return null;
  }

  // Lower confidence for word-based matches
  const result = processMatch(digits, 0.7);
  if (result) {
    result.raw = raw; // Keep original text
  }
  return result;
}

/**
 * Find obfuscated phone numbers with letter substitutions
 * e.g., "4o5-55five-1234"
 */
function findObfuscatedNumbers(text: string): Array<{ text: string; confidence: number }> {
  const results: Array<{ text: string; confidence: number }> = [];

  // Pattern for mixed digit/letter sequences that might be phone numbers
  // Look for sequences with at least 7 digit-like characters
  const mixedPattern = /\b[\doO0-9][-.\s]?[\doO0-9][-.\s]?[\doO0-9][-.\s]?[\doO0-9][-.\s]?[\doO0-9][-.\s]?[\doO0-9][-.\s]?[\doO0-9][-.\s]?[\doO0-9][-.\s]?[\doO0-9][-.\s]?[\doO0-9]\b/gi;

  const matches = text.matchAll(mixedPattern);
  for (const match of matches) {
    let cleaned = match[0].toLowerCase();

    // Replace common letter substitutions
    cleaned = cleaned.replace(/o/g, '0');
    cleaned = cleaned.replace(/i/g, '1');
    cleaned = cleaned.replace(/l/g, '1');
    cleaned = cleaned.replace(/s/g, '5');
    cleaned = cleaned.replace(/b/g, '8');

    // Count actual digits after cleanup
    const digitCount = (cleaned.match(/\d/g) || []).length;
    if (digitCount >= 10) {
      results.push({
        text: cleaned,
        confidence: 0.6, // Lower confidence for obfuscated
      });
    }
  }

  // Also look for "call" or "text" followed by potential number
  const callPattern = /(?:call|text|phone|tel)[:\s]+([^\n,;]{10,30})/gi;
  const callMatches = text.matchAll(callPattern);
  for (const match of callMatches) {
    const potentialNumber = match[1];
    const digits = convertMixedToDigits(potentialNumber);
    if (digits.length >= 10 && digits.length <= 11) {
      results.push({
        text: digits,
        confidence: 0.75,
      });
    }
  }

  return results;
}

/**
 * Convert a mixed word/digit/letter string to digits
 */
function convertMixedToDigits(text: string): string {
  let result = '';
  const lower = text.toLowerCase();

  // First, try word-by-word conversion
  const words = lower.split(/[-.\s]+/);
  for (const word of words) {
    if (/^\d+$/.test(word)) {
      result += word;
    } else if (WORD_TO_DIGIT[word]) {
      result += WORD_TO_DIGIT[word];
    } else {
      // Try character-by-character for things like "4o5"
      for (const char of word) {
        if (/\d/.test(char)) {
          result += char;
        } else if (char === 'o' || char === 'O') {
          result += '0';
        } else if (char === 'i' || char === 'l' || char === 'I') {
          result += '1';
        } else if (WORD_TO_DIGIT[char]) {
          result += WORD_TO_DIGIT[char];
        }
      }
    }
  }

  return result;
}

/**
 * Format a phone number for display
 */
export function formatPhoneForDisplay(normalized: string): string {
  if (!normalized.startsWith('+1') || normalized.length !== 12) {
    return normalized;
  }

  const areaCode = normalized.substring(2, 5);
  const prefix = normalized.substring(5, 8);
  const line = normalized.substring(8, 12);

  return `(${areaCode}) ${prefix}-${line}`;
}

/**
 * Validate if a string looks like a valid US phone number
 */
export function isValidUSPhone(text: string): boolean {
  const result = processMatch(text, 1);
  return result !== null;
}

// Test function
function runTests() {
  const testCases = [
    '(405) 555-1234',
    '405-555-1234',
    '405.555.1234',
    '405 555 1234',
    '4055551234',
    '+1-405-555-1234',
    '1-405-555-1234',
    'four oh five five five five one two three four',
    '4o5-555-1234',
    'call me at 405-555-1234',
    'text four zero five 555 one two three four',
    '405-441--313six', // Double dash with word
    '5 0 5 1 2 3 4 5 6 7', // Spaces between all
  ];

  console.log('Phone Extractor Tests\n');
  for (const test of testCases) {
    const results = extractPhoneNumbers(test);
    console.log(`Input: "${test}"`);
    if (results.length > 0) {
      for (const r of results) {
        console.log(`  -> ${r.normalized} (confidence: ${r.confidence})`);
        console.log(`     Display: ${formatPhoneForDisplay(r.normalized)}`);
      }
    } else {
      console.log('  -> No phone number found');
    }
    console.log();
  }
}

// Run tests if called directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  runTests();
}
