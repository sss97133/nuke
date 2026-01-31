#!/usr/bin/env npx tsx
/**
 * Search Page QA Test Suite
 * Tests search quality, relevance, and performance
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface SearchResult {
  id: string;
  type: string;
  title: string;
  description?: string;
  relevance_score: number;
  metadata?: Record<string, any>;
}

interface SearchResponse {
  results: SearchResult[];
  search_summary?: string;
}

interface TestCase {
  name: string;
  query: string;
  expectedTypes?: string[];
  mustContain?: string[];       // Results must contain these terms
  mustNotContain?: string[];    // Results should NOT contain these
  minResults?: number;
  maxLatencyMs?: number;
}

const TEST_CASES: TestCase[] = [
  // Exact model searches
  {
    name: "Exact model: C10",
    query: "c10",
    expectedTypes: ["vehicle"],
    mustContain: ["c10", "C10"],
    minResults: 5,
  },
  {
    name: "Exact model: Porsche 911",
    query: "porsche 911",
    expectedTypes: ["vehicle"],
    mustContain: ["911"],
    mustNotContain: ["boxster", "panamera", "cayenne"],
    minResults: 1,
  },
  {
    name: "Year + Make + Model",
    query: "1967 mustang",
    expectedTypes: ["vehicle"],
    mustContain: ["mustang", "Mustang"],
    minResults: 1,
  },
  // Organization searches
  {
    name: "Organization: Mecum",
    query: "mecum",
    expectedTypes: ["organization"],
    mustContain: ["mecum", "Mecum"],
    minResults: 1,
  },
  // Make-only searches
  {
    name: "Make only: Chevrolet",
    query: "chevrolet",
    expectedTypes: ["vehicle"],
    minResults: 10,
  },
  {
    name: "Make only: BMW",
    query: "bmw",
    expectedTypes: ["vehicle", "organization"],
    minResults: 1,
  },
  // Edge cases
  {
    name: "Empty query",
    query: "",
    minResults: 0,
  },
  {
    name: "Special characters",
    query: "c10 && drop",
    minResults: 0, // Should handle gracefully
  },
  {
    name: "VIN search",
    query: "1G1YY22G965104567", // Sample VIN format
    minResults: 0, // May or may not find
  },
  // User/org searches (may find orgs with similar names)
  {
    name: "Generic term search",
    query: "admin",
    // Could return users OR orgs depending on data
    minResults: 0,
  },
];

async function runSearch(query: string): Promise<{ response: SearchResponse | null; latencyMs: number; error?: string }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, limit: 50 }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { response: null, latencyMs, error: `HTTP ${res.status}: ${errText.slice(0, 100)}` };
    }

    const data = await res.json();
    return { response: data, latencyMs };
  } catch (err: any) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    if (err.name === 'AbortError') {
      return { response: null, latencyMs, error: 'Request timed out (30s)' };
    }
    return { response: null, latencyMs, error: err.message };
  }
}

function checkRelevance(results: SearchResult[], test: TestCase): { passed: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check minimum results
  if (test.minResults !== undefined && results.length < test.minResults) {
    issues.push(`Expected at least ${test.minResults} results, got ${results.length}`);
  }

  // Check expected types
  if (test.expectedTypes && results.length > 0) {
    const topTypes = results.slice(0, 5).map(r => r.type);
    const hasExpectedType = test.expectedTypes.some(t => topTypes.includes(t));
    if (!hasExpectedType) {
      issues.push(`Expected types [${test.expectedTypes}] in top 5, got [${topTypes}]`);
    }
  }

  // Check mustContain in top results
  if (test.mustContain && results.length > 0) {
    const top5Titles = results.slice(0, 5).map(r => r.title.toLowerCase()).join(' ');
    for (const term of test.mustContain) {
      if (!top5Titles.includes(term.toLowerCase())) {
        issues.push(`Top 5 results don't contain required term: "${term}"`);
      }
    }
  }

  // Check mustNotContain in top results
  if (test.mustNotContain && results.length > 0) {
    const top5Titles = results.slice(0, 5).map(r => r.title.toLowerCase()).join(' ');
    for (const term of test.mustNotContain) {
      if (top5Titles.includes(term.toLowerCase())) {
        issues.push(`Top 5 results incorrectly contain: "${term}"`);
      }
    }
  }

  return { passed: issues.length === 0, issues };
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('SEARCH PAGE QA TEST SUITE');
  console.log('='.repeat(60));
  console.log();

  // Warm-up request to avoid cold start affecting first test
  console.log('Warming up search function...');
  await runSearch('warmup');
  console.log('Warm-up complete.\n');

  const results: { test: TestCase; passed: boolean; issues: string[]; latencyMs: number }[] = [];
  const latencies: number[] = [];

  for (const test of TEST_CASES) {
    process.stdout.write(`Testing: ${test.name}... `);

    const { response, latencyMs, error } = await runSearch(test.query);
    latencies.push(latencyMs);

    if (error) {
      console.log(`FAIL (error: ${error})`);
      results.push({ test, passed: false, issues: [error], latencyMs });
      continue;
    }

    const searchResults = response?.results || [];
    const { passed, issues } = checkRelevance(searchResults, test);

    if (passed) {
      console.log(`PASS (${searchResults.length} results, ${latencyMs}ms)`);
    } else {
      console.log(`FAIL (${latencyMs}ms)`);
      issues.forEach(issue => console.log(`  - ${issue}`));
    }

    results.push({ test, passed, issues, latencyMs });
  }

  // Summary
  console.log();
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Tests: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log();

  // Latency stats
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  console.log('Latency:');
  console.log(`  P50: ${p50}ms`);
  console.log(`  P95: ${p95}ms`);
  console.log(`  Avg: ${avg}ms`);
  console.log();

  // Failed tests detail
  if (failed > 0) {
    console.log('FAILED TESTS:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ${r.test.name}: ${r.test.query}`);
      r.issues.forEach(issue => console.log(`    - ${issue}`));
    });
  }

  // Exit with error code if tests failed
  process.exit(failed > 0 ? 1 : 0);
}

// Check env vars
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Run with: dotenvx run -- npx tsx scripts/search-qa-tests.ts');
  process.exit(1);
}

runTests();
