#!/usr/bin/env npx tsx
/**
 * Tests how the AIDataIngestionSearch component routes different inputs
 * Simulates the decision logic to find where it goes wrong
 */

// Replicate the heuristics from AIDataIngestionSearch.tsx

function normalizeUrlInput(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^[<(\[]+/, '').replace(/[>\])]+$/, '').trim();
  if (!cleaned) return null;
  if (/\s/.test(cleaned)) return null;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (/^www\./i.test(cleaned)) return `https://${cleaned}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[\/?#].*)?$/i.test(cleaned)) {
    return `https://${cleaned}`;
  }
  return null;
}

function isWiringIntent(text: string): boolean {
  const t = (text || '').toLowerCase();
  if (!t) return false;
  // Wiring-specific keywords - be precise to avoid false positives.
  // "can bus" is wiring, but "can I see" is not.
  return (
    t.includes('wiring') ||
    /\bharness\b/.test(t) ||  // "harness" but not "harness racing"
    t.includes('pdm') ||
    t.includes('ecu') ||
    t.includes('pinout') ||
    t.includes('bulkhead') ||
    t.includes('motec') ||
    /\bloom\b/.test(t) ||     // "loom" but not "looming"
    /\bawg\b/.test(t) ||      // wire gauge
    /\bcan\s*bus\b/.test(t) ||  // "can bus" or "canbus" - NOT "can I"
    t.includes('can-bus')
  );
}

function looksLikeNaturalLanguageSearch(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;

  // URL or VIN? Not a search query.
  if (normalizeUrlInput(t)) return false;
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(t)) return false;

  // Very short (1-2 chars)? Probably not useful for search.
  if (t.length < 2) return false;

  // SIMPLE HEURISTIC: If it's short text without special structure, it's a search.
  // Most people typing "porsche", "c10", "mustang" want to search.
  if (t.length <= 200) return true;

  // Legacy patterns still work for longer text
  if (t.includes('?')) return true;
  if (/^(what|why|how|when|where|who|which|are|is|do|does|did|can|should|could|would)\b/i.test(t)) return true;
  if (/\b(show|find|search|look|see|browse|list)\b/i.test(t)) return true;
  if (/\b(i\s+want\s+to\s+see|i\s+wanna\s+see|i\s+want\s+to|i\s+wanna)\b/i.test(t)) return true;
  if (/\b(all\s+the|all)\b/i.test(t) && t.split(/\s+/).length <= 8) return true;
  return false;
}

function isLikelyVehicleListingUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes('bringatrailer.com/listing/')) return true;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const q = u.search.toLowerCase();
    if (/[?&](vin|id)=/.test(q)) return true;
    const patterns = [
      /\/vehicle\/[^/]+/i,
      /\/inventory\/[^/]+/i,
      /\/listing\/[^/]+/i,
      /\/lot\/[^/]+/i,
      /\/car\/[^/]+/i,
      /\/auction\/[^/]+/i,
      /\/bid\/[^/]+/i,
    ];
    return patterns.some((re) => re.test(path));
  } catch {
    return false;
  }
}

function isMecumLotUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.toLowerCase().includes('mecum.com')) return false;
    const path = u.pathname.toLowerCase();
    if (path.includes('/lots/detail/')) return true;
    return /\/lots\/\d+(?:\/|$)/i.test(path);
  } catch {
    return false;
  }
}

