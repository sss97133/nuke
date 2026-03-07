import { classifyIntent } from './intentRouter';
import { parseQuery, type ParsedQuery } from './queryParser';

const MARKET_QUESTION_RE = /^(how\s+many|how\s+much|what(?:'s|s|\s+is|\s+are)\s+(?:the\s+)?(?:price|value|average|market|worth))/i;
const MARKET_VERB_RE = /\b(sold|selling|traded|listed|auctioned|fetching|going\s+for|worth|valued)\b/i;
const MARKET_NOUN_RE = /\b(market\s+consensus|market\s+data|comps?|comparables?|pricing|valuation|sales\s+data)\b/i;

/**
 * Detects whether a query is asking a market/data question
 * that the comps endpoint can answer.
 */
export function isMarketQuestion(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (MARKET_QUESTION_RE.test(q)) return true;
  if (MARKET_VERB_RE.test(q) && MARKET_NOUN_RE.test(q)) return true;
  // Also treat MARKET intent from intentRouter as market question
  const intent = classifyIntent(query);
  if (intent.intent === 'MARKET') return true;
  // "how many X sold" pattern
  if (/^how\s+many\b/i.test(q) && /\bsold\b/i.test(q)) return true;
  return false;
}

/**
 * Strips question scaffolding to extract the vehicle description.
 * "how many 1975 chevy c10 sold in 2025" → "1975 chevy c10"
 * "what's a 1973 porsche 911 worth" → "1973 porsche 911"
 */
export function stripQuestionScaffolding(query: string): string {
  let q = query.trim();

  // Remove leading question phrases
  q = q.replace(/^(how\s+many|how\s+much\s+(?:is|are|does)|what(?:'s|s|\s+is|\s+are)\s+(?:the\s+)?(?:price|value|average|market|worth)\s+(?:of|for)?)\s*/i, '');
  q = q.replace(/^(what(?:'s|s|\s+is|\s+are)\s+(?:a|an|the)?\s*)/i, '');
  q = q.replace(/^(how\s+much\s+(?:is|are)\s+(?:a|an|the)?\s*)/i, '');

  // Remove trailing question scaffolding
  q = q.replace(/\s+(sold|selling|traded|listed|auctioned|fetching|going\s+for|worth|valued)\s*(in\s+\d{4})?\s*\??$/i, ' $2');
  q = q.replace(/\s+(market\s+consensus|market\s+data|comps?|comparables?|pricing|valuation|sales\s+data)\s*\??$/i, '');
  q = q.replace(/\s+so\s+far\s*(in\s+\d{4})?\s*\??$/i, ' $1');
  q = q.replace(/\?$/, '');

  // "in 2026" at the end → keep the year, drop "in"
  q = q.replace(/\s+in\s+(\d{4})\s*$/i, ' $1');

  return q.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a market question into vehicle params for the comps endpoint.
 */
export function parseMarketQuery(query: string): ParsedQuery & { isMarket: boolean } {
  const isMarket = isMarketQuestion(query);
  const vehicleDesc = isMarket ? stripQuestionScaffolding(query) : query;
  const parsed = parseQuery(vehicleDesc);
  return { ...parsed, isMarket };
}
