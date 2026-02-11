/**
 * Developers Hub - MCP Server & API Documentation
 *
 * Following Nuke design system:
 * - 8pt text everywhere
 * - 0px border radius
 * - Windows 95 aesthetic
 * - Light grey/white backgrounds
 *
 * Route: /developers
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SUPABASE_URL } from '../../lib/env';

const API_BASE = `${SUPABASE_URL}/functions/v1`;

const mcpTools = [
  {
    name: 'search_vehicles',
    description: 'Search by VIN, URL, year, make/model, or free text',
    example: '{ query: "1967 Mustang", limit: 5 }',
    response: '{ results: [...], query_type: "text", total_count: 142 }',
  },
  {
    name: 'extract_listing',
    description: 'Extract structured data from any car listing URL',
    example: '{ url: "https://bringatrailer.com/listing/..." }',
    response: '{ year: 1988, make: "Porsche", model: "911", trim: "Turbo", vin: "..." }',
  },
  {
    name: 'get_vehicle_valuation',
    description: '8-signal market valuation (The Nuke Estimate)',
    example: '{ vehicle_id: "uuid" }',
    response: '{ estimated_value: 47500, confidence_score: 0.82, deal_score: "Good Deal" }',
  },
  {
    name: 'identify_vehicle_image',
    description: 'AI vision: photo → year/make/model/trim with confidence',
    example: '{ image_url: "https://example.com/car.jpg" }',
    response: '{ year: 1973, make: "Porsche", model: "911", confidence: 0.87 }',
  },
  {
    name: 'get_vehicle',
    description: 'Fetch a full vehicle profile by ID',
    example: '{ vehicle_id: "uuid" }',
    response: '{ id, year, make, model, vin, sale_price, images, observations... }',
  },
  {
    name: 'list_vehicles',
    description: 'List vehicles (yours or public)',
    example: '{ limit: 20, offset: 0 }',
    response: '{ vehicles: [...], total: 758000 }',
  },
];

const restEndpoints = [
  {
    category: 'Vehicles',
    description: 'Query and manage vehicle data',
    items: [
      { method: 'GET', path: '/api-v1-vehicles', description: 'Search vehicles' },
      { method: 'GET', path: '/api-v1-vehicles/:id', description: 'Vehicle details' },
      { method: 'GET', path: '/api-v1-vehicles/:id/timeline', description: 'Vehicle history' },
    ],
  },
  {
    category: 'Search',
    description: 'Universal search across all entities',
    items: [
      { method: 'POST', path: '/universal-search', description: 'Search vehicles, orgs, users' },
    ],
  },
  {
    category: 'Extraction',
    description: 'Extract data from listings and images',
    items: [
      { method: 'POST', path: '/extract-vehicle-data-ai', description: 'Extract from listing URL' },
      { method: 'POST', path: '/identify-vehicle-from-image', description: 'AI vehicle image ID' },
      { method: 'POST', path: '/compute-vehicle-valuation', description: 'Compute valuation' },
    ],
  },
  {
    category: 'Observations',
    description: 'Unified event data with provenance',
    items: [
      { method: 'POST', path: '/api-v1-observations', description: 'Submit observation' },
      { method: 'GET', path: '/api-v1-observations', description: 'Query observations' },
    ],
  },
];

const changelog = [
  {
    version: '2026.02.10',
    date: 'February 10, 2026',
    changes: [
      { type: 'new', text: 'MCP Server: npx -y @sss97133/nuke-mcp-server' },
      { type: 'new', text: '6 MCP tools for AI agent integration' },
      { type: 'new', text: 'AI vehicle image identification (0.9 confidence)' },
      { type: 'improved', text: 'Vehicle page collapsed by default for clarity' },
    ],
  },
  {
    version: '2026.02.05',
    date: 'February 5, 2026',
    changes: [
      { type: 'new', text: 'Business Data API for restoration companies' },
      { type: 'new', text: 'Telegram bot for technician photo intake' },
      { type: 'new', text: 'Invite code system for onboarding' },
    ],
  },
  {
    version: '2026.02.01',
    date: 'February 1, 2026',
    changes: [
      { type: 'new', text: 'Webhooks API' },
      { type: 'new', text: 'Usage dashboard' },
      { type: 'improved', text: 'Rate limit: 1000 req/hour' },
    ],
  },
  {
    version: '2026.01.15',
    date: 'January 15, 2026',
    changes: [
      { type: 'new', text: 'API Keys management' },
      { type: 'new', text: 'Vehicles API' },
      { type: 'new', text: 'Observations API' },
    ],
  },
];

const styles = {
  page: {
    padding: 'var(--space-4)',
    maxWidth: '900px',
    margin: '0 auto',
    fontSize: '8pt',
    fontFamily: 'Arial, sans-serif',
  },
  header: {
    marginBottom: 'var(--space-5)',
  },
  title: {
    fontSize: '10pt',
    fontWeight: 'bold' as const,
    marginBottom: 'var(--space-1)',
  },
  subtitle: {
    fontSize: '8pt',
    color: 'var(--text-muted)',
  },
  nav: {
    display: 'flex',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-4)',
    borderBottom: '1px solid var(--border-light)',
    paddingBottom: 'var(--space-2)',
  },
  navButton: (active: boolean) => ({
    fontSize: '8pt',
    padding: 'var(--space-2) var(--space-3)',
    background: active ? 'var(--grey-200)' : 'transparent',
    border: active ? '2px inset var(--border-light)' : '2px solid transparent',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
  }),
  section: {
    marginBottom: 'var(--space-5)',
  },
  sectionTitle: {
    fontSize: '8pt',
    fontWeight: 'bold' as const,
    marginBottom: 'var(--space-3)',
  },
  card: {
    background: 'var(--white)',
    border: '2px solid var(--border-medium)',
    padding: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
  },
  codeBlock: {
    background: 'var(--grey-100)',
    border: '1px solid var(--border-light)',
    padding: 'var(--space-3)',
    fontFamily: 'monospace',
    fontSize: '8pt',
    overflow: 'auto' as const,
    whiteSpace: 'pre' as const,
  },
  methodBadge: (method: string) => ({
    display: 'inline-block',
    padding: '2px 6px',
    fontSize: '8pt',
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    background: method === 'GET' ? 'var(--grey-100)' : method === 'POST' ? 'var(--grey-200)' : 'var(--grey-100)',
    border: '1px solid var(--border-medium)',
    marginRight: 'var(--space-2)',
  }),
  changeBadge: (type: string) => ({
    display: 'inline-block',
    padding: '2px 6px',
    fontSize: '8pt',
    background: type === 'new' ? 'var(--grey-100)' : type === 'improved' ? 'var(--grey-50)' : 'var(--grey-100)',
    border: '1px solid var(--border-light)',
    marginRight: 'var(--space-2)',
  }),
  button: {
    fontSize: '8pt',
    padding: 'var(--space-2) var(--space-3)',
    background: 'var(--text)',
    color: 'var(--white)',
    border: '2px solid var(--text)',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
  },
  buttonSecondary: {
    fontSize: '8pt',
    padding: 'var(--space-2) var(--space-3)',
    background: 'var(--grey-200)',
    border: '2px outset var(--border-light)',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
  },
  link: {
    color: 'var(--primary-color, #0ea5e9)',
    fontSize: '8pt',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '8pt',
  },
  th: {
    textAlign: 'left' as const,
    padding: 'var(--space-2)',
    borderBottom: '2px solid var(--border-medium)',
    fontWeight: 'bold' as const,
    color: 'var(--text-muted)',
  },
  td: {
    padding: 'var(--space-2)',
    borderBottom: '1px solid var(--border-light)',
  },
  stepNumber: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    background: 'var(--grey-200)',
    border: '1px solid var(--border-medium)',
    fontWeight: 'bold' as const,
    marginRight: 'var(--space-2)',
  },
  statBox: {
    background: 'var(--grey-50)',
    border: '1px solid var(--border-light)',
    padding: 'var(--space-3)',
    textAlign: 'center' as const,
  },
  statValue: {
    fontSize: '10pt',
    fontWeight: 'bold' as const,
  },
  statLabel: {
    fontSize: '8pt',
    color: 'var(--text-muted)',
  },
  toolCard: {
    background: 'var(--white)',
    border: '2px solid var(--border-medium)',
    padding: 'var(--space-3)',
    marginBottom: 'var(--space-2)',
  },
  toolName: {
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    fontSize: '8pt',
    marginBottom: '4px',
  },
  toolDesc: {
    color: 'var(--text-muted)',
    fontSize: '8pt',
    marginBottom: '6px',
  },
};

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: 'relative' }}>
      <pre style={styles.codeBlock}>{code}</pre>
      <button
        onClick={copy}
        style={{
          position: 'absolute',
          top: 'var(--space-2)',
          right: 'var(--space-2)',
          ...styles.buttonSecondary,
          padding: '2px 8px',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function DevelopersPage() {
  const [activeTab, setActiveTab] = useState<'mcp' | 'rest' | 'changelog'>('mcp');

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>Nuke API & MCP Server</div>
        <div style={styles.subtitle}>
          Vehicle intelligence for AI agents. 758K profiles, AI valuations, image identification.
        </div>
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
          <Link to="/settings/api-keys">
            <button style={styles.button}>Get API Key</button>
          </Link>
          <a href="https://github.com/sss97133/nuke-mcp-server" target="_blank" rel="noreferrer">
            <button style={styles.buttonSecondary}>GitHub</button>
          </a>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <div style={styles.statBox}>
            <div style={styles.statValue}>758K</div>
            <div style={styles.statLabel}>vehicles</div>
          </div>
          <div style={styles.statBox}>
            <div style={styles.statValue}>627K</div>
            <div style={styles.statLabel}>observations</div>
          </div>
          <div style={styles.statBox}>
            <div style={styles.statValue}>181</div>
            <div style={styles.statLabel}>extractors</div>
          </div>
          <div style={styles.statBox}>
            <div style={styles.statValue}>1M+</div>
            <div style={styles.statLabel}>images</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div style={styles.nav}>
        {(['mcp', 'rest', 'changelog'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={styles.navButton(activeTab === tab)}
          >
            {tab === 'mcp' ? 'MCP Server' : tab === 'rest' ? 'REST API' : 'Changelog'}
          </button>
        ))}
      </div>

      {/* MCP Server Tab */}
      {activeTab === 'mcp' && (
        <div>
          {/* Quick Install */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Install</div>
            <CodeBlock code="npx -y @sss97133/nuke-mcp-server" />
          </div>

          {/* Setup */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Setup</div>

            <div style={styles.card}>
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <span style={styles.stepNumber}>1</span>
                <span style={{ fontWeight: 'bold' }}>Get your API key</span>
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                Sign up and generate a key from Settings.
              </div>
              <Link to="/settings/api-keys" style={styles.link}>
                Go to API Keys →
              </Link>
            </div>

            <div style={styles.card}>
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <span style={styles.stepNumber}>2</span>
                <span style={{ fontWeight: 'bold' }}>Configure your AI client</span>
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                Add to Claude Desktop, Claude Code, or Cursor:
              </div>
              <CodeBlock
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
            </div>

            <div style={styles.card}>
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <span style={styles.stepNumber}>3</span>
                <span style={{ fontWeight: 'bold' }}>Ask your AI</span>
              </div>
              <div style={{ color: 'var(--text-muted)' }}>
                Try: "What's a 1973 Porsche 911 worth?" or "What car is in this photo?"
              </div>
            </div>
          </div>

          {/* Tools */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>6 Tools</div>
            {mcpTools.map((tool) => (
              <div key={tool.name} style={styles.toolCard}>
                <div style={styles.toolName}>{tool.name}</div>
                <div style={styles.toolDesc}>{tool.description}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                  <div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px' }}>Input</div>
                    <pre style={{ ...styles.codeBlock, margin: 0, padding: '6px 8px' }}>{tool.example}</pre>
                  </div>
                  <div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px' }}>Output</div>
                    <pre style={{ ...styles.codeBlock, margin: 0, padding: '6px 8px' }}>{tool.response}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Data Sources */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Data Sources</div>
            <div style={styles.card}>
              <div style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>
                Bring a Trailer, Cars & Bids, RM Sotheby's, Mecum, Gooding, Bonhams,
                eBay Motors, Craigslist, Facebook Marketplace, Hagerty, PCarMarket,
                Collecting Cars, forums, and more. All data points have provenance
                tracking and confidence scores.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REST API Tab */}
      {activeTab === 'rest' && (
        <div>
          {/* Auth */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Authentication</div>
            <div style={styles.card}>
              <div style={{ marginBottom: 'var(--space-2)' }}>
                Include your API key in every request:
              </div>
              <CodeBlock code={`X-API-Key: nk_live_xxxxxxxxxxxxx`} />
              <div style={{ color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                Or use Bearer token: Authorization: Bearer [jwt]
              </div>
            </div>
          </div>

          {/* Rate Limits */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Rate Limits</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
              <div style={styles.statBox}>
                <div style={styles.statValue}>1,000</div>
                <div style={styles.statLabel}>req/hour</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statValue}>100</div>
                <div style={styles.statLabel}>max per page</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statValue}>24,000</div>
                <div style={styles.statLabel}>req/day</div>
              </div>
            </div>
          </div>

          {/* Endpoints */}
          <div style={styles.sectionTitle}>Endpoints</div>
          {restEndpoints.map((category) => (
            <div key={category.category} style={styles.section}>
              <div style={{ fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
                {category.category}
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
                {category.description}
              </div>
              {category.items.map((endpoint) => (
                <div key={endpoint.path} style={styles.card}>
                  <span style={styles.methodBadge(endpoint.method)}>{endpoint.method}</span>
                  <code style={{ fontFamily: 'monospace' }}>{endpoint.path}</code>
                  <div style={{ color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                    {endpoint.description}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Example */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Example: Search Vehicles</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Request</div>
                <CodeBlock
                  code={`curl -X POST "${API_BASE}/universal-search" \\
  -H "X-API-Key: nk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "1967 Mustang", "limit": 5}'`}
                />
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Response</div>
                <CodeBlock
                  code={`{
  "results": [{
    "id": "8aece928-...",
    "type": "vehicle",
    "title": "1967 Ford Mustang Fastback",
    "subtitle": "$45,750"
  }],
  "total_count": 2,
  "search_time_ms": 159
}`}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Changelog */}
      {activeTab === 'changelog' && (
        <div>
          <div style={styles.sectionTitle}>Changelog</div>
          {changelog.map((release) => (
            <div key={release.version} style={styles.card}>
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <span style={{ fontWeight: 'bold', marginRight: 'var(--space-2)' }}>
                  {release.version}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{release.date}</span>
              </div>
              {release.changes.map((change, i) => (
                <div key={i} style={{ marginBottom: 'var(--space-1)' }}>
                  <span style={styles.changeBadge(change.type)}>{change.type}</span>
                  {change.text}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{
        marginTop: 'var(--space-5)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-light)',
        color: 'var(--text-muted)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>github.com/sss97133/nuke-mcp-server</span>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Link to="/settings/api-keys" style={styles.link}>API Keys</Link>
            <Link to="/settings/usage" style={styles.link}>Usage</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
