import { useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAcquisitionPipeline } from '../hooks/useAcquisitionPipeline';
import type { PipelineEntry } from '../hooks/useAcquisitionPipeline';
import '../design-system.css';

type ViewFilter = 'targets' | 'active' | 'all';

function formatPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  return '$' + n.toLocaleString();
}

function scoreBadge(score: number | null): { label: string; color: string } {
  if (!score) return { label: '—', color: '#999' };
  if (score >= 80) return { label: 'STRONG BUY', color: '#16a34a' };
  if (score >= 70) return { label: 'BUY', color: '#2563eb' };
  if (score >= 50) return { label: 'FAIR', color: '#ca8a04' };
  return { label: 'PASS', color: '#dc2626' };
}

function conditionLabel(tier: string | undefined): string {
  if (!tier) return '—';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function StageTag({ stage }: { stage: string }) {
  const colors: Record<string, string> = {
    target: '#2563eb',
    contacted: '#7c3aed',
    inspecting: '#ca8a04',
    offer_made: '#ea580c',
    under_contract: '#16a34a',
    acquired: '#059669',
    at_shop: '#0891b2',
    validated: '#4f46e5',
    listed: '#c026d3',
    sold: '#16a34a',
  };
  const bg = colors[stage] || '#6b7280';
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 3,
      fontSize: 10,
      fontWeight: 600,
      color: '#fff',
      background: bg,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    }}>
      {stage.replace(/_/g, ' ')}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background: 'var(--surface, #fff)',
      border: '1px solid var(--border, #e5e7eb)',
      padding: '12px 16px',
      flex: 1,
      minWidth: 140,
    }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text, #111)', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function DealCard({ entry, onAction }: { entry: PipelineEntry; onAction: (id: string, action: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const proof = entry.market_proof_data;
  const badge = scoreBadge(entry.deal_score);
  const hasUrl = entry.discovery_url?.startsWith('http');
  const profit = entry.estimated_profit || proof?.net_profit || 0;
  const roi = proof?.roi_pct || 0;

  return (
    <div style={{
      background: 'var(--surface, #fff)',
      border: '1px solid var(--border, #e5e7eb)',
      marginBottom: 6,
      fontSize: 12,
    }}>
      {/* Header row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ flex: '0 0 auto' }}>
          <StageTag stage={entry.stage} />
        </div>
        <div style={{ flex: 1, fontWeight: 600 }}>
          {entry.year || '?'} {entry.make} {entry.model || ''}
        </div>
        <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
          <span style={{ color: badge.color, fontWeight: 700, fontSize: 10 }}>{badge.label}</span>
          {entry.deal_score && <span style={{ color: '#999', marginLeft: 4, fontSize: 10 }}>({entry.deal_score})</span>}
        </div>
        <div style={{ flex: '0 0 80px', textAlign: 'right', fontWeight: 600 }}>
          {formatPrice(entry.asking_price)}
        </div>
        <div style={{
          flex: '0 0 80px', textAlign: 'right', fontWeight: 700,
          color: profit > 0 ? '#16a34a' : profit < 0 ? '#dc2626' : '#999',
        }}>
          {profit > 0 ? '+' : ''}{formatPrice(profit)}
        </div>
        <div style={{ flex: '0 0 50px', textAlign: 'right', color: '#6b7280', fontSize: 10 }}>
          {roi > 0 ? `${roi}%` : '—'}
        </div>
        <div style={{ flex: '0 0 16px', textAlign: 'center', color: '#999' }}>
          {expanded ? '\u25B2' : '\u25BC'}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 12px 10px', borderTop: '1px solid var(--border, #e5e7eb)' }}>
          <div style={{ display: 'flex', gap: 24, paddingTop: 8, flexWrap: 'wrap' }}>
            {/* Left: Market data */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>MARKET DATA</div>
              <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Comp Median</td><td style={{ textAlign: 'right' }}>{formatPrice(entry.comp_median)}</td></tr>
                  <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Condition</td><td style={{ textAlign: 'right' }}>{conditionLabel(proof?.condition_tier)}</td></tr>
                  <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Cost to Ready</td><td style={{ textAlign: 'right' }}>{formatPrice(proof?.cost_to_ready)}</td></tr>
                  <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Target Sale</td><td style={{ textAlign: 'right' }}>{formatPrice(proof?.target_sale_price)}</td></tr>
                  <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Total Investment</td><td style={{ textAlign: 'right' }}>{formatPrice(proof?.total_investment)}</td></tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td style={{ padding: '2px 0', borderTop: '1px solid #e5e7eb' }}>Net Profit</td>
                    <td style={{ textAlign: 'right', borderTop: '1px solid #e5e7eb', color: profit > 0 ? '#16a34a' : '#dc2626' }}>
                      {formatPrice(profit)} ({roi}% ROI)
                    </td>
                  </tr>
                </tbody>
              </table>
              {proof?.match_strategy && (
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>Comps: {proof.match_strategy}</div>
              )}
            </div>

            {/* Middle: Cost breakdown */}
            {proof?.cost_breakdown && (
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>COST BREAKDOWN</div>
                <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
                  <tbody>
                    <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Parts</td><td style={{ textAlign: 'right' }}>{formatPrice(proof.cost_breakdown.parts)}</td></tr>
                    <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Labor ({proof.cost_breakdown.labor_hours}h)</td><td style={{ textAlign: 'right' }}>{formatPrice(proof.cost_breakdown.labor)}</td></tr>
                    <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Transport</td><td style={{ textAlign: 'right' }}>{formatPrice(proof.cost_breakdown.transport)}</td></tr>
                    <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Inspection</td><td style={{ textAlign: 'right' }}>{formatPrice(proof.cost_breakdown.inspection)}</td></tr>
                    <tr><td style={{ padding: '2px 0', color: '#6b7280' }}>Listing Fees</td><td style={{ textAlign: 'right' }}>{proof.cost_breakdown.listing_fees_pct}%</td></tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Right: Location + Actions */}
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>DETAILS</div>
              <div style={{ fontSize: 11, marginBottom: 2 }}>
                {[entry.location_city, entry.location_state].filter(Boolean).join(', ') || 'Unknown location'}
              </div>
              {hasUrl && (
                <a
                  href={entry.discovery_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, color: '#2563eb', display: 'block', marginBottom: 4 }}
                >
                  View Listing &rarr;
                </a>
              )}
              {proof?.risk_factors && proof.risk_factors.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: '#dc2626', fontWeight: 600 }}>Risks:</div>
                  {proof.risk_factors.map((r, i) => (
                    <div key={i} style={{ fontSize: 10, color: '#6b7280', paddingLeft: 8 }}>- {r}</div>
                  ))}
                </div>
              )}
              {proof?.cost_notes && proof.cost_notes.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {proof.cost_notes.map((n, i) => (
                    <div key={i} style={{ fontSize: 10, color: '#9ca3af', paddingLeft: 8 }}>{n}</div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                {entry.stage === 'target' && (
                  <button
                    onClick={() => onAction(entry.id, 'contact')}
                    style={{
                      padding: '3px 8px', fontSize: 10, fontWeight: 600,
                      background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
                    }}
                  >
                    Contact Seller
                  </button>
                )}
                {entry.stage === 'contacted' && (
                  <button
                    onClick={() => onAction(entry.id, 'schedule_inspection')}
                    style={{
                      padding: '3px 8px', fontSize: 10, fontWeight: 600,
                      background: '#ca8a04', color: '#fff', border: 'none', cursor: 'pointer',
                    }}
                  >
                    Schedule Inspection
                  </button>
                )}
                {entry.stage === 'inspecting' && (
                  <button
                    onClick={() => onAction(entry.id, 'make_offer')}
                    style={{
                      padding: '3px 8px', fontSize: 10, fontWeight: 600,
                      background: '#ea580c', color: '#fff', border: 'none', cursor: 'pointer',
                    }}
                  >
                    Make Offer
                  </button>
                )}
                {entry.stage === 'offer_made' && (
                  <button
                    onClick={() => onAction(entry.id, 'accept_deal')}
                    style={{
                      padding: '3px 8px', fontSize: 10, fontWeight: 600,
                      background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer',
                    }}
                  >
                    Accept Deal
                  </button>
                )}
              </div>
            </div>
          </div>

          {entry.notes && (
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 8, padding: '4px 0', borderTop: '1px solid #f3f4f6' }}>
              {entry.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AcquisitionPipeline() {
  usePageTitle('Acquisition Pipeline');
  const { entries, stats, loading, error, refresh, advanceStage } = useAcquisitionPipeline();
  const [filter, setFilter] = useState<ViewFilter>('targets');
  const [actionError, setActionError] = useState<string | null>(null);

  const activeDealStages = ['contacted', 'inspecting', 'offer_made', 'under_contract', 'acquired', 'in_transport', 'at_shop', 'validated', 'reconditioning', 'listed'];
  const filtered = entries.filter(e => {
    if (filter === 'targets') return e.stage === 'target';
    if (filter === 'active') return activeDealStages.includes(e.stage);
    return true;
  });

  const handleAction = async (id: string, action: string) => {
    setActionError(null);
    try {
      const params: Record<string, unknown> = {};
      if (action === 'contact') {
        params.contact_method = 'CL email reply';
        params.contact_notes = 'Initial contact from pipeline dashboard';
      }
      if (action === 'schedule_inspection') {
        params.shop_name = prompt('Shop name:') || 'TBD';
      }
      if (action === 'make_offer') {
        const amount = prompt('Offer amount ($):');
        if (!amount) return;
        params.offer_amount = parseInt(amount.replace(/[^0-9]/g, ''));
      }
      if (action === 'accept_deal') {
        const price = prompt('Purchase price ($):');
        if (!price) return;
        params.purchase_price = parseInt(price.replace(/[^0-9]/g, ''));
      }
      await advanceStage(id, action, params);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, fontSize: 12, color: '#6b7280' }}>
        Loading pipeline...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, fontSize: 12, color: '#dc2626' }}>
        Error: {error}
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 24px', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Acquisition Pipeline</h1>
        <button
          onClick={refresh}
          style={{
            padding: '4px 12px', fontSize: 10, fontWeight: 600,
            background: 'var(--surface, #fff)', border: '1px solid var(--border, #e5e7eb)',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <StatCard label="Total Scanned" value={stats.total} />
          <StatCard label="Targets" value={stats.targets} sub={`${stats.strong_buys} strong, ${stats.buys} buy`} />
          <StatCard label="Active Deals" value={stats.active_deals} />
          <StatCard
            label="Target Profit"
            value={formatPrice(stats.total_target_profit)}
            sub={`${stats.avg_target_roi}% avg ROI`}
          />
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--border, #e5e7eb)' }}>
        {(['targets', 'active', 'all'] as ViewFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 16px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
              background: filter === f ? 'var(--surface, #fff)' : 'transparent',
              border: 'none', borderBottom: filter === f ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer', color: filter === f ? '#2563eb' : '#6b7280',
              letterSpacing: '0.5px',
            }}
          >
            {f === 'targets' ? `Targets (${entries.filter(e => e.stage === 'target').length})` :
             f === 'active' ? `Active Deals (${entries.filter(e => activeDealStages.includes(e.stage)).length})` :
             `All (${entries.length})`}
          </button>
        ))}
      </div>

      {actionError && (
        <div style={{ padding: '6px 12px', fontSize: 11, color: '#dc2626', background: '#fef2f2', marginBottom: 8, border: '1px solid #fecaca' }}>
          {actionError}
        </div>
      )}

      {/* Column headers */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px',
        fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        <div style={{ flex: '0 0 auto', width: 70 }}>Stage</div>
        <div style={{ flex: 1 }}>Vehicle</div>
        <div style={{ flex: '0 0 auto', width: 80, textAlign: 'right' }}>Score</div>
        <div style={{ flex: '0 0 80px', textAlign: 'right' }}>Ask</div>
        <div style={{ flex: '0 0 80px', textAlign: 'right' }}>Net Profit</div>
        <div style={{ flex: '0 0 50px', textAlign: 'right' }}>ROI</div>
        <div style={{ flex: '0 0 16px' }} />
      </div>

      {/* Entries */}
      {filtered.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
          No entries in this view
        </div>
      ) : (
        filtered.map(entry => (
          <DealCard key={entry.id} entry={entry} onAction={handleAction} />
        ))
      )}
    </div>
  );
}
