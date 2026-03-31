import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyAmount } from '../../utils/currency';
import { DEAL_SCORE_CONFIG, type DealScoreLabel } from '../../constants/dealScore';

interface NukeEstimatePanelProps {
  vehicleId: string;
  vehicle: {
    year?: number;
    make?: string;
    model?: string;
  };
  /** When false and no estimate exists, the panel returns null instead of showing a compute button. */
  canCompute?: boolean;
}

interface NukeEstimate {
  estimated_value: number;
  value_low: number;
  value_high: number;
  confidence_score: number;
  price_tier: string;
  confidence_interval_pct: number;
  signal_weights: Record<string, { weight: number; multiplier: number; sourceCount: number }>;
  deal_score: number | null;
  deal_score_label: string | null;
  heat_score: number | null;
  heat_score_label: string | null;
  model_version: string;
  input_count: number;
  calculated_at: string;
}

interface RecordPrice {
  record_price: number;
  record_sale_date: string | null;
  previous_record_price: number | null;
  times_record_broken: number;
}

interface SurvivalRate {
  total_produced: number | null;
  estimated_surviving: number | null;
  survival_rate: number | null;
  estimation_method: string;
  confidence_score: number | null;
}

const DEAL_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(DEAL_SCORE_CONFIG).map(([k, v]) => [k, v.color])
);

const HEAT_COLORS: Record<string, string> = {
  volcanic: 'var(--error)',
  fire: 'var(--orange)',
  hot: 'var(--warning)',
  warm: 'var(--text-secondary)',
  cold: 'var(--text-disabled)',
};

const SIGNAL_LABELS: Record<string, string> = {
  comps: 'Comparable Sales',
  condition: 'Condition',
  rarity: 'Rarity / Production',
  sentiment: 'Market Sentiment',
  bid_curve: 'Bid Activity',
  market_trend: 'Market Trend',
  survival: 'Survival Scarcity',
  originality: 'Originality',
};

