/**
 * Data Quality Dashboard
 * Real-time field completion rates + enrichment workforce status
 * Polls data_quality_snapshots table every 30 seconds
 */

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface FieldStat {
  field: string;
  label: string;
  pct: number;
  delta1h: number;
  tier: 'identity' | 'specs' | 'content' | 'location' | 'valuations';
}

interface WorkforceStrategy {
  name: string;
  displayName: string;
  cost: 'free' | 'llm';
  status: 'active' | 'idle' | 'unknown';
  lastRun?: string;
  priority: number;
}

interface Snapshot {
  id: number;
  captured_at: string;
  sample_size: number;
  total_vehicles: number;
  field_stats: Record<string, number>;
  workforce_status: any;
  pipeline_stats: any;
}

// Field definitions: order + tier
// Field keys must match what get_data_quality_field_stats() returns exactly
const FIELD_DEFS: { field: string; label: string; tier: FieldStat['tier'] }[] = [
  // Identity
  { field: 'make', label: 'Make', tier: 'identity' },
  { field: 'model', label: 'Model', tier: 'identity' },
  { field: 'year', label: 'Year', tier: 'identity' },
  { field: 'vin', label: 'VIN', tier: 'identity' },
  { field: 'trim', label: 'Trim', tier: 'identity' },
  { field: 'series', label: 'Series', tier: 'identity' },
  // Specs
  { field: 'body_style', label: 'Body Style', tier: 'specs' },
  { field: 'engine_type', label: 'Engine', tier: 'specs' },
  { field: 'engine_liters', label: 'Displacement', tier: 'specs' },
  { field: 'drivetrain', label: 'Drivetrain', tier: 'specs' },
  { field: 'transmission_type', label: 'Transmission', tier: 'specs' },
  { field: 'fuel_type', label: 'Fuel Type', tier: 'specs' },
  { field: 'doors', label: 'Doors', tier: 'specs' },
  { field: 'seats', label: 'Seats', tier: 'specs' },
  { field: 'horsepower', label: 'Horsepower', tier: 'specs' },
  { field: 'torque', label: 'Torque', tier: 'specs' },
  { field: 'mpg_city', label: 'MPG City', tier: 'specs' },
  { field: 'mpg_highway', label: 'MPG Highway', tier: 'specs' },
  { field: 'weight_lbs', label: 'Weight', tier: 'specs' },
  { field: 'wheelbase_inches', label: 'Wheelbase', tier: 'specs' },
  { field: 'mileage', label: 'Mileage', tier: 'specs' },
  // Content
  { field: 'description', label: 'Description', tier: 'content' },
  { field: 'listing_url', label: 'Listing URL', tier: 'content' },
  { field: 'image_url', label: 'Image URL', tier: 'content' },
  { field: 'color', label: 'Exterior Color', tier: 'content' },
  { field: 'interior_color', label: 'Interior Color', tier: 'content' },
  // Location
  { field: 'city', label: 'City', tier: 'location' },
  { field: 'state', label: 'State', tier: 'location' },
  { field: 'country', label: 'Country', tier: 'location' },
  // Valuations
  { field: 'nuke_estimate', label: 'Nuke Estimate', tier: 'valuations' },
  { field: 'asking_price', label: 'Asking Price', tier: 'valuations' },
  { field: 'auction_status', label: 'Auction Status', tier: 'valuations' },
  { field: 'deal_score', label: 'Deal Score', tier: 'valuations' },
  { field: 'heat_score', label: 'Heat Score', tier: 'valuations' },
  { field: 'signal_score', label: 'Signal Score', tier: 'valuations' },
];

const TIER_LABELS: Record<FieldStat['tier'], string> = {
  identity: 'Core Identity',
  specs: 'Specifications',
  content: 'Content',
  location: 'Location',
  valuations: 'Valuations',
};

