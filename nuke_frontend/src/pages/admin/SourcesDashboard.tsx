import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface SourceRow {
  slug: string;
  display_name: string;
  category: string;
  status: string;
  extractor_function: string | null;
  total_extracted: number;
  total_vehicles_created: number;
  success_rate_24h: number | null;
  avg_extraction_ms: number | null;
  last_successful_at: string | null;
  estimated_extraction_hours: number | null;
  monitoring_strategy: string | null;
  monitoring_frequency_hours: number | null;
  listing_url_pattern: string | null;
  observation_source_id: string | null;
  obs_category: string | null;
  base_url: string | null;
  logo_url: string | null;
  business_name: string | null;
  business_id: string | null;
  universe_total: number | null;
  universe_active: number | null;
  census_at: string | null;
}

interface QueueStats {
  pending: number;
  processing: number;
  complete: number;
  failed: number;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#2d8a4e',
  monitoring: 'var(--info)',
  investigating: 'var(--warning)',
  degraded: 'var(--error)',
  blocked: '#991b1b',
  pending: 'var(--text-secondary)',
  not_started: 'var(--text-disabled)',
  archived: 'var(--text-secondary)',
};

const CATEGORY_LABELS: Record<string, string> = {
  auction: 'AUCTION',
  marketplace: 'MARKET',
  dealer: 'DEALER',
  forum: 'FORUM',
  registry: 'REGISTRY',
  social: 'SOCIAL',
  documentation: 'DOCS',
};

