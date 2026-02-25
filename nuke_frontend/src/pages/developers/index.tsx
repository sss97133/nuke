/**
 * Nuke Developer Documentation Hub
 *
 * Comprehensive API documentation for building with Nuke.
 * Covers: REST API, MCP Server, Batch Import, Observations,
 * Extraction, Valuations, Business Data API, Webhooks.
 *
 * Design: Nuke design system (8pt text, 0px radius, Windows 95 aesthetic).
 * Routes: /developers, /docs/api, /docs/*
 */

import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SUPABASE_URL } from '../../lib/env';

const API_BASE = `${SUPABASE_URL}/functions/v1`;

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const s = {
  layout: {
    display: 'flex',
    maxWidth: '1100px',
    margin: '0 auto',
    fontSize: '8pt',
    fontFamily: 'Arial, sans-serif',
    color: 'var(--text)',
    minHeight: 'calc(100vh - 60px)',
  },
  sidebar: {
    width: '200px',
    flexShrink: 0,
    borderRight: '1px solid var(--border-light)',
    padding: 'var(--space-4) var(--space-3)',
    position: 'sticky' as const,
    top: '60px',
    height: 'calc(100vh - 60px)',
    overflowY: 'auto' as const,
  },
  sidebarGroup: {
    marginBottom: 'var(--space-4)',
  },
  sidebarLabel: {
    fontSize: '7pt',
    fontWeight: 'bold' as const,
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 'var(--space-2)',
  },
  sidebarLink: (active: boolean) => ({
    display: 'block',
    fontSize: '8pt',
    padding: '3px var(--space-2)',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    fontWeight: active ? 'bold' as const : 'normal' as const,
    background: active ? 'var(--grey-100)' : 'transparent',
    border: active ? '1px solid var(--border-light)' : '1px solid transparent',
    cursor: 'pointer',
    textDecoration: 'none',
    marginBottom: '2px',
  }),
  content: {
    flex: 1,
    padding: 'var(--space-4) var(--space-5)',
    maxWidth: '800px',
    overflowY: 'auto' as const,
  },
  h1: {
    fontSize: '12pt',
    fontWeight: 'bold' as const,
    marginBottom: 'var(--space-2)',
  },
  h2: {
    fontSize: '10pt',
    fontWeight: 'bold' as const,
    marginBottom: 'var(--space-2)',
    marginTop: 'var(--space-6)',
    paddingBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--border-light)',
  },
  h3: {
    fontSize: '9pt',
    fontWeight: 'bold' as const,
    marginBottom: 'var(--space-2)',
    marginTop: 'var(--space-4)',
  },
  p: {
    color: 'var(--text-muted)',
    lineHeight: '1.5',
    marginBottom: 'var(--space-3)',
  },
  code: {
    background: 'var(--grey-100)',
    border: '1px solid var(--border-light)',
    padding: 'var(--space-3)',
    fontFamily: 'monospace',
    fontSize: '8pt',
    overflow: 'auto' as const,
    whiteSpace: 'pre' as const,
    lineHeight: '1.5',
    marginBottom: 'var(--space-3)',
  },
  inlineCode: {
    background: 'var(--grey-200)',
    padding: '1px 4px',
    fontFamily: 'monospace',
    fontSize: '8pt',
    border: '1px solid var(--border-light)',
  },
  card: {
    background: 'var(--white)',
    border: '2px solid var(--border-medium)',
    padding: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
  },
  methodBadge: (method: string) => ({
    display: 'inline-block',
    padding: '2px 6px',
    fontSize: '8pt',
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    background: method === 'GET' ? '#e8f5e9' : method === 'POST' ? '#e3f2fd' : method === 'PATCH' ? '#fff3e0' : method === 'DELETE' ? '#ffebee' : 'var(--grey-100)',
    border: '1px solid var(--border-medium)',
    marginRight: 'var(--space-2)',
  }),
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '8pt',
    marginBottom: 'var(--space-3)',
  },
  th: {
    textAlign: 'left' as const,
    padding: 'var(--space-2)',
    borderBottom: '2px solid var(--border-medium)',
    fontWeight: 'bold' as const,
    background: 'var(--grey-50)',
  },
  td: {
    padding: 'var(--space-2)',
    borderBottom: '1px solid var(--border-light)',
    verticalAlign: 'top' as const,
  },
  note: {
    background: 'var(--grey-50)',
    border: '1px solid var(--border-light)',
    borderLeft: '3px solid var(--text-muted)',
    padding: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
    color: 'var(--text-muted)',
    lineHeight: '1.4',
  },
  buttonPrimary: {
    fontSize: '8pt',
    padding: 'var(--space-2) var(--space-4)',
    background: 'var(--text)',
    color: 'var(--white)',
    border: '2px solid var(--text)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
  },
  buttonSecondary: {
    fontSize: '8pt',
    padding: 'var(--space-2) var(--space-4)',
    background: 'var(--grey-200)',
    border: '2px outset var(--border-light)',
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  endpoint: {
    padding: 'var(--space-3)',
    border: '2px solid var(--border-medium)',
    marginBottom: 'var(--space-4)',
    background: 'var(--white)',
  },
  endpointHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-2)',
    fontFamily: 'monospace',
    fontSize: '9pt',
  },
  paramRequired: {
    color: '#d13438',
    fontSize: '7pt',
    fontWeight: 'bold' as const,
  },
  paramOptional: {
    color: 'var(--text-muted)',
    fontSize: '7pt',
  },
};

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
      {title && (
        <div style={{
          fontSize: '7pt',
          color: 'var(--text-muted)',
          background: 'var(--grey-200)',
          border: '1px solid var(--border-light)',
          borderBottom: 'none',
          padding: '3px var(--space-3)',
          fontFamily: 'monospace',
        }}>
          {title}
        </div>
      )}
      <pre style={{ ...s.code, marginBottom: 0 }}>{code}</pre>
      <button
        onClick={copy}
        style={{
          position: 'absolute',
          top: title ? '24px' : 'var(--space-2)',
          right: 'var(--space-2)',
          ...s.buttonSecondary,
          padding: '2px 8px',
          fontSize: '7pt',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function ParamTable({ params }: { params: { name: string; type: string; required?: boolean; description: string }[] }) {
  return (
    <table style={s.table}>
      <thead>
        <tr>
          <th style={s.th}>Parameter</th>
          <th style={s.th}>Type</th>
          <th style={s.th}>Description</th>
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={p.name}>
            <td style={s.td}>
              <code style={s.inlineCode}>{p.name}</code>{' '}
              {p.required ? (
                <span style={s.paramRequired}>required</span>
              ) : (
                <span style={s.paramOptional}>optional</span>
              )}
            </td>
            <td style={{ ...s.td, fontFamily: 'monospace' }}>{p.type}</td>
            <td style={s.td}>{p.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ */
/*  Section definitions                                                */
/* ------------------------------------------------------------------ */

const SECTIONS = [
  { id: 'overview', label: 'Overview', group: 'Getting Started' },
  { id: 'quickstart', label: 'Quickstart', group: 'Getting Started' },
  { id: 'authentication', label: 'Authentication', group: 'Getting Started' },
  { id: 'vehicles', label: 'Vehicles', group: 'REST API' },
  { id: 'vin-lookup', label: 'VIN Lookup', group: 'REST API' },
  { id: 'vehicle-history', label: 'Vehicle History', group: 'REST API' },
  { id: 'vehicle-auction', label: 'Vehicle Auction', group: 'REST API' },
  { id: 'market-trends', label: 'Market Trends', group: 'REST API' },
  { id: 'search', label: 'Search', group: 'REST API' },
  { id: 'batch', label: 'Batch Import', group: 'REST API' },
  { id: 'observations', label: 'Observations', group: 'REST API' },
  { id: 'extraction', label: 'Extraction', group: 'REST API' },
  { id: 'valuations', label: 'Valuations', group: 'REST API' },
  { id: 'business', label: 'Business Data', group: 'REST API' },
  { id: 'mcp', label: 'MCP Server', group: 'Integrations' },
  { id: 'webhooks', label: 'Webhooks', group: 'Integrations' },
  { id: 'errors', label: 'Errors & Limits', group: 'Reference' },
  { id: 'changelog', label: 'Changelog', group: 'Reference' },
];

/* ------------------------------------------------------------------ */
/*  Sections                                                           */
/* ------------------------------------------------------------------ */

function OverviewSection() {
  return (
    <div>
      <h1 style={s.h1}>Nuke Developer Documentation</h1>
      <p style={s.p}>
        Nuke is a vehicle intelligence platform with data on 938K+ collector and enthusiast vehicles.
        Every data point has provenance tracking and confidence scores. Build apps that search, analyze,
        value, and extract vehicle data from 34+ source platforms.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
        {[
          { value: '938K+', label: 'Vehicles' },
          { value: '625K+', label: 'Observations' },
          { value: '507K+', label: 'Valuations' },
          { value: '30M+', label: 'Images' },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: 'var(--grey-100)',
            border: '1px solid var(--border-light)',
            padding: 'var(--space-3)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '10pt', fontWeight: 'bold', fontFamily: 'monospace' }}>{stat.value}</div>
            <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <h2 style={s.h2}>What You Can Build</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        {[
          { title: 'AI Valuation Agent', desc: 'Build agents that estimate fair market value using 8 signal sources — comparables, sentiment, rarity, bid curves, and more.' },
          { title: 'Inventory Intelligence', desc: 'Feed dealer or shop inventory into the platform. Get automatic market comps, price positioning, and demand signals.' },
          { title: 'Restoration Tracker', desc: 'Ingest photos and receipts via the Business Data API. AI extracts work type, parts, costs, and builds a service timeline.' },
          { title: 'Market Research Tool', desc: 'Query 625K+ observations across 34 platforms. Analyze trends by segment, era, or specific model with structured data.' },
          { title: 'Listing Extractor', desc: 'Point the AI extraction endpoint at any car listing URL. Get structured year/make/model/price/images data back.' },
          { title: 'MCP-Powered Chat', desc: 'Connect any AI agent to the Nuke MCP server. Give your chatbot instant access to vehicle search, valuation, and identification.' },
        ].map((item) => (
          <div key={item.title} style={s.card}>
            <div style={{ fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>{item.title}</div>
            <div style={{ color: 'var(--text-muted)', lineHeight: '1.4' }}>{item.desc}</div>
          </div>
        ))}
      </div>

      <h2 style={s.h2}>API Surface</h2>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Endpoint</th>
            <th style={s.th}>Purpose</th>
            <th style={s.th}>Auth</th>
          </tr>
        </thead>
        <tbody>
          {[
            { path: '/api-v1-vin-lookup/:vin', purpose: 'One-call vehicle profile by VIN', auth: 'Required' },
            { path: '/api-v1-vehicle-history/:vin', purpose: 'Observation timeline for a vehicle', auth: 'Required' },
            { path: '/api-v1-vehicle-auction/:vin', purpose: 'Auction results + sentiment', auth: 'Required' },
            { path: '/api-v1-market-trends', purpose: 'Price trends by make/model/year', auth: 'Required' },
            { path: '/api-v1-search', purpose: 'Full-text search (v1 wrapper)', auth: 'Required' },
            { path: '/api-v1-vehicles', purpose: 'CRUD operations on vehicles', auth: 'Required' },
            { path: '/api-v1-batch', purpose: 'Bulk import up to 1,000 vehicles', auth: 'Required' },
            { path: '/api-v1-observations', purpose: 'Query and submit observation events', auth: 'Required' },
            { path: '/extract-vehicle-data-ai', purpose: 'AI extraction from any listing URL', auth: 'Optional' },
            { path: '/compute-vehicle-valuation', purpose: 'AI-powered vehicle valuation', auth: 'Required' },
            { path: '/api-v1-business-data', purpose: 'Business/shop dashboard data', auth: 'Required' },
            { path: '/db-stats', purpose: 'Database overview statistics', auth: 'None' },
          ].map((ep) => (
            <tr key={ep.path}>
              <td style={{ ...s.td, fontFamily: 'monospace' }}>{ep.path}</td>
              <td style={s.td}>{ep.purpose}</td>
              <td style={s.td}>{ep.auth}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuickstartSection() {
  return (
    <div>
      <h1 style={s.h1}>Quickstart</h1>
      <p style={s.p}>Get up and running in under 5 minutes. Choose your integration path:</p>

      <h2 style={s.h2}>Option A: REST API</h2>

      <h3 style={s.h3}>1. Get an API Key</h3>
      <p style={s.p}>
        Sign up at <Link to="/" style={{ color: 'var(--text)', fontWeight: 'bold' }}>Nuke</Link> and
        generate a key from <Link to="/settings/api-keys" style={{ color: 'var(--text)', fontWeight: 'bold' }}>Settings &gt; API Keys</Link>.
        Keys are prefixed <code style={s.inlineCode}>nk_live_</code>.
      </p>

      <h3 style={s.h3}>2. Search for a Vehicle</h3>
      <CodeBlock
        title="Request"
        code={`curl -X POST "${API_BASE}/universal-search" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: nk_live_your_key_here" \\
  -d '{"query": "1973 Porsche 911", "limit": 5}'`}
      />
      <CodeBlock
        title="Response"
        code={`{
  "success": true,
  "results": [
    {
      "id": "a1b2c3d4-...",
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

      <h3 style={s.h3}>3. Get Vehicle Details</h3>
      <CodeBlock
        title="Request"
        code={`curl "${API_BASE}/api-v1-vehicles/a1b2c3d4-..." \\
  -H "X-API-Key: nk_live_your_key_here"`}
      />
      <CodeBlock
        title="Response"
        code={`{
  "data": {
    "id": "a1b2c3d4-...",
    "year": 1973,
    "make": "Porsche",
    "model": "911 Carrera RS 2.7",
    "vin": "9113600xxx",
    "mileage": 42000,
    "color": "Grand Prix White",
    "transmission": "Manual",
    "engine_type": "2.7L Flat-6",
    "sale_price": 1250000,
    "primary_image_url": "https://...",
    "created_at": "2025-12-15T..."
  }
}`}
      />

      <h3 style={s.h3}>4. Extract from a Listing URL</h3>
      <CodeBlock
        title="Request"
        code={`curl -X POST "${API_BASE}/extract-vehicle-data-ai" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://bringatrailer.com/listing/1988-porsche-911-turbo-4/"}'`}
      />
      <CodeBlock
        title="Response"
        code={`{
  "success": true,
  "data": {
    "year": 1988,
    "make": "Porsche",
    "model": "911 Turbo",
    "vin": "WP0JB0934JS050xxx",
    "mileage": 37000,
    "price": 165000,
    "exterior_color": "Guards Red",
    "transmission": "Manual",
    "engine": "3.3L Turbocharged Flat-6",
    "image_urls": ["https://...", "https://..."]
  },
  "confidence": 0.94,
  "source": "bringatrailer.com",
  "extractionMethod": "dedicated_extractor"
}`}
      />

      <h2 style={s.h2}>Option B: MCP Server (AI Agents)</h2>
      <p style={s.p}>
        If you're building with Claude, GPT, or any MCP-compatible AI agent, connect the Nuke MCP server
        to give your agent direct access to vehicle intelligence tools.
      </p>

      <h3 style={s.h3}>1. Install</h3>
      <CodeBlock code="npx -y @sss97133/nuke-mcp-server" />

      <h3 style={s.h3}>2. Configure</h3>
      <CodeBlock
        title="claude_desktop_config.json"
        code={`{
  "mcpServers": {
    "nuke": {
      "command": "npx",
      "args": ["-y", "@sss97133/nuke-mcp-server"],
      "env": {
        "NUKE_API_KEY": "nk_live_your_key_here"
      }
    }
  }
}`}
      />

      <h3 style={s.h3}>3. Use It</h3>
      <p style={s.p}>
        Ask your AI agent anything about vehicles. It will automatically call the right Nuke tools:
      </p>
      <div style={s.note}>
        "What's a 1967 Shelby GT500 worth?"<br />
        "Identify the car in this photo"<br />
        "Find all Porsche 911s sold above $200K"<br />
        "Extract the listing at bringatrailer.com/listing/..."
      </div>

      <h2 style={s.h2}>Option C: TypeScript SDK</h2>
      <p style={s.p}>
        The official Nuke SDK follows Stripe/Plaid patterns. Install with npm:
      </p>
      <CodeBlock
        title="Install"
        code="npm install @nuke1/sdk"
      />
      <CodeBlock
        title="Usage"
        code={`import Nuke from '@nuke1/sdk';

const nuke = new Nuke('nk_live_your_key_here');

// VIN Lookup — full profile in one call
const profile = await nuke.vinLookup.get('WP0AB0916KS121279');
console.log(profile.valuation?.estimated_value);

// Search
const results = await nuke.search.query({ q: 'porsche 911 turbo' });

// Market Trends
const trends = await nuke.marketTrends.get({
  make: 'Porsche', model: '911', period: '1y'
});
console.log(trends.summary.trend_direction);

// Vehicle History
const history = await nuke.vehicleHistory.list('WP0AB0916KS121279');

// Auction Data + Sentiment
const auction = await nuke.vehicleAuction.get('WP0AB0916KS121279');
console.log(auction.sentiment?.overall);

// CRUD operations
const vehicle = await nuke.vehicles.create({
  year: 1988, make: 'Porsche', model: '911 Turbo'
});`}
      />
    </div>
  );
}

function AuthenticationSection() {
  return (
    <div>
      <h1 style={s.h1}>Authentication</h1>
      <p style={s.p}>
        Nuke supports three authentication methods. Choose based on your use case:
      </p>

      <h2 style={s.h2}>API Key</h2>
      <p style={s.p}>
        Best for server-to-server integrations and scripts. Generate keys from{' '}
        <Link to="/settings/api-keys" style={{ color: 'var(--text)', fontWeight: 'bold' }}>Settings &gt; API Keys</Link>.
      </p>
      <CodeBlock
        title="Header format"
        code={`X-API-Key: nk_live_xxxxxxxxxxxxxxxxxxxxx`}
      />
      <CodeBlock
        title="Example"
        code={`curl "${API_BASE}/api-v1-vehicles?limit=10" \\
  -H "X-API-Key: nk_live_your_key_here"`}
      />
      <div style={s.note}>
        API keys are hashed (SHA-256) before storage. The plaintext key is only shown once at creation.
        If lost, revoke and create a new one.
      </div>

      <h2 style={s.h2}>Bearer Token (JWT)</h2>
      <p style={s.p}>
        Best for browser-based apps and user-scoped operations. Obtain a JWT by signing in through Supabase Auth.
      </p>
      <CodeBlock
        title="Header format"
        code={`Authorization: Bearer eyJhbGciOiJIUzI1NiIs...`}
      />
      <CodeBlock
        title="Getting a token"
        code={`import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, ANON_KEY)

// Sign in
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
})

// Use the access token
const token = session.access_token

fetch(\`\${API_BASE}/api-v1-vehicles\`, {
  headers: { 'Authorization': \`Bearer \${token}\` }
})`}
      />

      <h2 style={s.h2}>Anon Key (Public Endpoints)</h2>
      <p style={s.p}>
        Some endpoints like <code style={s.inlineCode}>universal-search</code> and{' '}
        <code style={s.inlineCode}>db-stats</code> work with just the Supabase anon key.
        No user authentication needed.
      </p>
      <CodeBlock
        code={`curl -X POST "${API_BASE}/universal-search" \\
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "porsche 911"}'`}
      />

      <h2 style={s.h2}>Permissions</h2>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Endpoint</th>
            <th style={s.th}>Anon Key</th>
            <th style={s.th}>API Key</th>
            <th style={s.th}>JWT</th>
          </tr>
        </thead>
        <tbody>
          {[
            { ep: 'api-v1-vin-lookup', anon: '-', api: 'Read', jwt: 'Read' },
            { ep: 'api-v1-vehicle-history', anon: '-', api: 'Read', jwt: 'Read' },
            { ep: 'api-v1-vehicle-auction', anon: '-', api: 'Read', jwt: 'Read' },
            { ep: 'api-v1-market-trends', anon: '-', api: 'Read', jwt: 'Read' },
            { ep: 'api-v1-search', anon: '-', api: 'Read', jwt: 'Read' },
            { ep: 'api-v1-vehicles', anon: 'Read', api: 'CRUD', jwt: 'CRUD (own)' },
            { ep: 'api-v1-batch', anon: '-', api: 'Write', jwt: 'Write' },
            { ep: 'api-v1-observations', anon: 'Read', api: 'Read/Write', jwt: 'Read/Write' },
            { ep: 'extract-vehicle-data-ai', anon: 'Read', api: 'Read', jwt: 'Read' },
            { ep: 'compute-vehicle-valuation', anon: '-', api: 'Read', jwt: '-' },
            { ep: 'api-v1-business-data', anon: '-', api: 'Read', jwt: 'Read (own org)' },
            { ep: 'db-stats', anon: 'Read', api: 'Read', jwt: 'Read' },
          ].map((row) => (
            <tr key={row.ep}>
              <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.ep}</td>
              <td style={s.td}>{row.anon}</td>
              <td style={s.td}>{row.api}</td>
              <td style={s.td}>{row.jwt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VehiclesSection() {
  return (
    <div>
      <h1 style={s.h1}>Vehicles API</h1>
      <p style={s.p}>
        Full CRUD operations on vehicle profiles. Vehicles are the core entity — everything else
        (observations, valuations, images) links back to a vehicle record.
      </p>

      {/* GET list */}
      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-vehicles</span>
        </div>
        <p style={s.p}>List vehicles with pagination. Returns public vehicles by default, or your own with <code style={s.inlineCode}>mine=true</code>.</p>

        <ParamTable params={[
          { name: 'page', type: 'number', description: 'Page number (default: 1)' },
          { name: 'limit', type: 'number', description: 'Results per page, 1-100 (default: 20)' },
          { name: 'mine', type: 'boolean', description: 'Filter to authenticated user\'s vehicles' },
        ]} />

        <CodeBlock
          title="Example"
          code={`curl "${API_BASE}/api-v1-vehicles?page=1&limit=5&mine=true" \\
  -H "X-API-Key: nk_live_xxx"`}
        />

        <CodeBlock
          title="Response"
          code={`{
  "data": [
    {
      "id": "uuid-1",
      "year": 1988,
      "make": "Porsche",
      "model": "911 Turbo",
      "vin": "WP0JB093...",
      "mileage": 37000,
      "color": "Guards Red",
      "sale_price": 165000,
      "primary_image_url": "https://...",
      "is_public": true,
      "created_at": "2026-01-15T..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 42,
    "pages": 9
  }
}`}
        />
      </div>

      {/* GET single */}
      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-vehicles/:id</span>
        </div>
        <p style={s.p}>Get a single vehicle by UUID. Returns the full vehicle profile including all fields.</p>
        <CodeBlock
          title="Example"
          code={`curl "${API_BASE}/api-v1-vehicles/a1b2c3d4-e5f6-..." \\
  -H "X-API-Key: nk_live_xxx"`}
        />
      </div>

      {/* POST create */}
      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('POST')}>POST</span>
          <span>/api-v1-vehicles</span>
        </div>
        <p style={s.p}>Create a new vehicle. At least one of <code style={s.inlineCode}>year</code>, <code style={s.inlineCode}>make</code>, <code style={s.inlineCode}>model</code>, or <code style={s.inlineCode}>vin</code> is required.</p>

        <ParamTable params={[
          { name: 'year', type: 'number', description: 'Model year (1886-2028)' },
          { name: 'make', type: 'string', description: 'Manufacturer (e.g., "Porsche")' },
          { name: 'model', type: 'string', description: 'Model name (e.g., "911 Turbo")' },
          { name: 'trim', type: 'string', description: 'Trim level' },
          { name: 'vin', type: 'string', description: 'Vehicle Identification Number (17 chars)' },
          { name: 'mileage', type: 'number', description: 'Current odometer reading' },
          { name: 'color', type: 'string', description: 'Exterior color' },
          { name: 'interior_color', type: 'string', description: 'Interior color' },
          { name: 'transmission', type: 'string', description: '"Manual", "Automatic", etc.' },
          { name: 'engine_type', type: 'string', description: 'Engine description' },
          { name: 'drivetrain', type: 'string', description: '"RWD", "AWD", "FWD", "4WD"' },
          { name: 'body_style', type: 'string', description: '"Coupe", "Sedan", "Convertible", etc.' },
          { name: 'purchase_price', type: 'number', description: 'Price paid (your record)' },
          { name: 'description', type: 'string', description: 'Free-form description' },
          { name: 'is_public', type: 'boolean', description: 'Publicly visible (default: false)' },
        ]} />

        <CodeBlock
          title="Example"
          code={`curl -X POST "${API_BASE}/api-v1-vehicles" \\
  -H "X-API-Key: nk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "year": 1974,
    "make": "Chevrolet",
    "model": "Corvette",
    "vin": "1Z37S4E404301",
    "color": "Mille Miglia Red",
    "transmission": "Manual",
    "engine_type": "350ci V8"
  }'`}
        />
      </div>

      {/* PATCH update */}
      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('PATCH')}>PATCH</span>
          <span>/api-v1-vehicles/:id</span>
        </div>
        <p style={s.p}>Update an existing vehicle. Only sends the fields you want to change.</p>
        <CodeBlock
          title="Example"
          code={`curl -X PATCH "${API_BASE}/api-v1-vehicles/uuid-here" \\
  -H "X-API-Key: nk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"mileage": 42500, "sale_price": 185000}'`}
        />
      </div>

      {/* DELETE */}
      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('DELETE')}>DELETE</span>
          <span>/api-v1-vehicles/:id</span>
        </div>
        <p style={s.p}>Archive (soft delete) a vehicle. Returns confirmation message.</p>
        <CodeBlock
          title="Example"
          code={`curl -X DELETE "${API_BASE}/api-v1-vehicles/uuid-here" \\
  -H "X-API-Key: nk_live_xxx"`}
        />
        <CodeBlock
          title="Response"
          code={`{ "message": "Vehicle archived successfully" }`}
        />
      </div>
    </div>
  );
}

function SearchSection() {
  return (
    <div>
      <h1 style={s.h1}>Universal Search</h1>
      <p style={s.p}>
        The search endpoint is a magic input handler. It detects what you're searching for (VIN, URL, year, or free text)
        and returns the most relevant results across vehicles, organizations, users, and tags.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('POST')}>POST</span>
          <span>/universal-search</span>
        </div>

        <ParamTable params={[
          { name: 'query', type: 'string', required: true, description: 'Search query — VIN, URL, year, make/model, or free text' },
          { name: 'limit', type: 'number', description: 'Max results to return, 1-100 (default: 20)' },
          { name: 'types', type: 'string[]', description: 'Filter to specific types: "vehicle", "organization", "user", "tag", "external_identity"' },
          { name: 'includeAI', type: 'boolean', description: 'Use AI fallback for ambiguous queries (default: true)' },
        ]} />

        <h3 style={s.h3}>Query Type Detection</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Pattern</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Behavior</th>
            </tr>
          </thead>
          <tbody>
            {[
              { pattern: '17 alphanumeric, no I/O/Q', type: 'vin', behavior: 'Direct VIN lookup' },
              { pattern: 'http://, www., domain.com', type: 'url', behavior: 'Returns extraction signal' },
              { pattern: '4-digit number (1886-2028)', type: 'year', behavior: 'Year-filtered search' },
              { pattern: 'Everything else', type: 'text', behavior: 'Full-text search across make, model, description' },
            ].map((row) => (
              <tr key={row.type}>
                <td style={s.td}>{row.pattern}</td>
                <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.type}</td>
                <td style={s.td}>{row.behavior}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <CodeBlock
          title="Search by text"
          code={`curl -X POST "${API_BASE}/universal-search" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "porsche 911 turbo", "limit": 10}'`}
        />
        <CodeBlock
          title="Search by VIN"
          code={`curl -X POST "${API_BASE}/universal-search" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "WP0JB0934JS050123"}'`}
        />

        <h3 style={s.h3}>Response</h3>
        <CodeBlock
          code={`{
  "success": true,
  "results": [
    {
      "id": "uuid",
      "type": "vehicle",
      "title": "1988 Porsche 911 Turbo",
      "subtitle": "$165,000 — 37,000 mi",
      "description": "Guards Red, Manual, Flat-6 Turbo",
      "image_url": "https://...",
      "relevance_score": 0.95,
      "metadata": {
        "year": 1988,
        "make": "Porsche",
        "model": "911 Turbo"
      }
    }
  ],
  "query_type": "text",
  "total_count": 142,
  "search_time_ms": 38
}`}
        />
      </div>
    </div>
  );
}

function VinLookupSection() {
  return (
    <div>
      <h1 style={s.h1}>VIN Lookup</h1>
      <p style={s.p}>
        One-call vehicle profile by VIN. Returns the full vehicle record plus embedded valuation,
        listing/observation/image counts, and the first 5 images. This is the fastest way to get
        everything about a vehicle in a single request.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-vin-lookup/:vin</span>
        </div>

        <ParamTable params={[
          { name: 'vin', type: 'string', required: true, description: 'Vehicle Identification Number (path parameter)' },
        ]} />

        <CodeBlock
          title="curl"
          code={`curl "${API_BASE}/api-v1-vin-lookup/WP0AB0916KS121279" \\
  -H "X-API-Key: nk_live_xxx"`}
        />

        <CodeBlock
          title="SDK"
          code={`const profile = await nuke.vinLookup.get('WP0AB0916KS121279');
console.log(profile.year, profile.make, profile.model);
console.log(profile.valuation?.estimated_value);
console.log(profile.counts); // { listings: 2, observations: 15, images: 24 }`}
        />

        <CodeBlock
          title="Response"
          code={`{
  "data": {
    "id": "uuid-1",
    "year": 1988,
    "make": "Porsche",
    "model": "911 Turbo",
    "vin": "WP0AB0916KS121279",
    "mileage": 37000,
    "sale_price": 165000,
    "primary_image_url": "https://...",
    "valuation": {
      "estimated_value": 172000,
      "value_low": 155000,
      "value_high": 189000,
      "confidence_score": 82,
      "deal_score_label": "good",
      "heat_score_label": "hot"
    },
    "counts": {
      "listings": 2,
      "observations": 15,
      "images": 24
    },
    "images": [
      { "id": "uuid", "image_url": "https://...", "is_primary": true },
      ...
    ]
  }
}`}
        />

        <h3 style={s.h3}>Response Fields</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Field</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              { field: 'valuation', type: 'object|null', desc: 'Nuke Estimate with confidence, deal score, heat score' },
              { field: 'counts.listings', type: 'number', desc: 'Number of external auction/marketplace listings' },
              { field: 'counts.observations', type: 'number', desc: 'Total observations in the timeline' },
              { field: 'counts.images', type: 'number', desc: 'Number of images returned (max 5)' },
              { field: 'images', type: 'array', desc: 'First 5 images, sorted by primary flag' },
            ].map((row) => (
              <tr key={row.field}>
                <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.field}</td>
                <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.type}</td>
                <td style={s.td}>{row.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VehicleHistorySection() {
  return (
    <div>
      <h1 style={s.h1}>Vehicle History</h1>
      <p style={s.p}>
        Paginated observation timeline for a vehicle. Every auction listing, forum post, service record,
        price signal, and sighting is stored as an observation with source attribution. Filter by kind
        to see specific event types.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-vehicle-history/:vin</span>
        </div>

        <ParamTable params={[
          { name: 'vin', type: 'string', required: true, description: 'Vehicle Identification Number (path parameter)' },
          { name: 'kind', type: 'string', description: 'Filter by observation kind: listing, comment, sale, service, sighting' },
          { name: 'page', type: 'number', description: 'Page number (default: 1)' },
          { name: 'limit', type: 'number', description: 'Results per page, 1-100 (default: 50)' },
        ]} />

        <CodeBlock
          title="curl"
          code={`curl "${API_BASE}/api-v1-vehicle-history/WP0AB0916KS121279?kind=listing&limit=10" \\
  -H "X-API-Key: nk_live_xxx"`}
        />

        <CodeBlock
          title="SDK"
          code={`const history = await nuke.vehicleHistory.list('WP0AB0916KS121279', {
  kind: 'listing',
  limit: 10,
});

for (const obs of history.data.observations) {
  console.log(obs.kind, obs.observed_at, obs.structured_data);
}`}
        />

        <CodeBlock
          title="Response"
          code={`{
  "data": {
    "vehicle": {
      "id": "uuid-1",
      "year": 1988,
      "make": "Porsche",
      "model": "911 Turbo",
      "vin": "WP0AB0916KS121279"
    },
    "observations": [
      {
        "id": "obs-uuid",
        "kind": "listing",
        "observed_at": "2026-01-15T00:00:00Z",
        "source_id": "bat-auctions",
        "structured_data": {
          "platform": "bringatrailer",
          "listing_url": "https://...",
          "final_price": 165000,
          "bid_count": 42
        },
        "confidence": 0.95,
        "source_url": "https://bringatrailer.com/listing/..."
      }
    ]
  },
  "pagination": {
    "page": 1, "limit": 10, "total": 15, "pages": 2
  }
}`}
        />
      </div>
    </div>
  );
}

function VehicleAuctionSection() {
  return (
    <div>
      <h1 style={s.h1}>Vehicle Auction</h1>
      <p style={s.p}>
        Comprehensive auction data for a vehicle: all external listings (BaT, Cars & Bids, RM Sotheby's, etc.),
        comment counts with the 10 most recent comments, and AI-generated sentiment analysis from auction discussions.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-vehicle-auction/:vin</span>
        </div>

        <ParamTable params={[
          { name: 'vin', type: 'string', required: true, description: 'Vehicle Identification Number (path parameter)' },
        ]} />

        <CodeBlock
          title="curl"
          code={`curl "${API_BASE}/api-v1-vehicle-auction/WP0AB0916KS121279" \\
  -H "X-API-Key: nk_live_xxx"`}
        />

        <CodeBlock
          title="SDK"
          code={`const auction = await nuke.vehicleAuction.get('WP0AB0916KS121279');
console.log(auction.listings.length, 'auction listings');
console.log(auction.comments.total_count, 'total comments');
console.log(auction.sentiment?.overall, auction.sentiment?.score);`}
        />

        <CodeBlock
          title="Response"
          code={`{
  "data": {
    "vehicle": {
      "id": "uuid-1",
      "year": 1988,
      "make": "Porsche",
      "model": "911 Turbo",
      "vin": "WP0AB0916KS121279",
      "sale_price": 165000
    },
    "listings": [
      {
        "id": "listing-uuid",
        "platform": "bringatrailer",
        "listing_url": "https://...",
        "listing_status": "sold",
        "final_price": 165000,
        "bid_count": 42,
        "view_count": 12000,
        "sold_at": "2026-01-15T20:00:00Z"
      }
    ],
    "comments": {
      "total_count": 127,
      "recent": [
        {
          "comment_text": "Beautiful example, well maintained...",
          "author_name": "gt3rs_fan",
          "posted_at": "2026-01-15T19:45:00Z",
          "platform": "bringatrailer"
        }
      ]
    },
    "sentiment": {
      "overall": "positive",
      "score": 0.82,
      "comment_count_analyzed": 127,
      "fields_extracted": 14,
      "analyzed_at": "2026-01-16T..."
    }
  }
}`}
        />

        <h3 style={s.h3}>Sentiment Fields</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Field</th>
              <th style={s.th}>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              { field: 'overall', desc: 'Sentiment label: positive, negative, mixed, neutral' },
              { field: 'score', desc: 'Numeric sentiment score (0-1, where 1 = most positive)' },
              { field: 'comment_count_analyzed', desc: 'How many comments the AI analyzed' },
              { field: 'fields_extracted', desc: 'Number of structured fields extracted from comments' },
              { field: 'details', desc: 'Full AI extraction: themes, concerns, price opinions, etc.' },
            ].map((row) => (
              <tr key={row.field}>
                <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.field}</td>
                <td style={s.td}>{row.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarketTrendsSection() {
  return (
    <div>
      <h1 style={s.h1}>Market Trends</h1>
      <p style={s.p}>
        Price trends by make/model/year range over a configurable time period. Returns time-bucketed
        statistics including average, median, percentiles (25th/75th), min/max, and volume.
        Useful for understanding market direction and pricing context.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-market-trends</span>
        </div>

        <ParamTable params={[
          { name: 'make', type: 'string', required: true, description: 'Vehicle make (e.g., "Porsche")' },
          { name: 'model', type: 'string', description: 'Vehicle model (e.g., "911")' },
          { name: 'year_from', type: 'number', description: 'Minimum model year' },
          { name: 'year_to', type: 'number', description: 'Maximum model year' },
          { name: 'period', type: 'string', description: 'Time period: 30d, 90d, 1y, 3y (default: 90d)' },
        ]} />

        <CodeBlock
          title="curl"
          code={`curl "${API_BASE}/api-v1-market-trends?make=Porsche&model=911&period=1y" \\
  -H "X-API-Key: nk_live_xxx"`}
        />

        <CodeBlock
          title="SDK"
          code={`const trends = await nuke.marketTrends.get({
  make: 'Porsche',
  model: '911',
  year_from: 1985,
  year_to: 1995,
  period: '1y',
});

console.log(trends.summary.trend_direction); // "rising" | "falling" | "stable"
console.log(trends.summary.price_change_pct); // e.g., 12.5

for (const p of trends.periods) {
  console.log(p.period_start, p.avg_price, p.median_price, p.sale_count);
}`}
        />

        <CodeBlock
          title="Response"
          code={`{
  "data": {
    "query": {
      "make": "Porsche",
      "model": "911",
      "year_from": null,
      "year_to": null,
      "period": "1y"
    },
    "summary": {
      "total_sales": 979,
      "periods_with_data": 8,
      "overall_avg_price": 82709,
      "price_change_pct": -5.2,
      "trend_direction": "falling"
    },
    "periods": [
      {
        "period_start": "2025-03-01",
        "period_end": "2025-04-01",
        "sale_count": 145,
        "avg_price": 87500,
        "median_price": 72000,
        "p25_price": 45000,
        "p75_price": 115000,
        "min_price": 18000,
        "max_price": 425000,
        "avg_mileage": 52000
      }
    ]
  }
}`}
        />

        <h3 style={s.h3}>Period Buckets</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Period</th>
              <th style={s.th}>Bucket Size</th>
              <th style={s.th}>Use Case</th>
            </tr>
          </thead>
          <tbody>
            {[
              { period: '30d', bucket: '7 days', use: 'Short-term price movement' },
              { period: '90d', bucket: '14 days', use: 'Quarterly trends (default)' },
              { period: '1y', bucket: '1 month', use: 'Annual market analysis' },
              { period: '3y', bucket: '3 months', use: 'Long-term market cycles' },
            ].map((row) => (
              <tr key={row.period}>
                <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.period}</td>
                <td style={s.td}>{row.bucket}</td>
                <td style={s.td}>{row.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchSection() {
  return (
    <div>
      <h1 style={s.h1}>Batch Import</h1>
      <p style={s.p}>
        Import up to 1,000 vehicles in a single request. Supports deduplication by VIN or year/make/model,
        and can attach observations to each vehicle.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('POST')}>POST</span>
          <span>/api-v1-batch</span>
        </div>

        <h3 style={s.h3}>Request Body</h3>
        <CodeBlock
          code={`{
  "vehicles": [
    {
      "year": 2020,
      "make": "Tesla",
      "model": "Model S Performance",
      "vin": "5YJSA1E47LF...",
      "mileage": 15000,
      "exterior_color": "Red Multi-Coat",
      "transmission": "Automatic",
      "engine": "Dual Motor Electric",
      "sale_price": 72000,
      "observations": [
        {
          "source_type": "dealer_inventory",
          "observation_kind": "listing",
          "data": { "list_price": 72000, "days_on_lot": 14 },
          "confidence": 0.95
        }
      ]
    },
    {
      "year": 2019,
      "make": "BMW",
      "model": "M4 Competition",
      "vin": "WBS4M9C55LAH...",
      "mileage": 22000
    }
  ],
  "options": {
    "skip_duplicates": true,
    "match_by": "vin",
    "update_existing": false
  }
}`}
        />

        <h3 style={s.h3}>Options</h3>
        <ParamTable params={[
          { name: 'skip_duplicates', type: 'boolean', description: 'Skip vehicles that already exist (default: true)' },
          { name: 'match_by', type: 'string', description: 'Dedup strategy: "vin", "year_make_model", or "none" (default: "vin")' },
          { name: 'update_existing', type: 'boolean', description: 'Update existing vehicles if matched (default: false)' },
        ]} />

        <h3 style={s.h3}>Response</h3>
        <CodeBlock
          code={`{
  "success": true,
  "result": {
    "created": 1,
    "updated": 0,
    "skipped": 1,
    "failed": 0,
    "vehicles": [
      { "index": 0, "id": "uuid-1", "status": "created" },
      { "index": 1, "status": "skipped", "error": "Duplicate VIN" }
    ]
  }
}`}
        />

        <div style={s.note}>
          Batch size limit: 1,000 vehicles per request. For larger imports, split into multiple requests.
          Each vehicle can have up to 100 observations attached.
        </div>
      </div>
    </div>
  );
}

function ObservationsSection() {
  return (
    <div>
      <h1 style={s.h1}>Observations API</h1>
      <p style={s.p}>
        Observations are the core data primitive. Every auction listing, forum post, social mention, bid,
        comment, and price signal is stored as an observation with full provenance. This creates an immutable
        event timeline for every vehicle.
      </p>

      <h2 style={s.h2}>Concepts</h2>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Field</th>
            <th style={s.th}>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            { field: 'source_id', desc: 'Where the data came from (e.g., "bat-auctions", "rennlist-forum", "owner-input")' },
            { field: 'kind', desc: 'Type of observation: "listing", "comment", "bid", "sale", "service", "sighting"' },
            { field: 'observed_at', desc: 'When the event actually happened (not when we ingested it)' },
            { field: 'structured_data', desc: 'The actual payload — varies by kind' },
            { field: 'confidence', desc: 'How confident we are in this data point (0.0-1.0)' },
            { field: 'provenance', desc: 'Source URL, document ID, and extraction method' },
          ].map((row) => (
            <tr key={row.field}>
              <td style={{ ...s.td, fontFamily: 'monospace', fontWeight: 'bold' }}>{row.field}</td>
              <td style={s.td}>{row.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* GET observations */}
      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-observations</span>
        </div>
        <p style={s.p}>Query observations for a vehicle. Requires either <code style={s.inlineCode}>vehicle_id</code> or <code style={s.inlineCode}>vin</code>.</p>

        <ParamTable params={[
          { name: 'vehicle_id', type: 'uuid', description: 'Vehicle UUID (required if no vin)' },
          { name: 'vin', type: 'string', description: 'VIN (required if no vehicle_id)' },
          { name: 'kind', type: 'string', description: 'Filter by observation type' },
          { name: 'page', type: 'number', description: 'Page number (default: 1)' },
          { name: 'limit', type: 'number', description: 'Results per page, 1-100 (default: 50)' },
        ]} />

        <CodeBlock
          title="Example"
          code={`curl "${API_BASE}/api-v1-observations?vehicle_id=uuid-here&kind=comment&limit=20" \\
  -H "X-API-Key: nk_live_xxx"`}
        />
      </div>

      {/* POST observation */}
      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('POST')}>POST</span>
          <span>/api-v1-observations</span>
        </div>
        <p style={s.p}>Submit a new observation. If VIN is provided but no vehicle exists, a placeholder vehicle is auto-created.</p>

        <ParamTable params={[
          { name: 'vehicle_id', type: 'uuid', description: 'Vehicle UUID (optional if vin provided)' },
          { name: 'vin', type: 'string', description: 'VIN (optional if vehicle_id provided)' },
          { name: 'source_id', type: 'string', required: true, description: 'Source slug (e.g., "bat-auctions", "owner-input")' },
          { name: 'kind', type: 'string', required: true, description: 'Observation type (e.g., "listing", "comment", "sale")' },
          { name: 'observed_at', type: 'ISO 8601', description: 'When the event happened (default: now)' },
          { name: 'structured_data', type: 'object', required: true, description: 'The observation payload' },
          { name: 'confidence', type: 'number', description: '0.0-1.0 confidence score (default: 0.8)' },
          { name: 'provenance', type: 'object', description: 'Source URL, document_id, extracted_by' },
        ]} />

        <CodeBlock
          title="Example: Submit a service record"
          code={`curl -X POST "${API_BASE}/api-v1-observations" \\
  -H "X-API-Key: nk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "vin": "WP0JB0934JS050123",
    "source_id": "owner-input",
    "kind": "service",
    "observed_at": "2026-01-15T00:00:00Z",
    "structured_data": {
      "work_type": "engine_rebuild",
      "shop": "Rennsport Werks",
      "cost": 18500,
      "parts": ["pistons", "cylinders", "gaskets"],
      "notes": "Full engine rebuild at 120K miles"
    },
    "confidence": 1.0
  }'`}
        />
      </div>

      <h2 style={s.h2}>Observation Pipeline</h2>
      <CodeBlock
        code={`[Any Source]           BaT, Cars & Bids, RM Sotheby's, Forums, Owner Input, Shop Records
       |
       v
ingest-observation     Normalize, deduplicate, link to vehicle profile
       |
       v
vehicle_observations   Immutable event store (625K+ observations)
       |
       v
discover-from-         AI analysis: sentiment, price signals, mechanical
  observations         insights, ownership changes, comparables
       |
       v
observation_           Structured discoveries with confidence scores
  discoveries`}
      />
    </div>
  );
}

function ExtractionSection() {
  return (
    <div>
      <h1 style={s.h1}>AI Extraction</h1>
      <p style={s.p}>
        Point the extraction endpoint at any car listing URL. It scrapes the page, identifies vehicle data,
        and returns structured fields. Dedicated extractors exist for major platforms (BaT, Cars & Bids, Mecum, etc.),
        with an AI fallback for unknown sources.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('POST')}>POST</span>
          <span>/extract-vehicle-data-ai</span>
        </div>

        <ParamTable params={[
          { name: 'url', type: 'string', required: true, description: 'The listing URL to extract from' },
          { name: 'html', type: 'string', description: 'Pre-fetched HTML (skips scraping)' },
          { name: 'textContent', type: 'string', description: 'Pre-extracted text content' },
          { name: 'save_to_db', type: 'boolean', description: 'Auto-save to vehicles table (default: false)' },
          { name: 'max_vehicles', type: 'number', description: 'Max vehicles to extract from page (default: 1)' },
        ]} />

        <CodeBlock
          title="Example"
          code={`curl -X POST "${API_BASE}/extract-vehicle-data-ai" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://carsandbids.com/auctions/xxxxxxx/2022-porsche-911-gt3",
    "save_to_db": true
  }'`}
        />

        <CodeBlock
          title="Response"
          code={`{
  "success": true,
  "data": {
    "year": 2022,
    "make": "Porsche",
    "model": "911 GT3",
    "vin": "WP0AC2A98NS2...",
    "mileage": 3200,
    "price": 225000,
    "exterior_color": "Shark Blue",
    "interior_color": "Black",
    "transmission": "Manual",
    "engine": "4.0L Flat-6",
    "drivetrain": "RWD",
    "body_style": "Coupe",
    "description": "One owner, all service records...",
    "image_urls": [
      "https://...",
      "https://..."
    ],
    "location": "Austin, TX",
    "seller": "enthusiast_garage"
  },
  "confidence": 0.96,
  "source": "carsandbids.com",
  "extractionMethod": "dedicated_extractor",
  "vehicle_id": "uuid-created",
  "images_saved": 24
}`}
        />

        <h3 style={s.h3}>Supported Platforms</h3>
        <p style={s.p}>
          Dedicated extractors exist for these platforms (highest accuracy). All other URLs use AI extraction.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          {[
            'Bring a Trailer', 'Cars & Bids', 'RM Sotheby\'s', 'Mecum', 'Gooding & Co.',
            'Bonhams', 'PCarMarket', 'Collecting Cars', 'Hagerty Marketplace',
            'GAA Classic Cars', 'Barrett-Jackson', 'eBay Motors',
          ].map((name) => (
            <div key={name} style={{
              padding: 'var(--space-2)',
              background: 'var(--grey-50)',
              border: '1px solid var(--border-light)',
              textAlign: 'center',
            }}>
              {name}
            </div>
          ))}
        </div>
        <div style={s.note}>
          For platforms without a dedicated extractor, the AI extraction pipeline uses Firecrawl for
          JavaScript-rendered pages and OpenAI GPT-4 for data extraction. Accuracy is typically 85-95%.
        </div>
      </div>
    </div>
  );
}

function ValuationsSection() {
  return (
    <div>
      <h1 style={s.h1}>Valuations (The Nuke Estimate)</h1>
      <p style={s.p}>
        The Nuke Estimate is an 8-signal AI valuation that combines comparable sales, community sentiment,
        rarity data, bid curves, market trends, and more. Currently covering 506K+ vehicles (62.4% of the database).
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('POST')}>POST</span>
          <span>/compute-vehicle-valuation</span>
        </div>
        <p style={s.p}>Compute or retrieve a valuation. Accepts a single vehicle, batch of IDs, or auto-discovery mode.</p>

        <h3 style={s.h3}>Single Vehicle</h3>
        <CodeBlock
          code={`curl -X POST "${API_BASE}/compute-vehicle-valuation" \\
  -H "Authorization: Bearer SERVICE_ROLE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"vehicle_id": "uuid-here"}'`}
        />

        <h3 style={s.h3}>Batch (up to 100)</h3>
        <CodeBlock
          code={`curl -X POST "${API_BASE}/compute-vehicle-valuation" \\
  -H "Authorization: Bearer SERVICE_ROLE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "vehicle_ids": ["uuid-1", "uuid-2", "uuid-3"],
    "force": false
  }'`}
        />

        <h3 style={s.h3}>Response</h3>
        <CodeBlock
          code={`{
  "success": true,
  "computed": 3,
  "cached": 0,
  "errors": 0,
  "results": [
    {
      "vehicle_id": "uuid-1",
      "estimated_value": 165000,
      "value_low": 148000,
      "value_high": 182000,
      "confidence_score": 82,
      "price_tier": "collector",
      "deal_score": 15,
      "deal_score_label": "plus_1",
      "heat_score": 72,
      "heat_score_label": "hot",
      "signal_weights": {
        "comparables": 0.35,
        "condition": 0.15,
        "rarity": 0.12,
        "sentiment": 0.10,
        "bid_curve": 0.10,
        "market_trend": 0.08,
        "survival_rate": 0.05,
        "originality": 0.05
      },
      "model_version": "v1",
      "calculated_at": "2026-02-10T..."
    }
  ]
}`}
        />

        <h3 style={s.h3}>Valuation Signals</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Signal</th>
              <th style={s.th}>Weight</th>
              <th style={s.th}>Source</th>
            </tr>
          </thead>
          <tbody>
            {[
              { signal: 'Comparables', weight: '35%', source: 'Recent sales of same year/make/model/trim' },
              { signal: 'Condition', weight: '15%', source: 'Vehicle assessments and quality scores' },
              { signal: 'Rarity', weight: '12%', source: 'Production numbers, survival rates' },
              { signal: 'Sentiment', weight: '10%', source: 'AI analysis of auction comments' },
              { signal: 'Bid Curve', weight: '10%', source: 'Bidding momentum from auctions' },
              { signal: 'Market Trend', weight: '8%', source: '30/90 day price movements for segment' },
              { signal: 'Survival Rate', weight: '5%', source: 'How many are left of this model' },
              { signal: 'Originality', weight: '5%', source: 'Numbers-matching, unmodified status' },
            ].map((row) => (
              <tr key={row.signal}>
                <td style={{ ...s.td, fontWeight: 'bold' }}>{row.signal}</td>
                <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.weight}</td>
                <td style={s.td}>{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={s.h3}>Deal Score</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Label</th>
              <th style={s.th}>Range</th>
              <th style={s.th}>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'plus_3', range: '+50 to +100', meaning: 'Exceptional deal — well below market' },
              { label: 'plus_2', range: '+25 to +49', meaning: 'Great deal' },
              { label: 'plus_1', range: '+10 to +24', meaning: 'Good deal' },
              { label: 'fair', range: '-9 to +9', meaning: 'Fair market price' },
              { label: 'minus_1', range: '-10 to -24', meaning: 'Slightly overpriced' },
              { label: 'minus_2', range: '-25 to -49', meaning: 'Overpriced' },
              { label: 'minus_3', range: '-50 to -100', meaning: 'Significantly overpriced' },
            ].map((row) => (
              <tr key={row.label}>
                <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.label}</td>
                <td style={s.td}>{row.range}</td>
                <td style={s.td}>{row.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BusinessSection() {
  return (
    <div>
      <h1 style={s.h1}>Business Data API</h1>
      <p style={s.p}>
        For shops, garages, and restoration businesses. Access photo submissions from technicians,
        vehicle service status, and team management. Requires owner/manager role for the business.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-business-data/summary</span>
        </div>
        <p style={s.p}>Dashboard summary with activity counts and breakdowns.</p>
        <CodeBlock
          title="Response"
          code={`{
  "submissions": {
    "today": 12,
    "this_week": 47,
    "this_month": 183
  },
  "technicians_active": 4,
  "vehicles_in_service": 28,
  "work_type_breakdown": {
    "engine_rebuild": 3,
    "paint_correction": 5,
    "suspension": 2,
    "general_maintenance": 8,
    "unknown": 10
  },
  "recent_activity": [...]
}`}
        />
      </div>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-business-data/submissions</span>
        </div>
        <p style={s.p}>List photo submissions from technicians. Supports date filtering and pagination.</p>
        <ParamTable params={[
          { name: 'limit', type: 'number', description: 'Results per page (default: 50)' },
          { name: 'offset', type: 'number', description: 'Pagination offset (default: 0)' },
          { name: 'since', type: 'ISO 8601', description: 'Filter submissions after this date' },
          { name: 'until', type: 'ISO 8601', description: 'Filter submissions before this date' },
          { name: 'vehicle_id', type: 'uuid', description: 'Filter to specific vehicle' },
          { name: 'technician_id', type: 'uuid', description: 'Filter to specific technician' },
          { name: 'status', type: 'string', description: 'Filter by processing status' },
        ]} />
      </div>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-business-data/vehicles</span>
        </div>
        <p style={s.p}>List vehicles currently in service at your shop.</p>
        <ParamTable params={[
          { name: 'status', type: 'string', description: '"active" or "all" (default: "active")' },
          { name: 'service_status', type: 'string', description: '"currently_in_service" to filter active jobs' },
        ]} />
      </div>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-business-data/technicians</span>
        </div>
        <p style={s.p}>List connected technicians and their current vehicle assignments.</p>
      </div>

      <h2 style={s.h2}>Shop Onboarding Flow</h2>
      <CodeBlock
        code={`1. Boss creates account + organization
   POST /api-v1-vehicles (add their fleet)

2. Invite technicians
   POST /api-v1-business-data/invite
   → Technician receives SMS/Telegram link

3. Technician connects
   → Links photo album or sends via Telegram bot

4. Photos auto-processed
   → AI identifies vehicle, work type, and status
   → Observations created automatically

5. Boss views dashboard
   GET /api-v1-business-data/summary
   GET /api-v1-business-data/submissions`}
      />
    </div>
  );
}

function McpSection() {
  return (
    <div>
      <h1 style={s.h1}>MCP Server</h1>
      <p style={s.p}>
        The Nuke MCP (Model Context Protocol) server gives AI agents direct access to vehicle intelligence.
        Connect it to Claude Desktop, Claude Code, Cursor, or any MCP-compatible client.
      </p>

      <h2 style={s.h2}>Installation</h2>
      <CodeBlock code="npx -y @sss97133/nuke-mcp-server" />

      <h2 style={s.h2}>Configuration</h2>

      <h3 style={s.h3}>Claude Desktop</h3>
      <CodeBlock
        title="~/Library/Application Support/Claude/claude_desktop_config.json"
        code={`{
  "mcpServers": {
    "nuke": {
      "command": "npx",
      "args": ["-y", "@sss97133/nuke-mcp-server"],
      "env": {
        "NUKE_API_KEY": "nk_live_your_key_here"
      }
    }
  }
}`}
      />

      <h3 style={s.h3}>Claude Code</h3>
      <CodeBlock
        title=".claude/settings.json"
        code={`{
  "mcpServers": {
    "nuke": {
      "command": "npx",
      "args": ["-y", "@sss97133/nuke-mcp-server"],
      "env": {
        "NUKE_API_KEY": "nk_live_your_key_here"
      }
    }
  }
}`}
      />

      <h3 style={s.h3}>Cursor</h3>
      <CodeBlock
        title=".cursor/mcp.json"
        code={`{
  "mcpServers": {
    "nuke": {
      "command": "npx",
      "args": ["-y", "@sss97133/nuke-mcp-server"],
      "env": {
        "NUKE_API_KEY": "nk_live_your_key_here"
      }
    }
  }
}`}
      />

      <h2 style={s.h2}>Available Tools</h2>

      {[
        {
          name: 'search_vehicles',
          desc: 'Search by VIN, URL, year, make/model, or free text. Returns vehicle profiles with thumbnails.',
          input: '{ query: "1967 Mustang", limit: 5 }',
          output: '{ results: [{ type: "vehicle", title: "1967 Ford Mustang Fastback", ... }], total_count: 42 }',
        },
        {
          name: 'extract_listing',
          desc: 'Extract structured vehicle data from any listing URL. Supports 12+ platforms with dedicated extractors.',
          input: '{ url: "https://bringatrailer.com/listing/..." }',
          output: '{ year: 1988, make: "Porsche", model: "911 Turbo", price: 165000, ... }',
        },
        {
          name: 'get_vehicle_valuation',
          desc: 'Get the Nuke Estimate — an 8-signal AI valuation with confidence scores and deal rating.',
          input: '{ vehicle_id: "uuid" }',
          output: '{ estimated_value: 165000, confidence_score: 82, deal_score_label: "plus_1" }',
        },
        {
          name: 'identify_vehicle_image',
          desc: 'AI vision: photo → year/make/model/trim with confidence. Works with any car photo.',
          input: '{ image_url: "https://example.com/car.jpg" }',
          output: '{ year: 1973, make: "Porsche", model: "911 Carrera RS", confidence: 0.91 }',
        },
        {
          name: 'get_vehicle',
          desc: 'Fetch a complete vehicle profile by ID, including images, observations, and valuations.',
          input: '{ vehicle_id: "uuid" }',
          output: '{ id, year, make, model, vin, sale_price, images: [...], observations: [...] }',
        },
        {
          name: 'list_vehicles',
          desc: 'List vehicles with pagination. Filter to your own or browse all public vehicles.',
          input: '{ limit: 20, offset: 0 }',
          output: '{ vehicles: [...], total: 810000 }',
        },
      ].map((tool) => (
        <div key={tool.name} style={s.endpoint}>
          <div style={{ fontFamily: 'monospace', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
            {tool.name}
          </div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)', lineHeight: '1.4' }}>
            {tool.desc}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px' }}>Input</div>
              <pre style={{ ...s.code, margin: 0, padding: '6px 8px' }}>{tool.input}</pre>
            </div>
            <div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px' }}>Output</div>
              <pre style={{ ...s.code, margin: 0, padding: '6px 8px' }}>{tool.output}</pre>
            </div>
          </div>
        </div>
      ))}

      <h2 style={s.h2}>Example Prompts</h2>
      <div style={s.note}>
        "What's a 1967 Shelby GT500 worth?"<br />
        "Identify the car in this photo" (paste image)<br />
        "Extract the listing at bringatrailer.com/listing/..."<br />
        "Find all air-cooled Porsches sold above $200K"<br />
        "Show me the observation timeline for VIN WBS4M9C5..."<br />
        "Add this vehicle to my garage: 1974 Corvette, red, 350ci"
      </div>
    </div>
  );
}

function WebhooksSection() {
  return (
    <div>
      <h1 style={s.h1}>Webhooks</h1>
      <p style={s.p}>
        Subscribe to events and get notified when things happen. Useful for monitoring specific vehicles,
        price thresholds, new listings from a source, or new observations.
      </p>

      <h2 style={s.h2}>Setup</h2>
      <p style={s.p}>
        Configure webhooks from <Link to="/settings/webhooks" style={{ color: 'var(--text)', fontWeight: 'bold' }}>Settings &gt; Webhooks</Link>.
        Provide an HTTPS endpoint URL and select which events to subscribe to.
      </p>

      <h2 style={s.h2}>Events</h2>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Event</th>
            <th style={s.th}>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            { event: 'vehicle.created', desc: 'A new vehicle was added to the database' },
            { event: 'vehicle.updated', desc: 'A vehicle record was modified' },
            { event: 'observation.created', desc: 'A new observation was ingested' },
            { event: 'valuation.computed', desc: 'A new valuation was calculated' },
            { event: 'extraction.completed', desc: 'An AI extraction finished' },
            { event: 'price.alert', desc: 'A vehicle hit your price threshold' },
          ].map((row) => (
            <tr key={row.event}>
              <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.event}</td>
              <td style={s.td}>{row.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={s.h2}>Payload Format</h2>
      <CodeBlock
        code={`{
  "id": "evt_abc123",
  "type": "observation.created",
  "created_at": "2026-02-10T15:30:00Z",
  "data": {
    "observation_id": "uuid",
    "vehicle_id": "uuid",
    "kind": "listing",
    "source_id": "bat-auctions",
    "structured_data": { ... }
  }
}`}
      />

      <h2 style={s.h2}>Delivery</h2>
      <div style={s.note}>
        Webhooks are delivered via HTTP POST with a JSON body. Failed deliveries are retried up to 3 times
        with exponential backoff (1 min, 5 min, 30 min). Your endpoint should return a 2xx status within 10 seconds.
      </div>
    </div>
  );
}

function ErrorsSection() {
  return (
    <div>
      <h1 style={s.h1}>Errors & Rate Limits</h1>

      <h2 style={s.h2}>Rate Limits</h2>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Tier</th>
            <th style={s.th}>Requests/Hour</th>
            <th style={s.th}>Batch Size</th>
            <th style={s.th}>Page Size</th>
          </tr>
        </thead>
        <tbody>
          {[
            { tier: 'Free', rph: '100', batch: '50', page: '20' },
            { tier: 'Developer', rph: '1,000', batch: '500', page: '100' },
            { tier: 'Business', rph: '10,000', batch: '1,000', page: '100' },
          ].map((row) => (
            <tr key={row.tier}>
              <td style={{ ...s.td, fontWeight: 'bold' }}>{row.tier}</td>
              <td style={s.td}>{row.rph}</td>
              <td style={s.td}>{row.batch}</td>
              <td style={s.td}>{row.page}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={s.h2}>Error Responses</h2>
      <p style={s.p}>All errors follow a consistent format:</p>
      <CodeBlock
        code={`{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "status": 400
}`}
      />

      <h3 style={s.h3}>Error Codes</h3>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>HTTP</th>
            <th style={s.th}>Code</th>
            <th style={s.th}>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            { http: '400', code: 'INVALID_REQUEST', desc: 'Missing or invalid parameters' },
            { http: '401', code: 'UNAUTHORIZED', desc: 'Missing or invalid API key / JWT' },
            { http: '403', code: 'FORBIDDEN', desc: 'Insufficient permissions for this resource' },
            { http: '404', code: 'NOT_FOUND', desc: 'Resource does not exist' },
            { http: '409', code: 'CONFLICT', desc: 'Resource already exists (duplicate)' },
            { http: '429', code: 'RATE_LIMITED', desc: 'Too many requests — slow down' },
            { http: '500', code: 'INTERNAL_ERROR', desc: 'Server error — retry or contact support' },
          ].map((row) => (
            <tr key={row.code}>
              <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.http}</td>
              <td style={{ ...s.td, fontFamily: 'monospace' }}>{row.code}</td>
              <td style={s.td}>{row.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={s.h2}>CORS</h2>
      <p style={s.p}>
        All endpoints support cross-origin requests. <code style={s.inlineCode}>Access-Control-Allow-Origin: *</code> is
        set on all responses. Preflight OPTIONS requests are handled automatically.
      </p>

      <h2 style={s.h2}>Base URL</h2>
      <CodeBlock code={API_BASE} />
      <p style={s.p}>
        All endpoint paths in this documentation are relative to this base URL.
      </p>
    </div>
  );
}

function ChangelogSection() {
  const changelog = [
    {
      version: '2026.02.12',
      date: 'February 12, 2026',
      changes: [
        { type: 'new', text: 'VIN Lookup: one-call vehicle profile with valuation + counts + images' },
        { type: 'new', text: 'Vehicle History: paginated observation timeline by VIN' },
        { type: 'new', text: 'Vehicle Auction: listings + comments + AI sentiment by VIN' },
        { type: 'new', text: 'Market Trends: price trends with percentiles by make/model/year' },
        { type: 'new', text: 'Search API: authenticated v1 wrapper for universal-search' },
        { type: 'new', text: 'TypeScript SDK v1.2.0 with 5 new resource classes' },
        { type: 'improved', text: 'OpenAPI spec updated with all new endpoints and schemas' },
      ],
    },
    {
      version: '2026.02.10',
      date: 'February 10, 2026',
      changes: [
        { type: 'new', text: 'Comprehensive developer documentation hub' },
        { type: 'new', text: 'MCP Server: npx -y @sss97133/nuke-mcp-server' },
        { type: 'new', text: '6 MCP tools for AI agent integration' },
        { type: 'new', text: 'AI vehicle image identification (0.9 confidence)' },
        { type: 'fix', text: 'Fixed 21 parseInt radix issues across edge functions' },
        { type: 'fix', text: 'Fixed .single() crash risks in 10+ functions' },
        { type: 'improved', text: 'Vehicle valuations: 506K+ computed (62.4% coverage)' },
        { type: 'improved', text: 'Data quality: 5,600+ bogus VINs cleaned, 10K+ makes normalized' },
      ],
    },
    {
      version: '2026.02.05',
      date: 'February 5, 2026',
      changes: [
        { type: 'new', text: 'Business Data API for restoration companies' },
        { type: 'new', text: 'Telegram bot for technician photo intake' },
        { type: 'new', text: 'Invite code system for onboarding' },
        { type: 'new', text: 'Batch import API (up to 1,000 vehicles)' },
      ],
    },
    {
      version: '2026.02.01',
      date: 'February 1, 2026',
      changes: [
        { type: 'new', text: 'Webhooks API with event subscriptions' },
        { type: 'new', text: 'Usage dashboard' },
        { type: 'improved', text: 'Rate limit: 1,000 req/hour' },
      ],
    },
    {
      version: '2026.01.15',
      date: 'January 15, 2026',
      changes: [
        { type: 'new', text: 'API Keys management' },
        { type: 'new', text: 'REST Vehicles API (CRUD)' },
        { type: 'new', text: 'Observations API with provenance tracking' },
        { type: 'new', text: 'Universal Search endpoint' },
      ],
    },
  ];

  return (
    <div>
      <h1 style={s.h1}>Changelog</h1>
      <p style={s.p}>Release history and notable changes.</p>

      {changelog.map((release) => (
        <div key={release.version} style={s.card}>
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <span style={{ fontWeight: 'bold', fontFamily: 'monospace', marginRight: 'var(--space-2)' }}>
              {release.version}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{release.date}</span>
          </div>
          {release.changes.map((change, i) => (
            <div key={i} style={{ marginBottom: 'var(--space-1)' }}>
              <span style={{
                display: 'inline-block',
                padding: '1px 6px',
                fontSize: '7pt',
                fontFamily: 'monospace',
                background: change.type === 'new' ? '#e8f5e9' : change.type === 'fix' ? '#ffebee' : 'var(--grey-100)',
                border: '1px solid var(--border-light)',
                marginRight: 'var(--space-2)',
              }}>
                {change.type}
              </span>
              {change.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

const sectionComponents: Record<string, () => JSX.Element> = {
  overview: OverviewSection,
  quickstart: QuickstartSection,
  authentication: AuthenticationSection,
  vehicles: VehiclesSection,
  'vin-lookup': VinLookupSection,
  'vehicle-history': VehicleHistorySection,
  'vehicle-auction': VehicleAuctionSection,
  'market-trends': MarketTrendsSection,
  search: SearchSection,
  batch: BatchSection,
  observations: ObservationsSection,
  extraction: ExtractionSection,
  valuations: ValuationsSection,
  business: BusinessSection,
  mcp: McpSection,
  webhooks: WebhooksSection,
  errors: ErrorsSection,
  changelog: ChangelogSection,
};

export default function DevelopersPage() {
  const location = useLocation();
  const [activeSection, setActiveSection] = useState('overview');
  const contentRef = useRef<HTMLDivElement>(null);

  // Parse hash from URL
  useEffect(() => {
    const hash = location.hash.replace('#', '');
    if (hash && sectionComponents[hash]) {
      setActiveSection(hash);
    }
  }, [location.hash]);

  // Scroll to top when section changes
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [activeSection]);

  const ActiveComponent = sectionComponents[activeSection] || OverviewSection;

  // Group sections
  const groups: Record<string, typeof SECTIONS> = {};
  SECTIONS.forEach((sec) => {
    if (!groups[sec.group]) groups[sec.group] = [];
    groups[sec.group].push(sec);
  });

  return (
    <div style={s.layout}>
      {/* Sidebar */}
      <nav style={s.sidebar}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
            Nuke Docs
          </div>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
            Vehicle Intelligence API
          </div>
        </div>

        {Object.entries(groups).map(([group, sections]) => (
          <div key={group} style={s.sidebarGroup}>
            <div style={s.sidebarLabel}>{group}</div>
            {sections.map((sec) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection(sec.id);
                  window.history.replaceState(null, '', `#${sec.id}`);
                }}
                style={s.sidebarLink(activeSection === sec.id)}
              >
                {sec.label}
              </a>
            ))}
          </div>
        ))}

        <div style={{
          marginTop: 'var(--space-4)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border-light)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}>
          <Link to="/settings/api-keys" style={{ ...s.sidebarLink(false), color: 'var(--text)' }}>
            Get API Key
          </Link>
          <Link to="/api" style={{ ...s.sidebarLink(false), color: 'var(--text)' }}>
            Live Demo
          </Link>
          <a
            href="https://github.com/sss97133/nuke-mcp-server"
            target="_blank"
            rel="noreferrer"
            style={{ ...s.sidebarLink(false), color: 'var(--text)' }}
          >
            GitHub
          </a>
        </div>
      </nav>

      {/* Content */}
      <main ref={contentRef} style={s.content}>
        <ActiveComponent />

        {/* Footer nav */}
        <div style={{
          marginTop: 'var(--space-8)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border-light)',
          display: 'flex',
          justifyContent: 'space-between',
          color: 'var(--text-muted)',
        }}>
          {(() => {
            const idx = SECTIONS.findIndex((sec) => sec.id === activeSection);
            const prev = idx > 0 ? SECTIONS[idx - 1] : null;
            const next = idx < SECTIONS.length - 1 ? SECTIONS[idx + 1] : null;
            return (
              <>
                <div>
                  {prev && (
                    <a
                      href={`#${prev.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setActiveSection(prev.id);
                        window.history.replaceState(null, '', `#${prev.id}`);
                      }}
                      style={{ color: 'var(--text)', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      &larr; {prev.label}
                    </a>
                  )}
                </div>
                <div>
                  {next && (
                    <a
                      href={`#${next.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setActiveSection(next.id);
                        window.history.replaceState(null, '', `#${next.id}`);
                      }}
                      style={{ color: 'var(--text)', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      {next.label} &rarr;
                    </a>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      </main>
    </div>
  );
}
