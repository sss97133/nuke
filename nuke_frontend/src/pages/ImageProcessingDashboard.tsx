import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import '../styles/unified-design-system.css';

interface ProcessingStats {
  // Progress
  total: number;
  tier1Complete: number;
  tier2Complete: number;
  tier3Complete: number;
  failed: number;
  
  // Performance
  imagesPerMinute: number;
  eta: string;
  startTime: Date;
  
  // Costs
  totalCost: number;
  projectedCost: number;
  avgCostPerImage: number;
  modelUsage: Record<string, { count: number; cost: number; avgConfidence: number }>;
  
  // Quality
  avgConfidence: number;
  validationRate: number;
  consensusRate: number;
  
  // Context
  contextScores: {
    rich: number;
    good: number;
    medium: number;
    poor: number;
  };
  
  // Tables populated
  tablesPopulated: Record<string, number>;
  
  // Recent activity
  recentActivity: Array<{
    imageId: string;
    vehicleId: string;
    tier: number;
    model: string;
    confidence: number;
    cost: number;
    contextScore: number;
    timestamp: string;
  }>;
  
  // Alerts
  alerts: Array<{
    severity: 'info' | 'warning' | 'error';
    message: string;
    action?: string;
  }>;
}

export default function ImageProcessingDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<ProcessingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadStats();

    // Event-driven refresh: when a deep-analysis atom lands in vehicle_observations
    // (the canonical sink), refresh the recent-activity feed. No polling — the old
    // 2s setInterval fired four `count: exact, head: true` scans over the 38.9M-row
    // vehicle_images table every tick, which times out / hammers the DB. The feed is
    // bounded (LIMIT) and indexed, so it stays cheap.
    if (!autoRefresh) return;
    const channel = supabase
      .channel('image-processing-updates')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'vehicle_observations' },
        (payload) => {
          if ((payload.new as { kind?: string }).kind === 'condition') loadStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [autoRefresh]);

  async function loadStats() {
    try {
      // Canonical deep-analysis marker = vehicle_images.ai_scan_metadata.byok_deep_analysis,
      // surfaced as atoms in vehicle_observations (kind=condition, analysis_kind=image_deep_byok).
      // The retired tier_1/2/3_analysis JSONB keys have no writer (tier_2/3 are 0 everywhere),
      // so the old tier counters always read ~zero while thousands of images were deep-analyzed.
      //
      // We do NOT compute exact global totals here: counting the 38.9M-row vehicle_images table
      // (or the 7.5M-row vehicle_observations table) on every render is not affordable client-side.
      // The recent-activity feed below is bounded + index-ordered (ingested_at) and is the honest,
      // cheap signal for "is the deep pipeline flowing right now."
      //
      // TODO(needs_db): a true global rollup — total deep-analyzed images, % coverage, per-day
      // depth distribution — belongs in a DB-side aggregate (a materialized view or a
      // get_global_analysis_coverage() RPC mirroring get_vehicle_analysis_coverage / get_vehicle_day_depth).
      // Repoint the headline tiles at that RPC once it exists. Do not reintroduce full-table head counts.
      const { data: recentAtoms } = await supabase
        .from('vehicle_observations')
        .select('id, vehicle_id, observed_at, ingested_at, confidence_score, structured_data')
        .eq('kind', 'condition')
        .contains('structured_data', { analysis_kind: 'image_deep_byok' })
        .order('ingested_at', { ascending: false })
        .limit(20);

      const atoms = recentAtoms || [];

      const recentActivity = atoms.map(a => {
        const sd = (a.structured_data || {}) as {
          image_id?: string; scene_type?: string; build_phase_guess?: string; agent_model?: string;
        };
        return {
          imageId: sd.image_id || a.id,
          vehicleId: a.vehicle_id,
          tier: 0,
          model: sd.agent_model || sd.scene_type || sd.build_phase_guess || 'byok',
          confidence: Math.round((a.confidence_score ?? 0) * 100),
          cost: 0,
          contextScore: 0,
          timestamp: a.ingested_at || a.observed_at || new Date().toISOString()
        };
      });

      // Window counts from the live feed only (NOT global totals — see note above).
      const recentDeep = atoms.length;
      const recentConfident = atoms.filter(a => (a.confidence_score ?? 0) >= 0.6).length;

      setStats({
        total: recentDeep,
        tier1Complete: recentDeep,
        tier2Complete: recentConfident,
        tier3Complete: 0,
        failed: 0,
        totalCost: 0,
        modelUsage: {},
        contextScores: { rich: 0, good: 0, medium: 0, poor: 0 },
        recentActivity,
        imagesPerMinute: 0,
        eta: '',
        startTime: new Date(),
        avgCostPerImage: 0,
        projectedCost: 0,
        avgConfidence: 0,
        validationRate: 0,
        consensusRate: 0,
        tablesPopulated: {},
        alerts: []
      });

      setLoading(false);
    } catch (error) {
      console.error('Error loading stats:', error);
      setLoading(false);
    }
  }

  if (loading || !stats) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading processing stats...
      </div>
    );
  }

  // These are WINDOW figures from the live recent-atom feed, not global totals.
  // Percentages over a 20-row window are meaningless, so the tiles below show raw
  // counts only. Global coverage % awaits the DB-side rollup (see loadStats TODO).
  const confidentPercent = stats.tier1Complete > 0
    ? (stats.tier2Complete / stats.tier1Complete) * 100
    : 0;

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      
      {/* Header */}
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="button button-secondary cursor-button"
            style={{ 
              marginBottom: '16px',
              fontSize: '11px', 
              padding: '6px 12px',
              border: '2px solid var(--border-light)',
              transition: 'all 0.12s ease'
            }}
          >
            ← Back to Mission Control
          </button>
          <h1 style={{ fontSize: '11px', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Image Processing Dashboard
          </h1>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Real-time AI analysis monitoring
          </p>
        </div>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className="button cursor-button"
          style={{
            padding: '8px 16px',
            fontSize: '11px',
            border: `2px solid ${autoRefresh ? 'var(--success)' : 'var(--border-light)'}`,
            background: autoRefresh ? 'var(--success-light)' : 'var(--surface)',
            color: autoRefresh ? 'var(--success)' : 'var(--text-muted)',
            transition: 'all 0.12s ease'
          }}
        >
          {autoRefresh ? 'AUTO-REFRESH ON' : 'AUTO-REFRESH PAUSED'}
        </button>
      </div>

      {/* Live-window stats — figures from the recent deep-analysis atom feed, NOT global
          totals. A real global coverage rollup awaits the DB-side aggregate (see loadStats). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>

        {/* Recent deep-analyzed atoms */}
        <div className="card" style={{ padding: '16px', border: '2px solid var(--accent)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            RECENT DEEP-ANALYSIS ATOMS
          </div>
          <div style={{ fontSize: '19px', fontWeight: 700 }}>
            {stats.tier1Complete.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            byok_deep_analysis · live window
          </div>
        </div>

        {/* High-confidence within window */}
        <div className="card" style={{ padding: '16px', border: '2px solid var(--success)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            HIGH CONFIDENCE (≥0.6)
          </div>
          <div style={{ fontSize: '19px', fontWeight: 700, marginBottom: '8px' }}>
            {stats.tier2Complete.toLocaleString()}
          </div>
          <div style={{ height: '4px', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
            <div style={{ width: `${confidentPercent}%`, height: '100%', background: 'var(--success)' }} />
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {confidentPercent.toFixed(0)}% of window
          </div>
        </div>

        {/* Global coverage — pending DB rollup */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            GLOBAL COVERAGE
          </div>
          <div style={{ fontSize: '19px', fontWeight: 700, color: 'var(--text-muted)' }}>
            —
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            awaiting analysis-coverage rollup RPC
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        {/* Recent Activity Feed */}
        <div className="card">
          <div className="card-header" style={{ fontSize: '11px', fontWeight: 700 }}>
            RECENT ACTIVITY
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {stats.recentActivity.map((activity, idx) => {
              const timeAgo = Math.floor((Date.now() - new Date(activity.timestamp).getTime()) / 1000);
              return (
                <div 
                  key={idx}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border-light)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ fontSize: '11px', fontFamily: "'Courier New', monospace", color: 'var(--text-muted)' }}>
                      {activity.imageId.substring(0, 8)}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase' }}>
                      {activity.model}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {activity.confidence}% confidence
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {timeAgo < 60 ? `${timeAgo}s ago` : `${Math.floor(timeAgo / 60)}m ago`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pipeline marker reference */}
        <div className="card">
          <div className="card-header" style={{ fontSize: '11px', fontWeight: 700 }}>
            DEPTH MARKER
          </div>
          <div className="card-body">
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Analysis depth is read from the canonical BYOK marker, not the retired tier_1/2/3 keys.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '11px' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>image</div>
                <code style={{ color: 'var(--text-muted)' }}>ai_scan_metadata.byok_deep_analysis</code>
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>atom</div>
                <code style={{ color: 'var(--text-muted)' }}>vehicle_observations · kind=condition · analysis_kind=image_deep_byok</code>
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>per-vehicle / per-day depth</div>
                <code style={{ color: 'var(--text-muted)' }}>get_vehicle_analysis_coverage() · get_vehicle_day_depth()</code>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                A global coverage rollup (total deep-analyzed, % of library) needs a DB-side
                aggregate — the headline tile lights up once that RPC ships.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
        <button
          onClick={loadStats}
          className="button button-primary cursor-button"
          style={{ padding: '10px 20px', fontSize: '11px' }}
        >
          REFRESH DATA
        </button>
        
        <button
          onClick={() => navigate('/admin/scripts')}
          className="button button-secondary cursor-button"
          style={{ padding: '10px 20px', fontSize: '11px' }}
        >
          SCRIPT CONTROL
        </button>
      </div>
    </div>
  );
}