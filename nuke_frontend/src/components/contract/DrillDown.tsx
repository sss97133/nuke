import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

/**
 * DrillDown — click-to-expand contextual info panel for financial/legal concepts.
 *
 * Every data point in the Contract Station should be wrapped in a DrillDown
 * so humans understand what they're looking at and agents can parse the
 * structured data attributes.
 *
 * Usage:
 *   <DrillDown concept="reg_d" value="REG D">
 *     REG D
 *   </DrillDown>
 */

// Knowledge base: every concept the contract station surfaces
const CONCEPTS: Record<string, ConceptDef> = {
  // Regulatory
  reg_d: {
    title: 'SEC Regulation D',
    category: 'regulatory',
    summary: 'Private placement exemption from SEC registration.',
    detail: 'Allows companies to raise unlimited capital from accredited investors without registering with the SEC. Most common exemption for private funds.',
    requirements: ['Net worth > $1M (excl. primary residence)', 'Annual income > $200K ($300K joint)', 'Or: certain professional certifications (Series 7, 65, 82)'],
    restrictions: ['Securities are restricted 6-12 months', 'No general solicitation under Rule 506(b)', 'General solicitation OK under Rule 506(c) with verification'],
    rules: ['Rule 504: Up to $10M', 'Rule 506(b): Unlimited, up to 35 non-accredited', 'Rule 506(c): Unlimited, accredited only, ads OK'],
  },
  reg_a: {
    title: 'SEC Regulation A (Mini-IPO)',
    category: 'regulatory',
    summary: 'Simplified public offering up to $75M.',
    detail: 'Tier 1: up to $20M (state review required). Tier 2: up to $75M (SEC-qualified, ongoing reporting).',
    requirements: ['Open to non-accredited investors', 'Tier 2: non-accredited limited to 10% of income or net worth'],
  },
  reg_cf: {
    title: 'Regulation Crowdfunding',
    category: 'regulatory',
    summary: 'Raise up to $5M via SEC-registered funding portals.',
    detail: 'Investment limits based on income and net worth. Must use a registered intermediary.',
    requirements: ['All investors eligible', 'Annual limits: greater of $2,500 or 5% of income/net worth (if either < $124K)'],
  },
  private_placement: {
    title: 'Private Placement',
    category: 'regulatory',
    summary: 'Private securities offering not registered with regulators.',
    detail: 'Terms set by offering documents. Investor qualifications vary by jurisdiction.',
  },
  public: {
    title: 'Public Offering',
    category: 'regulatory',
    summary: 'Fully SEC-registered securities available to all investors.',
    detail: 'Full disclosure requirements, ongoing reporting, freely tradeable.',
  },

  // Entity types
  limited_partnership: {
    title: 'Limited Partnership (LP)',
    category: 'entity',
    summary: 'GP manages, LPs invest passively with limited liability.',
    detail: 'Most common structure for investment funds. General partner bears unlimited liability and management responsibility. Limited partners risk only their investment.',
    tax: 'Pass-through — K-1 income/losses flow to partners. No entity-level federal tax.',
  },
  llc: {
    title: 'Limited Liability Company',
    category: 'entity',
    summary: 'Flexible entity with limited liability for all members.',
    detail: 'Operating agreement governs management, distributions, and voting. Can be member-managed or manager-managed.',
    tax: 'Default pass-through. Can elect S-Corp or C-Corp taxation.',
  },
  spv: {
    title: 'Special Purpose Vehicle',
    category: 'entity',
    summary: 'Single-purpose entity isolating assets from parent.',
    detail: 'Created specifically for one deal or asset basket. Bankruptcy-remote — if SPV fails, parent is protected and vice versa.',
    tax: 'Depends on SPV structure (typically LLC pass-through).',
  },
  trust: {
    title: 'Trust',
    category: 'entity',
    summary: 'Trustee holds assets for beneficiaries.',
    detail: 'Used for estate planning, asset protection, and institutional investing. Grantor trust is tax-transparent.',
    tax: 'Grantor trust: transparent. Non-grantor: compressed tax brackets.',
  },
  corporation: {
    title: 'Corporation',
    category: 'entity',
    summary: 'Separate legal entity with shareholder governance.',
    detail: 'Board of directors, officers, annual meetings. Most structured governance.',
    tax: 'C-Corp: double taxation (corporate + dividend). S-Corp: pass-through with restrictions.',
  },

  // Contract types
  etf: {
    title: 'Exchange-Traded Fund',
    category: 'contract_type',
    summary: 'Basket of assets traded as a single instrument.',
    detail: 'Diversified exposure to curated vehicles. Daily NAV calculation. Can be bought/sold like securities.',
  },
  equity_fund: {
    title: 'Equity Fund',
    category: 'contract_type',
    summary: 'Collection of equity/ownership positions.',
    detail: 'Holds equity stakes in vehicles, businesses, and projects. Returns come from asset appreciation and profit sharing.',
  },
  bond_fund: {
    title: 'Bond Fund',
    category: 'contract_type',
    summary: 'Collection of fixed-income bonds.',
    detail: 'Holds vehicle-backed bonds with fixed coupon payments. Income-oriented with lower risk than equity.',
  },
  hybrid: {
    title: 'Hybrid Fund',
    category: 'contract_type',
    summary: 'Mix of vehicles, bonds, stakes, and organizations.',
    detail: 'Diversified across asset classes — equity upside from vehicles + income from bonds + growth from stakes.',
  },
  project_fund: {
    title: 'Project Fund',
    category: 'contract_type',
    summary: 'Investment in specific build or restoration projects.',
    detail: 'Funds a defined project (garage build, restoration, event) with target timeline and exit strategy.',
  },
  organization_fund: {
    title: 'Organization Fund',
    category: 'contract_type',
    summary: 'Investment in workshop/business operations.',
    detail: 'Holds positions in automotive businesses — shops, dealerships, event spaces, storage facilities.',
  },
  real_estate_fund: {
    title: 'Real Estate Fund',
    category: 'contract_type',
    summary: 'Investment in automotive-adjacent real estate.',
    detail: 'Garages, showrooms, event venues, storage facilities, tracks. Real estate appreciation + rental income + event revenue. The physical layer of the collector car ecosystem.',
  },
  venue_fund: {
    title: 'Venue Fund',
    category: 'contract_type',
    summary: 'Real estate + events combo investment.',
    detail: 'Owns the property AND the events hosted there. Triple-engine returns: real estate appreciation, vehicle storage fees, and event revenue. The automotive compound model.',
  },
  custom: {
    title: 'Custom Structure',
    category: 'contract_type',
    summary: 'Bespoke investment structure with mixed asset classes.',
    detail: 'May combine vehicles, real estate, events, bonds, equity stakes, and organizational positions. Structure defined by curator. Most flexible but requires careful due diligence.',
  },

  // Transparency
  full: {
    title: 'Full Transparency',
    category: 'transparency',
    summary: 'All holdings visible, real-time updates.',
    detail: 'Every asset, valuation, and transaction is visible to investors. Maximum accountability.',
  },
  partial: {
    title: 'Partial Transparency',
    category: 'transparency',
    summary: 'Aggregated data, periodic updates.',
    detail: 'Asset type breakdown and performance visible. Individual positions may be masked. Updated monthly.',
  },
  minimal: {
    title: 'Minimal Transparency',
    category: 'transparency',
    summary: 'High-level performance only.',
    detail: 'Only NAV and return metrics visible. Holdings not disclosed. Common in hedge fund structures.',
  },

  // Financial concepts
  inflation_hedge: {
    title: 'Inflation Hedge',
    category: 'financial',
    summary: 'Assets that preserve purchasing power as currency devalues.',
    detail: 'Collector vehicles are real, tangible assets with intrinsic scarcity. Unlike cash or bonds, their value tends to rise with or above inflation. The Hagerty Blue Chip Index has outperformed CPI by 2-4% annually over 20 years.',
    context: 'Related concepts: Store of Value, Real Assets, Alternative Investments, Veblen Goods.',
  },
  store_of_value: {
    title: 'Store of Value',
    category: 'financial',
    summary: 'An asset that maintains its value over time.',
    detail: 'Collector vehicles satisfy the store-of-value criteria: scarcity (limited production), durability (with proper storage), cultural significance (growing demand), and provenance (documented history increases value).',
  },
  alternative_investment: {
    title: 'Alternative Investment',
    category: 'financial',
    summary: 'Assets outside traditional stocks, bonds, and cash.',
    detail: 'Collector vehicles join real estate, art, wine, and private equity as alternative investments. Key advantage: low correlation to public equity markets (historically 0.05-0.15 with S&P 500).',
  },

  // Risk
  conservative: {
    title: 'Conservative Risk',
    category: 'risk',
    summary: 'Capital preservation focus. Lower expected returns.',
    detail: 'Blue-chip marques with established value floors. Typically includes vehicles with strong auction track records and documented provenance.',
  },
  moderate: {
    title: 'Moderate Risk',
    category: 'risk',
    summary: 'Balanced risk/return. Mix of established and emerging.',
    detail: 'Blend of blue-chip vehicles with emerging collectibles. Some allocation to bonds or funded positions.',
  },
  aggressive: {
    title: 'Aggressive Risk',
    category: 'risk',
    summary: 'Growth-oriented. Higher volatility accepted.',
    detail: 'Concentration in appreciating segments, speculative models, or active project investments. Higher potential returns with more downside risk.',
  },
  speculative: {
    title: 'Speculative Risk',
    category: 'risk',
    summary: 'High risk, high potential reward.',
    detail: 'Emerging marques, project completions, or market timing plays. Capital at risk. Not suitable for conservative investors.',
  },
};