const WORKFORCE_STRATEGIES: WorkforceStrategy[] = [
  { name: 'batch-vin-decode', displayName: 'VIN Decode (NHTSA)', cost: 'free', priority: 1, status: 'unknown' },
  { name: 'batch-ymm-propagate', displayName: 'YMM Propagate', cost: 'free', priority: 2, status: 'unknown' },
  { name: 'mine_descriptions', displayName: 'Mine Descriptions', cost: 'free', priority: 3, status: 'unknown' },
  { name: 'derive_fields', displayName: 'Derive Fields', cost: 'free', priority: 4, status: 'unknown' },
  { name: 'enrich-factory-specs', displayName: 'Factory Specs (LLM)', cost: 'llm', priority: 5, status: 'unknown' },
  { name: 'enrich-vehicle-profile-ai', displayName: 'Profile AI (LLM)', cost: 'llm', priority: 6, status: 'unknown' },
  { name: 'compute-vehicle-valuation', displayName: 'Vehicle Valuation', cost: 'free', priority: 7, status: 'unknown' },
];

function getBarColor(pct: number): string {
  if (pct >= 80) return 'var(--success)';
  if (pct >= 30) return 'var(--warning)';
  if (pct >= 10) return 'var(--warning-text, #f97316)';
  return 'var(--error)';
}

function TrendArrow({ delta }: { delta: number }) {
  if (delta > 0.05) return <span style={{ color: 'var(--success)', marginLeft: '6px', fontWeight: 700 }}>▲{delta.toFixed(1)}%</span>;
  if (delta < -0.05) return <span style={{ color: 'var(--error)', marginLeft: '6px', fontWeight: 700 }}>▼{Math.abs(delta).toFixed(1)}%</span>;
  return <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>→</span>;
}

