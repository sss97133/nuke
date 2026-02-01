#!/usr/bin/env npx tsx
/**
 * UX Test Agents - Synthetic users that try to use the site and find walls
 *
 * Each agent has a persona, goals, and tries to accomplish tasks.
 * Reports friction, failures, confusion points.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface TestResult {
  agent: string;
  task: string;
  action: string;
  success: boolean;
  latencyMs: number;
  issue?: string;
  details?: any;
}

interface AgentPersona {
  name: string;
  description: string;
  tasks: AgentTask[];
}

interface AgentTask {
  name: string;
  actions: AgentAction[];
}

interface AgentAction {
  type: 'search' | 'navigate' | 'api_call' | 'expect';
  input?: string;
  endpoint?: string;
  body?: any;
  expectation?: {
    minResults?: number;
    maxLatencyMs?: number;
    shouldContain?: string[];
    shouldNotContain?: string[];
    resultType?: string;
  };
}

const results: TestResult[] = [];

// ============================================================================
// TEST PERSONAS
// ============================================================================

const PERSONAS: AgentPersona[] = [
  {
    name: "Car Shopper - Looking for Porsche",
    description: "Wants to find a Porsche 911 for sale",
    tasks: [
      {
        name: "Find Porsche 911s",
        actions: [
          {
            type: 'search',
            input: 'porsche 911',
            expectation: {
              minResults: 1,
              maxLatencyMs: 3000,
              shouldContain: ['911'],
              shouldNotContain: ['boxster', 'cayenne', 'panamera']
            }
          },
          {
            type: 'search',
            input: 'porsche 911 for sale',
            expectation: { minResults: 0, maxLatencyMs: 3000 }
          },
          {
            type: 'search',
            input: '911 turbo',
            expectation: { minResults: 0, maxLatencyMs: 3000 }
          }
        ]
      }
    ]
  },
  {
    name: "Car Shopper - Looking for C10",
    description: "Wants to find a Chevy C10 truck",
    tasks: [
      {
        name: "Find C10 trucks",
        actions: [
          {
            type: 'search',
            input: 'c10',
            expectation: { minResults: 5, maxLatencyMs: 3000 }
          },
          {
            type: 'search',
            input: 'chevy c10',
            expectation: { minResults: 5, maxLatencyMs: 3000 }
          },
          {
            type: 'search',
            input: '1972 c10',
            expectation: { minResults: 1, maxLatencyMs: 3000 }
          },
          {
            type: 'search',
            input: 'squarebody',
            expectation: { minResults: 0, maxLatencyMs: 3000 }
          }
        ]
      }
    ]
  },
  {
    name: "Auction Researcher",
    description: "Wants to find auction data from major houses",
    tasks: [
      {
        name: "Find Mecum data",
        actions: [
          {
            type: 'search',
            input: 'mecum',
            expectation: { minResults: 1, maxLatencyMs: 5000, resultType: 'organization' }
          },
          {
            type: 'search',
            input: 'mecum kissimmee',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'mecum 2024',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          }
        ]
      },
      {
        name: "Find BaT data",
        actions: [
          {
            type: 'search',
            input: 'bring a trailer',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'bat',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          }
        ]
      }
    ]
  },
  {
    name: "VIN Lookup User",
    description: "Has a VIN and wants to find the vehicle",
    tasks: [
      {
        name: "Search by VIN",
        actions: [
          {
            type: 'search',
            input: '1G1YY22G965104567',  // Sample VIN format
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'vin 1G1YY22G965104567',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          }
        ]
      }
    ]
  },
  {
    name: "Natural Language Questioner",
    description: "Asks questions in plain English",
    tasks: [
      {
        name: "Ask questions",
        actions: [
          {
            type: 'search',
            input: 'what porsches are for sale',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'show me all c10s',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'how many mustangs are there',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'find me a cheap project car',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          }
        ]
      }
    ]
  },
  {
    name: "Typo User",
    description: "Makes spelling mistakes",
    tasks: [
      {
        name: "Search with typos",
        actions: [
          {
            type: 'search',
            input: 'porche',  // Common misspelling
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'chevorlet',  // Common misspelling
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'mustand',  // Common misspelling
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'camero',  // Common misspelling
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          }
        ]
      }
    ]
  },
  {
    name: "Shop/Service Finder",
    description: "Looking for shops and services",
    tasks: [
      {
        name: "Find shops",
        actions: [
          {
            type: 'search',
            input: 'restoration shop',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'mechanic',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'ls swap',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          }
        ]
      }
    ]
  },
  {
    name: "Year Range Searcher",
    description: "Searching by year or era",
    tasks: [
      {
        name: "Search by year",
        actions: [
          {
            type: 'search',
            input: '1967',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: '1967 mustang',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: '60s muscle car',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'classic cars',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          }
        ]
      }
    ]
  },
  {
    name: "Price Conscious Buyer",
    description: "Looking for vehicles by price",
    tasks: [
      {
        name: "Search by price intent",
        actions: [
          {
            type: 'search',
            input: 'under 50000',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'cheap project',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'affordable classic',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          }
        ]
      }
    ]
  },
  {
    name: "Empty/Edge Case User",
    description: "Tests edge cases",
    tasks: [
      {
        name: "Edge case queries",
        actions: [
          {
            type: 'search',
            input: '',
            expectation: { minResults: 0, maxLatencyMs: 1000 }
          },
          {
            type: 'search',
            input: '   ',
            expectation: { minResults: 0, maxLatencyMs: 1000 }
          },
          {
            type: 'search',
            input: 'a',
            expectation: { minResults: 0, maxLatencyMs: 3000 }
          },
          {
            type: 'search',
            input: 'the',
            expectation: { minResults: 0, maxLatencyMs: 3000 }
          },
          {
            type: 'search',
            input: '!@#$%^&*()',
            expectation: { minResults: 0, maxLatencyMs: 3000 }
          }
        ]
      }
    ]
  },
  {
    name: "Specific Vehicle Hunter",
    description: "Looking for very specific vehicles",
    tasks: [
      {
        name: "Specific searches",
        actions: [
          {
            type: 'search',
            input: '1969 camaro z28',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'e30 m3',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: '240z',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          },
          {
            type: 'search',
            input: 'ferrari 308',
            expectation: { minResults: 0, maxLatencyMs: 5000 }
          }
        ]
      }
    ]
  }
];

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runSearch(query: string): Promise<{ data: any; latencyMs: number; error?: string }> {
  const start = Date.now();

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, limit: 50 }),
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return { data: null, latencyMs, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { data, latencyMs };
  } catch (err: any) {
    return { data: null, latencyMs: Date.now() - start, error: err.message };
  }
}

async function runAction(agent: string, task: string, action: AgentAction): Promise<TestResult> {
  if (action.type === 'search') {
    const { data, latencyMs, error } = await runSearch(action.input || '');

    const result: TestResult = {
      agent,
      task,
      action: `search: "${action.input}"`,
      success: true,
      latencyMs,
      details: {
        resultCount: data?.results?.length || 0,
        types: data?.results?.map((r: any) => r.type) || [],
        topTitles: data?.results?.slice(0, 3).map((r: any) => r.title) || []
      }
    };

    if (error) {
      result.success = false;
      result.issue = `Error: ${error}`;
      return result;
    }

    const exp = action.expectation;
    if (exp) {
      const resultCount = data?.results?.length || 0;
      const topTitles = (data?.results?.slice(0, 5) || []).map((r: any) => r.title.toLowerCase()).join(' ');

      // Check min results
      if (exp.minResults !== undefined && resultCount < exp.minResults) {
        result.success = false;
        result.issue = `Expected at least ${exp.minResults} results, got ${resultCount}`;
      }

      // Check latency
      if (exp.maxLatencyMs !== undefined && latencyMs > exp.maxLatencyMs) {
        result.success = false;
        result.issue = (result.issue ? result.issue + '; ' : '') +
          `Too slow: ${latencyMs}ms (max ${exp.maxLatencyMs}ms)`;
      }

      // Check shouldContain
      if (exp.shouldContain) {
        for (const term of exp.shouldContain) {
          if (!topTitles.includes(term.toLowerCase())) {
            result.success = false;
            result.issue = (result.issue ? result.issue + '; ' : '') +
              `Top results missing "${term}"`;
          }
        }
      }

      // Check shouldNotContain
      if (exp.shouldNotContain) {
        for (const term of exp.shouldNotContain) {
          if (topTitles.includes(term.toLowerCase())) {
            result.success = false;
            result.issue = (result.issue ? result.issue + '; ' : '') +
              `Top results incorrectly contain "${term}"`;
          }
        }
      }
    }

    return result;
  }

  return {
    agent,
    task,
    action: action.type,
    success: false,
    latencyMs: 0,
    issue: `Unknown action type: ${action.type}`
  };
}

async function runAgentTests() {
  console.log('='.repeat(70));
  console.log('UX TEST AGENTS - Simulating Real User Behavior');
  console.log('='.repeat(70));
  console.log();

  // Warm up
  console.log('Warming up...');
  await runSearch('warmup');
  console.log();

  for (const persona of PERSONAS) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`AGENT: ${persona.name}`);
    console.log(`       ${persona.description}`);
    console.log('─'.repeat(70));

    for (const task of persona.tasks) {
      console.log(`\n  Task: ${task.name}`);

      for (const action of task.actions) {
        const result = await runAction(persona.name, task.name, action);
        results.push(result);

        const status = result.success ? '✓' : '✗';
        const latency = `${result.latencyMs}ms`.padStart(6);
        const count = `${result.details?.resultCount || 0} results`.padStart(12);

        if (result.success) {
          console.log(`    ${status} ${latency} ${count}  "${action.input}"`);
        } else {
          console.log(`    ${status} ${latency} ${count}  "${action.input}"`);
          console.log(`      └─ ISSUE: ${result.issue}`);
        }
      }
    }
  }

  // Generate summary
  console.log('\n');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const passed = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\nTotal Tests: ${results.length}`);
  console.log(`Passed: ${passed.length} (${(passed.length / results.length * 100).toFixed(0)}%)`);
  console.log(`Failed: ${failed.length} (${(failed.length / results.length * 100).toFixed(0)}%)`);

  // Latency stats
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  console.log(`\nLatency:`);
  console.log(`  P50: ${p50}ms`);
  console.log(`  P95: ${p95}ms`);
  console.log(`  Avg: ${avg}ms`);

  // Issue breakdown
  if (failed.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log('ISSUES BY CATEGORY');
    console.log('─'.repeat(70));

    const issueTypes: Record<string, TestResult[]> = {};
    for (const r of failed) {
      const issueType = r.issue?.split(':')[0] || 'Unknown';
      if (!issueTypes[issueType]) issueTypes[issueType] = [];
      issueTypes[issueType].push(r);
    }

    for (const [type, issues] of Object.entries(issueTypes)) {
      console.log(`\n${type}: ${issues.length} issues`);
      for (const issue of issues.slice(0, 5)) {
        console.log(`  - [${issue.agent}] ${issue.action}`);
        console.log(`    ${issue.issue}`);
      }
      if (issues.length > 5) {
        console.log(`  ... and ${issues.length - 5} more`);
      }
    }
  }

  // Zero result searches
  const zeroResults = results.filter(r => r.details?.resultCount === 0 && r.success);
  if (zeroResults.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log('SEARCHES WITH ZERO RESULTS (potential data gaps)');
    console.log('─'.repeat(70));
    for (const r of zeroResults) {
      console.log(`  - "${r.action.replace('search: ', '').replace(/"/g, '')}"`);
    }
  }

  // Slow searches
  const slowSearches = results.filter(r => r.latencyMs > 5000);
  if (slowSearches.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log('SLOW SEARCHES (>5s)');
    console.log('─'.repeat(70));
    for (const r of slowSearches.sort((a, b) => b.latencyMs - a.latencyMs)) {
      console.log(`  - ${r.latencyMs}ms: "${r.action.replace('search: ', '').replace(/"/g, '')}"`);
    }
  }

  console.log('\n');
}

runAgentTests().catch(console.error);