interface ConceptDef {
  title: string;
  category: string;
  summary: string;
  detail?: string;
  requirements?: string[];
  restrictions?: string[];
  rules?: string[];
  tax?: string;
  context?: string;
}

interface DrillDownProps {
  concept: string;
  value?: string;
  children: React.ReactNode;
  inline?: boolean; // Default true — renders inline
}

export default function DrillDown({ concept, value, children, inline = true }: DrillDownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const def = CONCEPTS[concept];

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!def) return;
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left;
      let top = rect.bottom + 6;
      if (left + 360 > vw) left = vw - 370;
      if (left < 8) left = 8;
      if (top + 300 > vh) top = rect.top - 310;
      if (top < 8) top = 8;
      setPos({ top, left });
    }
    setOpen(!open);
  }, [open, def]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!def) return <>{children}</>;

  const categoryColors: Record<string, string> = {
    regulatory: '#3b82f6',
    entity: '#8b5cf6',
    contract_type: '#10b981',
    transparency: '#f59e0b',
    financial: '#ef4444',
    risk: '#f97316',
  };
  const color = categoryColors[def.category] || '#6b7280';

  return (
    <span ref={ref} style={{ position: 'relative', display: inline ? 'inline' : 'inline-flex' }}>
      <span
        onClick={handleClick}
        data-drill={concept}
        data-category={def.category}
        data-value={value || concept}
        style={{
          cursor: 'pointer',
          borderBottom: `1.5px dotted ${color}`,
          transition: 'color 0.12s',
        }}
        title={`${def.title}: ${def.summary}`}
      >
        {children}
      </span>
      {open && (
        <div
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 10001,
            width: '350px',
            background: 'var(--bg, #fff)',
            border: `2px solid ${color}`,
            borderRadius: '6px',
            boxShadow: '0 12px 36px rgba(0,0,0,0.2)',
            overflow: 'hidden',
            fontSize: '9pt',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            padding: '10px 12px',
            background: color,
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: '10pt' }}>{def.title}</div>
              <div style={{ fontSize: '7pt', opacity: 0.9, textTransform: 'uppercase', fontWeight: 700, marginTop: '2px' }}>
                {def.category.replace('_', ' ')}
              </div>
            </div>
            <X size={14} style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => setOpen(false)} />
          </div>

          {/* Body */}
          <div style={{ padding: '12px', lineHeight: '16px', maxHeight: '300px', overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, marginBottom: '6px' }}>{def.summary}</div>
            {def.detail && (
              <div style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>{def.detail}</div>
            )}
            {def.requirements && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontWeight: 700, fontSize: '8pt', textTransform: 'uppercase', marginBottom: '4px', color }}>Requirements</div>
                <ul style={{ margin: 0, paddingLeft: '16px' }}>
                  {def.requirements.map((r, i) => <li key={i} style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>{r}</li>)}
                </ul>
              </div>
            )}
            {def.restrictions && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontWeight: 700, fontSize: '8pt', textTransform: 'uppercase', marginBottom: '4px', color }}>Restrictions</div>
                <ul style={{ margin: 0, paddingLeft: '16px' }}>
                  {def.restrictions.map((r, i) => <li key={i} style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>{r}</li>)}
                </ul>
              </div>
            )}
            {def.rules && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontWeight: 700, fontSize: '8pt', textTransform: 'uppercase', marginBottom: '4px', color }}>Rules</div>
                <ul style={{ margin: 0, paddingLeft: '16px' }}>
                  {def.rules.map((r, i) => <li key={i} style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>{r}</li>)}
                </ul>
              </div>
            )}
            {def.tax && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontWeight: 700, fontSize: '8pt', textTransform: 'uppercase', marginBottom: '4px', color }}>Tax Treatment</div>
                <div style={{ color: 'var(--text-muted)' }}>{def.tax}</div>
              </div>
            )}
            {def.context && (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontStyle: 'italic', borderTop: '1px solid var(--border)', paddingTop: '6px', marginTop: '6px' }}>
                {def.context}
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

/** Export CONCEPTS for agent/test access */
export { CONCEPTS };
