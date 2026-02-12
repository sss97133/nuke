/**
 * API / MCP Landing Page
 *
 * Public-facing page for developers and AI builders.
 * Shows platform capabilities, live search demo, MCP tools, and getting started.
 *
 * Design: Nuke design system (8pt text, 0px radius, Windows 95 aesthetic).
 * Route: /api
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';
import type { UniversalSearchResult } from '../services/universalSearchService';

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const STATS = [
  { value: '810K', label: 'Vehicle Profiles' },
  { value: '625K', label: 'Observations' },
  { value: '181', label: 'Extractors' },
  { value: '34', label: 'Source Platforms' },
];

interface McpTool {
  name: string;
  description: string;
  example: string;
}

const MCP_TOOLS: McpTool[] = [
  {
    name: 'universal-search',
    description: 'Full-text search across vehicles, organizations, users, and VINs. Returns thumbnails, relevance scores, and AI suggestions.',
    example: `await supabase.functions.invoke('universal-search', {
  body: { query: '1973 Porsche 911', limit: 10 }
})
// => { results: [{ type: "vehicle", title: "1973 Porsche 911 Carrera RS", ... }] }`,
  },
  {
    name: 'api-v1-vehicles',
    description: 'Query vehicle profiles with full provenance. Filter by year, make, model, VIN, price range, body style, and more.',
    example: `curl "https://api.nuke.build/functions/v1/api-v1-vehicles?make=Porsche&year_min=1970&year_max=1975" \\
  -H "X-API-Key: nk_live_xxx"
// => { data: [{ year: 1973, make: "Porsche", model: "911", sale_price: 185000, ... }] }`,
  },
  {
    name: 'ingest-observation',
    description: 'Submit structured observations from any source. Observations are provenance-tracked, deduplicated, and linked to vehicle profiles.',
    example: `await supabase.functions.invoke('ingest-observation', {
  body: {
    source_slug: 'bat-auctions',
    kind: 'listing',
    vehicle_hint: { year: 1988, make: 'BMW', model: 'M3' },
    payload: { sale_price: 120000, url: 'https://...' }
  }
})`,
  },
  {
    name: 'extract-vehicle-data-ai',
    description: 'AI-powered extraction from any URL. Scrapes the page, identifies vehicle data, and returns structured fields with confidence scores.',
    example: `await supabase.functions.invoke('extract-vehicle-data-ai', {
  body: { url: 'https://bringatrailer.com/listing/1973-porsche-911-carrera-rs/' }
})
// => { year: 1973, make: "Porsche", model: "911 Carrera RS", vin: "...", images: [...] }`,
  },
  {
    name: 'api-v1-observations',
    description: 'Query the unified observation timeline for any vehicle. Every auction, forum post, social mention, and price signal in one feed.',
    example: `curl "https://api.nuke.build/functions/v1/api-v1-observations?vehicle_id=abc-123&limit=50" \\
  -H "X-API-Key: nk_live_xxx"
// => { data: [{ kind: "comment", source: "bat-auctions", payload: {...}, created_at: "..." }] }`,
  },
  {
    name: 'discovery-snowball',
    description: 'Recursive lead discovery. Given a seed URL or vehicle, finds related listings, forum threads, and social mentions across 34 platforms.',
    example: `await supabase.functions.invoke('discovery-snowball', {
  body: { seed_url: 'https://rennlist.com/forums/964/...', depth: 2, max_leads: 50 }
})
// => { leads_found: 23, new_vehicles: 4, observations_created: 47 }`,
  },
  {
    name: 'api-v1-valuations',
    description: 'Get Nuke Estimates for any vehicle. Returns valuation with confidence scoring, deal score, heat score, and price range.',
    example: `curl "https://api.nuke.build/functions/v1/api-v1-valuations?vin=WP0AB0916KS121279" \\
  -H "X-API-Key: nk_live_xxx"
// => { data: { estimated_value: 185000, confidence_score: 0.87, deal_score_label: "great" } }`,
  },
  {
    name: 'api-v1-listings',
    description: 'Query external auction and marketplace listings. Filter by platform (BaT, C&B, Hagerty), status, and vehicle.',
    example: `curl "https://api.nuke.build/functions/v1/api-v1-listings?platform=bat&status=sold&limit=10" \\
  -H "X-API-Key: nk_live_xxx"
// => { data: [{ platform: "bat", final_price: 56000, bid_count: 42, ... }], pagination: {...} }`,
  },
  {
    name: 'api-v1-comps',
    description: 'Find comparable vehicle sales. Returns similar sold vehicles with summary stats (avg, median, min, max prices).',
    example: `curl "https://api.nuke.build/functions/v1/api-v1-comps?make=Porsche&model=911&year=1973" \\
  -H "X-API-Key: nk_live_xxx"
// => { summary: { avg_price: 185000, median_price: 172000 }, data: [...] }`,
  },
];

/* ------------------------------------------------------------------ */
/*  Styles (inline, matching existing DevelopersPage pattern)          */
/* ------------------------------------------------------------------ */

