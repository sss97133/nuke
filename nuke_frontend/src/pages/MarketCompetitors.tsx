import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SHARE_URL  = 'https://nuke.ag/market/competitors';
const SHARE_TEXT = 'Nuke vs. Rally, TheCarCrowd, Fraction Motors — every fractional vehicle ownership platform compared. Real transaction data on 1.25M vehicles.';

// ─── Data ────────────────────────────────────────────────────────────────────

type Tier = 'strong' | 'partial' | 'none' | 'na';

interface Competitor {
  id: string;
  name: string;
  url: string;
  tagline: string;
  founded: string;
  hq: string;
  model: string;
  minInvestment: string;
  vehiclesOffered: string;
  aum: string;
  regulatory: string;
  notes: string;
  isNuke?: boolean;
}

interface FeatureRow {
  category: string;
  feature: string;
  description: string;
  scores: Record<string, Tier>;
}

const COMPETITORS: Competitor[] = [
  {
    id: 'nuke',
    name: 'Nuke',
    url: '#',
    tagline: 'Data-grounded fractional ownership with 1.25M vehicle price history',
    founded: '2024',
    hq: 'US',
    model: 'Segment ETFs + individual vehicle shares',
    minInvestment: '$1',
    vehiclesOffered: '1.25M tracked',
    aum: '—',
    regulatory: 'MVP',
    notes: 'Only platform with proprietary transaction data across 15+ auction sources. NAV computed from real market closes, not appraiser estimates.',
    isNuke: true,
  },
  {
    id: 'rally',
    name: 'Rally',
    url: 'rallyrd.com',
    tagline: 'Invest in iconic collectibles',
    founded: '2017',
    hq: 'New York, NY',
    model: 'SEC Reg A+, individual asset IPOs + secondary market',
    minInvestment: '$14.25–$212.50/share',
    vehiclesOffered: '9 cars ($2.07M total market cap)',
    aum: 'Undisclosed',
    regulatory: 'SEC Reg A+',
    notes: '9 verified car listings: BMW 850CSi ($142.5K, $14.25/share), Porsche 356 Speedster ($425K, $212.50/share), Ford GT ($320K), Aston Martin V8 Vantage ($297.5K), 1985 Ferrari Testarossa ($165K), Lamborghini Jalpa ($135K), Ford Mustang ($82.5K), Lotus Esprit ($77.7K). Saleen S7 ($420K) already exited. Multi-asset: cars share catalog with cards, comics, NFTs, wine.',
  },
  {
    id: 'carcrowd',
    name: 'TheCarCrowd',
    url: 'thecarcrowd.uk',
    tagline: 'Fractional classic car syndicates',
    founded: '2021',
    hq: 'Newark, UK',
    model: 'FCA-regulated car syndicates, 3–8 investors per vehicle',
    minInvestment: '£25,000–£35,000/allocation',
    vehiclesOffered: '15 vehicles (12 active, 3 planned)',
    aum: 'Undisclosed',
    regulatory: 'FCA (UK)',
    notes: 'UK-only, accredited-investor level minimums (£25K–£35K per slot). Active: Ferrari F430, Audi R8 V10 manual, Mercedes SLS, Lamborghini Gallardo (1 of 250 gated 6-speed), Porsche 996 GT3 RS (15.53% projected annual return), Aston Martin V12 Vantage. Planned: Ferrari 360 CS, Ferrari 348 TB, Lamborghini Diablo SV. 3–5 year hold, CGT-free structure.',
  },
  {
    id: 'fractionmotors',
    name: 'Fraction Motors',
    url: 'fractionmotors.com',
    tagline: 'Blockchain-tokenized collector cars',
    founded: '2022',
    hq: 'Birmingham, AL',
    model: 'Solana tokenization — 100,000 tokens per vehicle',
    minInvestment: 'Sub-$1 (fraction of 0.247–0.957 SOL)',
    vehiclesOffered: '5 cars ($284.4K total appraised)',
    aum: 'Undisclosed / early stage',
    regulatory: 'Unregulated (blockchain)',
    notes: '5 verified listings: 1965 Mustang K-Code ($95.7K, VIN 5R08K133254), 1969 Chevelle SS 396 L78 ($66.5K), 2012 Shelby GT500 ($58.4K), 1958 VW Beetle ($39.1K), 1988 Pontiac Fiero GT ($24.7K). All still available. 100k Solana tokens/car. iOS + Android app. No secondary market liquidity data yet.',
  },
  {
    id: 'ccc',
    name: 'Classic Car Collective',
    url: 'classiccarcollective.com',
    tagline: 'Fractional classic car ownership',
    founded: 'Unknown',
    hq: 'Netherlands (EU)',
    model: 'Password-gated, EUR-denominated, Shopify storefront',
    minInvestment: 'Unknown — site fully gated',
    vehiclesOffered: 'Unknown — site fully gated',
    aum: 'Unknown',
    regulatory: 'EU (unverified)',
    notes: 'Netherlands-based. Entire platform is password-protected — no public inventory, pricing, or terms. EUR-denominated, US investors cannot access. No SEC/FCA filing found. Treat as opaque until further data.',
  },
];

