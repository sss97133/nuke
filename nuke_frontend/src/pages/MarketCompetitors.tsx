import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SHARE_URL  = 'https://nuke.ag/market/partners';
const SHARE_TEXT = 'Nuke partners with Rally, TheCarCrowd, MCQ Markets, and Fraction Motors — bringing real transaction data and data-informed buyers to fractional vehicle platforms.';

// ─── Data ────────────────────────────────────────────────────────────────────

interface Partner {
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
  what_they_have: string;
  partnership_opportunity: string;
}

interface CapabilityRow {
  category: string;
  capability: string;
  description: string;
  platforms: Record<string, boolean>;
}

const PARTNERS: Partner[] = [
  {
    id: 'rally',
    name: 'Rally',
    url: 'rallyrd.com',
    tagline: 'Invest in iconic collectibles',
    founded: '2017',
    hq: 'New York, NY',
    model: 'SEC Reg A+, individual asset IPOs + secondary market',
    minInvestment: '$14.25\u2013$212.50/share (cars)',
    vehiclesOffered: '9 active cars ($2.07M market cap)',
    aum: '~$40M (all assets)',
    regulatory: 'SEC Reg A+',
    what_they_have: 'Proven SEC Reg A+ infrastructure, established secondary market, 200K+ user base, 8-year track record in fractional collectibles. 9 active car listings across sports cars, classics, and exotics.',
    partnership_opportunity: "Rally's car listings are priced via Hagerty appraisals \u2014 subjective estimates. Nuke's real transaction data (1.25M vehicles, 15+ auction sources) can power real-market NAV for their listings. Our data API can replace appraisal-based pricing with auction-close-based pricing, and our investor base of data-driven buyers would bring fresh demand to their secondary market.",
  },
  {
    id: 'carcrowd',
    name: 'TheCarCrowd',
    url: 'thecarcrowd.uk',
    tagline: 'Fractional classic car syndicates',
    founded: '2019',
    hq: 'Newark, UK',
    model: 'Private syndicates per car',
    minInvestment: '\u00a32,000\u2013\u00a35,000/slot',
    vehiclesOffered: '40+ cars (UK syndicate model)',
    aum: '~\u00a32\u20138M (est.)',
    regulatory: 'Private syndicate model',
    what_they_have: 'Largest classic car fractional platform by vehicle count (40+ cars), 7,000+ member community, established UK market presence, curation expertise for classic British and European vehicles, and hands-on vehicle management experience.',
    partnership_opportunity: "TheCarCrowd has more cars under management than any other platform, but their pricing is based on directors' estimates. Nuke's comps engine provides real comparable sales data for each vehicle. A data partnership would give their 7,000 members transparent market-rate pricing \u2014 and introduce their inventory to US investors via Nuke's platform.",
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
    what_they_have: 'SEC Reg A+ infrastructure, $20/share minimum (most accessible price point in the market), focus on blue-chip exotics (Lamborghini, Lexus LFA, Ferrari), motorsports community connections via co-founder Lachlan DeFrancesco.',
    partnership_opportunity: "Most aligned US partner. MCQ picks cars by feel and motorsports relationships \u2014 compelling curation, but no data layer. Nuke's comps engine and vision AI can validate MCQ's pricing before IPO, give buyers confidence in NAV, and surface MCQ listings to Nuke's data-driven investor audience. Natural fit for API integration.",
  },
  {
    id: 'fractionmotors',
    name: 'Fraction Motors',
    url: 'fractionmotors.com',
    tagline: 'Blockchain-tokenized collector cars',
    founded: '2022',
    hq: 'Birmingham, AL',
    model: 'Blockchain tokenization \u2014 100,000 tokens per vehicle (USDC)',
    minInvestment: 'Sub-$1',
    vehiclesOffered: '5 cars ($284.4K total appraised)',
    aum: 'Early stage',
    regulatory: 'Blockchain model',
    what_they_have: 'Sub-$1 minimum investment (lowest entry point in the market), blockchain-native architecture enabling micro-fractional ownership, diverse vehicle selection from muscle cars to classic VWs, and early-adopter community.',
    partnership_opportunity: "Fraction Motors has the most accessible entry point in the market \u2014 sub-$1 fractions could unlock a completely new class of collectors. Their blockchain model needs a credible pricing layer. Nuke's transaction data and comps engine can provide real market valuations for their tokenized vehicles. A data partnership brings credibility and price transparency to their platform.",
  },
];