function isLikelyOrgWebsiteUrl(url: string): boolean {
  if (!url.startsWith('http')) return false;
  if (isLikelyVehicleListingUrl(url)) return false;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const path = u.pathname.toLowerCase();
    if (parts.length <= 1) return true;
    if (/\/(about|contact|inventory|vehicles|sold|current|auctions?|events?)\b/i.test(path)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isVin(text: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(text.trim());
}

// Simulate what the component does
function routeInput(input: string): { route: string; reason: string } {
  const trimmed = input.trim();

  if (!trimmed) {
    return { route: 'NOTHING', reason: 'Empty input' };
  }

  const normalizedUrl = normalizeUrlInput(trimmed);

  // Check if it's a URL
  if (normalizedUrl) {
    if (isMecumLotUrl(normalizedUrl)) {
      return { route: 'MECUM_IMPORT', reason: 'Mecum lot URL detected' };
    }
    if (isLikelyVehicleListingUrl(normalizedUrl)) {
      return { route: 'VEHICLE_LISTING_EXTRACT', reason: 'Vehicle listing URL detected' };
    }
    if (isLikelyOrgWebsiteUrl(normalizedUrl)) {
      return { route: 'ORG_CREATE', reason: 'Organization website URL detected' };
    }
    return { route: 'URL_EXTRACT', reason: 'Generic URL - will try AI extraction' };
  }

  // Check for wiring intent
  if (isWiringIntent(trimmed)) {
    return { route: 'WIRING_WORKBENCH', reason: 'Wiring-related keywords detected' };
  }

  // Check for natural language search
  if (looksLikeNaturalLanguageSearch(trimmed)) {
    return { route: 'SEARCH', reason: 'Natural language search detected' };
  }

  // Check for VIN
  if (isVin(trimmed)) {
    return { route: 'AI_EXTRACT', reason: 'VIN detected - will try AI extraction' };
  }

  // Default: AI extraction (this is the problem!)
  return { route: 'AI_EXTRACT', reason: 'Default fallback - AI extraction' };
}

// Test cases
const TEST_INPUTS = [
  // Simple searches that should just search
  'porsche',
  'porsche 911',
  'c10',
  'mustang',
  'bmw',
  '1967 mustang',
  'chevy truck',

  // Natural language (should search)
  'show me porsches',
  'find c10 trucks',
  'what mustangs are for sale',

  // Queries that might confuse the router
  'cheap cars',
  'project car',
  'classic',
  'for sale',
  'near me',
  'restoration',

  // Edge cases
  'can bus wiring', // Contains "can " - wiring intent?
  'can I see porsches', // Contains "can " - wiring intent?
  'harness racing', // Contains "harness" - wiring intent?

  // URLs
  'https://bringatrailer.com/listing/1969-ford-mustang',
  'https://www.mecum.com/lots/123456',
  'https://somedealer.com',
  'somedealer.com',
  'www.mecum.com',

  // VINs
  '1G1YY22G965104567',

  // Garbage
  'asdfghjkl',
  '12345',
  'a',
];

console.log('='.repeat(70));
console.log('INPUT ROUTING TEST - How the omnibus input bar routes inputs');
console.log('='.repeat(70));
console.log();

const routeCounts: Record<string, number> = {};

for (const input of TEST_INPUTS) {
  const result = routeInput(input);
  routeCounts[result.route] = (routeCounts[result.route] || 0) + 1;

  const inputDisplay = input.length > 40 ? input.slice(0, 37) + '...' : input;
  const routeDisplay = result.route.padEnd(25);
  console.log(`"${inputDisplay.padEnd(42)}" → ${routeDisplay} (${result.reason})`);
}

console.log();
console.log('='.repeat(70));
console.log('ROUTE DISTRIBUTION');
console.log('='.repeat(70));

for (const [route, count] of Object.entries(routeCounts).sort((a, b) => b[1] - a[1])) {
  const pct = ((count / TEST_INPUTS.length) * 100).toFixed(0);
  console.log(`${route.padEnd(25)} ${count} (${pct}%)`);
}

// Identify problem cases
console.log();
console.log('='.repeat(70));
console.log('PROBLEM CASES - Inputs that go to AI_EXTRACT but should be SEARCH');
console.log('='.repeat(70));

const shouldBeSearch = [
  'porsche', 'porsche 911', 'c10', 'mustang', 'bmw', '1967 mustang', 'chevy truck',
  'cheap cars', 'project car', 'classic', 'for sale', 'near me', 'restoration',
  'asdfghjkl', '12345', 'a'
];

for (const input of shouldBeSearch) {
  const result = routeInput(input);
  if (result.route !== 'SEARCH') {
    console.log(`✗ "${input}" → ${result.route} (should be SEARCH)`);
    console.log(`  Reason: ${result.reason}`);
  }
}

console.log();
console.log('='.repeat(70));
console.log('FALSE POSITIVES - Wiring intent detection');
console.log('='.repeat(70));

const wiringFalsePositives = ['can I see porsches', 'can bus wiring', 'harness racing'];
for (const input of wiringFalsePositives) {
  if (isWiringIntent(input)) {
    console.log(`✗ "${input}" triggers wiring intent (false positive)`);
  }
}