const FEATURES: FeatureRow[] = [
  // Data
  {
    category: 'Data',
    feature: 'Proprietary price history',
    description: 'Real transaction data from multiple auction platforms',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', fractionmotors: 'none', ccc: 'none' },
  },
  {
    category: 'Data',
    feature: 'NAV from real transactions',
    description: 'Net Asset Value computed from actual market sales, not appraiser estimates',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'partial', fractionmotors: 'none', ccc: 'none' },
  },
  {
    category: 'Data',
    feature: 'Vehicle coverage',
    description: 'Tracked vehicles with price history (Nuke: 1.25M | Rally: 9 cars | TheCarCrowd: 40+ | Fraction: 5+)',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'partial', fractionmotors: 'none', ccc: 'none' },
  },
  {
    category: 'Data',
    feature: 'Vision AI (condition/damage)',
    description: 'Automated photo analysis for condition, damage, modifications',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', fractionmotors: 'none', ccc: 'none' },
  },
  {
    category: 'Data',
    feature: 'Data API for developers',
    description: 'Programmatic access to vehicle data and market pricing',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', fractionmotors: 'partial', ccc: 'none' },
  },
  // Market structure
  {
    category: 'Market',
    feature: 'Continuous secondary market',
    description: 'Trade shares anytime with limit orders',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'partial', fractionmotors: 'partial', ccc: 'none' },
  },
  {
    category: 'Market',
    feature: 'Segment ETFs',
    description: 'Diversified exposure to vehicle categories (Porsche, Trucks, etc.)',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', fractionmotors: 'none', ccc: 'none' },
  },
  {
    category: 'Market',
    feature: 'Individual vehicle fractions',
    description: 'Invest in a specific VIN',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'strong', fractionmotors: 'strong', ccc: 'na' },
  },
  {
    category: 'Market',
    feature: 'Price-time priority order book',
    description: 'True exchange-style matching (not periodic windows or fixed NAV)',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'none', fractionmotors: 'none', ccc: 'none' },
  },
  {
    category: 'Market',
    feature: 'Min investment < $25',
    description: 'Accessible to retail investors (Rally: $14.25/share; CarCrowd: £25,000/slot; Fraction: <$1)',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'none', fractionmotors: 'strong', ccc: 'na' },
  },
  // Vehicle focus
  {
    category: 'Vehicles',
    feature: 'Vehicle-exclusive focus',
    description: 'Platform dedicated to cars (not diluted by art/cards/sneakers)',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'strong', fractionmotors: 'strong', ccc: 'strong' },
  },
  {
    category: 'Vehicles',
    feature: 'Working-class + blue chip',
    description: 'Covers trucks, project cars, barn finds — not just $500K Ferraris',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'partial', fractionmotors: 'strong', ccc: 'na' },
  },
  {
    category: 'Vehicles',
    feature: 'Comps engine',
    description: 'Automated comparable sales analysis per vehicle',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', fractionmotors: 'none', ccc: 'none' },
  },
  // Platform
  {
    category: 'Platform',
    feature: 'Regulatory status',
    description: 'SEC, FCA, or equivalent qualification',
    scores: { nuke: 'partial', rally: 'strong', carcrowd: 'strong', fractionmotors: 'none', ccc: 'partial' },
  },
  {
    category: 'Platform',
    feature: 'Mobile app',
    description: 'Native iOS/Android app',
    scores: { nuke: 'none', rally: 'strong', carcrowd: 'none', fractionmotors: 'strong', ccc: 'none' },
  },
  {
    category: 'Platform',
    feature: 'US market access',
    description: 'Available to US-based investors',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'none', fractionmotors: 'strong', ccc: 'none' },
  },
  {
    category: 'Platform',
    feature: 'Provenance tracking',
    description: 'Service records, ownership history, title chain',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', fractionmotors: 'none', ccc: 'none' },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<Tier, { label: string; bg: string; color: string }> = {
  strong:  { label: '✓',  bg: 'rgba(16,185,129,0.15)', color: '#059669' },
  partial: { label: '~',  bg: 'rgba(245,158,11,0.15)',  color: '#b45309' },
  none:    { label: '✗',  bg: 'rgba(220,38,38,0.10)',   color: '#b91c1c' },
  na:      { label: '—',  bg: 'rgba(0,0,0,0.04)',       color: 'var(--text-muted)' },
};

