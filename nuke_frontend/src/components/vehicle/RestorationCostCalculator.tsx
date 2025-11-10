import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Restoration Cost Calculator (Robinhood × Cursor style)
 * 
 * AI analyzes images → Estimates Parts + Labor → Projects profit
 * User can add opinion and adjust estimates
 */

interface CostCategory {
  category: string;
  parts_low: number;
  parts_high: number;
  labor_hours_low: number;
  labor_hours_high: number;
  labor_rate: number;
  total_low: number;
  total_high: number;
  confidence: number;
  reasoning: string;
  ai_detected_issues?: string[];
}

interface Props {
  vehicleId: string;
  year: number;
  make: string;
  model: string;
  imageUrls: string[];
  onClose?: () => void;
}

export default function RestorationCostCalculator({ vehicleId, year, make, model, imageUrls, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [estimate, setEstimate] = useState<any | null>(null);
  const [userOpinion, setUserOpinion] = useState('');
  const [adjustedTotal, setAdjustedTotal] = useState<number | null>(null);
  const [desiredCondition, setDesiredCondition] = useState<'driver' | 'show' | 'concours'>('show');

  const runEstimate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('estimate-restoration-cost', {
        body: {
          vehicleId,
          year,
          make,
          model,
          imageUrls,
          desiredCondition
        }
      });

      if (error) throw error;
      setEstimate(data);
    } catch (error) {
      console.error('Estimate failed:', error);
      alert('Failed to generate estimate');
    } finally {
      setLoading(false);
    }
  };

  const saveOpinion = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Save opinion to entity_opinions table
      await supabase
        .from('entity_opinions')
        .upsert({
          entity_type: 'vehicle',
          entity_id: vehicleId,
          user_id: user.id,
          opinion_text: userOpinion,
          data_contributed: {
            restoration_estimate: adjustedTotal || estimate?.totals?.average,
            estimated_at: new Date().toISOString()
          }
        });

      alert('Opinion saved!');
      if (onClose) onClose();
    } catch (error) {
      console.error('Save opinion error:', error);
    }
  };

  return (
    <div className="rh-card" style={{ margin: '16px' }}>
      <div className="rh-card-content">
        {/* Header */}
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ 
            fontSize: '15px', 
            fontWeight: 600, 
            color: 'var(--rh-text-primary)', 
            marginBottom: '4px' 
          }}>
            Restoration Cost Calculator
          </h3>
          <p style={{ 
            fontSize: '13px', 
            color: 'var(--rh-text-secondary)', 
            margin: 0 
          }}>
            AI analyzes {imageUrls.length} images to estimate Parts + Labor
          </p>
        </div>

        {/* Desired Quality Selector */}
        {!estimate && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: 'var(--rh-text-secondary)', marginBottom: '8px' }}>
              Target Quality:
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['driver', 'show', 'concours'] as const).map(quality => (
                <button
                  key={quality}
                  onClick={() => setDesiredCondition(quality)}
                  className={desiredCondition === quality ? 'rh-btn-primary' : 'rh-btn'}
                  style={{ flex: 1, padding: '8px', fontSize: '13px' }}
                >
                  {quality === 'driver' && 'Driver'}
                  {quality === 'show' && 'Show Quality'}
                  {quality === 'concours' && 'Concours'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Run Estimate Button */}
        {!estimate && (
          <button
            onClick={runEstimate}
            disabled={loading}
            className="rh-btn-primary"
            style={{ width: '100%', padding: '12px', opacity: loading ? 0.5 : 1 }}
          >
            {loading ? 'Analyzing Images...' : 'Generate AI Estimate'}
          </button>
        )}

        {/* Results */}
        {estimate && (
          <>
            {/* Total Cost Hero */}
            <div style={{ 
              textAlign: 'center', 
              padding: '24px 16px',
              background: 'var(--rh-surface-elevated)',
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '11px', color: 'var(--rh-text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Estimated Total Cost
              </div>
              <div style={{ fontFamily: 'var(--rh-font-mono)', fontSize: '32px', fontWeight: 300, color: 'var(--rh-text-primary)' }}>
                ${estimate.totals.total_low.toLocaleString()} - ${estimate.totals.total_high.toLocaleString()}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--rh-text-secondary)', marginTop: '4px' }}>
                Average: ${estimate.totals.average.toLocaleString()}
              </div>
            </div>

            {/* Parts vs Labor Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: 'var(--rh-border)', marginBottom: '16px' }}>
              <div style={{ background: 'var(--rh-surface)', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: 'var(--rh-text-tertiary)', marginBottom: '6px', textTransform: 'uppercase' }}>
                  Parts
                </div>
                <div style={{ fontFamily: 'var(--rh-font-mono)', fontSize: '18px', fontWeight: 600 }}>
                  ${estimate.totals.parts_low.toLocaleString()} - ${estimate.totals.parts_high.toLocaleString()}
                </div>
              </div>
              <div style={{ background: 'var(--rh-surface)', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: 'var(--rh-text-tertiary)', marginBottom: '6px', textTransform: 'uppercase' }}>
                  Labor
                </div>
                <div style={{ fontFamily: 'var(--rh-font-mono)', fontSize: '18px', fontWeight: 600 }}>
                  ${estimate.totals.labor_cost_low.toLocaleString()} - ${estimate.totals.labor_cost_high.toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--rh-text-tertiary)', marginTop: '4px' }}>
                  {estimate.totals.labor_hours_low}-{estimate.totals.labor_hours_high} hrs @ ${estimate.labor_rate}/hr
                </div>
              </div>
            </div>

            {/* Category Breakdown */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                Cost Breakdown
              </div>
              {estimate.breakdown.map((category: CostCategory, idx: number) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px',
                    border: '1px solid var(--rh-border)',
                    borderRadius: '8px',
                    marginBottom: '8px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>
                      {category.category}
                    </div>
                    <div style={{ fontFamily: 'var(--rh-font-mono)', fontSize: '14px', fontWeight: 600 }}>
                      ${category.total_low.toLocaleString()} - ${category.total_high.toLocaleString()}
                    </div>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--rh-text-secondary)', marginBottom: '4px' }}>
                    Parts: ${category.parts_low}-${category.parts_high} • Labor: {category.labor_hours_low}-{category.labor_hours_high} hrs
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--rh-text-tertiary)' }}>
                    {category.reasoning}
                  </div>
                  {category.ai_detected_issues && category.ai_detected_issues.length > 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--rh-orange)', marginTop: '4px' }}>
                      AI Detected: {category.ai_detected_issues.join(', ')}
                    </div>
                  )}
                  <div style={{ fontSize: '10px', color: 'var(--rh-text-tertiary)', marginTop: '4px' }}>
                    Confidence: {category.confidence}%
                  </div>
                </div>
              ))}
            </div>

            {/* Value Projection */}
            <div style={{ 
              padding: '16px', 
              background: 'var(--rh-accent-dim)', 
              border: '1px solid var(--rh-accent)',
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
                Value Projection After Restoration
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--rh-text-secondary)' }}>Current Value</span>
                <span style={{ fontFamily: 'var(--rh-font-mono)', fontSize: '14px' }}>
                  ${estimate.value_projection.current_value.toLocaleString()}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--rh-text-secondary)' }}>Restored Value</span>
                <span style={{ fontFamily: 'var(--rh-font-mono)', fontSize: '14px' }}>
                  ${estimate.value_projection.restored_value_low.toLocaleString()} - ${estimate.value_projection.restored_value_high.toLocaleString()}
                </span>
              </div>
              <div style={{ 
                borderTop: '1px solid var(--rh-border)', 
                paddingTop: '8px', 
                marginTop: '8px',
                display: 'flex',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontSize: '14px', fontWeight: 600 }}>Projected Profit</span>
                <span style={{ 
                  fontFamily: 'var(--rh-font-mono)', 
                  fontSize: '16px', 
                  fontWeight: 600,
                  color: estimate.value_projection.profit_low > 0 ? 'var(--rh-green)' : 'var(--rh-red)'
                }}>
                  ${estimate.value_projection.profit_low.toLocaleString()} - ${estimate.value_projection.profit_high.toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--rh-text-tertiary)', marginTop: '4px', textAlign: 'right' }}>
                ROI: {estimate.value_projection.roi_low_percent.toFixed(0)}% - {estimate.value_projection.roi_high_percent.toFixed(0)}%
              </div>
            </div>

            {/* User Opinion */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                Your Opinion
              </div>
              <textarea
                placeholder="Add your thoughts on this restoration estimate... What would you change? What's the AI missing?"
                value={userOpinion}
                onChange={(e) => setUserOpinion(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '14px',
                  background: 'var(--rh-surface-elevated)',
                  border: '1px solid var(--rh-border)',
                  borderRadius: '8px',
                  color: 'var(--rh-text-primary)',
                  resize: 'vertical',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            {/* Adjust Total */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                Your Adjusted Estimate (Optional)
              </div>
              <input
                type="number"
                placeholder={`AI says $${estimate.totals.average.toLocaleString()}`}
                value={adjustedTotal || ''}
                onChange={(e) => setAdjustedTotal(e.target.value ? parseInt(e.target.value) : null)}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '15px',
                  fontFamily: 'var(--rh-font-mono)',
                  background: 'var(--rh-surface-elevated)',
                  border: '1px solid var(--rh-border)',
                  borderRadius: '8px',
                  color: 'var(--rh-text-primary)'
                }}
              />
            </div>

            {/* Save Opinion Button */}
            <button
              onClick={saveOpinion}
              disabled={!userOpinion.trim() && !adjustedTotal}
              className="rh-btn-primary"
              style={{ 
                width: '100%', 
                padding: '12px',
                opacity: !userOpinion.trim() && !adjustedTotal ? 0.5 : 1
              }}
            >
              Save My Opinion
            </button>
          </>
        )}
      </div>
    </div>
  );
}

