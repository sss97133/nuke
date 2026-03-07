/**
 * API Landing Page
 *
 * Route: /api
 * Three stories: the transformation, the vision, the data.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';
import type { UniversalSearchResult } from '../services/universalSearchService';
import { parseMarketQuery } from '../lib/search/marketQueryParser';

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const s = {
  page: {
    maxWidth: '720px',
    margin: '0 auto',
    padding: 'var(--space-4)',
    fontSize: '11px',
    fontFamily: 'Arial, sans-serif',
    color: 'var(--text)',
  },
  hero: {
    padding: 'var(--space-10) 0 var(--space-6)',
    marginBottom: 'var(--space-5)',
  },
  heroTitle: {
    fontSize: 'calc(16pt * var(--font-scale, 1))',
    fontWeight: 'bold' as const,
    letterSpacing: '-0.03em',
    marginBottom: 'var(--space-3)',
  },
  heroSub: {
    fontSize: 'calc(9pt * var(--font-scale, 1))',
    color: 'var(--text-muted)',
    lineHeight: '1.5',
    maxWidth: '520px',
    marginBottom: 'var(--space-5)',
  },
  section: {
    marginBottom: 'var(--space-8)',
  },
  label: {
    fontSize: '8px',
    fontWeight: 'bold' as const,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-muted)',
    marginBottom: 'var(--space-3)',
  },
  divider: {
    borderTop: '2px solid var(--border-medium)',
    marginBottom: 'var(--space-6)',
  },
  code: {
    background: 'var(--grey-100)',
    border: '1px solid var(--border-light)',
    padding: 'var(--space-3)',
    fontFamily: '"Courier New", monospace',
    fontSize: '11px',
    overflow: 'auto' as const,
    whiteSpace: 'pre' as const,
    lineHeight: '1.6',
  },
  inlineCode: {
    background: 'var(--grey-200)',
    padding: '1px 4px',
    fontFamily: '"Courier New", monospace',
    fontSize: '11px',
    border: '1px solid var(--border-light)',
  },
  prose: {
    color: 'var(--text-muted)',
    lineHeight: '1.5',
    marginBottom: 'var(--space-3)',
  },
  card: {
    background: 'var(--white)',
    border: '2px solid var(--border-medium)',
    padding: 'var(--space-3)',
  },
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
  },
  searchThumb: {
    width: '40px',
    height: '40px',
    background: 'var(--grey-200)',
    border: '1px solid var(--border-light)',
    objectFit: 'cover' as const,
    flexShrink: 0,
  },
  searchMeta: { flex: 1, minWidth: 0 },
  searchTitle: {
    fontWeight: 'bold' as const,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  },
  searchSub: { color: 'var(--text-muted)', fontSize: '11px' },
  badge: {
    display: 'inline-block',
    padding: '1px 6px',
    fontSize: '11px',
    fontFamily: '"Courier New", monospace',
    background: 'var(--grey-200)',
    border: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  btn: {
    display: 'inline-block',
    fontSize: '11px',
    padding: 'var(--space-2) var(--space-4)',
    background: 'var(--text)',
    color: 'var(--white)',
    border: '2px solid var(--text)',
    cursor: 'pointer',
    fontFamily: '"Courier New", monospace',
    fontWeight: 'bold' as const,
    textDecoration: 'none',
  },
  btnGhost: {
    fontSize: '11px',
    padding: 'var(--space-2) var(--space-4)',
    background: 'var(--grey-200)',
    border: '2px outset var(--border-light)',
    cursor: 'pointer',
    fontFamily: '"Courier New", monospace',
  },
  link: {
    color: 'var(--text)',
    fontWeight: 'bold' as const,
    textDecoration: 'underline',
    fontSize: '11px',
  },
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

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <pre style={s.code}>{children}</pre>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        style={{ position: 'absolute', top: 6, right: 6, ...s.btnGhost, padding: '2px 8px' }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

interface CompsData {
  summary: { count: number; avg_price: number; median_price: number; min_price: number; max_price: number; auction_event_count: number } | null;
  query: { make: string; model: string | null; year: number | null; year_range: number };
  data: { platform: string | null }[];
}

function formatPrice(n: number): string {
  if (n >= 1000) return '$' + Math.round(n / 1000).toLocaleString() + 'K';
  return '$' + n.toLocaleString();
}

function MarketAnswer({ comps }: { comps: CompsData }) {
  const { summary, query: q, data } = comps;
  if (!summary || summary.count === 0) return null;

  const label = [q.make, q.model].filter(Boolean).join(' ');
  const yearLabel = q.year
    ? `(${q.year - q.year_range}–${q.year + q.year_range})`
    : '';

  // Count by platform
  const platforms: Record<string, number> = {};
  for (const d of data) {
    const p = d.platform || 'Other';
    platforms[p] = (platforms[p] || 0) + 1;
  }
  const sourceList = Object.entries(platforms)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name} (${count})`)
    .join('  ');

  return (
    <div style={{ border: '2px solid var(--border-medium)', background: 'var(--white)', marginBottom: 'var(--space-3)' }}>
      <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-light)' }}>
        <div style={s.label}>MARKET DATA</div>
        <div style={{ fontWeight: 'bold' }}>
          {summary.count} comparable sale{summary.count !== 1 ? 's' : ''}
          {label && <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}> &middot; {label} {yearLabel}</span>}
        </div>
      </div>
      <div style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: '"Courier New", monospace', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ color: 'var(--text-muted)' }}>avg</span>
          <span>{formatPrice(summary.avg_price)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ color: 'var(--text-muted)' }}>median</span>
          <span>{formatPrice(summary.median_price)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ color: 'var(--text-muted)' }}>range</span>
          <span>{formatPrice(summary.min_price)} – {formatPrice(summary.max_price)}</span>
        </div>
      </div>
      {sourceList && (
        <div style={{
          padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--border-light)',
          color: 'var(--text-muted)', fontSize: '11px',
        }}>
          {sourceList}
        </div>
      )}
    </div>
  );
}

function LiveSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UniversalSearchResult[]>([]);
  const [comps, setComps] = useState<CompsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setComps(null); setMs(null); setTotal(0); return; }
    setLoading(true);
    try {
      const parsed = parseMarketQuery(q);

      // Always search entities
      const searchPromise = supabase.functions.invoke('universal-search', {
        body: { query: q.trim(), limit: 6, includeAI: false },
      });

      // If market query with a parseable make, also fetch comps
      let compsPromise: Promise<any> | null = null;
      if (parsed.isMarket && parsed.make) {
        const compsBody: Record<string, any> = { make: parsed.make, limit: 20 };
        if (parsed.model) compsBody.model = parsed.model;
        if (parsed.yearMin) compsBody.year = parsed.yearMin;
        if (parsed.yearMin && parsed.yearMax && parsed.yearMax !== parsed.yearMin) {
          compsBody.year_range = Math.max(2, Math.ceil((parsed.yearMax - parsed.yearMin) / 2));
        }
        compsPromise = supabase.functions.invoke('api-v1-comps', { body: compsBody });
      }

      const [searchRes, compsRes] = await Promise.all([
        searchPromise,
        compsPromise ?? Promise.resolve(null),
      ]);

      const { data, error } = searchRes;
      if (!error && data) {
        setResults(data.results ?? []);
        setMs(data.search_time_ms ?? null);
        setTotal(data.total_count ?? 0);
      }

      if (compsRes?.data && !compsRes.error) {
        setComps(compsRes.data);
      } else {
        setComps(null);
      }
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  const onInput = (v: string) => {
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => search(v), 300);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const hasComps = comps?.summary && comps.summary.count > 0;
  const hasResults = results.length > 0;

  return (
    <>
      <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
        <input
          type="text"
          placeholder="1973 Porsche 911, Shelby Cobra, how many Mustangs sold..."
          value={query}
          onChange={(e) => onInput(e.target.value)}
          style={s.searchInput}
        />
        {loading && (
          <span style={{
            position: 'absolute', right: 'var(--space-3)', top: '50%',
            transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace',
          }}>...</span>
        )}
      </div>
      {hasComps && <MarketAnswer comps={comps!} />}
      {hasResults && (
        <div style={{ border: '2px solid var(--border-medium)', background: 'var(--white)' }}>
          {results.map((r) => (
            <div key={r.id} style={s.searchResult}>
              {r.image_url ? (
                <img src={r.image_url} alt="" style={s.searchThumb}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : <div style={s.searchThumb} />}
              <div style={s.searchMeta}>
                <div style={s.searchTitle}>{r.title}</div>
                {r.subtitle && <div style={s.searchSub}>{r.subtitle}</div>}
              </div>
              <span style={s.badge}>{r.type}</span>
            </div>
          ))}
          <div style={{
            padding: 'var(--space-2) var(--space-3)', color: 'var(--text-muted)',
            fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{total} result{total !== 1 ? 's' : ''}</span>
            {ms !== null && <span>{ms}ms</span>}
          </div>
        </div>
      )}
      {query.trim() && !loading && !hasComps && !hasResults && (
        <div style={{ color: 'var(--text-muted)', padding: 'var(--space-3)' }}>
          No results.
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ApiLanding() {
  usePageTitle('Nuke API');

  return (
    <div style={s.page}>

      {/* ---- Hero ---- */}
      <div style={s.hero}>
        <div style={s.heroTitle}>Your raw data in.<br />Structured vehicle intelligence out.</div>
        <div style={s.heroSub}>
          Send a photo, a listing URL, a text description — whatever you have.
          No VIN required. We figure out the vehicle, the value, and the market.
        </div>
        <Code>{`import Nuke from '@nuke1/sdk';
const nuke = new Nuke('nk_live_...');

// photo → identity + value
const car = await nuke.vision.analyze({ image_url: 'https://...' });
// { year: 1973, make: "Porsche", model: "911", condition: "excellent", estimated_value: 185000 }

// text → comps
const comps = await nuke.comps.get({ make: 'Porsche', model: '911', year: 1973 });
// { avg_price: 185000, median: 172000, count: 47, results: [...] }

// search anything
const results = await nuke.search.query('air-cooled porsche under 100k');
// [{ title: "1982 Porsche 911 SC Targa", estimated_value: 78000, ... }, ...]`}</Code>
      </div>

      <div style={s.divider} />

      {/* ---- Live ---- */}
      <div style={s.section}>
        <div style={s.label}>LIVE</div>
        <LiveSearch />
      </div>

      <div style={s.divider} />

      {/* ---- Vision ---- */}
      <div style={s.section}>
        <div style={s.label}>VISION</div>
        <div style={{ fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
          Send a photo. Know the car.
        </div>
        <div style={s.prose}>
          Our model identifies the vehicle from the image alone — year, make, model,
          condition, which part of the car you're looking at, and any visible damage.
          Trained on our own data. Works on a phone photo from a parking lot.
        </div>
        <Code>{`const analysis = await nuke.vision.analyze({
  image_url: 'https://photos.example.com/img_4892.jpg'
});

// {
//   make: "Porsche",
//   model: "911",
//   year: 1973,
//   family: "german",
//   condition_score: 8.2,
//   zone: "front_three_quarter",
//   damage_flags: [],
//   modifications: [],
//   photo_quality: 4,
//   estimated_value: 185000,
//   cost_usd: 0
// }`}</Code>
        <div style={{ ...s.prose, marginTop: 'var(--space-3)', marginBottom: 0 }}>
          41 vehicle zones. 7 damage classes. 8 modification types.
          Condition scored 1–10. $0 per image — local inference, not a cloud API resale.
        </div>
      </div>

      <div style={s.divider} />

      {/* ---- Data ---- */}
      <div style={s.section}>
        <div style={s.label}>DATA</div>
        <div style={{ fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
          Every value shows its work.
        </div>
        <div style={s.prose}>
          We don't return a number and ask you to trust it. Every valuation comes with
          the comparable sales it's based on, which sources they came from, and a
          confidence score. Multiple independent sources confirm the same value —
          confidence goes up. Your users see why a car is worth what it's worth.
        </div>
        <Code>{`const val = await nuke.valuations.get({
  make: 'Porsche', model: '911', year: 1973
});

// {
//   estimated_value: 185000,
//   confidence: 0.92,
//   deal_score: "fair",
//   comparables: [
//     { source: "Bring a Trailer", price: 192000, date: "2025-11-14" },
//     { source: "RM Sotheby's",    price: 178000, date: "2025-09-22" },
//     { source: "Bonhams",         price: 185000, date: "2025-06-08" }
//   ],
//   price_range: { low: 165000, high: 210000 },
//   sample_size: 47
// }`}</Code>
      </div>

      <div style={s.divider} />

      {/* ---- SDK ---- */}
      <div style={s.section}>
        <div style={s.label}>SDK</div>
        <Code>{`npm install @nuke1/sdk`}</Code>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Link to="/developers" style={s.link}>Full API reference &rarr;</Link>
        </div>
      </div>

      {/* ---- MCP ---- */}
      <div style={s.section}>
        <div style={s.label}>MCP</div>
        <div style={s.prose}>
          Add to Claude Desktop, Cursor, or any MCP client. Your agent gets vehicle
          search, valuations, comps, and vision tools automatically.
        </div>
        <Code>{`{
  "mcpServers": {
    "nuke": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-client@latest",
               "--server", "https://api.nuke.ag/functions/v1/mcp-server"]
    }
  }
}`}</Code>
      </div>

      {/* ---- REST ---- */}
      <div style={s.section}>
        <div style={s.label}>REST</div>
        <Code>{`curl https://api.nuke.ag/functions/v1/api-v1-comps?make=Porsche&model=911&year=1973 \\
  -H "X-API-Key: nk_live_..."

curl -X POST https://api.nuke.ag/functions/v1/api-v1-vision \\
  -H "X-API-Key: nk_live_..." \\
  -d '{"image_url": "https://..."}'`}</Code>
      </div>

      <div style={s.divider} />

      {/* ---- Get a key ---- */}
      <div style={s.section}>
        <div style={s.label}>GET A KEY</div>
        <div style={s.card}>
          <div style={{ marginBottom: 'var(--space-2)', lineHeight: '1.4' }}>
            Create an account, generate a key.
            Production: <span style={s.inlineCode}>nk_live_</span> —
            Sandbox: <span style={s.inlineCode}>nk_test_</span>
          </div>
          <Link to="/settings/api-keys" style={s.btn}>
            Get API Key
          </Link>
        </div>
      </div>

      {/* ---- Footer ---- */}
      <div style={s.footer}>
        <span>support@nuke.ag</span>
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
          <Link to="/developers" style={s.link}>Docs</Link>
          <Link to="/settings/api-keys" style={s.link}>Keys</Link>
        </div>
      </div>
    </div>
  );
}
