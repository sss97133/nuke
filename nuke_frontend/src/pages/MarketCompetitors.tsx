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
    notes: 'Only platform with proprietary transaction data across 15+ auction sources. NAV computed from real auction closes, not appraiser estimates. Covers every price tier from $5K barn finds to $500K Ferraris.',
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
    minInvestment: '$14.25–$212.50/share (cars)',
    vehiclesOffered: '9 active cars ($2.07M market cap)',
    aum: '~$40M (all assets)',
    regulatory: 'SEC Reg A+ · $350K SEC fine 2023',
    notes: 'Raised $112M total ($175M valuation in 2021), now last round was $0.5M in June 2025 — growth stalled. ~200–250K users (flat since 2021). SEC fined $350K in July 2023 for operating an unregistered securities exchange (2018–2021, $5.8M in secondary trades, 20K investors). 9 car listings: BMW 850CSi ($14.25/share), Porsche 356 ($212.50/share), Saleen S7 already exited. Multi-asset: cars now compete with cards, wine, comics for catalog space.',
  },
  {
    id: 'carcrowd',
    name: 'TheCarCrowd',
    url: 'thecarcrowd.uk',
    tagline: 'Fractional classic car syndicates',
    founded: '2019',
    hq: 'Newark, UK',
    model: 'Private syndicates per car — NOT FCA-regulated',
    minInvestment: '£2,000–£5,000/slot',
    vehiclesOffered: '40+ cars (UK syndicate model)',
    aum: '~£2–8M (est.)',
    regulatory: '⚠ Explicitly NOT FCA-regulated',
    notes: 'Their own FAQs state: "not regulated by the UK Financial Conduct Authority." No FSCS protection. Raised ~$2.4M total equity. 7,000+ members. Fees: 12.5% curation upfront + ~3.91%/year + up to 10% of gains on exit — PistonHeads community calculates car must appreciate ~30% before investors break even. Returns (12.6% 2023, 12.7% 2024) are directors\' paper estimates — only 2 confirmed exits. UK-only, no US access.',
  },
  {
    id: 'mcqmarkets',
    name: 'MCQ Markets',
    url: 'mcqmarkets.com',
    tagline: 'Fractional ownership in exotic collector cars',
    founded: '2022',
    hq: 'US',
    model: 'SEC Reg A+, individual car IPOs + secondary market',
    minInvestment: '$20/share',
    vehiclesOffered: 'Lamborghini Countach 5000QV, Lexus LFA, Ferrari 512 BBi',
    aum: 'Early stage',
    regulatory: 'SEC Reg A+',
    notes: 'Direct US competitor. $20/share minimum — lowest of any SEC-regulated platform. Currently listing: 1986 Lamborghini Countach 5000QV, 2012 Lexus LFA, 1984 Ferrari 512 BBi. Raised $750K Reg CF round. Also launched McQueen Garage (Dogecoin blockchain) in June 2025. Motorsports/entertainment connections via co-founder Lachlan DeFrancesco.',
  },
  {
    id: 'fractionmotors',
    name: 'Fraction Motors',
    url: 'fractionmotors.com',
    tagline: 'Blockchain-tokenized collector cars',
    founded: '2022',
    hq: 'Birmingham, AL',
    model: 'Blockchain tokenization — 100,000 tokens per vehicle (USDC)',
    minInvestment: 'Sub-$1',
    vehiclesOffered: '5 cars ($284.4K total appraised)',
    aum: 'Undisclosed / minimal',
    regulatory: '⚠ No SEC registration found',
    notes: '5 cars: 1965 Mustang K-Code ($95.7K), 1969 Chevelle SS ($66.5K), 2012 GT500 ($58.4K), 1958 Beetle ($39.1K), 1988 Fiero ($24.7K). App launched June 2024 — 2 App Store ratings total. No SEC/FINRA filing found despite selling investment interests to retail. No disclosed funding. No press coverage. Blockchain model may bypass SEC registration but creates significant legal exposure.',
  },
];

