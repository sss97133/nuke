import { KNOWN_MAKES, MAKE_ALIASES, MAKES_LOWER, BODY_STYLES_LOWER, COLORS_LOWER, KNOWN_ERAS } from './dictionaries';

export interface ParsedQuery {
  make: string | null;
  model: string | null;
  yearMin: number | null;
  yearMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
  bodyStyle: string | null;
  color: string | null;
  era: string | null;
  freeText: string;
}

// Patterns
const YEAR_RANGE_RE = /(\d{4})\s*[-–]\s*(\d{4})/;
const SINGLE_YEAR_RE = /\b(19[0-9]{2}|20[0-2][0-9])\b/;
const PRICE_UNDER_RE = /(?:under|below|less than|max|<)\s*\$?([\d,]+)\s*(k)?/i;
const PRICE_OVER_RE = /(?:over|above|more than|min|>)\s*\$?([\d,]+)\s*(k)?/i;
const PRICE_RANGE_RE = /\$?([\d,]+)\s*(k)?\s*[-–]\s*\$?([\d,]+)\s*(k)?/i;
const DOLLAR_RE = /\$[\d,]+(k)?/gi;

function parsePrice(raw: string, hasK: string | undefined): number {
  const num = parseFloat(raw.replace(/,/g, ''));
  return hasK ? num * 1000 : num;
}

export function parseQuery(input: string): ParsedQuery {
  let remaining = input.trim();
  const result: ParsedQuery = {
    make: null, model: null,
    yearMin: null, yearMax: null,
    priceMin: null, priceMax: null,
    bodyStyle: null, color: null, era: null,
    freeText: ''
  };

  // 1. Extract year range
  const yearRange = remaining.match(YEAR_RANGE_RE);
  if (yearRange) {
    result.yearMin = parseInt(yearRange[1]);
    result.yearMax = parseInt(yearRange[2]);
    remaining = remaining.replace(YEAR_RANGE_RE, ' ');
  } else {
    // Single year
    const singleYear = remaining.match(SINGLE_YEAR_RE);
    if (singleYear) {
      const y = parseInt(singleYear[1]);
      result.yearMin = y;
      result.yearMax = y;
      remaining = remaining.replace(SINGLE_YEAR_RE, ' ');
    }
  }

  // 2. Extract price constraints
  const priceRange = remaining.match(PRICE_RANGE_RE);
  if (priceRange) {
    result.priceMin = parsePrice(priceRange[1], priceRange[2]);
    result.priceMax = parsePrice(priceRange[3], priceRange[4]);
    remaining = remaining.replace(PRICE_RANGE_RE, ' ');
  } else {
    const under = remaining.match(PRICE_UNDER_RE);
    if (under) {
      result.priceMax = parsePrice(under[1], under[2]);
      remaining = remaining.replace(PRICE_UNDER_RE, ' ');
    }
    const over = remaining.match(PRICE_OVER_RE);
    if (over) {
      result.priceMin = parsePrice(over[1], over[2]);
      remaining = remaining.replace(PRICE_OVER_RE, ' ');
    }
  }

  // Remove standalone dollar amounts
  remaining = remaining.replace(DOLLAR_RE, ' ');

  // 3. Extract make
  const lower = remaining.toLowerCase().trim();
  const tokens = lower.split(/\s+/).filter(Boolean);

  // Try multi-word makes first (e.g., "alfa romeo", "land rover")
  for (const [alias, canonical] of Object.entries(MAKE_ALIASES)) {
    if (alias.includes(' ') && lower.includes(alias)) {
      result.make = canonical;
      remaining = remaining.replace(new RegExp(alias, 'i'), ' ');
      break;
    }
  }

  if (!result.make) {
    // Try each token against makes and aliases
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      // Check two-word combination
      if (i + 1 < tokens.length) {
        const twoWord = token + ' ' + tokens[i + 1];
        if (MAKES_LOWER.has(twoWord)) {
          result.make = KNOWN_MAKES.find(m => m.toLowerCase() === twoWord) || twoWord;
          remaining = remaining.replace(new RegExp(twoWord, 'i'), ' ');
          break;
        }
      }
      // Single word
      if (MAKES_LOWER.has(token)) {
        result.make = KNOWN_MAKES.find(m => m.toLowerCase() === token) || token;
        remaining = remaining.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, 'i'), ' ');
        break;
      }
      if (MAKE_ALIASES[token]) {
        result.make = MAKE_ALIASES[token];
        remaining = remaining.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, 'i'), ' ');
        break;
      }
    }
  }

  // 4. Extract body style
  const remainingLower = remaining.toLowerCase().trim();
  for (const style of BODY_STYLES_LOWER) {
    if (remainingLower.includes(style)) {
      result.bodyStyle = style;
      remaining = remaining.replace(new RegExp(`\\b${escapeRegex(style)}\\b`, 'i'), ' ');
      break;
    }
  }

  // 5. Extract color
  const tokensAfterMake = remaining.toLowerCase().trim().split(/\s+/).filter(Boolean);
  for (const t of tokensAfterMake) {
    if (COLORS_LOWER.has(t)) {
      result.color = t;
      remaining = remaining.replace(new RegExp(`\\b${escapeRegex(t)}\\b`, 'i'), ' ');
      break;
    }
  }

  // 6. Extract era
  for (const [key, era] of Object.entries(KNOWN_ERAS)) {
    if (remainingLower.includes(key)) {
      result.era = era;
      remaining = remaining.replace(new RegExp(`\\b${escapeRegex(key)}\\b`, 'i'), ' ');
      break;
    }
  }

  // 7. Remaining text is the model (if make was found) or freeText
  const cleaned = remaining.replace(/\s+/g, ' ').trim();
  if (result.make && cleaned) {
    result.model = cleaned;
  } else {
    result.freeText = cleaned;
  }

  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
