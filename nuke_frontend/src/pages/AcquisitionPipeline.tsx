import { useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAcquisitionPipeline } from '../hooks/useAcquisitionPipeline';
import type { PipelineEntry } from '../hooks/useAcquisitionPipeline';
import '../design-system.css';

type ViewFilter = 'targets' | 'active' | 'all';

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return '$' + n.toLocaleString();
}

function scoreTxt(score: number | null): string {
  if (!score) return '—';
  if (score >= 80) return 'STRONG BUY';
  if (score >= 70) return 'BUY';
  if (score >= 50) return 'FAIR';
  return 'PASS';
}

function DealRow({ entry, onAction }: { entry: PipelineEntry; onAction: (id: string, action: string, params?: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [inlineInput, setInlineInput] = useState<{ action: string; value: string } | null>(null);
  const proof = entry.market_proof_data;
  const hasUrl = entry.discovery_url?.startsWith('http');
  const clUrl = !hasUrl && entry.discovery_url?.startsWith('cl://') ? entry.discovery_url : null;
  const profit = entry.estimated_profit || proof?.net_profit || 0;
  const roi = proof?.roi_pct || 0;
  const location = [entry.location_city, entry.location_state].filter(Boolean).join(', ');

  const submitInlineInput = () => {
    if (!inlineInput) return;
    const params: Record<string, unknown> = {};
    if (inlineInput.action === 'schedule_inspection') {
      params.shop_name = inlineInput.value.trim() || 'TBD';
    } else if (inlineInput.action === 'make_offer') {
      if (!inlineInput.value.trim()) return;
      params.offer_amount = parseInt(inlineInput.value.replace(/[^0-9]/g, ''));
    } else if (inlineInput.action === 'accept_deal') {
      if (!inlineInput.value.trim()) return;
      params.purchase_price = parseInt(inlineInput.value.replace(/[^0-9]/g, ''));
    }
    onAction(entry.id, inlineInput.action, params);
    setInlineInput(null);
  };

  const nextAction: Record<string, { action: string; label: string }> = {
    target: { action: 'contact', label: 'Contact' },
    contacted: { action: 'schedule_inspection', label: 'Inspect' },
    inspecting: { action: 'make_offer', label: 'Offer' },
    offer_made: { action: 'accept_deal', label: 'Accept' },
  };
  const act = nextAction[entry.stage];

  return (
    <>
      <tr
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--grey-100)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = ''; }}
      >
        <td style={{ padding: 'var(--space-2)', border: '1px solid var(--border-light)', whiteSpace: 'nowrap' }}>
          <span className="badge" style={{
            fontSize: '8px',
            textTransform: 'uppercase',
            fontWeight: 700,
            letterSpacing: '0.3px',
          }}>
            {entry.stage.replace(/_/g, ' ')}
          </span>
        </td>
        <td style={{ padding: 'var(--space-2)', border: '1px solid var(--border-light)', fontWeight: 700 }}>
          {entry.year || '?'} {entry.make} {entry.model || ''}
          {location && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>{location}</span>}
          {hasUrl && (
            <a
              href={entry.discovery_url!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ marginLeft: 8, color: 'var(--text-muted)', fontWeight: 400, fontSize: '9pt', textDecoration: 'none' }}
              title="View source listing"
            >↗</a>
          )}
          {clUrl && (
            <span style={{ marginLeft: 8, color: 'var(--text-disabled)', fontWeight: 400, fontSize: '9pt' }} title={clUrl}>CL</span>
          )}
        </td>
        <td style={{ padding: 'var(--space-2)', border: '1px solid var(--border-light)', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {scoreTxt(entry.deal_score)}
          {entry.deal_score != null && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>{entry.deal_score}</span>}
        </td>
        <td style={{ padding: 'var(--space-2)', border: '1px solid var(--border-light)', textAlign: 'right', fontFamily: 'monospace' }}>
          {fmt(entry.asking_price)}
        </td>
        <td style={{ padding: 'var(--space-2)', border: '1px solid var(--border-light)', textAlign: 'right', fontFamily: 'monospace' }}>
          {fmt(entry.comp_median)}
        </td>
        <td style={{
          padding: 'var(--space-2)', border: '1px solid var(--border-light)', textAlign: 'right',
          fontFamily: 'monospace', fontWeight: 700,
        }}>
          {profit > 0 ? '+' : ''}{fmt(profit)}
        </td>
        <td style={{ padding: 'var(--space-2)', border: '1px solid var(--border-light)', textAlign: 'right' }}>
          {roi > 0 ? `${roi}%` : '—'}
        </td>
        <td style={{ padding: 'var(--space-2)', border: '1px solid var(--border-light)', textAlign: 'center', color: 'var(--text-muted)', width: 16 }}>
          {open ? '\u25B4' : '\u25BE'}
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={8} style={{ padding: 0, border: '1px solid var(--border-light)', background: 'var(--grey-50)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-5)', padding: 'var(--space-3) var(--space-4)', flexWrap: 'wrap' }}>

              {/* Economics */}
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 700, marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Economics</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {[
                      ['Asking', fmt(entry.asking_price)],
                      ['Comp Median', fmt(entry.comp_median)],
                      ['Condition', proof?.condition_tier ? proof.condition_tier.charAt(0).toUpperCase() + proof.condition_tier.slice(1) : '—'],
                      ['Cost to Ready', fmt(proof?.cost_to_ready)],
                      ['Total Investment', fmt(proof?.total_investment)],
                      ['Target Sale', fmt(proof?.target_sale_price)],
                    ].map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ padding: '1px 0', color: 'var(--text-muted)' }}>{k}</td>
                        <td style={{ padding: '1px 0', textAlign: 'right', fontFamily: 'monospace' }}>{v}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 700 }}>
                      <td style={{ padding: '2px 0', borderTop: '1px solid var(--border)' }}>Net Profit</td>
                      <td style={{ padding: '2px 0', borderTop: '1px solid var(--border)', textAlign: 'right', fontFamily: 'monospace' }}>
                        {profit > 0 ? '+' : ''}{fmt(profit)} ({roi}%)
                      </td>
                    </tr>
                  </tbody>
                </table>
                {proof?.match_strategy && (
                  <div style={{ color: 'var(--text-disabled)', marginTop: 'var(--space-1)' }}>Comps: {proof.match_strategy}</div>
                )}
              </div>

              {/* Cost Breakdown */}
              {proof?.cost_breakdown && (
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Costs</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {[
                        ['Parts', fmt(proof.cost_breakdown.parts)],
                        [`Labor (${proof.cost_breakdown.labor_hours || 0}h)`, fmt(proof.cost_breakdown.labor)],
                        ['Transport', fmt(proof.cost_breakdown.transport)],
                        ['Inspection', fmt(proof.cost_breakdown.inspection)],
                        ['Listing Fees', `${proof.cost_breakdown.listing_fees_pct || 0}%`],
                      ].map(([k, v]) => (
                        <tr key={k}>
                          <td style={{ padding: '1px 0', color: 'var(--text-muted)' }}>{k}</td>
                          <td style={{ padding: '1px 0', textAlign: 'right', fontFamily: 'monospace' }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Actions + Notes */}
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 700, marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Details</div>
                {hasUrl && (
                  <a
                    href={entry.discovery_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'block', marginBottom: 'var(--space-1)', textDecoration: 'underline' }}
                  >
                    View Listing →
                  </a>
                )}
                {clUrl && (
                  <div style={{ marginBottom: 'var(--space-1)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '8pt', wordBreak: 'break-all' }}>
                    {clUrl}
                  </div>
                )}
                {entry.discovery_source && (
                  <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Source: {entry.discovery_source}</div>
                )}
                {proof?.risk_factors && proof.risk_factors.length > 0 && (
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 700 }}>Risks: </span>
                    {proof.risk_factors.join(' · ')}
                  </div>
                )}
                {proof?.cost_notes && proof.cost_notes.length > 0 && (
                  <div style={{ color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                    {proof.cost_notes.join(' · ')}
                  </div>
                )}
                {act && !inlineInput && (
                  <button
                    className="button button-primary"
                    style={{ marginTop: 'var(--space-3)', fontSize: '8pt' }}
                    onClick={e => {
                      e.stopPropagation();
                      const needsInput = ['schedule_inspection', 'make_offer', 'accept_deal'].includes(act.action);
                      if (needsInput) {
                        setOpen(true);
                        setInlineInput({ action: act.action, value: '' });
                      } else {
                        onAction(entry.id, act.action);
                      }
                    }}
                  >
                    {act.label} →
                  </button>
                )}
                {inlineInput && (
                  <div style={{ marginTop: 'var(--space-3)' }} onClick={e => e.stopPropagation()}>
                    <div style={{ marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px', fontSize: '8pt' }}>
                      {inlineInput.action === 'schedule_inspection' ? 'Shop Name' : inlineInput.action === 'make_offer' ? 'Offer Amount ($)' : 'Purchase Price ($)'}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <input
                        type={inlineInput.action === 'schedule_inspection' ? 'text' : 'number'}
                        value={inlineInput.value}
                        placeholder={inlineInput.action === 'schedule_inspection' ? 'Shop name...' : '0'}
                        onChange={e => setInlineInput({ ...inlineInput, value: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') submitInlineInput(); if (e.key === 'Escape') setInlineInput(null); }}
                        autoFocus
                        style={{ flex: 1, padding: '4px 8px', fontFamily: 'monospace', border: '1px solid var(--border-dark)', background: 'var(--surface)', color: 'var(--text)', fontSize: '8pt' }}
                      />
                      <button className="button button-primary" style={{ fontSize: '8pt', padding: '2px 8px' }} onClick={submitInlineInput}>✓</button>
                      <button className="button" style={{ fontSize: '8pt', padding: '2px 8px' }} onClick={() => setInlineInput(null)}>✕</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {entry.notes && (
              <div style={{ padding: '0 var(--space-4) var(--space-3)', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)', paddingTop: 'var(--space-2)' }}>
                {entry.notes}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
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

  const counts = {
    targets: entries.filter(e => e.stage === 'target').length,
    active: entries.filter(e => activeDealStages.includes(e.stage)).length,
    all: entries.length,
  };

  const handleAction = async (id: string, action: string, params: Record<string, unknown> = {}) => {
    setActionError(null);
    try {
      if (action === 'contact') {
        params.contact_method = 'CL email reply';
        params.contact_notes = 'Initial contact from pipeline';
      }
      await advanceStage(id, action, params);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ padding: '0 var(--space-2)', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-3) 0' }}>
        <div style={{ fontWeight: 700 }}>Acquisition Pipeline</div>
        <button className="button button-small" onClick={refresh}>Refresh</button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}>
          {[
            { label: 'Scanned', value: stats.total.toLocaleString() },
            { label: 'Targets', value: String(stats.targets), sub: `${stats.strong_buys} strong · ${stats.buys} buy` },
            { label: 'Active Deals', value: String(stats.active_deals) },
            { label: 'Target Profit', value: fmt(stats.total_target_profit), sub: `${stats.avg_target_roi}% avg ROI` },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: 'var(--space-3)' }}>
              <div style={{ textTransform: 'uppercase', letterSpacing: '0.3px', color: 'var(--text-muted)', marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontWeight: 700, fontSize: '11pt' }}>{s.value}</div>
              {s.sub && <div style={{ color: 'var(--text-muted)', marginTop: 1 }}>{s.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 'var(--space-2)' }}>
        {([
          { key: 'targets' as ViewFilter, label: 'Targets', count: counts.targets },
          { key: 'active' as ViewFilter, label: 'Active', count: counts.active },
          { key: 'all' as ViewFilter, label: 'All', count: counts.all },
        ]).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '4px var(--space-3)',
              border: '2px solid var(--border)',
              borderRight: 'none',
              background: filter === f.key ? 'var(--text)' : 'var(--surface)',
              color: filter === f.key ? 'var(--surface)' : 'var(--text)',
              fontWeight: 700,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
              fontFamily: 'Arial, sans-serif',
              fontSize: 'var(--font-size)',
            }}
          >
            {f.label} ({f.count})
          </button>
        ))}
        <div style={{ borderRight: '2px solid var(--border)' }} />
      </div>

      {loading && <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)' }}>Loading...</div>}
      {error && <div style={{ padding: 'var(--space-3)', border: '1px solid var(--border-dark)', background: 'var(--grey-200)', marginBottom: 'var(--space-2)' }}>Error: {error}</div>}
      {actionError && <div style={{ padding: 'var(--space-3)', border: '1px solid var(--border-dark)', background: 'var(--grey-200)', marginBottom: 'var(--space-2)' }}>{actionError}</div>}

      {/* Table */}
      {!loading && (
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 80 }}>Stage</th>
              <th>Vehicle</th>
              <th style={{ width: 90, textAlign: 'right' }}>Score</th>
              <th style={{ width: 80, textAlign: 'right' }}>Ask</th>
              <th style={{ width: 80, textAlign: 'right' }}>Median</th>
              <th style={{ width: 90, textAlign: 'right' }}>Net Profit</th>
              <th style={{ width: 50, textAlign: 'right' }}>ROI</th>
              <th style={{ width: 16 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--text-disabled)', border: '1px solid var(--border-light)' }}>
                  No entries
                </td>
              </tr>
            ) : (
              filtered.map(entry => (
                <DealRow key={entry.id} entry={entry} onAction={handleAction} />
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