// What each platform specializes in \u2014 complementary capabilities map
const CAPABILITIES: CapabilityRow[] = [
  {
    category: 'Inventory',
    capability: 'Blue-chip exotics',
    description: 'Ferraris, Lamborghinis, Porsches \u2014 trophy asset focus',
    platforms: { rally: true, carcrowd: false, mcqmarkets: true, fractionmotors: false },
  },
  {
    category: 'Inventory',
    capability: 'Classic / vintage',
    description: 'Pre-1980 collector vehicles, British and European classics',
    platforms: { rally: true, carcrowd: true, mcqmarkets: false, fractionmotors: true },
  },
  {
    category: 'Inventory',
    capability: 'Working-class collectibles',
    description: 'Muscle cars, trucks, barn finds \u2014 broader market access',
    platforms: { rally: false, carcrowd: false, mcqmarkets: false, fractionmotors: true },
  },
  {
    category: 'Market Access',
    capability: 'SEC Reg A+ (US retail)',
    description: 'Full SEC registration for US retail investor access',
    platforms: { rally: true, carcrowd: false, mcqmarkets: true, fractionmotors: false },
  },
  {
    category: 'Market Access',
    capability: 'Continuous secondary market',
    description: 'Trade shares anytime after IPO',
    platforms: { rally: true, carcrowd: false, mcqmarkets: true, fractionmotors: true },
  },
  {
    category: 'Market Access',
    capability: 'Sub-$25 minimum entry',
    description: 'Accessible to first-time fractional investors',
    platforms: { rally: true, carcrowd: false, mcqmarkets: true, fractionmotors: true },
  },
  {
    category: 'Market Access',
    capability: 'UK / European market',
    description: 'Established presence outside the US',
    platforms: { rally: false, carcrowd: true, mcqmarkets: false, fractionmotors: false },
  },
  {
    category: 'Platform',
    capability: 'Established user base (100K+)',
    description: 'Proven community of fractional investors',
    platforms: { rally: true, carcrowd: true, mcqmarkets: false, fractionmotors: false },
  },
  {
    category: 'Platform',
    capability: 'Mobile app',
    description: 'Native iOS/Android trading experience',
    platforms: { rally: true, carcrowd: false, mcqmarkets: false, fractionmotors: true },
  },
  {
    category: 'Platform',
    capability: 'Blockchain / tokenization',
    description: 'On-chain ownership and micro-fractionalization',
    platforms: { rally: false, carcrowd: false, mcqmarkets: false, fractionmotors: true },
  },
  {
    category: 'Platform',
    capability: 'Motorsports / collector community',
    description: 'Deep connections to car enthusiast networks',
    platforms: { rally: true, carcrowd: true, mcqmarkets: true, fractionmotors: false },
  },
];

