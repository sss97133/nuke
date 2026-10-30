import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyAmount } from '../../utils/currency';
import { DEAL_SCORE_CONFIG, type DealScoreLabel } from '../../constants/dealScore';
import { useNukeEstimate } from '../../hooks/useNukeEstimate';
import { assertVehicleAssessment, type ListingAssessment } from '../../services/listingPackageEvidence';
import VehicleEvidenceAssessment from './VehicleEvidenceAssessment';

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
  const { data, isLoading: loading } = useNukeEstimate(vehicleId, vehicle);
  const [review, setReview] = useState<{ id: string; loading: boolean; error?: string; assessment?: ListingAssessment }>({ id: vehicleId, loading: false });
  const requestGeneration = useRef(0);
  const currentVehicle = useRef(vehicleId);
  currentVehicle.current = vehicleId;
  useEffect(() => () => { requestGeneration.current++; }, [vehicleId]);
  const computing = review.id === vehicleId && review.loading;
  const assessment = review.id === vehicleId ? review.assessment : undefined;
  const reviewError = review.id === vehicleId ? review.error : undefined;

  const estimate = data?.estimate ?? null;
  const record = data?.record ?? null;
  const survival = data?.survival ?? null;

  const handleCompute = async () => {
    const generation = ++requestGeneration.current;
    const subject = vehicleId;
    setReview(previous => ({ id: subject, loading: true, assessment: previous.id === subject ? previous.assessment : undefined }));
    try {
      const { data: result, error } = await supabase.functions.invoke('compute-vehicle-valuation', {
        body: { action: 'assessment', vehicle_id: subject },
      });
      if (error || result?.action !== 'assessment' || result?.read_only !== true) throw new Error('Vehicle evidence could not be read.');
      assertVehicleAssessment(result.assessment, subject);
      if (requestGeneration.current === generation && currentVehicle.current === subject) {
        setReview({ id: subject, loading: false, assessment: result.assessment });
      }
    } catch (error) {
      if (requestGeneration.current === generation && currentVehicle.current === subject) setReview(previous => ({
        ...previous, id: subject, loading: false, error: error instanceof Error ? error.message : 'Vehicle evidence could not be read.',
      }));
    }
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
          {computing ? 'Reading evidence...' : 'Review evidence'}
        </button>
      </div>
      <div className="card-body" style={{ padding: '12px' }}>
        {reviewError && <p role="alert">{reviewError}</p>}
        {assessment && <VehicleEvidenceAssessment assessment={assessment} assertions={assessment.listing.assertions}
          unresolvedFields={assessment.unresolved_fields} vehicleId={vehicleId} />}
        {!estimate ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {computing ? (
              <p role="status">Reading retained evidence...</p>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                No stored estimate. Review the retained evidence to inspect its qualified market context and unresolved claims.
              </div>
            )}
          </div>
        ) : (
          <details>
            <summary>Stored heuristic estimate (unqualified)</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p>Vehicle-specific source qualification remains unestablished.</p>
            {/* Main estimate */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '21px', fontWeight: 800, color: 'var(--text)' }}>
                ${estimate.estimated_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Stored heuristic score: {estimate.confidence_score}/100
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
          </details>
        )}
      </div>
    </div>
  );
};

export default NukeEstimatePanel;
