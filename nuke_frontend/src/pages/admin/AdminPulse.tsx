import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

// --- Types ---
interface PulseData {
  generated_at: string;
  queue_health: {
    import_queue: Record<string, number>;
    bat_extraction: Record<string, number>;
    document_ocr: Record<string, number>;
    snapshot_extraction: Array<{ platform: string; status: string; cnt: number }>;
  };
  data_quality: {
    total_vehicles: number;
    total_images: number;
    total_observations: number;
    total_snapshots: number;
    total_estimates: number;
    field_stats: Record<string, number>;
    snapshot_captured_at: string;
  };
  extraction_pulse_24h: {
    vehicles_ingested: number;
    snapshots_success: number;
    snapshots_failed: number;
    reextracted_24h: number;
  };
  system_health: {
    active_cron_jobs: number;
    failed_cron_1h: number;
    succeeded_cron_1h: number;
    db_size_gb: number;
    ai_analysis_paused: boolean;
  };
}

// --- Helpers ---
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type Signal = 'green' | 'yellow' | 'red';

function signal(value: number, greenBelow: number, yellowBelow: number): Signal {
  if (value < greenBelow) return 'green';
  if (value < yellowBelow) return 'yellow';
  return 'red';
}

function pctSignal(pct: number): Signal {
  if (pct >= 80) return 'green';
  if (pct >= 50) return 'yellow';
  return 'red';
}

const SIGNAL_COLORS: Record<Signal, string> = {
  green: '#16825d',
  yellow: '#b05a00',
  red: '#d13438',
};

// --- Styles ---
const S = {
  page: {
    fontFamily: 'Arial, sans-serif',
    background: '#1a1a1a',
    color: '#e0e0e0',
    minHeight: '100vh',
    padding: '16px 20px',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    borderBottom: '2px solid #333',
    paddingBottom: '8px',
  } as React.CSSProperties,
  title: {
    fontSize: '14px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
  } as React.CSSProperties,
  meta: {
    fontSize: '9px',
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  } as React.CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '12px',
  } as React.CSSProperties,
  section: {
    border: '2px solid #333',
    padding: '12px',
    background: '#222',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    color: '#888',
    marginBottom: '10px',
  } as React.CSSProperties,
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
    fontSize: '12px',
    borderBottom: '1px solid #2a2a2a',
  } as React.CSSProperties,
  label: {
    fontSize: '9px',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: '#999',
  } as React.CSSProperties,
  value: {
    fontFamily: '"Courier New", monospace',
    fontSize: '13px',
    fontWeight: 700,
  } as React.CSSProperties,
  bigNum: {
    fontFamily: '"Courier New", monospace',
    fontSize: '22px',
    fontWeight: 700,
    lineHeight: 1,
  } as React.CSSProperties,
  dot: (color: string) => ({
    display: 'inline-block',
    width: '8px',
    height: '8px',
    background: color,
    marginRight: '6px',
    flexShrink: 0,
  } as React.CSSProperties),
  badge: (bg: string) => ({
    display: 'inline-block',
    padding: '1px 6px',
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    border: `1px solid ${bg}`,
    color: bg,
  } as React.CSSProperties),
};

// --- Components ---
function Metric({ label, value, sig }: { label: string; value: string | number; sig?: Signal }) {
  return (
    <div style={S.row}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {sig && <span style={S.dot(SIGNAL_COLORS[sig])} />}
        <span style={S.label}>{label}</span>
      </div>
      <span style={{ ...S.value, color: sig ? SIGNAL_COLORS[sig] : '#e0e0e0' }}>{value}</span>
    </div>
  );
}

function QueueSection({ title, data }: { title: string; data: Record<string, number> }) {
  const pending = data.pending || 0;
  const processing = data.processing || 0;
  const complete = data.complete || data.completed || 0;
  const failed = data.failed || 0;
  const total = Object.values(data).reduce((a, b) => a + b, 0);

  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ ...S.label, marginBottom: '4px', fontSize: '10px', color: '#bbb' }}>{title}</div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ ...S.value, color: '#e0e0e0' }}>{fmt(pending)} <span style={S.label}>PENDING</span></span>
        <span style={{ ...S.value, color: '#4a9eff' }}>{fmt(processing)} <span style={S.label}>PROC</span></span>
        <span style={{ ...S.value, color: SIGNAL_COLORS.green }}>{fmt(complete)} <span style={S.label}>DONE</span></span>
        {failed > 0 && <span style={{ ...S.value, color: SIGNAL_COLORS.red }}>{fmt(failed)} <span style={S.label}>FAIL</span></span>}
        {total > 0 && <span style={{ ...S.label, color: '#666' }}>({fmt(total)} total)</span>}
      </div>
    </div>
  );
}