const NUKE_VALUE_PROPS = [
  {
    title: 'Real transaction data \u2014 not appraisals',
    body: '1.25M vehicles across 15+ auction sources. Most fractional platforms price via Hagerty appraisals or directors\u2019 estimates. Nuke prices from real auction closes. Integrating our data layer means NAV grounded in what the market actually pays.',
  },
  {
    title: 'Comps engine \u2014 per-vehicle pricing intelligence',
    body: 'For any VIN or YMM, Nuke surfaces comparable sales with dates, condition adjustments, and platform breakdown. Partner platforms can embed this at IPO time to validate offering price and give investors confidence they\u2019re buying at market.',
  },
  {
    title: 'Vision AI \u2014 automated condition assessment',
    body: 'YONO (our vision model) classifies vehicle condition, zones of damage or modification, and originality from photos. Partner platforms submit photos; we return condition scores. Replaces subjective curation with consistent, data-backed grading.',
  },
  {
    title: 'Data API \u2014 build on our intelligence layer',
    body: 'api.nuke.ag exposes comps, valuations, market trends, and vehicle history as a developer API. Partner platforms integrate once and gain access to 1.25M vehicles of pricing history. TypeScript SDK available at npmjs.com/@nuke1/sdk.',
  },
  {
    title: 'Investor distribution \u2014 data-driven buyers',
    body: "Nuke\u2019s investor base comes for the data. They trust market-rate valuations, not appraisals. When a partner platform lists a vehicle with Nuke data behind the pricing, it unlocks a new buyer segment that currently can\u2019t find a fractional platform they trust.",
  },
];