const s = {
  page: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: 'var(--space-4)',
    fontSize: '8pt',
    fontFamily: 'Arial, sans-serif',
    color: 'var(--text)',
  },
  /* Hero */
  hero: {
    padding: 'var(--space-10) 0 var(--space-8)',
    borderBottom: '2px solid var(--border-medium)',
    marginBottom: 'var(--space-5)',
  },
  heroTitle: {
    fontSize: 'calc(14pt * var(--font-scale, 1))',
    fontWeight: 'bold' as const,
    marginBottom: 'var(--space-2)',
    letterSpacing: '-0.02em',
  },
  heroSubtitle: {
    fontSize: 'calc(9pt * var(--font-scale, 1))',
    color: 'var(--text-muted)',
    maxWidth: '560px',
    lineHeight: '1.4',
    marginBottom: 'var(--space-5)',
  },
  statRow: {
    display: 'flex',
    gap: 'var(--space-4)',
    flexWrap: 'wrap' as const,
  },
  statBox: {
    background: 'var(--grey-100)',
    border: '1px solid var(--border-light)',
    padding: 'var(--space-3) var(--space-4)',
    minWidth: '120px',
  },
  statValue: {
    fontSize: 'calc(11pt * var(--font-scale, 1))',
    fontWeight: 'bold' as const,
    fontFamily: 'monospace',
  },
  statLabel: {
    fontSize: '8pt',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  /* Section */
  section: {
    marginBottom: 'var(--space-8)',
  },
  sectionTitle: {
    fontSize: 'calc(10pt * var(--font-scale, 1))',
    fontWeight: 'bold' as const,
    marginBottom: 'var(--space-3)',
    paddingBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--border-light)',
  },
  sectionSubtitle: {
    fontSize: '8pt',
    color: 'var(--text-muted)',
    marginBottom: 'var(--space-4)',
    lineHeight: '1.4',
  },
  /* Cards */
  card: {
    background: 'var(--white)',
    border: '2px solid var(--border-medium)',
    padding: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
  },
  cardTitle: {
    fontWeight: 'bold' as const,
    fontFamily: 'monospace',
    marginBottom: 'var(--space-1)',
  },
  cardDesc: {
    color: 'var(--text-muted)',
    marginBottom: 'var(--space-2)',
    lineHeight: '1.4',
  },
  /* Code */
  codeBlock: {
    background: 'var(--grey-100)',
    border: '1px solid var(--border-light)',
    padding: 'var(--space-3)',
    fontFamily: 'monospace',
    fontSize: '8pt',
    overflow: 'auto' as const,
    whiteSpace: 'pre' as const,
    lineHeight: '1.5',
  },
  inlineCode: {
    background: 'var(--grey-200)',
    padding: '1px 4px',
    fontFamily: 'monospace',
    fontSize: '8pt',
    border: '1px solid var(--border-light)',
  },
  /* Search demo */
  searchInput: {
    width: '100%',
    padding: 'var(--space-3)',
    fontSize: 'calc(9pt * var(--font-scale, 1))',
    fontFamily: 'Arial, sans-serif',
    border: '2px solid var(--border-medium)',
    background: 'var(--white)',
    color: 'var(--text)',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  searchResult: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-3)',
    borderBottom: '1px solid var(--border-light)',
    cursor: 'default',
  },
  searchThumb: {
    width: '40px',
    height: '40px',
    background: 'var(--grey-200)',
    border: '1px solid var(--border-light)',
    objectFit: 'cover' as const,
    flexShrink: 0,
  },
  searchMeta: {
    flex: 1,
    minWidth: 0,
  },
  searchTitle: {
    fontWeight: 'bold' as const,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  },
  searchSubtitle: {
    color: 'var(--text-muted)',
    fontSize: '8pt',
  },
  typeBadge: {
    display: 'inline-block',
    padding: '1px 6px',
    fontSize: '8pt',
    fontFamily: 'monospace',
    background: 'var(--grey-200)',
    border: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  /* Buttons */
  buttonPrimary: {
    fontSize: '8pt',
    padding: 'var(--space-2) var(--space-4)',
    background: 'var(--text)',
    color: 'var(--white)',
    border: '2px solid var(--text)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    transition: 'all 0.12s ease',
  },
  buttonSecondary: {
    fontSize: '8pt',
    padding: 'var(--space-2) var(--space-4)',
    background: 'var(--grey-200)',
    border: '2px outset var(--border-light)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    transition: 'all 0.12s ease',
  },
  /* Get started */
  stepNumber: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    background: 'var(--grey-200)',
    border: '1px solid var(--border-medium)',
    fontWeight: 'bold' as const,
    fontFamily: 'monospace',
    marginRight: 'var(--space-2)',
    flexShrink: 0,
  },
  link: {
    color: 'var(--text)',
    fontWeight: 'bold' as const,
    textDecoration: 'underline',
    fontSize: '8pt',
  },
  /* Footer */
  footer: {
    marginTop: 'var(--space-8)',
    paddingTop: 'var(--space-3)',
    borderTop: '1px solid var(--border-light)',
    color: 'var(--text-muted)',
    display: 'flex',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 'var(--space-3)',
  },
} as const;

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{ position: 'relative' }}>
      <pre style={s.codeBlock}>{code}</pre>
      <button
        onClick={copy}
        style={{
          position: 'absolute',
          top: 'var(--space-2)',
          right: 'var(--space-2)',
          ...s.buttonSecondary,
          padding: '2px 8px',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function LiveSearchDemo() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UniversalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTime, setSearchTime] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearchTime(null);
      setTotalCount(0);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('universal-search', {
        body: { query: q.trim(), limit: 6, includeAI: false },
      });
      if (!error && data) {
        setResults(data.results ?? []);
        setSearchTime(data.search_time_ms ?? null);
        setTotalCount(data.total_count ?? 0);
      }
    } catch {
      // silently handle demo errors
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  // Cleanup
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
        <input
          type="text"
          placeholder="Try: 1973 Porsche 911, WBS4M9C5, Shelby Cobra..."
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          style={s.searchInput}
        />
        {loading && (
          <span style={{
            position: 'absolute',
            right: 'var(--space-3)',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            fontFamily: 'monospace',
          }}>
            ...
          </span>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div style={{ border: '2px solid var(--border-medium)', background: 'var(--white)' }}>
          {results.map((r) => (
            <div key={r.id} style={s.searchResult}>
              {r.image_url ? (
                <img
                  src={r.image_url}
                  alt=""
                  style={s.searchThumb}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div style={s.searchThumb} />
              )}
              <div style={s.searchMeta}>
                <div style={s.searchTitle}>{r.title}</div>
                {r.subtitle && <div style={s.searchSubtitle}>{r.subtitle}</div>}
              </div>
              <span style={s.typeBadge}>{r.type}</span>
            </div>
          ))}
          {/* Response metadata */}
          <div style={{
            padding: 'var(--space-2) var(--space-3)',
            color: 'var(--text-muted)',
            fontFamily: 'monospace',
            display: 'flex',
            justifyContent: 'space-between',
          }}>
            <span>{totalCount} result{totalCount !== 1 ? 's' : ''}</span>
            {searchTime !== null && <span>{searchTime}ms</span>}
          </div>
        </div>
      )}

      {query.trim() && !loading && results.length === 0 && (
        <div style={{ color: 'var(--text-muted)', padding: 'var(--space-3)' }}>
          No results. Try a year, make/model, or VIN.
        </div>
      )}
    </div>
  );
}

