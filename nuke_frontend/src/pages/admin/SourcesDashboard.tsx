import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import './SourcesDashboard.css';

interface SourceRow {
  slug: string;
  display_name: string;
  category: string;
  status: string;
  extractor_function: string | null;
  total_extracted: number | null;
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

interface OnboardResult {
  success: boolean;
  error?: string;
  already_onboarded?: boolean;
  queued?: number;
  phases?: {
    investigate?: { site_type?: string; urls_mapped?: number };
    census?: { universe_total?: number; estimated_turnover_per_day?: number };
    estimate?: { estimated_hours?: number; items_per_hour?: number };
  };
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message :
    error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The request could not be completed.';

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--success)',
  monitoring: 'var(--info)',
  investigating: 'var(--warning)',
  degraded: 'var(--error)',
  blocked: 'var(--error)',
  pending: 'var(--text-secondary)',
  not_started: 'var(--text-secondary)',
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
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [onboardResult, setOnboardResult] = useState<OnboardResult | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const readPending = useRef(false);
  const onboardPending = useRef(false);
  const mounted = useRef(true);

  const fetchData = useCallback(async () => {
    if (readPending.current) return;
    readPending.current = true;
    setRefreshing(true);
    // These independent readers may fail separately. A failed read is not an
    // empty registry or a zero queue, and polling never overlaps a pending read.
    await Promise.all([
      (async () => {
        try {
          const { data, error } = await supabase.from('source_dashboard_view').select('*');
          if (error) throw error;
          if (!Array.isArray(data)) throw new Error('The source reader returned an invalid response.');
          if (mounted.current) { setSources(data as SourceRow[]); setSourceError(null); }
        } catch (error) {
          if (mounted.current) setSourceError(errorMessage(error));
        } finally {
          if (mounted.current) setLoading(false);
        }
      })(),
      (async () => {
        try {
          const { data, error } = await supabase.rpc('get_queue_stats_24h');
          if (error) throw error;
          if (!data || !['pending', 'processing', 'complete', 'failed'].every(key =>
            typeof data[key] === 'number' && Number.isSafeInteger(data[key]) && data[key] >= 0)) {
            throw new Error('The queue reader returned an invalid response.');
          }
          if (mounted.current) { setQueueStats(data as QueueStats); setQueueError(null); }
        } catch (error) {
          if (mounted.current) { setQueueStats(null); setQueueError(errorMessage(error)); }
        }
      })(),
    ]);
    readPending.current = false;
    if (mounted.current) setRefreshing(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void fetchData();
    return () => { mounted.current = false; };
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const schedule = () => {
      if (interval) clearInterval(interval);
      interval = null;
      if (document.visibilityState === 'visible') {
        interval = setInterval(() => void fetchData(), 60_000);
      }
    };
    const onVisibilityChange = () => {
      schedule();
      if (document.visibilityState === 'visible') void fetchData();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [autoRefresh, fetchData]);

  const handleOnboard = async () => {
    if (onboardPending.current || !addUrl.trim()) return;
    onboardPending.current = true;
    setOnboarding(true);
    setOnboardResult(null);
    const url = addUrl.trim();
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Enter an http or https source URL.');
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error('Sign in again before onboarding a source.');
      // The existing client supplies the configured project URL and API key.
      // Submission remains explicit; loading or editing never starts onboarding.
      const { data, error } = await supabase.functions.invoke('onboard-source', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { url, phase: 'all' },
      });
      if (error) throw error;
      if (!data || typeof data.success !== 'boolean') throw new Error('The source service returned an invalid response.');
      const result = data as OnboardResult;
      if (mounted.current) {
        setOnboardResult(result);
        if (result.success) { setAddUrl(''); void fetchData(); }
      }
    } catch (error) {
      if (mounted.current) setOnboardResult({ success: false, error: errorMessage(error) });
    } finally {
      onboardPending.current = false;
      if (mounted.current) setOnboarding(false);
    }
  };

  // Status counts
  const statusCounts: Record<string, number> = {};
  for (const s of sources ?? []) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  }

