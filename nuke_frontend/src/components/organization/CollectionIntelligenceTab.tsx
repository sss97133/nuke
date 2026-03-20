import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface CollectionIntelligence {
  estimated_capacity: number | null;
  current_inventory: number | null;
  capacity_utilization: number | null;
  capacity_method: string | null;
  metro_area: string | null;
  metro_population: number | null;
  zip_median_income: number | null;
  zip_population: number | null;
  demand_score: number | null;
  demand_signals: Record<string, number>;
  vehicles_within_25mi: number | null;
  vehicles_within_50mi: number | null;
  avg_vehicle_value_25mi: number | null;
  competing_collections_25mi: number | null;
  competing_dealers_25mi: number | null;
  make_distribution: Record<string, number>;
  era_distribution: Record<string, number>;
  value_distribution: Record<string, number>;
  opportunity_summary: string | null;
  opportunity_score: number | null;
  calculated_at: string | null;
}

interface Props {
  organizationId: string;
}

const CollectionIntelligenceTab: React.FC<Props> = ({ organizationId }) => {
  const [intel, setIntel] = useState<CollectionIntelligence | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadIntelligence();
  }, [organizationId]);

  const loadIntelligence = async () => {
    try {
      const { data, error } = await supabase
        .from('collection_intelligence')
        .select('*')
        .eq('business_id', organizationId)
        .single();

      if (!error && data) {
        setIntel(data);
      }
    } catch {
      // No intelligence data yet
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
        Loading intelligence data...
      </div>
    );
  }

  if (!intel) {
    return (
      <div style={{ padding: '16px' }}>
        <div className="card" style={{ textAlign: 'center', padding: '32px' }}>
          <div style={{ fontSize: '15px', color: 'var(--text-muted)' }}>
            Intelligence data is being computed for this collection.
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Check back soon — demographic, market, and capacity analysis is generated automatically.
          </div>
        </div>
      </div>
    );
  }

  const demandColor = (intel.demand_score || 0) >= 70 ? 'var(--success)'
    : (intel.demand_score || 0) >= 40 ? 'var(--warning)'
    : 'var(--error)';

  const utilizationColor = (intel.capacity_utilization || 0) >= 80 ? 'var(--error)'
    : (intel.capacity_utilization || 0) >= 50 ? 'var(--warning)'
    : 'var(--success)';

  const topMakes = Object.entries(intel.make_distribution || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxMakeCount = topMakes.length > 0 ? topMakes[0][1] : 1;

  const topEras = Object.entries(intel.era_distribution || {})
    .sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top row: Capacity + Demand Score */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Capacity Card */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', fontWeight: 600 }}>
            Capacity Utilization
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ position: 'relative', width: '80px', height: '80px' }}>
              <svg viewBox="0 0 36 36" style={{ width: '80px', height: '80px', transform: 'rotate(-90deg)' }}>
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--border)" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15.5" fill="none"
                  stroke={utilizationColor}
                  strokeWidth="3"
                  strokeDasharray={`${(intel.capacity_utilization || 0) * 0.974} 97.4`}
                  strokeLinecap="round"
                />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '19px', fontWeight: 700, color: utilizationColor }}>
                {intel.capacity_utilization != null ? `${Math.round(intel.capacity_utilization)}%` : 'N/A'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '13px' }}>
                <span style={{ fontWeight: 700 }}>{intel.current_inventory || 0}</span>
                <span style={{ color: 'var(--text-muted)' }}> / {intel.estimated_capacity || '?'} vehicles</span>
              </div>
              {intel.capacity_method && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Method: {intel.capacity_method.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Demand Score Card */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', fontWeight: 600 }}>
            Demand Score
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '43px', fontWeight: 800, color: demandColor, lineHeight: 1 }}>
              {intel.demand_score != null ? Math.round(intel.demand_score) : '—'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              / 100
            </div>
          </div>
          {intel.demand_signals && Object.keys(intel.demand_signals).length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {Object.entries(intel.demand_signals).map(([key, value]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                  <div style={{ width: '100px', color: 'var(--text-muted)' }}>
                    {key.replace(/_/g, ' ')}
                  </div>
                  <div style={{ flex: 1, height: '4px', background: 'var(--gray-100)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (value / 30) * 100)}%`, height: '100%', background: demandColor}} />
                  </div>
                  <div style={{ width: '24px', textAlign: 'right', fontWeight: 600 }}>{Math.round(value)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Demographics + Market Context */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Demographics */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', fontWeight: 600 }}>
            Market Context
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {intel.metro_area && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Metro Area</div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{intel.metro_area}</div>
              </div>
            )}
            {intel.metro_population != null && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Population</div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{intel.metro_population.toLocaleString()}</div>
              </div>
            )}
            {intel.zip_median_income != null && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Median Income</div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>${Math.round(intel.zip_median_income).toLocaleString()}</div>
              </div>
            )}
          </div>
        </div>

        {/* Nearby Activity */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', fontWeight: 600 }}>
            Nearby Activity
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {intel.vehicles_within_25mi != null && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vehicles within 25mi</div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{intel.vehicles_within_25mi.toLocaleString()}</div>
              </div>
            )}
            {intel.competing_collections_25mi != null && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Competing Collections (25mi)</div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{intel.competing_collections_25mi}</div>
              </div>
            )}
            {intel.competing_dealers_25mi != null && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Dealers Nearby (25mi)</div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{intel.competing_dealers_25mi}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Make Distribution */}
      {topMakes.length > 0 && (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', fontWeight: 600 }}>
            Make Distribution
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {topMakes.map(([make, count]) => (
              <div key={make} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '80px', fontSize: '12px', fontWeight: 600, textAlign: 'right' }}>{make}</div>
                <div style={{ flex: 1, height: '16px', background: 'var(--gray-100)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(count / maxMakeCount) * 100}%`,
                    height: '100%',
                    background: 'var(--accent, #3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '6px',
                    fontSize: '11px', color: '#fff', fontWeight: 600,
                  }}>
                    {count}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Era Distribution */}
      {topEras.length > 0 && (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', fontWeight: 600 }}>
            Era Distribution
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {topEras.map(([era, count]) => (
              <div key={era} style={{
                padding: '6px 12px',
                background: 'var(--gray-50)',
                border: '1px solid var(--border)', fontSize: '12px',
              }}>
                <span style={{ fontWeight: 600 }}>{era}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Opportunity Summary */}
      {intel.opportunity_summary && (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', fontWeight: 600 }}>
            Opportunity Analysis
          </div>
          <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-primary)' }}>
            {intel.opportunity_summary}
          </div>
          {intel.calculated_at && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
              Last updated: {new Date(intel.calculated_at).toLocaleDateString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CollectionIntelligenceTab;