const NUKE_ADVANTAGES = [
  {
    title: '1.25M vehicles vs. 9 (Rally) / 15 (TheCarCrowd) / 5 (Fraction Motors)',
    body: 'Rally has 9 verified car listings totaling $2.07M in fractional market cap. TheCarCrowd has 15 UK-only syndicates. Fraction Motors has 5 Solana-tokenized cars worth $284K appraised. Nuke tracks 1.25M vehicles with real transaction history across BaT, Cars & Bids, Mecum, Bonhams, Gooding, RM Sotheby\'s, and 10+ more. That\'s not a rounding difference — it\'s a different category of product.',
  },
  {
    title: 'Real auction closes, not appraisals and projections',
    body: 'Rally prices its 9 cars using Hagerty valuations. Fraction Motors uses third-party appraisals ($24.7K–$95.7K per car). TheCarCrowd projects 15.53% annual growth on their Porsche 996 GT3 RS based on market forecasts. Nuke NAV is computed from actual auction closes. When a matching 911SC sells at BaT, our NAV updates immediately. No appraiser, no lag, no projection.',
  },
  {
    title: 'YONO: vision AI — no competitor has this',
    body: 'Rally\'s 9 cars are photographed and appraised by hand. TheCarCrowd uses expert valuers on each syndicate. Fraction Motors relies on CARFAX and appraisals. No competitor uses computer vision to assess condition, detect damage, or flag modifications. YONO runs on every photo at $0/image — a condition signal appraisers charge $500–$2,000 to produce.',
  },
  {
    title: 'Segment ETFs — nobody else offers this',
    body: 'Every competitor sells individual vehicle fractions: Rally\'s $14.25 BMW share, TheCarCrowd\'s £25K Ferrari slot, Fraction Motors\' Solana tokens. Nuke also offers segment ETFs (PORS, TRUK, SQBD, Y79) with NAV computed from the real market cap of entire vehicle categories — diversification without picking a single car.',
  },
  {
    title: 'TheCarCrowd requires £25,000 minimum. Rally: $14.25. Nuke: $1.',
    body: 'TheCarCrowd syndicates are 3–8 slots at £25,000–£35,000 each — UK-only, accredited-investor territory. Fraction Motors is technically sub-$1 but is unregulated Solana tokens with no secondary market liquidity data. Rally is $14.25/share minimum for cars. Nuke is $1 minimum, US market, with a live order book.',
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function MarketCompetitors() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [copied, setCopied] = useState(false);

  // Update document title + meta tags for Slack/WhatsApp/iMessage previews
  useEffect(() => {
    const prev = document.title;
    document.title = 'Nuke vs. Rally — Fractional Vehicle Ownership Comparison';

    const setMeta = (sel: string, attr: string, val: string) => {
      const el = document.querySelector(sel);
      if (el) el.setAttribute(attr, val);
    };
    setMeta('meta[name="description"]',           'content', SHARE_TEXT);
    setMeta('meta[property="og:title"]',          'content', 'Nuke vs. Rally — Fractional Vehicle Ownership Comparison');
    setMeta('meta[property="og:description"]',    'content', SHARE_TEXT);
    setMeta('meta[property="og:url"]',            'content', SHARE_URL);
    setMeta('meta[name="twitter:title"]',         'content', 'Nuke vs. Rally — Fractional Vehicle Ownership Comparison');
    setMeta('meta[name="twitter:description"]',   'content', SHARE_TEXT);

    return () => { document.title = prev; };
  }, []);

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({ title: document.title, url: SHARE_URL, text: SHARE_TEXT });
    } else {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const categories = ['All', ...Array.from(new Set(FEATURES.map(f => f.category)))];
  const visibleFeatures = activeCategory === 'All'
    ? FEATURES
    : FEATURES.filter(f => f.category === activeCategory);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '13pt', fontWeight: 800 }}>
              Fractional Vehicle Ownership — Market Landscape
            </h1>
            <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
              Rally: 9 cars, $2.07M market cap · TheCarCrowd: 15 vehicles, £25K min, UK-only · Fraction Motors: 5 cars, $284K appraised, Solana · vs. Nuke: 1.25M vehicles tracked
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="button button-primary"
              onClick={handleShare}
              style={{ minWidth: '100px' }}
            >
              {copied ? 'Copied!' : 'Share link'}
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market/exchange')}>
              Exchange
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market')}>
              Back
            </button>
          </div>
        </div>

        {/* Competitor cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {COMPETITORS.map(c => (
            <div key={c.id} className="card" style={{
              borderColor: c.isNuke ? 'var(--accent, #2563eb)' : 'var(--border)',
              borderWidth: c.isNuke ? '2px' : '1px',
            }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h3 className="heading-3" style={{ color: c.isNuke ? 'var(--accent, #2563eb)' : undefined }}>
                  {c.name}
                  {c.isNuke && <span style={{ marginLeft: '6px', fontSize: '7pt', fontWeight: 700, color: 'var(--accent, #2563eb)', background: 'rgba(37,99,235,0.1)', padding: '1px 5px', borderRadius: '3px' }}>THIS</span>}
                </h3>
                {c.url !== '#' && <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{c.url}</span>}
              </div>
              <div className="card-body" style={{ display: 'grid', gap: '6px', fontSize: '8.5pt' }}>
                <div style={{ color: 'var(--text-muted)' }}>{c.tagline}</div>
                <div style={{ display: 'grid', gap: '4px', marginTop: '4px' }}>
                  <Row label="Founded"    value={c.founded} />
                  <Row label="Model"      value={c.model} />
                  <Row label="Min invest" value={c.minInvestment} />
                  <Row label="Coverage"  value={c.vehiclesOffered} />
                  <Row label="AUM"        value={c.aum} />
                  <Row label="Regulatory" value={c.regulatory} />
                </div>
                <div style={{ marginTop: '6px', fontSize: '8pt', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
                  {c.notes}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Feature matrix */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <h3 className="heading-3">Feature Matrix</h3>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    padding: '3px 9px',
                    fontSize: '8pt',
                    fontWeight: 600,
                    fontFamily: 'Arial, sans-serif',
                    border: '1px solid var(--border)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    background: activeCategory === cat ? 'var(--accent, #2563eb)' : 'var(--surface)',
                    color: activeCategory === cat ? '#fff' : 'var(--text)',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg)' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap', minWidth: '200px' }}>
                    Feature
                  </th>
                  {COMPETITORS.map(c => (
                    <th key={c.id} style={{
                      padding: '10px 16px',
                      textAlign: 'center',
                      fontWeight: 800,
                      whiteSpace: 'nowrap',
                      color: c.isNuke ? 'var(--accent, #2563eb)' : undefined,
                      minWidth: '80px',
                    }}>
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleFeatures.map((row, i) => {
                  // Insert category divider when category changes
                  const prevCategory = i > 0 ? visibleFeatures[i - 1].category : null;
                  const showDivider = row.category !== prevCategory;

                  return (
                    <React.Fragment key={row.feature}>
                      {showDivider && (
                        <tr>
                          <td colSpan={COMPETITORS.length + 1} style={{
                            padding: '8px 16px 4px',
                            fontSize: '7.5pt',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            color: 'var(--text-muted)',
                            letterSpacing: '0.08em',
                            background: 'var(--bg)',
                            borderBottom: '1px solid var(--border)',
                          }}>
                            {row.category}
                          </td>
                        </tr>
                      )}
                      <tr style={{
                        borderBottom: '1px solid var(--border)',
                        background: i % 2 === 0 ? 'var(--surface)' : 'var(--bg)',
                      }}>
                        <td style={{ padding: '9px 16px' }}>
                          <div style={{ fontWeight: 600 }}>{row.feature}</div>
                          <div style={{ fontSize: '7.5pt', color: 'var(--text-muted)', marginTop: '2px' }}>{row.description}</div>
                        </td>
                        {COMPETITORS.map(c => {
                          const tier = row.scores[c.id] ?? 'na';
                          const cfg = TIER_CONFIG[tier];
                          return (
                            <td key={c.id} style={{ padding: '9px 16px', textAlign: 'center' }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '3px',
                                background: cfg.bg,
                                color: cfg.color,
                                fontWeight: 800,
                                fontSize: '10pt',
                                minWidth: '28px',
                              }}>
                                {cfg.label}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: '16px', fontSize: '8pt', color: 'var(--text-muted)' }}>
            {Object.entries(TIER_CONFIG).map(([tier, cfg]) => (
              <span key={tier} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ background: cfg.bg, color: cfg.color, fontWeight: 800, padding: '1px 6px', borderRadius: '3px' }}>{cfg.label}</span>
                {{ strong: 'Yes / Full', partial: 'Partial', none: 'No', na: 'N/A' }[tier]}
              </span>
            ))}
          </div>
        </div>

        {/* Nuke advantages deep-dive */}
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Why Nuke Wins on Data</h3>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: '14px' }}>
            {NUKE_ADVANTAGES.map((adv, i) => (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '4px 1fr',
                gap: '14px',
              }}>
                <div style={{ background: 'var(--accent, #2563eb)', borderRadius: '2px' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '9.5pt', marginBottom: '4px' }}>{adv.title}</div>
                  <div style={{ fontSize: '8.5pt', color: 'var(--text-muted)', lineHeight: 1.6 }}>{adv.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Competitive positioning summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
          <SummaryCard
            title="vs. Rally"
            verdict="$2.07M in 9 cars vs. 1.25M vehicles"
            color="rgba(37,99,235,0.12)"
            accentColor="#1d4ed8"
            body="Rally's entire car portfolio: 9 vehicles, $2.07M total market cap, $14.25–$212.50/share. Priced via Hagerty appraisals. Their Saleen S7 ($420K) already exited. Nuke has transaction history on 1.25M vehicles from real closes. Rally's moat is brand. Ours is data."
          />
          <SummaryCard
            title="vs. TheCarCrowd"
            verdict="£25,000 minimum. UK only. No US."
            color="rgba(16,185,129,0.12)"
            accentColor="#059669"
            body="15 vehicles, £25K–£35K per syndicate slot (3–8 investors per car). FCA-regulated, 3–5 year hold, CGT-free — serious product, wrong market. UK-only, no US access, no continuous order book, no transaction data. Their Porsche 996 GT3 RS projects 15.53% annual growth — from a human forecast, not auction data."
          />
          <SummaryCard
            title="vs. Fraction Motors"
            verdict="5 cars, $284K appraised, no exits yet"
            color="rgba(245,158,11,0.12)"
            accentColor="#b45309"
            body="5 Solana-tokenized cars: 1965 Mustang K-Code ($95.7K), 1969 Chevelle SS ($66.5K), 2012 GT500 ($58.4K), 1958 Beetle ($39.1K), 1988 Fiero ($24.7K). All still available — no sells, no exits, no secondary market liquidity data. Unregulated. iOS/Android app. Accessible cars, thin platform."
          />
          <SummaryCard
            title="vs. Classic Car Collective"
            verdict="Fully gated — no data available"
            color="rgba(139,92,246,0.12)"
            accentColor="#7c3aed"
            body="Netherlands-based, EUR-denominated, Shopify storefront — fully password-protected. No public inventory, no pricing, no regulatory filing found. Not accessible to US investors. Cannot verify vehicle count, returns, or business model."
          />
        </div>

        {/* Share strip */}
        <div style={{
          padding: '14px 20px',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--surface)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '8.5pt', color: 'var(--text-muted)' }}>Share this page:</span>
            <code style={{
              fontSize: '8.5pt',
              padding: '3px 8px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '3px',
              color: 'var(--text)',
              userSelect: 'all',
            }}>
              {SHARE_URL}
            </code>
          </div>
          <button className="button button-primary" onClick={handleShare}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>

        {/* CTA */}
        <div style={{
          padding: '20px',
          border: '2px solid var(--accent, #2563eb)',
          borderRadius: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'rgba(37,99,235,0.04)',
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '10pt' }}>Ready to trade?</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Invest in segment ETFs (PORS, TRUK, SQBD, Y79) or browse individual vehicle offerings.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="button button-primary" onClick={() => navigate('/market/exchange')}>
              Go to Exchange
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market/portfolio')}>
              Portfolio
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  );
}

function SummaryCard({ title, verdict, color, accentColor, body }: {
  title: string;
  verdict: string;
  color: string;
  accentColor: string;
  body: string;
}) {
  return (
    <div style={{
      padding: '16px',
      border: '2px solid var(--border)',
      borderRadius: '6px',
      background: color,
      display: 'grid',
      gap: '8px',
    }}>
      <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--text-muted)' }}>{title}</div>
      <div style={{ fontWeight: 800, fontSize: '10pt', color: accentColor }}>{verdict}</div>
      <div style={{ fontSize: '8.5pt', color: 'var(--text-muted)', lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}
