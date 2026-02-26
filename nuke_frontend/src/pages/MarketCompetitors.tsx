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
    model: 'SEC Reg A+, individual asset offerings + secondary market',
    minInvestment: '$55–$125/share (cars)',
    vehiclesOffered: '9 cars currently listed',
    aum: 'Undisclosed',
    regulatory: 'SEC Reg A+',
    notes: '9 verified car listings: 1965 Mustang ($110K market cap), Saleen S7 ($420K), Ferrari Testarossa, Porsche 356, Lotus Esprit S1, BMW 850CSi, Lamborghini Jalpa, Ford GT, Aston Martin V8 Vantage. Multi-asset platform (cars share catalog with cards, comics, NFTs).',
  },
  {
    id: 'carcrowd',
    name: 'TheCarCrowd',
    url: 'thecarcrowd.uk',
    tagline: 'Fractional classic car investment',
    founded: '2021',
    hq: 'Newark, UK',
    model: 'FCA-regulated, per-vehicle fractional shares + secondary market',
    minInvestment: '£18.90–£220/share',
    vehiclesOffered: '40+ under management; 3 live offerings',
    aum: 'Undisclosed',
    regulatory: 'FCA (UK)',
    notes: 'Largest car-specific fractional platform by asset count. 12.6% avg annual returns claimed since 2021. Current live offers: Ferrari F430, Audi R8, Mercedes SLS. 4,000+ members. UK-only market.',
  },
  {
    id: 'fractionmotors',
    name: 'Fraction Motors',
    url: 'fractionmotors.com',
    tagline: 'Own a fraction of a collectible car',
    founded: '2022',
    hq: 'Birmingham, AL',
    model: 'Solana blockchain tokenization — 100,000 tokens per vehicle',
    minInvestment: 'Sub-$1 (Solana token fractions)',
    vehiclesOffered: '5+ cars (Mustang, Chevelle, GT500, Beetle, Fiero)',
    aum: 'Undisclosed / early stage',
    regulatory: 'Unregulated (blockchain)',
    notes: 'Car-specific, blockchain-native. Appraised values $24,700–$95,700. 100k fungible tokens per vehicle traded on Solana DEX. Accessible classics (Fiero, Chevelle, Beetle — not ultra-premium). iOS + Android app.',
  },
  {
    id: 'ccc',
    name: 'Classic Car Collective',
    url: 'classiccarcollective.com',
    tagline: 'Fractional classic car ownership',
    founded: 'Unknown',
    hq: 'Netherlands (EU)',
    model: 'Password-gated platform, EUR-denominated',
    minInvestment: 'Unknown (private)',
    vehiclesOffered: 'Unknown (site is gated)',
    aum: 'Unknown',
    regulatory: 'EU (unknown specifics)',
    notes: 'Netherlands-based, EUR-denominated. Shopify-powered storefront, fully password-gated — no public data on inventory or pricing. Not accessible to US investors.',
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
    feature: 'Min investment < $10',
    description: 'Low barrier to entry for retail investors',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', fractionmotors: 'strong', ccc: 'na' },
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
    title: '1.25M vehicles vs. 9 cars (Rally) / 40 cars (TheCarCrowd)',
    body: 'Rally has 9 verified car listings. TheCarCrowd has 40+ under management. Nuke tracks 1.25M vehicles with real transaction history across BaT, Cars & Bids, Mecum, Bonhams, Gooding, RM Sotheby\'s, and 10+ more sources. That\'s not a rounding difference — it\'s a different category of product.',
  },
  {
    title: 'Real transactions, not Hagerty appraisals',
    body: 'Rally prices its assets using Hagerty valuations and third-party appraisers — estimates from humans who look at comps and write a number. Nuke NAV is computed from actual auction closes. When a matching Porsche 911SC sells for $47K at BaT, our NAV updates. No appraiser, no lag, no subjectivity.',
  },
  {
    title: 'YONO: vision AI trained on collector cars',
    body: 'No competitor uses computer vision to assess condition, detect damage, or flag modifications. YONO runs on every photo at $0/image — giving Nuke a condition signal that appraisers charge $500–2,000 to produce manually. TheCarCrowd hires human experts. We train models.',
  },
  {
    title: 'Segment ETFs — a product nobody else offers',
    body: 'Every competitor offers individual vehicle fractions. Rally (9 cars), TheCarCrowd (3 live offerings), Fraction Motors (5 cars). Nuke also offers segment ETFs — diversified funds across PORS, TRUK, SQBD, Y79 — with NAV computed from real market cap of that entire vehicle category. No one else does this.',
  },
  {
    title: 'Data moat compounds. Their inventory doesn\'t.',
    body: 'Every extraction run adds transaction history. Every YONO inference adds training data. Every vehicle profile adds provenance. Rally\'s data is static — they curated 9 cars. TheCarCrowd has 40. Nuke\'s coverage grows automatically with every auction that closes anywhere in the world.',
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
              How Nuke compares against Rally (9 cars), TheCarCrowd (40+ cars, UK), Fraction Motors (Solana), and Classic Car Collective (EU)
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
            verdict="9 cars vs. 1.25M vehicles"
            color="rgba(37,99,235,0.12)"
            accentColor="#1d4ed8"
            body="Rally has 9 verified car listings (Mustang, Saleen S7, Porsche 356, Ferrari Testarossa, etc.) priced via Hagerty appraisals. Nuke has transaction history on 1.25M vehicles from real auction closes. Rally's moat is brand. Ours is data — and data compounds."
          />
          <SummaryCard
            title="vs. TheCarCrowd"
            verdict="US access + real data"
            color="rgba(16,185,129,0.12)"
            accentColor="#059669"
            body="TheCarCrowd is the most serious car-specific competitor — FCA-regulated, 40+ assets, 12.6% claimed avg annual return since 2021. But UK-only, no US access, no continuous order book, no transaction data. Their NAV comes from expert valuations, not market closes."
          />
          <SummaryCard
            title="vs. Fraction Motors"
            verdict="Data layer vs. blockchain"
            color="rgba(245,158,11,0.12)"
            accentColor="#b45309"
            body="Fraction Motors (Solana) is car-specific and accessible (sub-$1 fractions, Fiero/Chevelle/Beetle). But unregulated, 5 cars, no auction data, no comps, no order book. Interesting tech bet. Not an investment platform yet."
          />
          <SummaryCard
            title="vs. Classic Car Collective"
            verdict="Transparent vs. gated"
            color="rgba(139,92,246,0.12)"
            accentColor="#7c3aed"
            body="CCC (Netherlands) is password-gated — no public inventory, no pricing, no SEC/FCA data available. EUR-denominated, not accessible to US investors. Unknown vehicle count. The entire platform is opaque by design."
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