// \u2500\u2500\u2500 Component \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export default function MarketCompetitors() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Nuke Partner Ecosystem \u2014 Fractional Vehicle Platforms';

    const setMeta = (sel: string, attr: string, val: string) => {
      const el = document.querySelector(sel);
      if (el) el.setAttribute(attr, val);
    };
    setMeta('meta[name="description"]',         'content', SHARE_TEXT);
    setMeta('meta[property="og:title"]',        'content', 'Nuke Partner Ecosystem \u2014 Fractional Vehicle Platforms');
    setMeta('meta[property="og:description"]',  'content', SHARE_TEXT);
    setMeta('meta[property="og:url"]',          'content', SHARE_URL);
    setMeta('meta[name="twitter:title"]',       'content', 'Nuke Partner Ecosystem \u2014 Fractional Vehicle Platforms');
    setMeta('meta[name="twitter:description"]', 'content', SHARE_TEXT);

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

  const categories = ['All', ...Array.from(new Set(CAPABILITIES.map(f => f.category)))];
  const visibleCapabilities = activeCategory === 'All'
    ? CAPABILITIES
    : CAPABILITIES.filter(f => f.category === activeCategory);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>
              Partner Ecosystem \u2014 Fractional Vehicle Platforms
            </h1>
            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
              These platforms have fractions to sell. Nuke has the data and the clients. Together we can move a market that&apos;s under $100M AUM against a $37B opportunity.
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
            <button className="button button-secondary" onClick={() => navigate('/market/segments')}>
              Exchange
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market')}>
              Back
            </button>
          </div>
        </div>

        {/* Partnership model callout */}
        <div style={{
          padding: '18px 24px',
          border: '2px solid var(--accent, #2563eb)',
          borderRadius: '6px',
          background: 'color-mix(in srgb, var(--accent) 4%, transparent)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '13px', marginBottom: '4px' }}>The model</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Fractional platforms have curated vehicles and legal infrastructure. Nuke has real transaction data, a comps engine, and data-driven investors. Partnerships create a better product for buyers \u2014 and more demand for sellers.
            </div>
          </div>
          <div style={{ display: 'grid', gap: '8px' }}>
            <ModelPill label="Partners bring" value="Inventory, regulation, curation" color="var(--accent, #2563eb)" />
            <ModelPill label="Nuke brings" value="Data, pricing, investor distribution" color="var(--success, #059669)" />
            <ModelPill label="Buyers get" value="Market-rate NAV, real comps, confidence" color="var(--warning-text, #b45309)" />
          </div>
        </div>

        {/* Partner cards */}
        <div>
          <h2 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Platform Profiles
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
            {PARTNERS.map(p => (
              <div key={p.id} className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h3 className="heading-3">{p.name}</h3>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.url}</span>
                </div>
                <div className="card-body" style={{ display: 'grid', gap: '10px', fontSize: '11px' }}>
                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{p.tagline}</div>
                  <div style={{ display: 'grid', gap: '4px' }}>
                    <Row label="Founded"    value={p.founded} />
                    <Row label="HQ"         value={p.hq} />
                    <Row label="Model"      value={p.model} />
                    <Row label="Min invest" value={p.minInvestment} />
                    <Row label="Coverage"   value={p.vehiclesOffered} />
                    <Row label="Regulatory" value={p.regulatory} />
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', display: 'grid', gap: '8px' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' }}>What they have</div>
                      <div style={{ fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>{p.what_they_have}</div>
                    </div>
                    <div style={{ background: 'color-mix(in srgb, var(--accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)', borderRadius: '4px', padding: '8px 10px' }}>
                      <div style={{ fontWeight: 700, fontSize: '10px', color: 'var(--accent, #2563eb)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' }}>Partnership opportunity</div>
                      <div style={{ fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>{p.partnership_opportunity}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Capability map */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 className="heading-3">Platform Capability Map</h3>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>What each partner brings to the ecosystem \u2014 complementary, not competing</div>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    padding: '3px 9px',
                    fontSize: '11px',
                    fontWeight: 600,
                    fontFamily: 'Arial, sans-serif',
                    border: '1px solid var(--border)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    background: activeCategory === cat ? 'var(--accent, #2563eb)' : 'var(--surface)',
                    color: activeCategory === cat ? 'var(--text-on-accent, #fff)' : 'var(--text)',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg)' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap', minWidth: '200px' }}>
                    Capability
                  </th>
                  {PARTNERS.map(p => (
                    <th key={p.id} style={{
                      padding: '10px 16px',
                      textAlign: 'center',
                      fontWeight: 800,
                      whiteSpace: 'nowrap',
                      minWidth: '90px',
                    }}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleCapabilities.map((row, i) => {
                  const prevCategory = i > 0 ? visibleCapabilities[i - 1].category : null;
                  const showDivider = row.category !== prevCategory;

                  return (
                    <React.Fragment key={row.capability}>
                      {showDivider && (
                        <tr>
                          <td colSpan={PARTNERS.length + 1} style={{
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
                          <div style={{ fontWeight: 600 }}>{row.capability}</div>
                          <div style={{ fontSize: '7.5pt', color: 'var(--text-muted)', marginTop: '2px' }}>{row.description}</div>
                        </td>
                        {PARTNERS.map(p => {
                          const has = row.platforms[p.id] ?? false;
                          return (
                            <td key={p.id} style={{ padding: '9px 16px', textAlign: 'center' }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '3px',
                                background: has ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--text) 4%, transparent)',
                                color: has ? 'var(--success)' : 'var(--text-muted)',
                                fontWeight: 800,
                                fontSize: '13px',
                                minWidth: '28px',
                              }}>
                                {has ? '\u2713' : '\u2014'}
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
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-muted)' }}>
            \u2713 = platform has this capability \u00b7 \u2014 = not a focus area \u00b7 Green cells highlight what each partner brings to the ecosystem
          </div>
        </div>

        {/* What Nuke brings */}
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">What Nuke Brings to Partners</h3>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>The intelligence layer that makes fractional vehicle investing data-credible</div>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: '14px' }}>
            {NUKE_VALUE_PROPS.map((prop, i) => (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '4px 1fr',
                gap: '14px',
              }}>
                <div style={{ background: 'var(--accent, #2563eb)', borderRadius: '2px' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '9.5pt', marginBottom: '4px' }}>{prop.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6 }}>{prop.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Integration paths */}
        <div>
          <h2 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Integration Paths
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <IntegrationCard
              title="Data API"
              subtitle="Any platform"
              color="color-mix(in srgb, var(--accent) 8%, transparent)"
              accentColor="var(--accent, #1d4ed8)"
              body="Partners call api.nuke.ag with a VIN or YMM. We return real comparable sales, auction history, condition flags, and a market-based valuation. Embed in IPO prospectus, listing page, or investor dashboard. TypeScript SDK available."
            />
            <IntegrationCard
              title="Vision AI"
              subtitle="Condition grading"
              color="color-mix(in srgb, var(--success) 8%, transparent)"
              accentColor="var(--success, #059669)"
              body="Submit vehicle photo sets to our YONO vision API. We return zone-level condition scores (exterior, interior, engine bay), modification flags, and an originality rating. Replaces subjective curation with consistent machine-graded assessment."
            />
            <IntegrationCard
              title="Listing Distribution"
              subtitle="Demand generation"
              color="color-mix(in srgb, var(--success) 8%, transparent)"
              accentColor="var(--success, #059669)"
              body="Partner fractions surfaced to Nuke's investor base \u2014 data-driven buyers who've already vetted market pricing via our platform. Distribution to users who trust auction-close NAV, not appraisals. Natural demand for well-priced inventory."
            />
            <IntegrationCard
              title="Co-branded Pricing Badge"
              subtitle="Investor trust layer"
              color="color-mix(in srgb, var(--warning) 8%, transparent)"
              accentColor="var(--warning-text, #b45309)"
              body="Partner listings show 'Priced with Nuke data' \u2014 linking to our comps report for the vehicle. Transparent pricing builds buyer confidence, reduces negotiation friction, and positions the platform as data-forward in a market that runs on appraisals."
            />
          </div>
        </div>

        {/* Market opportunity stats */}
        <div style={{
          padding: '16px 20px',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          background: 'var(--surface)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '16px',
          textAlign: 'center',
        }}>
          <StatBlock value="$37\u201343B" label="Annual classic car market" />
          <StatBlock value="<$100M" label="Total fractional AUM today" />
          <StatBlock value="<0.3%" label="Market fractionalized so far" />
          <StatBlock value="1.25M" label="Vehicles in Nuke's database" />
          <StatBlock value="15+" label="Auction sources tracked" />
          <StatBlock value="$1.38B\u2192$4.13B" label="Fractional market forecast (2024\u21922033)" />
        </div>

        {/* CTA */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
          <div style={{
            padding: '20px',
            border: '2px solid var(--accent, #2563eb)',
            borderRadius: '6px',
            background: 'color-mix(in srgb, var(--accent) 4%, transparent)',
          }}>
            <div style={{ fontWeight: 800, fontSize: '13px', marginBottom: '6px' }}>Platform partnership inquiry</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px', lineHeight: 1.5 }}>
              Running a fractional vehicle platform? Talk to us about data API integration, co-branded pricing, or listing distribution to Nuke investors.
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <a
                href="mailto:info@nuke.ag?subject=Platform%20Partnership%20Inquiry"
                className="button button-primary"
                style={{ textDecoration: 'none' }}
              >
                Contact us
              </a>
              <button className="button button-secondary" onClick={() => navigate('/offering')}>
                Data Room
              </button>
            </div>
          </div>

          <div style={{
            padding: '20px',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--surface)',
          }}>
            <div style={{ fontWeight: 800, fontSize: '13px', marginBottom: '6px' }}>Invest via Nuke</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px', lineHeight: 1.5 }}>
              Invest in segment ETFs (PORS, TRUK, SQBD, Y79) or browse individual vehicle offerings \u2014 priced with real auction data, not appraisals.
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="button button-primary" onClick={() => navigate('/market/segments')}>
                Go to Exchange
              </button>
              <button className="button button-secondary" onClick={() => navigate('/market/portfolio')}>
                Portfolio
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// \u2500\u2500\u2500 Sub-components \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  );
}

function ModelPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
      <span style={{ color: 'var(--text-muted)', minWidth: '90px' }}>{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

function IntegrationCard({ title, subtitle, color, accentColor, body }: {
  title: string;
  subtitle: string;
  color: string;
  accentColor: string;
  body: string;
}) {
  return (
    <div style={{
      padding: '16px',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      background: color,
      display: 'grid',
      gap: '6px',
    }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{subtitle}</div>
      <div style={{ fontWeight: 800, fontSize: '13px', color: accentColor }}>{title}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--accent, #2563eb)' }}>{value}</div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
    </div>
  );
}