  // Filter
  const filtered = (sources ?? []).filter(s => filter === 'all' || s.status === filter);
  const queueHasVisibleRows = queueStats !== null && Object.values(queueStats).some(count => count > 0);

  const completionPct = (s: SourceRow) => {
    if (!s.universe_total || s.universe_total < 0 || s.total_extracted == null || s.total_extracted < 0 || s.total_extracted > s.universe_total) return null;
    return Math.min(100, Math.round((s.total_extracted / s.universe_total) * 100));
  };

  const formatNum = (n: number | null | undefined) => {
    if (n === null || n === undefined) return '-';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  };

  const timeAgo = (ts: string | null) => {
    if (!ts) return 'Not recorded';
    const diff = Date.now() - new Date(ts).getTime();
    if (!Number.isFinite(diff)) return 'Unknown';
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="sources-dashboard">
      <header className="sources-dashboard__header">
        <div>
          <h1>Sources</h1>
          <p className="k-body">
            {sources === null ? (loading ? 'Loading source registry…' : 'Source registry unavailable') :
              `${sources.length} registered · ${statusCounts.active || 0} active · ${statusCounts.monitoring || 0} monitoring`}
          </p>
        </div>
        <div className="sources-dashboard__refresh-controls">
          <label className="sources-dashboard__auto-refresh">
            <input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />
            Auto-refresh every minute while visible
          </label>
          <button type="button" className="btn-base btn-secondary" disabled={refreshing} onClick={() => void fetchData()}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <form className="sources-dashboard__onboard" aria-busy={onboarding} onSubmit={event => { event.preventDefault(); void handleOnboard(); }}>
        <div className="sources-dashboard__url">
          <label htmlFor="source-url">Source URL</label>
          <input id="source-url" type="url" required placeholder="https://example.com" value={addUrl}
            disabled={onboarding} onChange={event => setAddUrl(event.target.value)} aria-describedby="source-onboard-help" />
          <p id="source-onboard-help" className="k-caption">Investigates the site, registers the source, and may queue listings for ingestion.</p>
        </div>
        <button type="submit" className="btn-base btn-primary" disabled={onboarding || !addUrl.trim()}>
          {onboarding ? 'Onboarding…' : 'Onboard source'}
        </button>
      </form>

      {/* Onboard Result */}
      {onboardResult && (
        <div role={onboardResult.success ? 'status' : 'alert'} className="sources-dashboard__result k-body" style={{
          border: `1px solid ${onboardResult.success ? 'var(--success)' : 'var(--error)'}`,
          padding: '12px',
          marginBottom: '16px',
        }}>
          {onboardResult.success ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                {onboardResult.already_onboarded ? 'Source already registered' : 'Source onboarded'}
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
              {onboardResult.queued != null && onboardResult.queued > 0 && <div>Queued: {onboardResult.queued} listings</div>}
            </>
          ) : (
            <div>{onboardResult.error || 'The source could not be onboarded.'}</div>
          )}
        </div>
      )}

      <section className="sources-dashboard__queue" aria-labelledby="source-queue-heading">
        <h2 id="source-queue-heading">Recent queue entries</h2>
        <p className="k-caption">Current status of rows added in the last 24 hours and visible to your account. Older backlog and completion-time throughput are not included.</p>
        {queueError ? <p role="alert" className="k-body">Queue summary unavailable: {queueError}</p> :
          queueStats === null ? <p role="status" className="k-body">Loading queue summary…</p> :
            !queueHasVisibleRows ? <p role="status" className="k-body">No queue rows are visible to this account in this period. This does not establish that the queue is empty.</p> :
              <dl className="sources-dashboard__queue-grid">
                {(['pending', 'processing', 'complete', 'failed'] as const).map(status => (
                  <div key={status}><dt>{status === 'complete' ? 'Complete now' : status}</dt><dd>{formatNum(queueStats[status])}</dd></div>
                ))}
              </dl>}
      </section>