export default function SourcesDashboard() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats>({ pending: 0, processing: 0, complete: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [addUrl, setAddUrl] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [onboardResult, setOnboardResult] = useState<any>(null);
  const [filter, setFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    // Single query via the view — replaces ~280 individual queries
    const { data: srData } = await supabase
      .from('source_dashboard_view')
      .select('*');

    if (srData) setSources(srData as SourceRow[]);

    // Queue stats via RPC — returns counts, not rows
    const { data: qData } = await supabase.rpc('get_queue_stats_24h');
    if (qData) {
      setQueueStats(qData as QueueStats);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleOnboard = async () => {
    if (!addUrl.trim()) return;
    setOnboarding(true);
    setOnboardResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onboard-source`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ url: addUrl.trim(), phase: 'all' }),
        }
      );
      const result = await resp.json();
      setOnboardResult(result);
      if (result.success) {
        setAddUrl('');
        fetchData();
      }
    } catch (e: any) {
      setOnboardResult({ success: false, error: e.message });
    }

    setOnboarding(false);
  };

  // Status counts
  const statusCounts: Record<string, number> = {};
  for (const s of sources) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  }

  // Filter
  const filtered = filter === 'all' ? sources : sources.filter(s => s.status === filter);

  const completionPct = (s: SourceRow) => {
    if (!s.universe_total || s.universe_total === 0) return null;
    return Math.min(100, Math.round((s.total_extracted / s.universe_total) * 100));
  };

  const formatNum = (n: number | null) => {
    if (n === null || n === undefined) return '-';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  };

  const timeAgo = (ts: string | null) => {
    if (!ts) return 'never';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div style={{ padding: '16px', maxWidth: '1200px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
            SOURCES
          </h1>
          <p style={{ fontFamily: 'Arial, sans-serif', fontSize: '9px', color: 'var(--text-secondary)', margin: '4px 0 0 0', textTransform: 'uppercase' }}>
            {sources.length} REGISTERED / {statusCounts['active'] || 0} ACTIVE / {statusCounts['monitoring'] || 0} MONITORING
          </p>
        </div>
      </div>

      {/* Add Source */}
      <div style={{
        border: '2px solid var(--border)',
        padding: '12px',
        marginBottom: '16px',
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
      }}>
        <span style={{ fontFamily: 'Arial, sans-serif', fontSize: '8px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          ADD SOURCE
        </span>
        <input
          type="text"
          placeholder="https://example-auction-site.com"
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleOnboard()}
          style={{
            flex: 1,
            fontFamily: 'Courier New, monospace',
            fontSize: '11px',
            border: '2px solid var(--border)',
            padding: '6px 8px',
            outline: 'none',
          }}
        />
        <button
          onClick={handleOnboard}
          disabled={onboarding || !addUrl.trim()}
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            border: '2px solid #111',
            background: onboarding ? 'var(--border)' : '#111',
            color: onboarding ? 'var(--text-secondary)' : '#fff',
            padding: '6px 16px',
            cursor: onboarding ? 'not-allowed' : 'pointer',
          }}
        >
          {onboarding ? 'ONBOARDING...' : 'ONBOARD'}
        </button>
      </div>

      {/* Onboard Result */}
      {onboardResult && (
        <div style={{
          border: `2px solid ${onboardResult.success ? '#2d8a4e' : 'var(--error)'}`,
          padding: '12px',
          marginBottom: '16px',
          fontFamily: 'Courier New, monospace',
          fontSize: '10px',
        }}>
          {onboardResult.success ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                {onboardResult.already_onboarded ? 'ALREADY ONBOARDED' : 'ONBOARDED SUCCESSFULLY'}
              </div>
              {onboardResult.phases?.investigate && (
                <div>Type: {onboardResult.phases.investigate.site_type} / URLs mapped: {onboardResult.phases.investigate.urls_mapped}</div>
              )}
              {onboardResult.phases?.census && (
                <div>Universe: {formatNum(onboardResult.phases.census.universe_total)} total / Turnover: {onboardResult.phases.census.estimated_turnover_per_day}/day</div>
              )}
              {onboardResult.phases?.estimate && (
                <div>Est. extraction: {onboardResult.phases.estimate.estimated_hours}h ({onboardResult.phases.estimate.items_per_hour}/hr)</div>
              )}
              {onboardResult.queued > 0 && <div>Queued: {onboardResult.queued} listings</div>}
            </>
          ) : (
            <div style={{ color: 'var(--error)' }}>Error: {onboardResult.error}</div>
          )}
        </div>
      )}

      {/* Data Flow */}
      <div style={{
        border: '2px solid var(--border)',
        padding: '12px',
        marginBottom: '16px',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '12px',
      }}>
        <div>
          <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '8px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)' }}>QUEUE PENDING</div>
          <div style={{ fontFamily: 'Courier New, monospace', fontSize: '16px', fontWeight: 700 }}>{formatNum(queueStats.pending)}</div>
        </div>
        <div>
          <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '8px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)' }}>PROCESSING</div>
          <div style={{ fontFamily: 'Courier New, monospace', fontSize: '16px', fontWeight: 700, color: 'var(--info)' }}>{formatNum(queueStats.processing)}</div>
        </div>
        <div>
          <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '8px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)' }}>COMPLETE (24H)</div>
          <div style={{ fontFamily: 'Courier New, monospace', fontSize: '16px', fontWeight: 700, color: '#2d8a4e' }}>{formatNum(queueStats.complete)}</div>
        </div>
        <div>
          <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '8px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)' }}>FAILED (24H)</div>
          <div style={{ fontFamily: 'Courier New, monospace', fontSize: '16px', fontWeight: 700, color: 'var(--error)' }}>{formatNum(queueStats.failed)}</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {['all', 'active', 'monitoring', 'investigating', 'pending', 'not_started'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '8px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              border: '2px solid',
              borderColor: filter === f ? '#111' : 'var(--border)',
              background: filter === f ? '#111' : 'transparent',
              color: filter === f ? '#fff' : 'var(--text-secondary)',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            {f === 'all' ? `ALL (${sources.length})` : `${f.replace('_', ' ')} (${statusCounts[f] || 0})`}
          </button>
        ))}
      </div>

      {/* Sources list */}
      {loading ? (
        <div style={{ fontFamily: 'Courier New, monospace', fontSize: '10px', color: 'var(--text-secondary)', padding: '20px' }}>Loading...</div>
      ) : (
        <div style={{ border: '2px solid var(--border)' }}>
          {filtered.map((s, idx) => {
            const pct = completionPct(s);
            return (
              <div
                key={s.slug}
                style={{
                  padding: '10px 12px',
                  borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'grid',
                  gridTemplateColumns: '28px 1fr 80px 80px 100px 80px',
                  gap: '8px',
                  alignItems: 'center',
                }}
              >
                {/* Logo */}
                <div style={{ width: '24px', height: '24px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {s.logo_url ? (
                    <img src={s.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span style={{ fontFamily: 'Arial, sans-serif', fontSize: '10px', fontWeight: 700, color: 'var(--text-disabled)' }}>
                      {(s.display_name || s.slug).charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>

                {/* Name + category */}
                <div>
                  <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px', fontWeight: 700 }}>
                    {s.display_name || s.slug}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                    <span style={{
                      fontFamily: 'Arial, sans-serif',
                      fontSize: '7px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--text-secondary)',
                    }}>
                      {CATEGORY_LABELS[s.obs_category || s.category] || (s.obs_category || s.category || '').toUpperCase()}
                    </span>
                    <span style={{
                      fontFamily: 'Arial, sans-serif',
                      fontSize: '7px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: STATUS_COLORS[s.status] || 'var(--text-secondary)',
                    }}>
                      {s.status.replace('_', ' ')}
                    </span>
                    {s.base_url && (
                      <a href={s.base_url} target="_blank" rel="noopener noreferrer" style={{
                        fontFamily: 'Courier New, monospace',
                        fontSize: '8px',
                        color: 'var(--text-disabled)',
                        textDecoration: 'none',
                      }}>
                        {s.base_url.replace('https://', '').replace('http://', '')}
                      </a>
                    )}
                  </div>
                </div>

                {/* Universe */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'Courier New, monospace', fontSize: '11px', fontWeight: 700 }}>
                    {formatNum(s.universe_total)}
                  </div>
                  <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '7px', textTransform: 'uppercase', color: 'var(--text-disabled)' }}>TOTAL</div>
                </div>

                {/* Extracted */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'Courier New, monospace', fontSize: '11px', fontWeight: 700 }}>
                    {formatNum(s.total_extracted)}
                  </div>
                  <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '7px', textTransform: 'uppercase', color: 'var(--text-disabled)' }}>EXTRACTED</div>
                </div>

                {/* Completion bar */}
                <div>
                  {pct !== null ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ flex: 1, height: '6px', border: '1px solid var(--border)', position: 'relative' }}>
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          height: '100%',
                          width: `${pct}%`,
                          background: pct > 90 ? '#2d8a4e' : pct > 50 ? 'var(--info)' : 'var(--warning)',
                        }} />
                      </div>
                      <span style={{ fontFamily: 'Courier New, monospace', fontSize: '9px', fontWeight: 700, minWidth: '28px' }}>
                        {pct}%
                      </span>
                    </div>
                  ) : (
                    <span style={{ fontFamily: 'Courier New, monospace', fontSize: '9px', color: 'var(--border)' }}>-</span>
                  )}
                </div>

                {/* Last active */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'Courier New, monospace', fontSize: '9px', color: 'var(--text-secondary)' }}>
                    {timeAgo(s.last_successful_at)}
                  </div>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'Courier New, monospace', fontSize: '10px', color: 'var(--text-disabled)' }}>
              No sources match filter
            </div>
          )}
        </div>
      )}
    </div>
  );
}