const NukeEstimatePanel: React.FC<NukeEstimatePanelProps> = ({ vehicleId, vehicle, canCompute = true }) => {
  const [estimate, setEstimate] = useState<NukeEstimate | null>(null);
  const [record, setRecord] = useState<RecordPrice | null>(null);
  const [survival, setSurvival] = useState<SurvivalRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      // Load estimate
      const { data: est } = await supabase
        .from('nuke_estimates')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();
      if (!cancelled && est) setEstimate(est as NukeEstimate);

      // Load record price for this make/model
      if (vehicle.make && vehicle.model && vehicle.year) {
        const { data: rec } = await supabase
          .from('record_prices')
          .select('record_price, record_sale_date, previous_record_price, times_record_broken')
          .ilike('make', vehicle.make)
          .ilike('model', `%${vehicle.model}%`)
          .lte('year_start', vehicle.year)
          .gte('year_end', vehicle.year)
          .maybeSingle();
        if (!cancelled && rec) setRecord(rec as RecordPrice);

        // Load survival rate
        const { data: surv } = await supabase
          .from('survival_rate_estimates')
          .select('total_produced, estimated_surviving, survival_rate, estimation_method, confidence_score')
          .ilike('make', vehicle.make)
          .ilike('model', `%${vehicle.model}%`)
          .lte('year_start', vehicle.year)
          .gte('year_end', vehicle.year)
          .maybeSingle();
        if (!cancelled && surv) setSurvival(surv as SurvivalRate);
      }

      if (!cancelled) setLoading(false);

      // Auto-compute if no estimate exists
      if (!cancelled && !est) {
        setComputing(true);
        try {
          const { data, error } = await supabase.functions.invoke('compute-vehicle-valuation', {
            body: { vehicle_id: vehicleId, force: false },
          });
          if (!cancelled && !error && data?.results?.[0]) {
            setEstimate(data.results[0] as NukeEstimate);
          }
        } catch {
          // silent — user can still click Compute manually
        }
        if (!cancelled) setComputing(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [vehicleId, vehicle.make, vehicle.model, vehicle.year]);

  const handleCompute = async () => {
    setComputing(true);
    try {
      const { data, error } = await supabase.functions.invoke('compute-vehicle-valuation', {
        body: { vehicle_id: vehicleId, force: true },
      });
      if (!error && data?.results?.[0]) {
        setEstimate(data.results[0] as NukeEstimate);
      }
    } catch {
      // ignore
    }
    setComputing(false);
  };

  // No Empty Shells: if done loading/computing and no estimate, hide for non-owners
  if (!loading && !computing && !estimate && !canCompute) return null;

  // Progressive density: return null when loading (no skeleton bars)
  if (loading) return null;

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>NUKE ESTIMATE</span>
        <button
          type="button"
          onClick={handleCompute}
          disabled={computing}
          style={{
            background: 'var(--grey-100)',
            border: '1px solid var(--border)',
            padding: '2px 8px', fontSize: '9px',
            fontWeight: 600,
            cursor: computing ? 'wait' : 'pointer',
            color: 'var(--text)',
          }}
        >
          {computing ? 'Computing...' : estimate ? 'Recompute' : 'Compute'}
        </button>
      </div>
      <div className="card-body" style={{ padding: '12px' }}>
        {!estimate ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {computing ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '8px', height: '8px', background: 'var(--success)',
                  }} />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Computing estimate...
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {['Comparable Sales', 'Market Trend', 'Rarity', 'Condition'].map((s, i) => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '100px', fontSize: '8px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s}</span>
                      <div style={{
                        flex: 1, height: '3px', background: 'var(--grey-100)', overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${30 + i * 15}%`, height: '100%',
                          background: 'var(--border)',
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                No estimate available. Click "Compute" to generate.
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Main estimate */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '21px', fontWeight: 800, color: 'var(--text)' }}>
                ${estimate.estimated_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {estimate.confidence_score}% confidence
              </span>
              <span style={{
                fontSize: '9px',
                padding: '1px 5px', background: 'var(--grey-100)',
                color: 'var(--text-muted)',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}>
                {estimate.price_tier}
              </span>
            </div>

            {/* Range */}
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Range: ${estimate.value_low.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              {' - '}
              ${estimate.value_high.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              {' '}
              ({'\u00B1'}{estimate.confidence_interval_pct}%)
            </div>

            {/* Deal + Heat scores */}
            <div style={{ display: 'flex', gap: '12px' }}>
              {estimate.deal_score != null && estimate.deal_score_label && (
                <div style={{
                  padding: '4px 8px', background: DEAL_COLORS[estimate.deal_score_label] || 'var(--text-secondary)',
                  color: 'var(--bg)',
                  fontSize: '11px',
                  fontWeight: 700,
                }}>
                  {DEAL_SCORE_CONFIG[estimate.deal_score_label as DealScoreLabel]?.display || estimate.deal_score_label}
                  {' '}{DEAL_SCORE_CONFIG[estimate.deal_score_label as DealScoreLabel]?.description || ''}
                  {' '}({estimate.deal_score > 0 ? '+' : ''}{estimate.deal_score.toFixed(1)})
                </div>
              )}
              {estimate.heat_score != null && estimate.heat_score_label && (
                <div style={{
                  padding: '4px 8px', background: HEAT_COLORS[estimate.heat_score_label] || 'var(--text-secondary)',
                  color: 'var(--bg)',
                  fontSize: '11px',
                  fontWeight: 700,
                }}>
                  {estimate.heat_score_label === 'volcanic' ? '\u{1F30B} VOLCANIC' :
                   estimate.heat_score_label === 'fire' ? '\u{1F525} FIRE' :
                   estimate.heat_score_label === 'hot' ? '\u{1F321}\u{FE0F} HOT' :
                   estimate.heat_score_label === 'warm' ? 'WARM' : 'COLD'}
                  {' '}({estimate.heat_score}/100)
                </div>
              )}
            </div>

            {/* Signal weight breakdown */}
            <div>
              <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>
                Signal Breakdown
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {Object.entries(estimate.signal_weights).map(([key, sig]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '7.5pt' }}>
                    <span style={{ width: '110px', color: 'var(--text-muted)' }}>
                      {SIGNAL_LABELS[key] || key}
                    </span>
                    <div style={{
                      flex: 1,
                      height: '4px',
                      background: 'var(--grey-100)', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${Math.min(sig.weight * 500, 100)}%`,
                        height: '100%',
                        background: sig.sourceCount > 0
                          ? sig.multiplier > 1.02 ? 'var(--success)' : sig.multiplier < 0.98 ? 'var(--error)' : 'var(--info)'
                          : 'var(--grey-300)', }} />
                    </div>
                    <span style={{ width: '40px', textAlign: 'right', fontWeight: 600, color: sig.sourceCount > 0 ? 'var(--text)' : 'var(--text-muted)' }}>
                      {sig.multiplier.toFixed(2)}x
                    </span>
                    <span style={{ width: '20px', textAlign: 'right', color: 'var(--text-muted)', fontSize: '6.5pt' }}>
                      ({sig.sourceCount})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Record tracker */}
            {record && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
                  Record Price
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700 }}>
                  ${record.record_price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: '6px' }}>
                    for {vehicle.make} {vehicle.model} ({vehicle.year && `${Math.floor(vehicle.year / 5) * 5}-${Math.floor(vehicle.year / 5) * 5 + 4}`})
                  </span>
                </div>
                {record.previous_record_price && (
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                    Previous record: ${record.previous_record_price.toLocaleString()} (beaten {record.times_record_broken}x)
                  </div>
                )}
              </div>
            )}

            {/* Survival data */}
            {survival && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
                  Survival Estimate
                </div>
                <div style={{ fontSize: '12px' }}>
                  {survival.estimated_surviving != null && (
                    <span style={{ fontWeight: 700 }}>
                      ~{survival.estimated_surviving.toLocaleString()} surviving
                    </span>
                  )}
                  {survival.total_produced != null && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
                      of {survival.total_produced.toLocaleString()} produced
                    </span>
                  )}
                  {survival.survival_rate != null && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
                      ({(survival.survival_rate * 100).toFixed(1)}%)
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '6.5pt', color: 'var(--text-muted)' }}>
                  Method: {survival.estimation_method}
                  {survival.confidence_score != null && ` | ${survival.confidence_score}% confidence`}
                </div>
              </div>
            )}

            {/* Meta */}
            <div style={{ fontSize: '6.5pt', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
              Model {estimate.model_version} | {estimate.input_count} signals |{' '}
              Computed {new Date(estimate.calculated_at).toLocaleDateString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NukeEstimatePanel;
