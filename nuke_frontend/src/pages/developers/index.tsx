/**
 * Developers Hub - API Documentation & Resources
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

const API_BASE = 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1';

const endpoints = [
  {
    category: 'Business Data',
    description: 'Access your business data from Telegram photo submissions',
    items: [
      { method: 'GET', path: '/api-v1-business-data/summary', description: 'Dashboard stats' },
      { method: 'GET', path: '/api-v1-business-data/submissions', description: 'Photo submissions from technicians' },
      { method: 'GET', path: '/api-v1-business-data/vehicles', description: 'Vehicles in service' },
      { method: 'GET', path: '/api-v1-business-data/technicians', description: 'Connected technicians' },
    ],
  },
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
    category: 'Observations',
    description: 'Unified event data',
    items: [
      { method: 'POST', path: '/api-v1-observations', description: 'Submit observation' },
      { method: 'GET', path: '/api-v1-observations', description: 'Query observations' },
    ],
  },
];

const changelog = [
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

// Styles following design system
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
    fontSize: '8pt',
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
    fontSize: '8pt',
    fontWeight: 'bold' as const,
  },
  statLabel: {
    fontSize: '8pt',
    color: 'var(--text-muted)',
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
  const [activeTab, setActiveTab] = useState<'quickstart' | 'reference' | 'changelog'>('quickstart');

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>Nuke API</div>
        <div style={styles.subtitle}>
          Build integrations with the collector vehicle data platform
        </div>
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
          <Link to="/settings/api-keys">
            <button style={styles.button}>Get API Key</button>
          </Link>
          <button style={styles.buttonSecondary} onClick={() => setActiveTab('quickstart')}>
            Quick Start
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div style={styles.nav}>
        {(['quickstart', 'reference', 'changelog'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={styles.navButton(activeTab === tab)}
          >
            {tab === 'quickstart' ? 'Quick Start' : tab === 'reference' ? 'API Reference' : 'Changelog'}
          </button>
        ))}
      </div>

      {/* Quick Start */}
      {activeTab === 'quickstart' && (
        <div>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Quick Start</div>

            {/* Step 1 */}
            <div style={styles.card}>
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <span style={styles.stepNumber}>1</span>
                <span style={{ fontWeight: 'bold' }}>Get your API key</span>
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                Create an API key from your settings. Keep it secure.
              </div>
              <Link to="/settings/api-keys" style={styles.link}>
                Go to API Keys →
              </Link>
            </div>

            {/* Step 2 */}
            <div style={styles.card}>
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <span style={styles.stepNumber}>2</span>
                <span style={{ fontWeight: 'bold' }}>Make your first request</span>
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                Use your API key in the X-API-Key header.
              </div>
              <CodeBlock
                code={`curl -X GET "${API_BASE}/api-v1-business-data/summary" \\
  -H "X-API-Key: nk_live_YOUR_API_KEY"`}
              />
            </div>

            {/* Step 3 */}
            <div style={styles.card}>
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <span style={styles.stepNumber}>3</span>
                <span style={{ fontWeight: 'bold' }}>Handle the response</span>
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                All responses are JSON.
              </div>
              <CodeBlock
                code={`{
  "submissions": { "today": 5, "this_week": 23 },
  "technicians_active": 3,
  "vehicles_in_service": 7
}`}
              />
            </div>
          </div>

          {/* Authentication */}
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
                <div style={styles.statValue}>∞</div>
                <div style={styles.statLabel}>no daily limit</div>
              </div>
            </div>
          </div>

          {/* Telegram */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Telegram Integration</div>
            <div style={styles.card}>
              <div style={{ fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                Photo Intake for Restoration Shops
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
                Technicians send photos via Telegram. Data flows to your API.
              </div>
              <div style={{ marginBottom: 'var(--space-1)' }}>
                1. Generate invite code for your business
              </div>
              <div style={{ marginBottom: 'var(--space-1)' }}>
                2. Technicians join via /start INVITE_CODE
              </div>
              <div>
                3. Photos appear at /api-v1-business-data/submissions
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Reference */}
      {activeTab === 'reference' && (
        <div>
          <div style={styles.sectionTitle}>API Reference</div>

          {endpoints.map((category) => (
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

          {/* Query Parameters */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Query Parameters</div>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Parameter</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={styles.td}><code>limit</code></td>
                  <td style={styles.td}>integer</td>
                  <td style={styles.td}>Max results (1-100, default 50)</td>
                </tr>
                <tr>
                  <td style={styles.td}><code>offset</code></td>
                  <td style={styles.td}>integer</td>
                  <td style={styles.td}>Pagination offset</td>
                </tr>
                <tr>
                  <td style={styles.td}><code>since</code></td>
                  <td style={styles.td}>ISO date</td>
                  <td style={styles.td}>Filter after date</td>
                </tr>
                <tr>
                  <td style={styles.td}><code>until</code></td>
                  <td style={styles.td}>ISO date</td>
                  <td style={styles.td}>Filter before date</td>
                </tr>
                <tr>
                  <td style={styles.td}><code>vehicle_id</code></td>
                  <td style={styles.td}>UUID</td>
                  <td style={styles.td}>Filter by vehicle</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Example */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Example: Get Submissions</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Request</div>
                <CodeBlock
                  code={`curl "${API_BASE}/api-v1-business-data/submissions?limit=10" \\
  -H "X-API-Key: nk_live_xxx"`}
                />
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Response</div>
                <CodeBlock
                  code={`{
  "data": [{
    "id": "abc123",
    "detected_work_type": "body_work",
    "vehicles": { "year": 1967, "make": "Chevrolet" }
  }],
  "total": 89,
  "pagination": { "hasMore": true }
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
          <span>Need help? support@nuke.dev</span>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Link to="/settings/api-keys" style={styles.link}>API Keys</Link>
            <Link to="/settings/webhooks" style={styles.link}>Webhooks</Link>
            <Link to="/settings/usage" style={styles.link}>Usage</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