// --- Main ---
const AdminPulse: React.FC = () => {
  const [data, setData] = useState<PulseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchPulse = useCallback(async () => {
    try {
      const { data: result, error: err } = await supabase.rpc('admin_pulse');
      if (err) throw new Error(err.message);
      setData(result as PulseData);
      setError(null);
      setLastFetch(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPulse();
    const interval = setInterval(fetchPulse, 60_000);
    return () => clearInterval(interval);
  }, [fetchPulse]);

  if (loading && !data) {
    return <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={S.meta}>LOADING PULSE...</span>
    </div>;
  }

  if (error && !data) {
    return <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: SIGNAL_COLORS.red, fontSize: '12px' }}>ERROR: {error}</span>
    </div>;
  }

  if (!data) return null;

  const { queue_health: q, data_quality: dq, extraction_pulse_24h: ep, system_health: sh } = data;
  const fs = dq.field_stats || {};

  // Snapshot extraction summary
  const snapPending = (q.snapshot_extraction || [])
    .filter(s => s.status === 'pending')
    .reduce((a, s) => a + s.cnt, 0);
  const snapCompleted = (q.snapshot_extraction || [])
    .filter(s => s.status === 'completed')
    .reduce((a, s) => a + s.cnt, 0);

  const cronFailRate = sh.succeeded_cron_1h > 0
    ? Math.round(100 * sh.failed_cron_1h / (sh.succeeded_cron_1h + sh.failed_cron_1h))
    : 0;

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.title}>PLATFORM PULSE</div>
          <div style={S.meta}>ONE SCREEN. IS EVERYTHING WORKING?</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={S.meta}>
            REFRESHES EVERY 60S
            {lastFetch && ` | LAST: ${lastFetch.toLocaleTimeString()}`}
          </div>
          {sh.ai_analysis_paused && (
            <span style={S.badge(SIGNAL_COLORS.yellow)}>AI PAUSED</span>
          )}
        </div>
      </div>

      <div style={S.grid}>
        {/* 1. BIG NUMBERS */}
        <div style={S.section}>
          <div style={S.sectionTitle}>PLATFORM SCALE</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', textAlign: 'center' }}>
            <div>
              <div style={S.bigNum}>{fmt(dq.total_vehicles)}</div>
              <div style={S.label}>VEHICLES</div>
            </div>
            <div>
              <div style={S.bigNum}>{fmt(dq.total_images)}</div>
              <div style={S.label}>IMAGES</div>
            </div>
            <div>
              <div style={S.bigNum}>{fmt(dq.total_snapshots)}</div>
              <div style={S.label}>SNAPSHOTS</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', textAlign: 'center', marginTop: '8px' }}>
            <div>
              <div style={{ ...S.bigNum, fontSize: '18px' }}>{fmt(dq.total_observations)}</div>
              <div style={S.label}>OBSERVATIONS</div>
            </div>
            <div>
              <div style={{ ...S.bigNum, fontSize: '18px' }}>{fmt(dq.total_estimates)}</div>
              <div style={S.label}>VALUATIONS</div>
            </div>
            <div>
              <div style={{ ...S.bigNum, fontSize: '18px' }}>{sh.db_size_gb}GB</div>
              <div style={S.label}>DB SIZE</div>
            </div>
          </div>
        </div>

        {/* 2. DATA QUALITY */}
        <div style={S.section}>
          <div style={S.sectionTitle}>DATA QUALITY (SAMPLED)</div>
          <Metric label="Year / Make / Model" value={`${fs.year?.toFixed(0) || '?'}% / ${fs.make?.toFixed(0) || '?'}% / ${fs.model?.toFixed(0) || '?'}%`} sig={pctSignal(fs.make || 0)} />
          <Metric label="VIN" value={`${(fs.vin || 0).toFixed(0)}%`} sig={pctSignal(fs.vin || 0)} />
          <Metric label="Description" value={`${(fs.description || 0).toFixed(0)}%`} sig={pctSignal(fs.description || 0)} />
          <Metric label="Sale Price" value={`${(fs.asking_price || 0).toFixed(0)}%`} sig={pctSignal(fs.asking_price || 0)} />
          <Metric label="Mileage" value={`${(fs.mileage || 0).toFixed(0)}%`} sig={pctSignal(fs.mileage || 0)} />
          <Metric label="Transmission" value={`${(fs.transmission_type || 0).toFixed(0)}%`} sig={pctSignal(fs.transmission_type || 0)} />
          <Metric label="Drivetrain" value={`${(fs.drivetrain || 0).toFixed(0)}%`} sig={pctSignal(fs.drivetrain || 0)} />
          <Metric label="Body Style" value={`${(fs.body_style || 0).toFixed(0)}%`} sig={pctSignal(fs.body_style || 0)} />
          <Metric label="Interior Color" value={`${(fs.interior_color || 0).toFixed(0)}%`} sig={pctSignal(fs.interior_color || 0)} />
          <Metric label="Nuke Estimate" value={`${(fs.nuke_estimate || 0).toFixed(0)}%`} sig={pctSignal(fs.nuke_estimate || 0)} />
        </div>

        {/* 3. QUEUE HEALTH */}
        <div style={S.section}>
          <div style={S.sectionTitle}>QUEUE HEALTH</div>
          <QueueSection title="IMPORT QUEUE" data={q.import_queue} />
          <QueueSection title="BAT EXTRACTION" data={q.bat_extraction} />
          <QueueSection title="DOCUMENT OCR" data={q.document_ocr} />
          <div style={{ marginBottom: '10px' }}>
            <div style={{ ...S.label, marginBottom: '4px', fontSize: '10px', color: '#bbb' }}>SNAPSHOT REEXTRACTION</div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ ...S.value, color: '#e0e0e0' }}>{fmt(snapPending)} <span style={S.label}>PENDING</span></span>
              <span style={{ ...S.value, color: SIGNAL_COLORS.green }}>{fmt(snapCompleted)} <span style={S.label}>DONE</span></span>
            </div>
            {/* Per-platform breakdown */}
            <div style={{ marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {(() => {
                const platforms: Record<string, { pending: number; completed: number }> = {};
                for (const s of q.snapshot_extraction || []) {
                  if (!platforms[s.platform]) platforms[s.platform] = { pending: 0, completed: 0 };
                  if (s.status === 'pending') platforms[s.platform].pending = s.cnt;
                  if (s.status === 'completed') platforms[s.platform].completed = s.cnt;
                }
                return Object.entries(platforms).map(([p, v]) => (
                  <span key={p} style={{ ...S.label, fontSize: '8px', color: v.pending > 0 ? '#4a9eff' : '#555' }}>
                    {p.toUpperCase()}: {fmt(v.pending > 0 ? v.pending : v.completed)}
                  </span>
                ));
              })()}
            </div>
          </div>
        </div>

        {/* 4. EXTRACTION PULSE (24H) */}
        <div style={S.section}>
          <div style={S.sectionTitle}>EXTRACTION PULSE (24H)</div>
          <Metric label="Vehicles Ingested" value={fmt(ep.vehicles_ingested)} sig={ep.vehicles_ingested > 0 ? 'green' : 'red'} />
          <Metric label="Snapshots Fetched (OK)" value={fmt(ep.snapshots_success)} sig={ep.snapshots_success > 0 ? 'green' : 'yellow'} />
          <Metric label="Snapshots Failed" value={fmt(ep.snapshots_failed)} sig={signal(ep.snapshots_failed, 100, 500)} />
          <Metric label="Fields Reextracted" value={fmt(ep.reextracted_24h)} sig={ep.reextracted_24h > 0 ? 'green' : 'yellow'} />

          <div style={{ marginTop: '12px' }}>
            <div style={S.sectionTitle}>SYSTEM HEALTH</div>
            <Metric label="Active Cron Jobs" value={sh.active_cron_jobs} />
            <Metric label="Cron Success (1h)" value={sh.succeeded_cron_1h} sig="green" />
            <Metric label="Cron Failures (1h)" value={sh.failed_cron_1h} sig={signal(sh.failed_cron_1h, 10, 50)} />
            <Metric label="Cron Fail Rate" value={`${cronFailRate}%`} sig={signal(cronFailRate, 5, 15)} />
            <Metric label="DB Size" value={`${sh.db_size_gb} GB`} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ ...S.meta, marginTop: '12px', textAlign: 'center' }}>
        DATA FROM admin_pulse() RPC | FIELD STATS SAMPLED EVERY 10 MIN
        {error && <span style={{ color: SIGNAL_COLORS.red }}> | LAST REFRESH ERROR: {error}</span>}
      </div>
    </div>
  );
};

export default AdminPulse;
