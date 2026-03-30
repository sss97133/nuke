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
    fontSize: '11px',
    fontFamily: 'Arial, sans-serif',
    color: 'var(--text)',
    minHeight: 'calc(100vh - 60px)',
  },
  sidebar: {
    width: '200px',
    flexShrink: 0,
    borderRight: '2px solid var(--border-light)',
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
    fontSize: '9px',
    fontWeight: 'bold' as const,
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 'var(--space-2)',
  },
  sidebarLink: (active: boolean) => ({
    display: 'block',
    fontSize: '11px',
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
    fontSize: '16px',
    fontWeight: 'bold' as const,
    marginBottom: 'var(--space-2)',
  },
  h2: {
    fontSize: '13px',
    fontWeight: 'bold' as const,
    marginBottom: 'var(--space-2)',
    marginTop: 'var(--space-6)',
    paddingBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--border-light)',
  },
  h3: {
    fontSize: '12px',
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
    border: '2px solid var(--border-light)',
    padding: 'var(--space-3)',
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    overflow: 'auto' as const,
    whiteSpace: 'pre' as const,
    lineHeight: '1.5',
    marginBottom: 'var(--space-3)',
  },
  inlineCode: {
    background: 'var(--grey-200)',
    padding: '1px 4px',
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
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
    fontSize: '11px',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold' as const,
    background: method === 'GET' ? '#e8f5e9' : method === 'POST' ? '#e3f2fd' : method === 'PATCH' ? '#fff3e0' : method === 'DELETE' ? '#ffebee' : 'var(--grey-100)',
    border: '1px solid var(--border-medium)',
    marginRight: 'var(--space-2)',
  }),
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '11px',
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
    border: '2px solid var(--border-light)',
    borderLeft: '3px solid var(--text-muted)',
    padding: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
    color: 'var(--text-muted)',
    lineHeight: '1.4',
  },
  buttonPrimary: {
    fontSize: '11px',
    padding: 'var(--space-2) var(--space-4)',
    background: 'var(--text)',
    color: 'var(--white)',
    border: '2px solid var(--text)',
    cursor: 'pointer',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold' as const,
  },
  buttonSecondary: {
    fontSize: '11px',
    padding: 'var(--space-2) var(--space-4)',
    background: 'var(--grey-200)',
    border: '2px outset var(--border-light)',
    cursor: 'pointer',
    fontFamily: "'Courier New', monospace",
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
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
  },
  paramRequired: {
    color: '#d13438',
    fontSize: '9px',
    fontWeight: 'bold' as const,
  },
  paramOptional: {
    color: 'var(--text-muted)',
    fontSize: '9px',
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
          fontSize: '9px',
          color: 'var(--text-muted)',
          background: 'var(--grey-200)',
          border: '2px solid var(--border-light)',
          borderBottom: 'none',
          padding: '3px var(--space-3)',
          fontFamily: "'Courier New', monospace",
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
          fontSize: '9px',
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
            <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{p.type}</td>
            <td style={s.td}>{p.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TransformCard({ label, inputLabel, inputContent, outputLines }: {
  label: string;
  inputLabel: string;
  inputContent: React.ReactNode;
  outputLines: { key: string; value: string }[];
}) {
  return (
    <div style={{ border: '2px solid var(--border-medium)', background: 'var(--white)', marginBottom: 'var(--space-3)' }}>
      <div style={{
        padding: 'var(--space-2) var(--space-3)',
        borderBottom: '1px solid var(--border-light)',
        fontSize: '8px',
        fontWeight: 'bold' as const,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        color: 'var(--text-muted)',
      }}>
        {label}
      </div>
      <div style={{ display: 'flex' }}>
        <div style={{
          flex: 1,
          padding: 'var(--space-3)',
          borderRight: '1px solid var(--border-light)',
          display: 'flex',
          flexDirection: 'column' as const,
          justifyContent: 'center',
        }}>
          <div style={{ fontSize: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
            {inputLabel}
          </div>
          {inputContent}
        </div>
        <div style={{
          flex: 1,
          padding: 'var(--space-3)',
          fontFamily: '"Courier New", monospace',
          fontSize: '11px',
          lineHeight: '1.6',
        }}>
          <div style={{ fontSize: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 'var(--space-1)', fontFamily: 'Arial, sans-serif' }}>
            OUTPUT
          </div>
          {outputLines.map(({ key, value }) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>{key}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
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
  { id: 'vision', label: 'Vision', group: 'REST API' },
  { id: 'comps', label: 'Comps', group: 'REST API' },
  { id: 'batch', label: 'Batch Import', group: 'REST API' },
  { id: 'observations', label: 'Observations', group: 'REST API' },
  { id: 'extraction', label: 'Structuring', group: 'REST API' },
  { id: 'valuations', label: 'Valuations', group: 'REST API' },
  { id: 'signal', label: 'Deal Signals', group: 'REST API' },
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
  const [stats, setStats] = useState<{
    vehicles: string; observations: string; valuations: string; images: string;
    auctions: string; platforms: string; makes: string;
  } | null>(null);

  useEffect(() => {
    fetch(`${SUPABASE_URL}/functions/v1/db-stats`)
      .then(r => r.json())
      .then((d) => {
        const fmtK = (n: number) => n >= 1_000_000
          ? (Math.floor(n / 100_000) / 10).toFixed(1) + 'M'
          : Math.floor(n / 1_000) + 'K';
        setStats({
          vehicles:     fmtK(d.vehicles   || d.total_vehicles || 0),
          observations: fmtK(d.details?.observations?.total || d.observations || 0),
          valuations:   fmtK(d.nuke_estimates || d.details?.valuations?.nuke_estimates || 0),
          images:       fmtK(d.images     || d.total_images  || 0),
          auctions:     fmtK(d.details?.auctions?.total || d.auction_events || 227700),
          platforms:    '15+',
          makes:        '12K+',
        });
      })
      .catch(() => {});
  }, []);

  const mono = { fontFamily: '"Courier New", monospace' } as const;
  const label8 = { fontSize: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 'bold' as const } as const;
  const cardBorder = { border: '2px solid var(--border-medium)', background: 'var(--white)', marginBottom: 'var(--space-4)' } as const;

  return (
    <div>
      <h1 style={{ ...s.h1, fontSize: '18px' }}>Every vehicle. Every auction. Every data point. One API.</h1>
      <p style={s.p}>
        Nuke indexes collector vehicles across 15+ auction platforms, marketplaces, registries, and forums.
        Send a photo, a VIN, a URL, or a natural-language question — get structured intelligence back
        with provenance, confidence scoring, and real comparable sales.
      </p>

      {/* ── Stats bar ── */}
      {stats && (
        <div style={{
          display: 'flex',
          gap: 'var(--space-5)',
          marginBottom: 'var(--space-5)',
          borderTop: '2px solid var(--border-medium)',
          borderBottom: '2px solid var(--border-medium)',
          padding: 'var(--space-3) 0',
          flexWrap: 'wrap' as const,
        }}>
          {[
            { value: stats.vehicles,     label: 'Vehicles' },
            { value: stats.images,       label: 'Images' },
            { value: stats.auctions,     label: 'Auction Events' },
            { value: stats.observations, label: 'Observations' },
            { value: stats.platforms,    label: 'Platforms' },
            { value: stats.makes,        label: 'Makes' },
          ].map(({ value, label }) => (
            <div key={label}>
              <div style={{ ...mono, fontSize: '13px', fontWeight: 'bold' as const }}>{value}</div>
              <div style={label8}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Data Sources ── */}
      <div style={cardBorder}>
        <div style={{ ...label8, padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-light)' }}>
          DATA SOURCES — UNIFIED INTO ONE SCHEMA
        </div>
        <div style={{ padding: 'var(--space-3)', lineHeight: '1.8' }}>
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <span style={label8}>AUCTIONS</span>{' '}
            <span style={{ ...mono, fontSize: '10px' }}>
              Bring a Trailer · Barrett-Jackson · Mecum · RM Sotheby's · Bonhams · Gooding · Cars & Bids · PCarMarket · Collecting Cars
            </span>
          </div>
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <span style={label8}>MARKETPLACES</span>{' '}
            <span style={{ ...mono, fontSize: '10px' }}>
              Facebook Marketplace · eBay Motors · Craigslist · Hagerty · Classic.com · Hemmings
            </span>
          </div>
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <span style={label8}>REGISTRIES</span>{' '}
            <span style={{ ...mono, fontSize: '10px' }}>
              NHTSA VIN Decoder · Marque clubs · Collector databases · State DMV records
            </span>
          </div>
          <div>
            <span style={label8}>OTHER</span>{' '}
            <span style={{ ...mono, fontSize: '10px' }}>
              Forums · Service records · Restoration shops · Owner submissions · Social media
            </span>
          </div>
        </div>
      </div>

      {/* ── The Pipeline ── */}
      <h2 style={s.h2}>How Images Become Data</h2>
      <p style={s.p}>
        Every vehicle enters Nuke as raw input — a listing URL, a photo, a VIN, a text description.
        The pipeline structures it, links it, scores it, and serves it through the API.
      </p>

      <div style={{ ...cardBorder, ...mono, fontSize: '10px', padding: 'var(--space-3)', lineHeight: '2', whiteSpace: 'pre-wrap' as const }}>
{`INGEST           Raw URL, photo, or VIN enters the system
    ↓
STRUCTURE        AI extracts year, make, model, VIN, mileage,
                 color, price, seller, 40+ fields
    ↓
LINK             Entity resolution — match to existing vehicle
                 or create new record. Deduplication via VIN,
                 title similarity, and image fingerprint.
    ↓
CLASSIFY         YONO vision model runs on every image:
                 ├─ Is this a vehicle?        (binary, ~99%)
                 ├─ What family?              (8 families, ~90%)
                 ├─ What make?                (per-family, ~65%)
                 └─ 41 zone classifications   (ext/int/detail)
    ↓
ANALYZE          Condition scoring (1–10), damage detection
                 (rust, dent, crack, repaint), modification
                 flags (custom wheels, lowered, engine swap)
    ↓
OBSERVE          Every data point stored as an observation
                 with full provenance: source, URL, date,
                 extractor, confidence score
    ↓
VALUE            Comparable sales + condition + market trends
                 → estimated value with confidence interval
    ↓
SIGNAL           14 deal-health signals fire:
                 sell-through risk, price decay, completion
                 discount, geographic arbitrage, buyer
                 qualification, commission optimization...
    ↓
SERVE            One API call returns everything.`}
      </div>

      {/* ── Three capabilities with full response payloads ── */}
      <h2 style={s.h2}>What You Can Build</h2>

      {/* VISION */}
      <div style={cardBorder}>
        <div style={{ ...label8, padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-light)' }}>
          VISION — PHOTO IN, IDENTITY + VALUE OUT
        </div>
        <div style={{ padding: 'var(--space-3)' }}>
          <p style={{ ...s.p, marginBottom: 'var(--space-2)' }}>
            Send any vehicle photo. YONO classifies it locally in 4ms for $0. No cloud vision bills.
            Returns make, model, year, condition, zone analysis, damage flags, and estimated value.
          </p>
          <CodeBlock
            title="nuke.vision.analyze()"
            code={`const result = await nuke.vision.analyze({
  image_url: 'https://photos.auction.com/lot-4892.jpg'
});

// Response:
{
  "make": "Porsche",
  "model": "911 Carrera RS 2.7",
  "year": 1973,
  "confidence": 0.94,
  "condition": {
    "score": 8.2,
    "scale": "1-10",
    "zones": {
      "exterior_front": "excellent",
      "exterior_rear": "good",
      "interior_dash": "excellent",
      "engine_bay": "fair — aftermarket air filter"
    },
    "damage_flags": [],
    "modification_flags": ["aftermarket_air_filter"]
  },
  "estimated_value": 185000,
  "value_confidence": 0.87,
  "similar_vehicles": 47,
  "classification_time_ms": 4
}`}
          />
          <div style={{ ...s.note, fontSize: '10px' }}>
            YONO is trained on Nuke's own dataset. Every user correction becomes training signal.
            The model improves continuously — 35M images queued for classification at $0 total cost.
          </div>
        </div>
      </div>

      {/* MARKET DATA */}
      <div style={cardBorder}>
        <div style={{ ...label8, padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-light)' }}>
          MARKET DATA — REAL COMPS FROM REAL AUCTIONS
        </div>
        <div style={{ padding: 'var(--space-3)' }}>
          <p style={{ ...s.p, marginBottom: 'var(--space-2)' }}>
            Query comparable sales across all platforms. Every comp traces back to a real auction result
            with platform, date, hammer price, listing URL, and vehicle photos.
          </p>
          <CodeBlock
            title="nuke.comps.get()"
            code={`const comps = await nuke.comps.get({
  make: 'Porsche', model: '911', year: 1973, limit: 20
});

// Response:
{
  "summary": {
    "count": 47,
    "avg_price": 107400,
    "median_price": 88000,
    "min_price": 62000,
    "max_price": 210000,
    "auction_event_count": 39
  },
  "data": [
    {
      "year": 1973,
      "make": "Porsche",
      "model": "911 Carrera RS 2.7",
      "sale_price": 210000,
      "platform": "Bring a Trailer",
      "sold_date": "2025-11-14",
      "mileage": 42000,
      "color": "Grand Prix White",
      "image_url": "https://...",
      "listing_url": "https://bringatrailer.com/listing/..."
    },
    // ... 46 more comparable sales
  ]
}`}
          />
        </div>
      </div>

      {/* STRUCTURING */}
      <div style={cardBorder}>
        <div style={{ ...label8, padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-light)' }}>
          STRUCTURING — ANY LISTING URL → STRUCTURED DATA
        </div>
        <div style={{ padding: 'var(--space-3)' }}>
          <p style={{ ...s.p, marginBottom: 'var(--space-2)' }}>
            Point Nuke at any vehicle listing from any platform. AI extracts 40+ fields and returns
            structured, queryable data. The original page is archived — re-extract anytime without re-crawling.
          </p>
          <CodeBlock
            title="nuke.extract()"
            code={`const listing = await nuke.extract({
  url: 'https://bringatrailer.com/listing/1988-porsche-911-turbo-4/'
});

// Response:
{
  "year": 1988,
  "make": "Porsche",
  "model": "911 Turbo",
  "vin": "WP0JB0934JS050xxx",
  "mileage": 37000,
  "exterior_color": "Guards Red",
  "interior_color": "Black Leather",
  "transmission": "5-Speed Manual",
  "engine": "3.3L Turbocharged Flat-6",
  "drivetrain": "RWD",
  "sale_price": 165000,
  "seller": "PorscheCollectorCA",
  "image_urls": [
    "https://...", "https://...", "https://..."  // 48 images
  ],
  "description_length": 2400,
  "modifications": ["sport seats", "short shifter"],
  "service_history": true,
  "confidence": 0.94,
  "source": "bringatrailer.com",
  "archived": true
}`}
          />
        </div>
      </div>

      {/* VIN LOOKUP */}
      <div style={cardBorder}>
        <div style={{ ...label8, padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-light)' }}>
          VIN LOOKUP — FULL VEHICLE PROFILE IN ONE CALL
        </div>
        <div style={{ padding: 'var(--space-3)' }}>
          <p style={{ ...s.p, marginBottom: 'var(--space-2)' }}>
            Decode any VIN against NHTSA specs, pull every known observation, compute valuation,
            and return comparable sales — all in a single request.
          </p>
          <CodeBlock
            title="nuke.vinLookup.get()"
            code={`const profile = await nuke.vinLookup.get('WP0AB0916KS121279');

// Response:
{
  "vehicle": {
    "year": 1988, "make": "Porsche", "model": "911 Turbo",
    "vin": "WP0AB0916KS121279",
    "decoded": {
      "plant": "Stuttgart-Zuffenhausen",
      "body_class": "Coupe",
      "displacement_l": 3.3,
      "fuel_type": "Gasoline",
      "gvwr": "Class 1C"
    }
  },
  "valuation": {
    "estimated_value": 172000,
    "value_low": 145000,
    "value_high": 198000,
    "confidence": 0.89,
    "deal_score": 72,
    "price_tier": "collector"
  },
  "observation_count": 14,
  "image_count": 48,
  "auction_history": [
    { "platform": "Bring a Trailer", "date": "2025-11-14", "price": 165000 },
    { "platform": "RM Sotheby's", "date": "2023-08-19", "price": 154000 }
  ],
  "comps_count": 23
}`}
          />
        </div>
      </div>

      {/* OBSERVATION TIMELINE */}
      <div style={cardBorder}>
        <div style={{ ...label8, padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-light)' }}>
          OBSERVATION TIMELINE — EVERYTHING EVER KNOWN ABOUT A VEHICLE
        </div>
        <div style={{ padding: 'var(--space-3)' }}>
          <p style={{ ...s.p, marginBottom: 'var(--space-2)' }}>
            Nuke links observations from 128+ sources into a single vehicle timeline.
            Auctions, forum mentions, dealer listings, service records, owner submissions — each with
            full provenance.
          </p>
          <CodeBlock
            title="nuke.vehicleHistory.list()"
            code={`const history = await nuke.vehicleHistory.list('WP0AB0916KS121279');

// Response:
{
  "observations": [
    {
      "kind": "auction_result",
      "source": "Bring a Trailer",
      "observed_at": "2025-11-14",
      "data": { "price": 165000, "result": "sold", "bids": 47 },
      "confidence": 0.99
    },
    {
      "kind": "forum_mention",
      "source": "Rennlist",
      "observed_at": "2025-09-02",
      "data": { "thread": "FS: 88 Turbo, 37K mi, Guards Red" },
      "confidence": 0.85
    },
    {
      "kind": "service_record",
      "source": "European Auto Werks",
      "observed_at": "2025-06-15",
      "data": { "work": "Annual service, brake fluid flush" },
      "confidence": 0.92
    },
    {
      "kind": "listing",
      "source": "PCarMarket",
      "observed_at": "2024-03-10",
      "data": { "asking_price": 159000, "status": "withdrawn" },
      "confidence": 0.95
    }
    // ... 10 more observations across 6 sources
  ],
  "total_count": 14,
  "source_count": 6
}`}
          />
        </div>
      </div>

      {/* DEAL SIGNALS */}
      <div style={cardBorder}>
        <div style={{ ...label8, padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-light)' }}>
          DEAL SIGNALS — 14 PROACTIVE INTELLIGENCE WIDGETS
        </div>
        <div style={{ padding: 'var(--space-3)' }}>
          <p style={{ ...s.p, marginBottom: 'var(--space-2)' }}>
            Not just data — actionable signals. Sell-through risk, price decay, completion discount,
            geographic arbitrage, buyer qualification. Each signal has severity, score, explanation, and history.
          </p>
          <CodeBlock
            title="nuke.analysis.get()"
            code={`const signals = await nuke.analysis.get({ vehicle_id: '...' });

// Response:
{
  "deal_score": 72,
  "signals": [
    {
      "widget": "sell_through_cliff",
      "severity": "warning",
      "score": 0.65,
      "explanation": "Listed 94 days. Similar vehicles average 42 days to sale. Price reduction likely needed.",
      "data": { "days_on_market": 94, "segment_avg": 42 }
    },
    {
      "widget": "geographic_arbitrage",
      "severity": "opportunity",
      "score": 0.82,
      "explanation": "This vehicle is priced 12% below West Coast median for equivalent condition.",
      "data": { "local_median": 148000, "target_median": 172000, "delta_pct": 12 }
    },
    {
      "widget": "completion_discount",
      "severity": "info",
      "score": 0.45,
      "explanation": "Missing original radio and tool kit. Buyers discount 3-5% for incomplete cars.",
      "data": { "missing_items": ["original_radio", "tool_kit"], "estimated_discount_pct": 4 }
    }
    // ... 11 more signals
  ]
}`}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        <Link to="/settings/api-keys" style={{ ...s.buttonPrimary, textDecoration: 'none', display: 'inline-block' }}>Get API Key</Link>
        <a href="#quickstart" style={{ ...s.buttonSecondary, textDecoration: 'none', display: 'inline-block' }}>Quickstart</a>
      </div>
    </div>
  );
}

function QuickstartSection() {
  return (
    <div>
      <h1 style={s.h1}>Quickstart</h1>
      <p style={s.p}>
        Get a key from{' '}
        <Link to="/settings/api-keys" style={{ color: 'var(--text)', fontWeight: 'bold' }}>Settings &gt; API Keys</Link>.
        Keys are prefixed <code style={s.inlineCode}>nk_live_</code> for production, <code style={s.inlineCode}>nk_test_</code> for sandbox.
      </p>

      <h2 style={s.h2}>TypeScript SDK</h2>
      <CodeBlock title="Install" code="npm install @nuke1/sdk" />
      <CodeBlock
        title="Full example"
        code={`import Nuke from '@nuke1/sdk';
const nuke = new Nuke('nk_live_your_key_here');

// ─── Photo → identity, condition, value ───
const car = await nuke.vision.analyze({
  image_url: 'https://photos.auction.com/lot-4892.jpg'
});
console.log(car.make);             // "Porsche"
console.log(car.model);            // "911 Carrera RS 2.7"
console.log(car.year);             // 1973
console.log(car.condition.score);  // 8.2
console.log(car.estimated_value);  // 185000

// ─── Comparable sales across all platforms ───
const comps = await nuke.comps.get({
  make: 'Porsche', model: '911', year: 1973
});
console.log(comps.summary.count);       // 47
console.log(comps.summary.avg_price);   // 107400
console.log(comps.summary.median_price);// 88000
// comps.data[0].platform => "Bring a Trailer"
// comps.data[0].sale_price => 210000
// comps.data[0].listing_url => "https://bringatrailer.com/..."

// ─── VIN → full profile + valuation ───
const profile = await nuke.vinLookup.get('WP0AB0916KS121279');
console.log(profile.vehicle.model);           // "911 Turbo"
console.log(profile.vehicle.decoded.plant);   // "Stuttgart-Zuffenhausen"
console.log(profile.valuation.estimated_value); // 172000
console.log(profile.valuation.deal_score);    // 72
console.log(profile.auction_history.length);  // 2

// ─── Any listing URL → structured data ───
const listing = await nuke.extract({
  url: 'https://bringatrailer.com/listing/1988-porsche-911-turbo-4/'
});
console.log(listing.year);           // 1988
console.log(listing.engine);         // "3.3L Turbocharged Flat-6"
console.log(listing.sale_price);     // 165000
console.log(listing.image_urls.length); // 48

// ─── Market trends over time ───
const trends = await nuke.marketTrends.get({
  make: 'Porsche', model: '911', period: '1y'
});
console.log(trends.summary.trend_direction); // "appreciating"
console.log(trends.summary.price_change_pct); // 8.4

// ─── Full observation timeline ───
const history = await nuke.vehicleHistory.list('WP0AB0916KS121279');
console.log(history.total_count);   // 14 observations
console.log(history.source_count);  // 6 distinct sources
// history.observations[0].source => "Bring a Trailer"
// history.observations[1].source => "Rennlist"
// history.observations[2].source => "European Auto Werks"

// ─── Deal health signals ───
const analysis = await nuke.analysis.get({ vehicle_id: '...' });
console.log(analysis.deal_score);   // 72
// analysis.signals[0].widget => "sell_through_cliff"
// analysis.signals[0].severity => "warning"
// analysis.signals[1].widget => "geographic_arbitrage"
// analysis.signals[1].severity => "opportunity"`}
      />

      <h2 style={s.h2}>MCP Server (AI Agents)</h2>
      <p style={s.p}>
        Give Claude, Cursor, or any MCP-compatible agent direct access to vehicle intelligence.
        Your agent can search vehicles, pull comps, analyze photos, and decode VINs without writing API calls.
      </p>
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
      <div style={s.note}>
        Your agent can now handle prompts like:<br /><br />
        "What's a 1967 Shelby GT500 worth? Show me comparable sales."<br />
        "Identify the car in this photo and tell me if it's priced right."<br />
        "Find all Porsche 911s sold above $200K on Bring a Trailer in 2025."<br />
        "Decode this VIN and pull the full observation timeline."<br />
        "Is this listing a good deal? Run the deal health analysis."
      </div>

      <h2 style={s.h2}>REST API</h2>
      <p style={s.p}>
        Every SDK method maps to a REST endpoint. Works with any language.
      </p>
      <CodeBlock
        title="Comparable sales"
        code={`curl -X POST ${API_BASE}/api-v1-comps \\
  -H "X-API-Key: nk_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"make": "Porsche", "model": "911", "year": 1973}'`}
      />
      <CodeBlock
        title="VIN lookup"
        code={`curl ${API_BASE}/api-v1-vin-lookup/WP0AB0916KS121279 \\
  -H "X-API-Key: nk_live_your_key_here"`}
      />
      <CodeBlock
        title="Vision analysis"
        code={`curl -X POST ${API_BASE}/api-v1-vision \\
  -H "X-API-Key: nk_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"image_url": "https://photos.auction.com/lot-4892.jpg", "mode": "full"}'`}
      />
      <CodeBlock
        title="Search"
        code={`curl -X POST ${API_BASE}/universal-search \\
  -H "X-API-Key: nk_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "air-cooled porsche under 100k", "limit": 10}'`}
      />
      <p style={s.p}>
        <a href="#vehicles" style={{ color: 'var(--text)', fontWeight: 'bold' }}>Full endpoint reference →</a>
      </p>
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
            { ep: 'ingest', anon: '-', api: 'Write', jwt: 'Write' },
            { ep: 'compute-vehicle-valuation', anon: '-', api: 'Read', jwt: '-' },
            { ep: 'api-v1-business-data', anon: '-', api: 'Read', jwt: 'Read (own org)' },
            { ep: 'db-stats', anon: 'Read', api: 'Read', jwt: 'Read' },
          ].map((row) => (
            <tr key={row.ep}>
              <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.ep}</td>
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
                <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.type}</td>
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

function VisionSection() {
  return (
    <div>
      <h1 style={s.h1}>Vision</h1>
      <p style={s.p}>
        Send a vehicle photo. YONO — Nuke's local vision model — classifies it in 4ms for $0.
        No cloud vision bills. Returns make, model confidence, vehicle zone, condition scoring,
        damage flags, and modification detection. Full analysis adds comparable sales.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('POST')}>POST</span>
          <span>/api-v1-vision</span>
        </div>

        <ParamTable params={[
          { name: 'image_url', type: 'string', required: true, description: 'URL of the vehicle image to analyze' },
          { name: 'mode', type: 'string', description: '"classify" (make only, ~4ms) or "full" (make + condition + zones, ~5s). Default: "classify"' },
          { name: 'include_comps', type: 'boolean', description: 'Include comparable sales in response. Only applies when mode="full". Default: false' },
        ]} />

        <CodeBlock
          title="curl — classify"
          code={`curl -X POST "${API_BASE}/api-v1-vision" \\
  -H "X-API-Key: nk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"image_url": "https://photos.example.com/car.jpg", "mode": "classify"}'`}
        />

        <CodeBlock
          title="SDK — classify"
          code={`// Quick make classification (~4ms, $0)
const result = await nuke.vision.classify('https://photos.example.com/car.jpg');
console.log(result.make);       // "Porsche"
console.log(result.family);     // "german"
console.log(result.confidence); // 0.91
console.log(result.top5);       // [{ make: "Porsche", confidence: 0.91 }, ...]`}
        />

        <CodeBlock
          title="SDK — full analysis"
          code={`// Full vehicle intelligence (~5s, $0)
const analysis = await nuke.vision.analyze('https://photos.example.com/car.jpg');

console.log(analysis.make);              // "Porsche"
console.log(analysis.model);             // "911"
console.log(analysis.year_estimate);     // 1973
console.log(analysis.vehicle_zone);      // "ext_front_driver"
console.log(analysis.condition_score);   // 7.5
console.log(analysis.damage_flags);      // ["minor_scratches"]
console.log(analysis.modification_flags);// ["aftermarket_wheels"]
console.log(analysis.photo_quality);     // "high"
console.log(analysis.is_vehicle);        // true`}
        />

        <CodeBlock
          title="SDK — batch"
          code={`// Batch classification (up to 100 images, $0)
const batch = await nuke.vision.batch([
  'https://photos.example.com/car1.jpg',
  'https://photos.example.com/car2.jpg',
  'https://photos.example.com/car3.jpg',
]);
console.log(batch.count);        // 3
console.log(batch.results[0].make); // "Ford"
console.log(batch.total_time_ms);   // 12`}
        />

        <CodeBlock
          title="Response — full analysis"
          code={`{
  "make": "Porsche",
  "model": "911",
  "year_estimate": 1973,
  "family": "german",
  "confidence": 0.91,
  "top5": [
    { "make": "Porsche", "confidence": 0.91 },
    { "make": "Volkswagen", "confidence": 0.04 },
    { "make": "BMW", "confidence": 0.02 }
  ],
  "vehicle_zone": "ext_front_driver",
  "condition_score": 7.5,
  "condition_scale": "1-10",
  "damage_flags": ["minor_scratches"],
  "modification_flags": ["aftermarket_wheels"],
  "photo_quality": "high",
  "photo_type": "exterior",
  "is_vehicle": true,
  "classification_time_ms": 4,
  "analysis_time_ms": 4800
}`}
        />

        <h3 style={s.h3}>Vehicle Zones (41 zones)</h3>
        <p style={s.p}>
          YONO identifies which part of the vehicle is shown in the photo. Zones are grouped into
          exterior (ext_front_driver, ext_rear_passenger, etc.), interior (int_dashboard, int_seats, etc.),
          detail (engine_bay, undercarriage, trunk), and other (documentation, key, badge).
        </p>

        <h3 style={s.h3}>Cost</h3>
        <div style={s.note}>
          All vision endpoints are $0. YONO runs locally on Nuke's infrastructure — no cloud vision
          API calls. Classify runs in 4ms. Full analysis (with Florence-2 for zones and condition) runs in ~5s.
        </div>
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
                <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.field}</td>
                <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.type}</td>
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
                <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.field}</td>
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
                <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.period}</td>
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

function CompsSection() {
  return (
    <div>
      <h1 style={s.h1}>Comparable Sales</h1>
      <p style={s.p}>
        Find comparable vehicle sales across all tracked platforms. Returns real auction results with
        platform, date, hammer price, listing URL, and vehicle photos. Supports filtering by
        make/model/year, VIN, vehicle ID, and price range.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span style={s.methodBadge('POST')}>POST</span>
          <span>/api-v1-comps</span>
        </div>

        <ParamTable params={[
          { name: 'make', type: 'string', required: true, description: 'Vehicle make (e.g., "Porsche"). Required unless vehicle_id or vin provided.' },
          { name: 'model', type: 'string', description: 'Vehicle model (e.g., "911")' },
          { name: 'year', type: 'number', description: 'Center year for range search' },
          { name: 'year_range', type: 'number', description: 'Years +/- from center year. Default: 2' },
          { name: 'vehicle_id', type: 'uuid', description: 'Look up by Nuke vehicle ID. Auto-resolves make/model/year and excludes this vehicle from results.' },
          { name: 'vin', type: 'string', description: 'Look up by VIN. Auto-resolves make/model/year.' },
          { name: 'min_price', type: 'number', description: 'Minimum sale price filter' },
          { name: 'max_price', type: 'number', description: 'Maximum sale price filter' },
          { name: 'limit', type: 'number', description: 'Max results (1-100). Default: 20' },
        ]} />

        <CodeBlock
          title="curl"
          code={`curl "${API_BASE}/api-v1-comps?make=Porsche&model=911&year=1973&limit=20" \\
  -H "X-API-Key: nk_live_xxx"`}
        />

        <CodeBlock
          title="SDK"
          code={`// By make/model/year
const comps = await nuke.comps.get({
  make: 'Porsche',
  model: '911',
  year: 1973,
  year_range: 3,
  limit: 20,
});

console.log(comps.summary.count);        // 47
console.log(comps.summary.avg_price);    // 107400
console.log(comps.summary.median_price); // 88000

for (const c of comps.data) {
  console.log(c.year, c.make, c.model, c.sale_price, c.platform, c.sold_date);
}

// By VIN (auto-resolves make/model/year)
const comps2 = await nuke.comps.get({ vin: 'WP0AB0916KS121279' });`}
        />

        <CodeBlock
          title="Response"
          code={`{
  "summary": {
    "count": 47,
    "avg_price": 107400,
    "median_price": 88000,
    "min_price": 62000,
    "max_price": 210000,
    "auction_event_count": 39
  },
  "data": [
    {
      "vehicle_id": "a1b2c3d4-...",
      "year": 1973,
      "make": "Porsche",
      "model": "911 Carrera RS 2.7",
      "trim": "Touring",
      "vin": "9113600xxx",
      "sale_price": 210000,
      "mileage": 42000,
      "color": "Grand Prix White",
      "image_url": "https://...",
      "listing_url": "https://bringatrailer.com/listing/...",
      "platform": "Bring a Trailer",
      "platform_raw": "bat",
      "sold_date": "2025-11-14",
      "source_type": "auction_event"
    }
  ],
  "query": {
    "make": "Porsche",
    "model": "911",
    "year": 1973,
    "year_range": 2,
    "excluded_vehicle_id": null
  }
}`}
        />

        <h3 style={s.h3}>Data Sources</h3>
        <p style={s.p}>
          Comps are sourced from two systems in priority order: auction_events (real hammer prices from
          Bring a Trailer, Barrett-Jackson, Mecum, RM Sotheby's, Bonhams, Gooding, Cars & Bids,
          PCarMarket, and others) and vehicle transaction records (sale_price from dealer and marketplace listings).
          Results are deduplicated and merged.
        </p>
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
              <td style={{ ...s.td, fontFamily: "'Courier New', monospace", fontWeight: 'bold' }}>{row.field}</td>
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

      <h2 style={s.h2}>How It Works</h2>
      <p style={s.p}>
        Every data point about a vehicle — sale prices, service records, ownership changes,
        condition assessments — is stored as a queryable timeline with source attribution
        and confidence scoring. Multiple sources confirming the same fact increases confidence automatically.
      </p>
    </div>
  );
}

function ExtractionSection() {
  return (
    <div>
      <h1 style={s.h1}>Structuring</h1>
      <p style={s.p}>
        Send any car listing URL. Get structured vehicle data back — year, make, model,
        specs, price, images, location. Works with any car listing on the internet.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('POST')}>POST</span>
          <span>/ingest</span>
        </div>

        <ParamTable params={[
          { name: 'url', type: 'string', description: 'A vehicle listing URL (BaT, C&B, Hagerty, Craigslist, eBay, FB Marketplace, etc.)' },
          { name: 'text', type: 'string', description: 'Free-text vehicle description (e.g. "1980 Chevy C10 $27,500 Greeneville TN")' },
          { name: 'year', type: 'number', description: 'Vehicle year' },
          { name: 'make', type: 'string', description: 'Vehicle make' },
          { name: 'model', type: 'string', description: 'Vehicle model' },
          { name: 'vin', type: 'string', description: 'Vehicle VIN' },
          { name: 'price', type: 'number', description: 'Asking or sale price' },
          { name: 'enrich', type: 'boolean', description: 'Auto-enrich from source URL (default: true)' },
          { name: 'batch', type: 'array', description: 'Array of inputs for batch ingestion (max 50)' },
        ]} />

        <CodeBlock
          title="Example — URL"
          code={`curl -X POST "${API_BASE}/ingest" \\
  -H "Authorization: Bearer YOUR_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://carsandbids.com/auctions/xxxxxxx/2022-porsche-911-gt3"
  }'`}
        />

        <CodeBlock
          title="Example — Structured"
          code={`curl -X POST "${API_BASE}/ingest" \\
  -H "Authorization: Bearer YOUR_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "year": 1980, "make": "Chevrolet", "model": "C10",
    "price": 27500, "location": "Greeneville, TN"
  }'`}
        />

        <CodeBlock
          title="Response"
          code={`{
  "status": "created",
  "vehicle_id": "uuid-...",
  "discovery_id": "uuid-...",
  "is_new_vehicle": true,
  "source": "cars_and_bids",
  "external_id": "xxxxxxx"
}`}
        />
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
        rarity data, bid curves, market trends, and more.
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
                <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.weight}</td>
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
                <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.label}</td>
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

function SignalSection() {
  return (
    <div>
      <h1 style={s.h1}>Deal Signals</h1>
      <p style={s.p}>
        Answers "is this a good deal?" Combines comparable sales, listing price vs market, heat score,
        and auction sentiment into a single 0–100 deal score with confidence-weighted breakdown.
      </p>

      <div style={s.endpoint}>
        <div style={s.endpointHeader}>
          <span style={s.methodBadge('GET')}>GET</span>
          <span>/api-v1-signal</span>
        </div>

        <ParamTable params={[
          { name: 'vehicle_id', type: 'uuid', description: 'Nuke vehicle ID. Required if vin not provided.' },
          { name: 'vin', type: 'string', description: 'Vehicle VIN. Required if vehicle_id not provided.' },
        ]} />

        <CodeBlock
          title="curl"
          code={`curl "${API_BASE}/api-v1-signal?vehicle_id=a1b2c3d4-..." \\
  -H "X-API-Key: nk_live_xxx"`}
        />

        <CodeBlock
          title="SDK"
          code={`// Score by vehicle ID
const score = await nuke.signal.score({ vehicle_id: 'a1b2c3d4-...' });

// Score by VIN
const score = await nuke.signal.score({ vin: 'WP0AB0916KS121279' });

// Shorthand (vehicle ID string)
const score = await nuke.signal.score('a1b2c3d4-...');

console.log(score.deal_score);       // 87
console.log(score.deal_score_label); // "strong_buy"
console.log(score.price_vs_market);  // -12 (12% below market)
console.log(score.comp_count);       // 14
console.log(score.confidence);       // 0.84
console.log(score.heat_score);       // 72`}
        />

        <CodeBlock
          title="Response"
          code={`{
  "deal_score": 87,
  "deal_score_label": "strong_buy",
  "price_vs_market": -12,
  "comp_count": 14,
  "confidence": 0.84,
  "heat_score": 72,
  "signals": {
    "price_position": {
      "score": 0.92,
      "weight": 0.35,
      "detail": "Listed 12% below median comp price"
    },
    "market_heat": {
      "score": 0.72,
      "weight": 0.20,
      "detail": "Above average search volume for segment"
    },
    "condition_premium": {
      "score": 0.85,
      "weight": 0.25,
      "detail": "Photo analysis indicates above-average condition"
    },
    "sentiment": {
      "score": 0.78,
      "weight": 0.20,
      "detail": "Positive auction comment sentiment (78th percentile)"
    }
  }
}`}
        />

        <h3 style={s.h3}>Deal Score Labels</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Score</th>
              <th style={s.th}>Label</th>
              <th style={s.th}>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {[
              { score: '90–100', label: 'strong_buy', interp: 'Exceptional deal — well below market with high confidence' },
              { score: '70–89', label: 'buy', interp: 'Good deal — below market or strong fundamentals' },
              { score: '50–69', label: 'fair', interp: 'Fair price — near market value' },
              { score: '30–49', label: 'hold', interp: 'Above market — may need price reduction' },
              { score: '0–29', label: 'overpriced', interp: 'Significantly above comparable sales' },
            ].map((row) => (
              <tr key={row.label}>
                <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.score}</td>
                <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.label}</td>
                <td style={s.td}>{row.interp}</td>
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
          desc: 'Send any car listing URL. Returns structured vehicle data — year, make, model, specs, price, images.',
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
          output: '{ vehicles: [...], total: 1200000 }',
        },
      ].map((tool) => (
        <div key={tool.name} style={s.endpoint}>
          <div style={{ fontFamily: "'Courier New', monospace", fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
            {tool.name}
          </div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)', lineHeight: '1.4' }}>
            {tool.desc}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '2px' }}>Input</div>
              <pre style={{ ...s.code, margin: 0, padding: '6px 8px' }}>{tool.input}</pre>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '2px' }}>Output</div>
              <pre style={{ ...s.code, margin: 0, padding: '6px 8px' }}>{tool.output}</pre>
            </div>
          </div>
        </div>
      ))}

      <h2 style={s.h2}>Example Prompts</h2>
      <div style={s.note}>
        "What's a 1967 Shelby GT500 worth?"<br />
        "Identify the car in this photo" (paste image)<br />
        "What's in this listing? bringatrailer.com/listing/..."<br />
        "Find all air-cooled Porsches sold above $200K"<br />
        "Show me the price history for this 911"<br />
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
              <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.event}</td>
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
              <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.http}</td>
              <td style={{ ...s.td, fontFamily: "'Courier New', monospace" }}>{row.code}</td>
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
            <span style={{ fontWeight: 'bold', fontFamily: "'Courier New', monospace", marginRight: 'var(--space-2)' }}>
              {release.version}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{release.date}</span>
          </div>
          {release.changes.map((change, i) => (
            <div key={i} style={{ marginBottom: 'var(--space-1)' }}>
              <span style={{
                display: 'inline-block',
                padding: '1px 6px',
                fontSize: '9px',
                fontFamily: "'Courier New', monospace",
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
  vision: VisionSection,
  comps: CompsSection,
  batch: BatchSection,
  observations: ObservationsSection,
  extraction: ExtractionSection,
  valuations: ValuationsSection,
  signal: SignalSection,
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
          <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
            Nuke Docs
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
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
