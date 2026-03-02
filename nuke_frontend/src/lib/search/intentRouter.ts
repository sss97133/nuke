import { MAKES_LOWER, MAKE_ALIASES, BODY_STYLES_LOWER, KNOWN_ERAS, KNOWN_DOMAINS } from './dictionaries';

export type SearchIntent =
  | 'NAVIGATE'
  | 'EXACT_VIN'
  | 'EXACT_URL'
  | 'MY_VEHICLES'
  | 'MARKET'
  | 'QUESTION'
  | 'BROWSE'
  | 'QUERY';

export interface IntentResult {
  intent: SearchIntent;
  raw: string;
  normalized: string;
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;
const URL_RE = /^https?:\/\//i;
const MY_WORDS = new Set(['my', 'mine', 'garage', 'favorites', 'my garage', 'my vehicles', 'my cars']);
const MARKET_WORDS = new Set(['market', 'price', 'trend', 'value', 'worth', 'comp', 'comps', 'pricing', 'prices', 'valuation']);
const QUESTION_STARTS = new Set(['who', 'what', 'when', 'where', 'why', 'how', 'which', 'is', 'are', 'can', 'does', 'do', 'will', 'should']);

export function classifyIntent(raw: string): IntentResult {
  const trimmed = raw.trim();
  const normalized = trimmed.toLowerCase();
  const base = { raw: trimmed, normalized };

  // 1. NAVIGATE — starts with / or @
  if (trimmed.startsWith('/') || trimmed.startsWith('@')) {
    return { ...base, intent: 'NAVIGATE' };
  }

  // 2. EXACT_VIN — 17-char VIN pattern
  if (VIN_RE.test(trimmed)) {
    return { ...base, intent: 'EXACT_VIN' };
  }

  // 3. EXACT_URL — starts with http or contains known domain
  if (URL_RE.test(trimmed) || KNOWN_DOMAINS.some(d => normalized.includes(d))) {
    return { ...base, intent: 'EXACT_URL' };
  }

  // 4. MY_VEHICLES — contains "my", "mine", "favorites", etc
  const words = normalized.split(/\s+/);
  if (words.some(w => MY_WORDS.has(w)) || MY_WORDS.has(normalized)) {
    return { ...base, intent: 'MY_VEHICLES' };
  }

  // 5. MARKET — contains market/price/trend keywords
  if (words.some(w => MARKET_WORDS.has(w))) {
    return { ...base, intent: 'MARKET' };
  }

  // 6. QUESTION — starts with question word or ends with ?
  if (trimmed.endsWith('?') || QUESTION_STARTS.has(words[0])) {
    return { ...base, intent: 'QUESTION' };
  }

  // 7. BROWSE — single known make, make+model, body style, or era with no free text
  const resolvedMake = resolveMake(normalized);
  if (resolvedMake) {
    // Check if remaining tokens after make are model-like (no complex free text)
    const makePattern = new RegExp(`^${escapeRegex(resolvedMake.toLowerCase())}\\s*`, 'i');
    const remainder = normalized.replace(makePattern, '').trim();
    // If no remainder, or remainder is purely alphanumeric (likely a model), it's BROWSE
    if (!remainder || /^[a-z0-9\s-]+$/i.test(remainder)) {
      return { ...base, intent: 'BROWSE' };
    }
  }

  // Check for body style or era alone
  if (BODY_STYLES_LOWER.has(normalized) || KNOWN_ERAS[normalized]) {
    return { ...base, intent: 'BROWSE' };
  }

  // 8. QUERY — everything else
  return { ...base, intent: 'QUERY' };
}

function resolveMake(input: string): string | null {
  // Check direct match
  if (MAKES_LOWER.has(input)) {
    return input;
  }
  // Check first word
  const firstWord = input.split(/\s+/)[0];
  if (MAKES_LOWER.has(firstWord)) {
    return firstWord;
  }
  // Check aliases
  const aliased = MAKE_ALIASES[firstWord] || MAKE_ALIASES[input];
  if (aliased) return aliased.toLowerCase();
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