function ProgressBar({ pct }: { pct: number }) {
  const color = getBarColor(pct);
  return (
    <div style={{
      width: '140px',
      height: '6px',
      background: 'rgba(0,0,0,0.1)', overflow: 'hidden',
      display: 'inline-block',
      verticalAlign: 'middle',
      marginRight: '8px',
    }}>
      <div style={{
        width: `${Math.min(pct, 100)}%`,
        height: '100%',
        background: color,
        transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

function formatEta(field: string, pct: number, delta1h: number): string {
  if (pct >= 95) return '';
  if (delta1h <= 0) return '';
  const missing = 95 - pct;
  const hoursToTarget = missing / delta1h;
  if (hoursToTarget > 999) return '';
  if (hoursToTarget < 1) return `~${Math.round(hoursToTarget * 60)}min to 95%`;
  if (hoursToTarget < 48) return `~${Math.round(hoursToTarget)}hr to 95%`;
  return `~${Math.round(hoursToTarget / 24)}d to 95%`;
}

function formatAge(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}hr ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function DataQualityDashboard() {
  const [loading, setLoading] = useState(true);
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [prev, setPrev] = useState<Snapshot | null>(null);
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [snapshotsResult] = await Promise.allSettled([
      supabase
        .from('data_quality_snapshots')
        .select('*')
        .order('captured_at', { ascending: false })
        .limit(2),
    ]);

    if (snapshotsResult.status === 'fulfilled' && snapshotsResult.value.data) {
      const rows = snapshotsResult.value.data;
      setLatest(rows[0] || null);
      setPrev(rows[1] || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const triggerWorker = async (strategyName: string) => {
    setTriggerLoading(strategyName);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('data-quality-workforce', {
        body: { strategy: strategyName },
      });
      if (error) throw error;
      const result = data?.results?.find((r: any) => r.strategy === strategyName);
      setMessage(result?.status === 'fired'
        ? `Fired ${strategyName} successfully`
        : `${strategyName}: ${result?.reason || 'skipped'}`);
    } catch (e) {
      setMessage(`Error: ${String(e)}`);
    } finally {
      setTriggerLoading(null);
    }
  };

  const triggerSnapshot = async () => {
    setTriggerLoading('snapshot');
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('compute-data-quality-snapshot', {
        body: {},
      });
      if (error) throw error;
      setMessage(data?.message || 'Snapshot triggered');
      await loadData();
    } catch (e) {
      setMessage(`Error: ${String(e)}`);
    } finally {
      setTriggerLoading(null);
    }
  };

  // Compute field stats with deltas
  const fieldStats: FieldStat[] = FIELD_DEFS.map(def => {
    const pct = (latest?.field_stats?.[def.field] ?? 0) as number;
    const prevPct = (prev?.field_stats?.[def.field] ?? pct) as number;
    const delta1h = Math.round((pct - prevPct) * 10) / 10;
    return { ...def, pct, delta1h };
  });

  const tiers: FieldStat['tier'][] = ['identity', 'specs', 'content', 'location', 'valuations'];

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
        Loading data quality stats...
      </div>
    );
  }

  const totalVehicles = latest?.total_vehicles ?? 0;
  const snapshotAge = latest?.captured_at ? formatAge(latest.captured_at) : 'never';
  const sampleSize = latest?.sample_size ?? 0;

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '24px',
        borderBottom: '2px solid var(--border-light)',
        paddingBottom: '16px',
      }}>
        <div>
          <h1 style={{
            fontSize: '20px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '2px',
            marginBottom: '4px',
          }}>
            Data Quality
          </h1>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {totalVehicles.toLocaleString()} vehicles &middot; Sample: {sampleSize.toLocaleString()} &middot; Last snapshot: {snapshotAge}
          </div>
        </div>
        <button
          onClick={triggerSnapshot}
          disabled={triggerLoading === 'snapshot'}
          style={{
            fontSize: '11px',
            padding: '8px 14px',
            background: 'var(--grey-100)',
            border: '2px solid var(--border-light)', cursor: 'pointer',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}
        >
          {triggerLoading === 'snapshot' ? 'Refreshing...' : 'Refresh Now'}
        </button>
      </div>

      {/* Message banner */}
      {message && (
        <div style={{
          background: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid rgba(34, 197, 94, 0.3)', padding: '10px 14px',
          fontSize: '11px',
          marginBottom: '16px',
          color: 'var(--success)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>{message}</span>
          <button onClick={() => setMessage(null)} style={{ all: 'unset', cursor: 'pointer', opacity: 0.6, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {!latest && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.1)',
          border: '2px solid rgba(245, 158, 11, 0.3)', padding: '16px',
          marginBottom: '24px',
          fontSize: '11px',
        }}>
          <strong>No snapshots yet.</strong> Click "Refresh Now" to capture the first snapshot, or wait for the cron job to run.
        </div>
      )}

      {/* Workforce Status Panel */}
      <div style={{
        background: 'var(--white)',
        border: '2px solid var(--border-light)', marginBottom: '24px',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 16px',
          background: 'var(--grey-100)',
          borderBottom: '1px solid var(--border-light)',
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>Enrichment Workforce</span>
          <button
            onClick={() => triggerWorker('all')}
            disabled={!!triggerLoading}
            style={{
              fontSize: '10px',
              padding: '4px 10px',
              background: 'var(--accent)',
              color: 'var(--bg)',
              border: 'none', cursor: 'pointer',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            Run All Free Strategies
          </button>
        </div>
        <div style={{ padding: '0' }}>
          {WORKFORCE_STRATEGIES.map((strategy, i) => {
            const isLlm = strategy.cost === 'llm';
            const isLoading = triggerLoading === strategy.name;
            return (
              <div key={strategy.name} style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 16px',
                borderBottom: i < WORKFORCE_STRATEGIES.length - 1 ? '1px solid var(--border-light)' : 'none',
                gap: '12px',
              }}>
                <div style={{
                  width: '20px',
                  height: '20px', background: isLlm ? 'rgba(245, 158, 11, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                  border: `2px solid ${isLlm ? 'var(--warning)' : 'var(--success)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  fontWeight: 700,
                  color: isLlm ? 'var(--warning)' : 'var(--success)',
                  flexShrink: 0,
                }}>
                  {strategy.priority}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600 }}>{strategy.displayName}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {isLlm
                      ? 'LLM strategy — set ENRICHMENT_LLM_ENABLED=true to enable'
                      : 'Free strategy — runs every cycle'}
                  </div>
                </div>
                <span style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 6px', background: isLlm ? 'rgba(245, 158, 11, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                  color: isLlm ? 'var(--warning)' : 'var(--success)',
                  border: `1px solid ${isLlm ? 'var(--warning)' : 'var(--success)'}`,
                }}>
                  {isLlm ? '$$$' : 'FREE'}
                </span>
                <button
                  onClick={() => triggerWorker(strategy.name)}
                  disabled={!!triggerLoading}
                  style={{
                    fontSize: '10px',
                    padding: '5px 10px',
                    background: isLoading ? 'var(--grey-100)' : 'transparent',
                    border: '1px solid var(--border-light)', cursor: 'pointer',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    flexShrink: 0,
                  }}
                >
                  {isLoading ? 'Starting...' : 'Start'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Field Completion Sections */}
      {tiers.map(tier => {
        const tierFields = fieldStats.filter(f => f.tier === tier);
        if (tierFields.length === 0) return null;

        // Sort by pct ascending (lowest first = most need)
        const sorted = [...tierFields].sort((a, b) => a.pct - b.pct);

        return (
          <div key={tier} style={{ marginBottom: '24px' }}>
            <h2 style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              color: 'var(--text-muted)',
              marginBottom: '8px',
              paddingBottom: '6px',
              borderBottom: '1px solid var(--border-light)',
            }}>
              {TIER_LABELS[tier]}
            </h2>
            <div style={{
              background: 'var(--white)',
              border: '2px solid var(--border-light)', overflow: 'hidden',
            }}>
              {sorted.map((f, i) => {
                const eta = formatEta(f.field, f.pct, f.delta1h);
                const color = getBarColor(f.pct);
                return (
                  <div key={f.field} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 16px',
                    borderBottom: i < sorted.length - 1 ? '1px solid var(--border-light)' : 'none',
                    gap: '12px',
                  }}>
                    {/* Field name */}
                    <div style={{
                      width: '140px',
                      fontSize: '11px',
                      fontWeight: 500,
                      flexShrink: 0,
                      color: 'var(--text)',
                      fontFamily: 'monospace',
                    }}>
                      {f.label}
                    </div>

                    {/* Progress bar */}
                    <div style={{ flex: 1, minWidth: '80px' }}>
                      <div style={{
                        width: '100%',
                        height: '6px',
                        background: 'rgba(0,0,0,0.06)', overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${Math.min(f.pct, 100)}%`,
                          height: '100%',
                          background: color,
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>

                    {/* Pct */}
                    <div style={{
                      width: '50px',
                      fontSize: '12px',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      textAlign: 'right',
                      color,
                      flexShrink: 0,
                    }}>
                      {f.pct.toFixed(1)}%
                    </div>

                    {/* Trend */}
                    <div style={{ width: '70px', flexShrink: 0 }}>
                      <TrendArrow delta={f.delta1h} />
                    </div>

                    {/* ETA */}
                    <div style={{
                      width: '120px',
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                      fontFamily: 'monospace',
                    }}>
                      {eta}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div style={{
        marginTop: '24px',
        fontSize: '10px',
        color: 'var(--text-muted)',
        display: 'flex',
        gap: '24px',
        borderTop: '1px solid var(--border-light)',
        paddingTop: '12px',
      }}>
        <span>Auto-refreshes every 30s</span>
        <span>Snapshot via TABLESAMPLE SYSTEM(3)</span>
        <span>Trend arrows = delta vs previous snapshot</span>
        <span>
          Bar colors: <span style={{ color: 'var(--success)' }}>■</span> &ge;80%
          <span style={{ color: 'var(--warning)' }}> ■</span> 30–79%
          <span style={{ color: 'var(--warning-text, #f97316)' }}> ■</span> 10–29%
          <span style={{ color: 'var(--error)' }}> ■</span> &lt;10%
        </span>
      </div>
    </div>
  );
}
