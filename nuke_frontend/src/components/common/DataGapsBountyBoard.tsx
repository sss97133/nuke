import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Data Gaps Bounty Board (Robinhood × Cursor style)
 * Shows missing fields that users can fill for points
 * Crowd-sourced form completion
 */

interface DataGap {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  field_priority: 'critical' | 'high' | 'medium' | 'low';
  gap_reason: string;
  points_reward: number;
  is_filled: boolean;
  
  // Enriched data
  vehicle?: {
    year: number;
    make: string;
    model: string;
  };
}

interface Props {
  entityType?: string;
  entityId?: string;
  limit?: number;
}

export default function DataGapsBountyBoard({ entityType, entityId, limit = 10 }: Props) {
  const [gaps, setGaps] = useState<DataGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState<string | null>(null);
  const [fillValue, setFillValue] = useState('');

  useEffect(() => {
    loadGaps();
  }, [entityType, entityId]);

  const loadGaps = async () => {
    setLoading(true);
    
    try {
      let query = supabase
        .from('data_gaps')
        .select('*')
        .eq('is_filled', false)
        .order('points_reward', { ascending: false });

      if (entityType && entityId) {
        query = query.eq('entity_type', entityType).eq('entity_id', entityId);
      }

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Enrich with entity data
      const enriched = await Promise.all(
        (data || []).map(async (gap) => {
          if (gap.entity_type === 'vehicle') {
            const { data: vehicle } = await supabase
              .from('vehicles')
              .select('year, make, model')
              .eq('id', gap.entity_id)
              .single();
            
            return { ...gap, vehicle };
          }
          return gap;
        })
      );

      setGaps(enriched);
    } catch (error) {
      console.error('Load gaps error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFillGap = async (gapId: string, fieldName: string, entityType: string, entityId: string) => {
    if (!fillValue.trim()) return;

    try {
      // Update the entity with the new value
      if (entityType === 'vehicle') {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({ [fieldName]: fillValue.trim() })
          .eq('id', entityId);

        if (updateError) throw updateError;
      }

      // Mark gap as filled
      const { error: gapError } = await supabase
        .from('data_gaps')
        .update({
          is_filled: true,
          filled_by: (await supabase.auth.getUser()).data.user?.id,
          filled_at: new Date().toISOString()
        })
        .eq('id', gapId);

      if (gapError) throw gapError;

      // Award points
      const gap = gaps.find(g => g.id === gapId);
      if (gap) {
        await supabase.rpc('award_points', {
          p_user_id: (await supabase.auth.getUser()).data.user?.id,
          p_category: 'data_fill',
          p_points: gap.points_reward,
          p_reason: `Filled ${fieldName} gap`
        });
      }

      // Reload gaps
      setFilling(null);
      setFillValue('');
      loadGaps();

    } catch (error: any) {
      console.error('Fill gap error:', error);
      alert('Failed to fill gap: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="rh-card" style={{ margin: '16px', padding: '24px', textAlign: 'center' }}>
        <div style={{ color: 'var(--rh-text-secondary)' }}>Loading bounties...</div>
      </div>
    );
  }

  if (gaps.length === 0) {
    return (
      <div className="rh-card" style={{ margin: '16px', padding: '24px', textAlign: 'center' }}>
        <div style={{ color: 'var(--rh-text-secondary)' }}>No data gaps found!</div>
        <div style={{ fontSize: '12px', color: 'var(--rh-text-tertiary)', marginTop: '8px' }}>
          All fields are complete. Check back later for new bounties.
        </div>
      </div>
    );
  }

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
            Data Bounties
          </h3>
          <p style={{ 
            fontSize: '13px', 
            color: 'var(--rh-text-secondary)', 
            margin: 0 
          }}>
            Fill missing fields to earn points and improve data quality
          </p>
        </div>

        {/* Gap List */}
        {gaps.map((gap) => {
          const priorityColor = {
            critical: 'var(--rh-red)',
            high: 'var(--rh-orange)',
            medium: 'var(--rh-blue)',
            low: 'var(--rh-text-tertiary)'
          }[gap.field_priority];

          return (
            <div
              key={gap.id}
              style={{
                padding: '12px',
                border: '1px solid var(--rh-border)',
                borderRadius: '8px',
                marginBottom: '8px',
                background: filling === gap.id ? 'var(--rh-surface-elevated)' : 'transparent'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ 
                      fontSize: '13px', 
                      fontWeight: 600, 
                      color: 'var(--rh-text-primary)',
                      fontFamily: 'var(--rh-font-mono)'
                    }}>
                      {gap.field_name}
                    </span>
                    <span style={{ 
                      fontSize: '11px', 
                      color: priorityColor,
                      textTransform: 'uppercase',
                      fontWeight: 600
                    }}>
                      {gap.field_priority}
                    </span>
                  </div>
                  {gap.vehicle && (
                    <div style={{ fontSize: '12px', color: 'var(--rh-text-secondary)', marginBottom: '4px' }}>
                      {gap.vehicle.year} {gap.vehicle.make} {gap.vehicle.model}
                    </div>
                  )}
                  <div style={{ fontSize: '12px', color: 'var(--rh-text-tertiary)' }}>
                    {gap.gap_reason}
                  </div>
                </div>
                <div style={{ 
                  fontFamily: 'var(--rh-font-mono)',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: 'var(--rh-green)'
                }}>
                  +{gap.points_reward}
                </div>
              </div>

              {/* Fill Form */}
              {filling === gap.id ? (
                <div>
                  <input
                    type="text"
                    placeholder={`Enter ${gap.field_name}`}
                    value={fillValue}
                    onChange={(e) => setFillValue(e.target.value)}
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '8px',
                      fontSize: '14px',
                      fontFamily: 'var(--rh-font-mono)',
                      background: 'var(--rh-surface)',
                      border: '1px solid var(--rh-border)',
                      borderRadius: '4px',
                      color: 'var(--rh-text-primary)',
                      marginBottom: '8px'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleFillGap(gap.id, gap.field_name, gap.entity_type, gap.entity_id)}
                      className="rh-btn-success"
                      style={{ flex: 1, padding: '8px' }}
                    >
                      Submit & Claim {gap.points_reward} pts
                    </button>
                    <button
                      onClick={() => { setFilling(null); setFillValue(''); }}
                      className="rh-btn"
                      style={{ padding: '8px 16px' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setFilling(gap.id)}
                  className="rh-btn"
                  style={{ width: '100%', padding: '8px', fontSize: '13px' }}
                >
                  Fill This Field
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