function ToolCard({ tool }: { tool: McpTool }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={s.card}>
      <div
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <div style={s.cardTitle}>{tool.name}</div>
          <div style={s.cardDesc}>{tool.description}</div>
        </div>
        <span style={{
          fontFamily: 'monospace',
          color: 'var(--text-muted)',
          flexShrink: 0,
          marginLeft: 'var(--space-3)',
          userSelect: 'none',
        }}>
          {expanded ? '[-]' : '[+]'}
        </span>
      </div>
      {expanded && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <CodeBlock code={tool.example} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function ApiLanding() {
  usePageTitle('Nuke API - Vehicle Intelligence for AI Agents');

  return (
    <div style={s.page}>
      {/* ---- Hero ---- */}
      <div style={s.hero}>
        <div style={s.heroTitle}>Vehicle Intelligence for AI Agents</div>
        <div style={s.heroSubtitle}>
          Structured data on 810K collector vehicles. Search by VIN, year/make/model, or natural
          language. Built for MCP, REST, and direct Supabase access.
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          <a href="#get-started">
            <button style={s.buttonPrimary}>Get Started</button>
          </a>
          <Link to="/developers">
            <button style={s.buttonSecondary}>API Reference</button>
          </Link>
        </div>
        <div style={s.statRow}>
          {STATS.map((stat) => (
            <div key={stat.label} style={s.statBox}>
              <div style={s.statValue}>{stat.value}</div>
              <div style={s.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Live Demo ---- */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Live Demo</div>
        <div style={s.sectionSubtitle}>
          This is the same <span style={s.inlineCode}>universal-search</span> endpoint your AI
          agent will call. Type anything -- VIN, year, make/model, or a natural language query.
        </div>
        <LiveSearchDemo />
        <div style={{ marginTop: 'var(--space-3)' }}>
          <CodeBlock
            code={`// What your agent sends
const { data } = await supabase.functions.invoke('universal-search', {
  body: { query: '1973 Porsche 911', limit: 10 }
});

// What it gets back
{
  "success": true,
  "results": [
    {
      "id": "a1b2c3",
      "type": "vehicle",
      "title": "1973 Porsche 911 Carrera RS 2.7",
      "subtitle": "$1,250,000",
      "image_url": "https://...",
      "relevance_score": 0.97
    }
  ],
  "query_type": "text",
  "total_count": 14,
  "search_time_ms": 42
}`}
          />
        </div>
      </div>

      {/* ---- MCP Tools ---- */}
      <div style={s.section}>
        <div style={s.sectionTitle}>MCP Tools</div>
        <div style={s.sectionSubtitle}>
          Six tools available over the Model Context Protocol. Each tool is a Supabase Edge Function
          that AI agents can call directly. Click any tool to see a code example.
        </div>

        <div style={{ marginBottom: 'var(--space-3)' }}>
          <CodeBlock
            code={`# Connect via MCP (stdio transport)
npx @anthropic/mcp-client@latest \\
  --server "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/mcp-server"`}
          />
        </div>

        {MCP_TOOLS.map((tool) => (
          <ToolCard key={tool.name} tool={tool} />
        ))}
      </div>

      {/* ---- Architecture ---- */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Architecture</div>
        <div style={s.sectionSubtitle}>
          Source-agnostic observation pipeline. Every data point has provenance.
        </div>
        <div style={s.card}>
          <pre style={{
            ...s.codeBlock,
            border: 'none',
            background: 'transparent',
            padding: 0,
            margin: 0,
          }}>
{`[Any Source]            Bring a Trailer, Cars & Bids, RM Sotheby's,
  |                     Rennlist, eBay, Craigslist, Instagram, ...
  v
ingest-observation      Normalize, deduplicate, link to vehicle profile
  |
  v
vehicle_observations    Unified event store (625K+ rows)
  |
  v
discover-from-          AI analysis: sentiment, price signals,
  observations          mechanical insights, ownership changes
  |
  v
observation_            Structured discoveries with confidence scores
  discoveries`}
          </pre>
        </div>
      </div>

      {/* ---- Get Started ---- */}
      <div id="get-started" style={s.section}>
        <div style={s.sectionTitle}>Get Started</div>

        {/* Step 1 */}
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <span style={s.stepNumber}>1</span>
            <span style={{ fontWeight: 'bold' }}>Get an API Key</span>
          </div>
          <div style={s.cardDesc}>
            Create an account and generate an API key from Settings.
            Keys are prefixed <span style={s.inlineCode}>nk_live_</span> for production
            and <span style={s.inlineCode}>nk_test_</span> for sandbox.
          </div>
          <Link to="/settings/api-keys" style={s.link}>Settings &gt; API Keys</Link>
        </div>

        {/* Step 2 */}
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <span style={s.stepNumber}>2</span>
            <span style={{ fontWeight: 'bold' }}>Install the SDK</span>
          </div>
          <div style={s.cardDesc}>
            The official TypeScript SDK follows Stripe/Plaid patterns. Includes typed resources
            for vehicles, valuations, listings, comps, observations, webhooks, and batch imports.
          </div>
          <CodeBlock
            code={`npm install @nuke/sdk

import Nuke from '@nuke/sdk';
const nuke = new Nuke('nk_live_...');

// Get comparable sales
const comps = await nuke.comps.get({ make: 'Porsche', model: '911', year: 1973 });
console.log(comps.summary); // { avg_price, median_price, min_price, max_price }

// Get a valuation
const val = await nuke.valuations.get({ vin: 'WP0AB0916KS121279' });
console.log(val.estimated_value, val.deal_score_label);`}
          />
        </div>

        {/* Step 3 */}
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <span style={s.stepNumber}>3</span>
            <span style={{ fontWeight: 'bold' }}>Make Your First Call</span>
          </div>
          <div style={s.cardDesc}>
            REST endpoints accept your key in the <span style={s.inlineCode}>X-API-Key</span> header.
            Supabase client calls use the standard anon key + JWT.
          </div>
          <CodeBlock
            code={`# Search for a vehicle
curl "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/universal-search" \\
  -X POST \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_ANON_KEY" \\
  -d '{"query": "1967 Shelby GT500", "limit": 5}'`}
          />
        </div>

        {/* Step 4 */}
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <span style={s.stepNumber}>4</span>
            <span style={{ fontWeight: 'bold' }}>Connect via MCP</span>
          </div>
          <div style={s.cardDesc}>
            For AI agents using the Model Context Protocol, connect directly to the MCP server.
            All six tools are automatically available to your agent.
          </div>
          <CodeBlock
            code={`// claude_desktop_config.json
{
  "mcpServers": {
    "nuke": {
      "command": "npx",
      "args": [
        "-y", "@anthropic/mcp-client@latest",
        "--server", "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/mcp-server"
      ]
    }
  }
}`}
          />
        </div>

        {/* Step 5 */}
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <span style={s.stepNumber}>5</span>
            <span style={{ fontWeight: 'bold' }}>Set Up Webhooks (Optional)</span>
          </div>
          <div style={s.cardDesc}>
            Get notified when new observations match your criteria. Useful for monitoring
            specific vehicles, price thresholds, or new listings from a source.
          </div>
          <Link to="/settings/webhooks" style={s.link}>Settings &gt; Webhooks</Link>
        </div>
      </div>

      {/* ---- Use Cases ---- */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Use Cases</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 'var(--space-3)',
        }}>
          {[
            {
              title: 'AI Valuation Agent',
              desc: 'Build an agent that monitors auctions, tracks comparable sales, and estimates fair market value using observation history.',
            },
            {
              title: 'Inventory Intelligence',
              desc: 'Feed dealer inventory into the observation pipeline. Get automatic market comps, price positioning, and demand signals.',
            },
            {
              title: 'Restoration Documentation',
              desc: 'Ingest photos and receipts via Telegram bot. AI extracts work type, parts, costs, and builds a verified service timeline.',
            },
            {
              title: 'Market Research',
              desc: 'Query 627K observations across 34 platforms. Analyze trends by segment, era, or specific model using structured data.',
            },
          ].map((uc) => (
            <div key={uc.title} style={s.card}>
              <div style={{ fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>{uc.title}</div>
              <div style={s.cardDesc}>{uc.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Rate Limits ---- */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Rate Limits</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
          <div style={{ ...s.statBox, textAlign: 'center' }}>
            <div style={s.statValue}>1,000</div>
            <div style={s.statLabel}>requests / hour</div>
          </div>
          <div style={{ ...s.statBox, textAlign: 'center' }}>
            <div style={s.statValue}>100</div>
            <div style={s.statLabel}>results per page</div>
          </div>
          <div style={{ ...s.statBox, textAlign: 'center' }}>
            <div style={s.statValue}>No limit</div>
            <div style={s.statLabel}>daily quota</div>
          </div>
        </div>
      </div>

      {/* ---- Footer ---- */}
      <div style={s.footer}>
        <span>Questions? support@nuke.dev</span>
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
          <Link to="/developers" style={s.link}>API Docs</Link>
          <Link to="/settings/api-keys" style={s.link}>API Keys</Link>
          <Link to="/settings/webhooks" style={s.link}>Webhooks</Link>
          <Link to="/settings/usage" style={s.link}>Usage</Link>
        </div>
      </div>
    </div>
  );
}