      {sourceError && <p role="alert" className="sources-dashboard__notice">Source registry unavailable: {sourceError}{sources !== null ? ' Showing the last successful read.' : ''}</p>}
      {sources !== null && <div className="sources-dashboard__filters" role="group" aria-label="Filter sources by status">
        {['all', 'active', 'monitoring', 'investigating', 'pending', 'not_started', 'degraded', 'blocked', 'archived'].map(f => (
          <button type="button" key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`btn-base ${filter === f ? 'btn-primary' : 'btn-secondary'}`}>
            {f === 'all' ? `All (${sources.length})` : `${f.replaceAll('_', ' ')} (${statusCounts[f] || 0})`}
          </button>
        ))}
      </div>}

      {/* Sources list */}
      {loading ? (
        <p role="status" className="k-body">Loading sources…</p>
      ) : sources !== null ? (
        <div className="sources-dashboard__list">
          {filtered.map((s) => {
            const pct = completionPct(s);
            return (
              <div
                key={s.slug}
                className="sources-dashboard__row"
              >
                {/* Logo */}
                <div style={{ width: '24px', height: '24px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {s.logo_url ? (
                    <img src={s.logo_url} width={24} height={24} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span className="k-label">
                      {(s.display_name || s.slug).charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>

                {/* Name + category */}
                <div className="sources-dashboard__identity">
                  <div className="k-body">
                    {s.display_name || s.slug}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                    <span className="k-label">
                      {CATEGORY_LABELS[s.obs_category || s.category] || (s.obs_category || s.category || '').toUpperCase()}
                    </span>
                    <span className="k-label sources-dashboard__status">
                      <span aria-hidden="true" className="sources-dashboard__status-dot" style={{ background: STATUS_COLORS[s.status] || 'var(--text-secondary)' }} />
                      {(s.status || 'unknown').replaceAll('_', ' ')}
                    </span>
                    {s.base_url && (
                      <a className="sources-dashboard__link" href={s.base_url} target="_blank" rel="noopener noreferrer" style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        textDecoration: 'underline',
                      }}>
                        {s.base_url.replace('https://', '').replace('http://', '')}
                      </a>
                    )}
                  </div>
                </div>

                {/* Universe */}
                <div className="sources-dashboard__metric">
                  <div className="k-measure k-measure--dense">
                    {formatNum(s.universe_total)}
                  </div>
                  <div className="k-caption">Census total</div>
                  {s.census_at && <div className="k-caption" title={s.census_at}>{timeAgo(s.census_at)}</div>}
                </div>

                {/* Extracted */}
                <div className="sources-dashboard__metric">
                  <div className="k-measure k-measure--dense">
                    {formatNum(s.total_extracted)}
                  </div>
                  <div className="k-caption">Extracted</div>
                </div>

                {/* Completion bar */}
                <div className="sources-dashboard__metric">
                  <div className="k-caption">Extracted / census</div>
                  {pct !== null ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ flex: 1, height: '6px', border: '1px solid var(--border)', position: 'relative' }}>
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          height: '100%',
                          width: `${pct}%`,
                          background: pct > 90 ? 'var(--success)' : pct > 50 ? 'var(--info)' : 'var(--warning)',
                        }} />
                      </div>
                      <span className="k-measure k-measure--dense">
                        {pct}%
                      </span>
                    </div>
                  ) : (
                    <span className="k-caption">{s.universe_total != null && s.total_extracted != null && s.total_extracted > s.universe_total ? 'Not comparable' : 'Unknown'}</span>
                  )}
                </div>

                {/* Last active */}
                <div className="sources-dashboard__metric">
                  <div className="k-caption">
                    {timeAgo(s.last_successful_at)}
                  </div>
                  <div className="k-caption">Last successful extraction</div>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {sources.length === 0 ? 'No registered sources were returned.' : 'No sources match this status.'}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
