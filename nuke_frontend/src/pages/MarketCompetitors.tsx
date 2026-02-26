import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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
    notes: 'Only platform with proprietary transaction data across 15+ auction sources. NAV computed from real market data, not appraiser estimates.',
    isNuke: true,
  },
  {
    id: 'rally',
    name: 'Rally',
    url: 'rallyrd.com',
    tagline: 'Invest in iconic collectibles',
    founded: '2017',
    hq: 'New York, NY',
    model: 'SEC-qualified individual asset offerings + secondary market',
    minInvestment: '$2–$50/share',
    vehiclesOffered: '~200–400 total offerings (cars + other)',
    aum: '~$100M+ AUM',
    regulatory: 'SEC Reg A+',
    notes: 'Broadest secondary market liquidity. Covers cars, watches, wine, cards. Car selection is blue-chip only (Ferrari, Porsche, classic US muscle).',
  },
  {
    id: 'collectable',
    name: 'Collectable',
    url: 'collectable.com',
    tagline: 'Own a piece of history',
    founded: '2020',
    hq: 'New York, NY',
    model: 'SEC-qualified fractional shares, trading windows',
    minInvestment: '$5–$25/share',
    vehiclesOffered: 'Limited vehicles (~20–50); focus on sports memorabilia',
    aum: 'Undisclosed',
    regulatory: 'SEC Reg A+',
    notes: 'Primarily sports memorabilia (cards, jerseys). Cars are a small slice. Trading is via periodic windows, not continuous.',
  },
  {
    id: 'otis',
    name: 'Otis',
    url: 'otis.com',
    tagline: 'Invest in culture',
    founded: '2018',
    hq: 'New York, NY',
    model: 'SEC-qualified fractional art/collectibles, secondary market via Otis Exchange',
    minInvestment: '$25/share',
    vehiclesOffered: 'Very limited vehicles; focus on art, sneakers, collectibles',
    aum: 'Acquired by Collectors Holdings 2023',
    regulatory: 'SEC Reg A+',
    notes: 'Acquired by Collectors Holdings. Vehicle focus minimal. Known for art and pop-culture collectibles.',
  },
  {
    id: 'ccc',
    name: 'Classic Car Collective',
    url: 'classiccarcollective.co.uk',
    tagline: 'Collective investment in classic cars',
    founded: '2019',
    hq: 'London, UK',
    model: 'Pooled fund — investors own fund shares, not individual vehicle fractions',
    minInvestment: '£500',
    vehiclesOffered: 'Fund-level (~40 vehicles)',
    aum: '£2M–5M',
    regulatory: 'FCA (UK)',
    notes: 'UK only. Fund model means no individual vehicle exposure or secondary market trading. Quarterly valuations.',
  },
  {
    id: 'apextrader',
    name: 'Apex Trader',
    url: '—',
    tagline: 'Fractional collector car investing',
    founded: '2022',
    hq: 'US',
    model: 'Individual vehicle fractions (early stage)',
    minInvestment: 'TBD',
    vehiclesOffered: '<10 vehicles (early stage)',
    aum: 'Pre-launch / very early',
    regulatory: 'Pre-regulatory',
    notes: 'Early-stage, car-specific competitor. Small team, minimal liquidity, no secondary market yet.',
  },
];