const FEATURES: FeatureRow[] = [
  // Data
  {
    category: 'Data',
    feature: 'Proprietary price history',
    description: 'Real transaction data from multiple auction platforms',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', mcqmarkets: 'none', fractionmotors: 'none' },
  },
  {
    category: 'Data',
    feature: 'NAV from real transactions',
    description: 'Net Asset Value from actual auction closes — not appraisals or director estimates',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', mcqmarkets: 'none', fractionmotors: 'none' },
  },
  {
    category: 'Data',
    feature: 'Vehicle coverage',
    description: 'Nuke: 1.25M · Rally: 9 cars · TheCarCrowd: 40+ · MCQ: 3 · Fraction: 5',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'partial', mcqmarkets: 'none', fractionmotors: 'none' },
  },
  {
    category: 'Data',
    feature: 'Vision AI (condition/damage)',
    description: 'Automated photo analysis for condition, damage, modifications',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', mcqmarkets: 'none', fractionmotors: 'none' },
  },
  {
    category: 'Data',
    feature: 'Data API for developers',
    description: 'Programmatic access to vehicle data and market pricing',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', mcqmarkets: 'none', fractionmotors: 'none' },
  },
  // Market structure
  {
    category: 'Market',
    feature: 'Continuous secondary market',
    description: 'Trade shares anytime (not periodic windows or illiquid bulletin boards)',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'none', mcqmarkets: 'strong', fractionmotors: 'partial' },
  },
  {
    category: 'Market',
    feature: 'Segment ETFs',
    description: 'Diversified exposure to vehicle categories (Porsche, Trucks, etc.)',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', mcqmarkets: 'none', fractionmotors: 'none' },
  },
  {
    category: 'Market',
    feature: 'Individual vehicle fractions',
    description: 'Invest in a specific VIN',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'strong', mcqmarkets: 'strong', fractionmotors: 'strong' },
  },
  {
    category: 'Market',
    feature: 'Price-time priority order book',
    description: 'True exchange-style matching — not periodic windows',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'none', mcqmarkets: 'strong', fractionmotors: 'none' },
  },
  {
    category: 'Market',
    feature: 'Min investment < $25',
    description: 'Nuke: $1 · MCQ: $20 · Rally: $14.25 · TheCarCrowd: £2,000 · Fraction: <$1',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'none', mcqmarkets: 'strong', fractionmotors: 'strong' },
  },
  // Vehicle focus
  {
    category: 'Vehicles',
    feature: 'Vehicle-exclusive focus',
    description: 'Platform dedicated to cars (not diluted by art/cards/sneakers)',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'strong', mcqmarkets: 'strong', fractionmotors: 'strong' },
  },
  {
    category: 'Vehicles',
    feature: 'Working-class + blue chip',
    description: 'Covers trucks, project cars, barn finds — not just $500K Ferraris',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', mcqmarkets: 'none', fractionmotors: 'strong' },
  },
  {
    category: 'Vehicles',
    feature: 'Comps engine',
    description: 'Automated comparable sales analysis per vehicle',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', mcqmarkets: 'none', fractionmotors: 'none' },
  },
  // Platform
  {
    category: 'Platform',
    feature: 'Regulatory compliance',
    description: 'SEC Reg A+ or equivalent — verified, not just claimed',
    scores: { nuke: 'partial', rally: 'partial', carcrowd: 'none', mcqmarkets: 'strong', fractionmotors: 'none' },
  },
  {
    category: 'Platform',
    feature: 'Mobile app',
    description: 'Native iOS/Android app',
    scores: { nuke: 'none', rally: 'strong', carcrowd: 'none', mcqmarkets: 'none', fractionmotors: 'strong' },
  },
  {
    category: 'Platform',
    feature: 'US market access',
    description: 'Available to US-based retail investors',
    scores: { nuke: 'strong', rally: 'strong', carcrowd: 'none', mcqmarkets: 'strong', fractionmotors: 'strong' },
  },
  {
    category: 'Platform',
    feature: 'Provenance tracking',
    description: 'Service records, ownership history, title chain',
    scores: { nuke: 'strong', rally: 'none', carcrowd: 'none', mcqmarkets: 'none', fractionmotors: 'none' },
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
    title: 'Rally raised $112M and has $40M in assets. Growth stalled in 2021.',
    body: 'Rally raised $112M total ($175M valuation in Oct 2021). Their last round was $0.5M in June 2025 — a signal the company is in maintenance mode, not growth. ~200–250K users, flat since 2021. ~$40M AUM across all assets after $112M invested. And in July 2023, the SEC fined them $350K for operating an unregistered securities exchange from 2018–2021. Their 9 car listings are priced via Hagerty appraisals. Nuke prices from real auction closes.',
  },
  {
    title: 'TheCarCrowd\'s own website: "not regulated by the FCA."',
    body: 'Press articles describe TheCarCrowd as FCA-regulated. Their own FAQ page says: "TheCarCrowd Limited offer private syndicates... which are not regulated by the UK Financial Conduct Authority. Your capital is at risk and any funds deposited are not protected by the Financial Services Compensation Scheme." The FCA connection (via Kession Capital) applies only to their equity crowdfunding raises, not the car investments.',
  },
  {
    title: 'TheCarCrowd fees: 12.5% upfront + 3.91%/year + 10% of gains.',
    body: 'PistonHeads forum community calculated that a TheCarCrowd syndicate car must appreciate approximately 30% before investors see any positive return after the 12.5% curation fee, ~4% annual operations fee over a 3–5 year hold, and 10% of any gains on exit. Their 12.6% average return (2023) is based on directors\' paper estimates — only 2 confirmed exits in 4+ years. The entire market is sub-$100M AUM.',
  },
  {
    title: 'Fraction Motors: 2 App Store reviews. No SEC registration.',
    body: 'Fraction Motors launched in June 2024 and has 2 App Store ratings. No SEC or FINRA filing found despite selling investment interests in tokenized vehicles to retail buyers. No disclosed funding. Zero press coverage. 5 cars listed totaling $284K appraised. Their blockchain model may bypass traditional securities law — or it may not, and they haven\'t tested it yet.',
  },
  {
    title: 'The entire market is under $100M AUM. It\'s wide open.',
    body: 'The global fractional classic car investment market is estimated at $1.38B in 2024 (DataIntelo), growing to $4.13B by 2033. The total classic car market is $37–43B annually. All fractional platforms combined — Rally, TheCarCrowd, MCQ Markets, Fraction Motors — hold an estimated under $100M in AUM. Less than 0.3% of the market has been fractionalized. Nuke has 1.25M vehicles tracked with real data. The timing is early.',
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
              Rally: $112M raised, 9 cars, SEC fined 2023 · TheCarCrowd: NOT FCA-regulated per own site, 12.5% fee · MCQ: $20/share, SEC Reg A+ · Fraction: 2 app reviews, no SEC filing · Total market AUM: &lt;$100M
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
            verdict="$112M raised. $40M assets. SEC fine."
            color="rgba(37,99,235,0.12)"
            accentColor="#1d4ed8"
            body="9 cars, $2.07M fractional market cap, priced via Hagerty. $112M raised but last round was $0.5M in June 2025 — stalled growth. SEC fined $350K in 2023 for running an unregistered exchange. Only documented car exit returned 17% net (not annualized) on a Mustang Cobra R. Users flat at 200–250K since 2021."
          />
          <SummaryCard
            title="vs. TheCarCrowd"
            verdict="Claims FCA. Own site says otherwise."
            color="rgba(16,185,129,0.12)"
            accentColor="#059669"
            body={'Their FAQ: "not regulated by the UK Financial Conduct Authority. Your capital is at risk and not protected by FSCS." 12.5% upfront fee + 3.91%/year + 10% of gains means ~30% appreciation needed to break even. Returns (12.6%) are directors\' paper estimates \u2014 2 confirmed exits in 4 years. \u00a32,000 minimum. UK-only.'}
          />
          <SummaryCard
            title="vs. MCQ Markets"
            verdict="Closest US comp — $20 min, SEC Reg A+"
            color="rgba(16,185,129,0.12)"
            accentColor="#059669"
            body="MCQ is the most direct US competitor: SEC Reg A+, $20/share, exotic cars (Lamborghini Countach 5000QV, Lexus LFA, Ferrari 512 BBi). $750K Reg CF raise. Early stage, small catalog. No transaction data, no comps engine, no segment ETFs. Nuke's data layer is the differentiator — MCQ picks cars the same way Rally does: by feel."
          />
          <SummaryCard
            title="vs. Fraction Motors"
            verdict="2 App Store reviews. No SEC filing."
            color="rgba(245,158,11,0.12)"
            accentColor="#b45309"
            body="5 cars ($284K total), launched June 2024, 2 App Store ratings. No SEC or FINRA registration found despite selling investment interests to retail. No disclosed funding. No press coverage. Blockchain model may bypass securities compliance — or may create significant legal exposure. Not a serious platform yet."
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