const FEATURES: FeatureRow[] = [
  // Data
  {
    category: 'Data',
    feature: 'Proprietary price history',
    description: 'Real transaction data from multiple auction platforms',
    scores: { nuke: 'strong', rally: 'none', collectable: 'none', otis: 'none', ccc: 'none', apextrader: 'none' },
  },
  {
    category: 'Data',
    feature: 'NAV from real transactions',
    description: 'Net Asset Value computed from actual market sales, not appraiser estimates',
    scores: { nuke: 'strong', rally: 'none', collectable: 'none', otis: 'none', ccc: 'partial', apextrader: 'none' },
  },
  {
    category: 'Data',
    feature: 'Vehicle coverage',
    description: 'Number of vehicles with price data',
    scores: { nuke: 'strong', rally: 'partial', collectable: 'none', otis: 'none', ccc: 'none', apextrader: 'none' },
  },
  {
    category: 'Data',
    feature: 'Vision AI (condition/damage)',
    description: 'Automated photo analysis for condition, damage, modifications',
    scores: { nuke: 'strong', rally: 'none', collectable: 'none', otis: 'none', ccc: 'none', apextrader: 'none' },
  },
  {
    category: 'Data',
    feature: 'Data API for developers',
    description: 'Programmatic access to vehicle data and market pricing',
    scores: { nuke: 'strong', rally: 'none', collectable: 'none', otis: 'none', ccc: 'none', apextrader: 'none' },
  },
  // Market structure
  {
    category: 'Market',
    feature: 'Continuous secondary market',
    description: 'Trade shares anytime with limit orders',
    scores: { nuke: 'strong', rally: 'strong', collectable: 'partial', otis: 'strong', ccc: 'none', apextrader: 'none' },
  },
  {
    category: 'Market',
    feature: 'Segment ETFs',
    description: 'Diversified exposure to vehicle categories (Porsche, Trucks, etc.)',
    scores: { nuke: 'strong', rally: 'none', collectable: 'none', otis: 'none', ccc: 'partial', apextrader: 'none' },
  },
  {
    category: 'Market',
    feature: 'Individual vehicle fractions',
    description: 'Invest in a specific VIN',
    scores: { nuke: 'strong', rally: 'strong', collectable: 'strong', otis: 'strong', ccc: 'none', apextrader: 'strong' },
  },
  {
    category: 'Market',
    feature: 'Price-time priority order book',
    description: 'True exchange-style matching (not periodic auction windows)',
    scores: { nuke: 'strong', rally: 'strong', collectable: 'none', otis: 'partial', ccc: 'none', apextrader: 'none' },
  },
  {
    category: 'Market',
    feature: 'Min investment < $10',
    description: 'Low barrier to entry for retail investors',
    scores: { nuke: 'strong', rally: 'strong', collectable: 'partial', otis: 'none', ccc: 'none', apextrader: 'na' },
  },
  // Vehicle focus
  {
    category: 'Vehicles',
    feature: 'Vehicle-exclusive focus',
    description: 'Platform dedicated to cars (not diluted by art/cards/sneakers)',
    scores: { nuke: 'strong', rally: 'none', collectable: 'none', otis: 'none', ccc: 'strong', apextrader: 'strong' },
  },
  {
    category: 'Vehicles',
    feature: 'Working-class + blue chip',
    description: 'Covers trucks, project cars, barn finds — not just $500K Ferraris',
    scores: { nuke: 'strong', rally: 'none', collectable: 'none', otis: 'none', ccc: 'partial', apextrader: 'partial' },
  },
  {
    category: 'Vehicles',
    feature: 'Comps engine',
    description: 'Automated comparable sales analysis per vehicle',
    scores: { nuke: 'strong', rally: 'none', collectable: 'none', otis: 'none', ccc: 'none', apextrader: 'none' },
  },
  // Platform
  {
    category: 'Platform',
    feature: 'Regulatory status',
    description: 'SEC or equivalent qualification',
    scores: { nuke: 'partial', rally: 'strong', collectable: 'strong', otis: 'strong', ccc: 'strong', apextrader: 'none' },
  },
  {
    category: 'Platform',
    feature: 'Mobile app',
    description: 'Native iOS/Android app',
    scores: { nuke: 'none', rally: 'strong', collectable: 'strong', otis: 'strong', ccc: 'none', apextrader: 'none' },
  },
  {
    category: 'Platform',
    feature: 'Provenance tracking',
    description: 'Service records, ownership history, title chain',
    scores: { nuke: 'strong', rally: 'none', collectable: 'none', otis: 'none', ccc: 'none', apextrader: 'none' },
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
    title: '1.25M vehicles with real price history',
    body: 'Rally prices assets using Hagerty valuations and third-party appraisers. Nuke NAV is computed from actual auction transactions across BaT, Cars & Bids, Mecum, Bonhams, Gooding, RM Sotheby\'s, and 10+ more. When a Porsche 911 sells, our NAV updates.',
  },
  {
    title: 'YONO: vision AI trained on collector cars',
    body: 'No competitor uses computer vision to assess condition, detect damage, or flag modifications. YONO runs on every photo at $0/image — giving Nuke a condition signal that appraisers charge $500–2000 to produce manually.',
  },
  {
    title: 'Segment ETFs grounded in real market data',
    body: 'Rally offers individual vehicles. We offer both — plus diversified segment funds (PORS, TRUK, SQBD) with NAV computed from the full market cap of that vehicle category, updated from real transactions every 4 hours.',
  },
  {
    title: 'Data moat compounds over time',
    body: 'Every extraction run adds more transaction history. Every YONO inference adds more training data. Every vehicle profile adds more provenance. Rally\'s data advantage is static (they own ~300 cars). Ours grows automatically.',
  },
  {
    title: 'API-first for the next generation of tools',
    body: 'No competitor exposes a developer API. Nuke\'s data layer powers the exchange AND is the product — insurance companies, lenders, and builders all need vehicle pricing data. Rally has no B2B play.',
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function MarketCompetitors() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<string>('All');

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
              How Nuke compares against Rally, Collectable, Otis, and other platforms
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
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
            verdict="Data beats curation"
            color="rgba(37,99,235,0.12)"
            accentColor="#1d4ed8"
            body="Rally picks blue-chip cars using human judgment. Nuke has transaction history on 1.25M vehicles. Rally's moat is brand. Ours is data — and data compounds."
          />
          <SummaryCard
            title="vs. Collectable / Otis"
            verdict="Car-native vs generalist"
            color="rgba(16,185,129,0.12)"
            accentColor="#059669"
            body="Both platforms treat cars as one asset class among many. No vehicle-specific infrastructure — no YONO, no comps, no auction data. Generic collectible platforms can't win on vehicle depth."
          />
          <SummaryCard
            title="vs. Classic Car Collective"
            verdict="Individual exposure + liquidity"
            color="rgba(245,158,11,0.12)"
            accentColor="#b45309"
            body="CCC is a UK fund with pooled exposure. No individual vehicle, no secondary market, no continuous pricing. Quarterly valuations from a human committee. We have a live order book."
          />
          <SummaryCard
            title="vs. Apex Trader"
            verdict="Infrastructure vs early stage"
            color="rgba(139,92,246,0.12)"
            accentColor="#7c3aed"
            body="Direct car-specific competitor at MVP stage. No data layer, no order book, no secondary market yet. We share the same thesis — our advantage is the data moat already built."
          />
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
