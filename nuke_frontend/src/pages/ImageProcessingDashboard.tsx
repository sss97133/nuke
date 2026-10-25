import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { PrefetchLink } from '../components/PrefetchLink';
import { usePageTitle } from '../hooks/usePageTitle';
import '../styles/unified-design-system.css';
import './ImageProcessingDashboard.css';

interface Activity {
  observationId: string;
  imageId: string | null;
  vehicleId: string | null;
  model: string | null;
  confidence: number | null;
  timestamp: string | null;
}

interface Coverage {
  photos: number | null;
  gated: number | null;
  deep: number | null;
  placed: number | null;
  vehicles: number | null;
  pctDeep: number | null;
  pctEngine: number | null;
  pctClip: number | null;
}

const numberOrUnknown = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const countOrUnknown = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const showCount = (value: number | null | undefined) => value == null ? 'Unknown' : value.toLocaleString();
const showPercent = (value: number | null | undefined) => value == null ? 'Unknown' : `${Math.round(value * 100)}%`;
const showTime = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString() : 'Time not reported';
const errorMessage = (reason: unknown) => reason && typeof reason === 'object' && 'message' in reason
  ? String(reason.message) : 'The reader did not respond. Try again.';

export default function ImageProcessingDashboard() {
  usePageTitle('Image processing');
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [feedReadAt, setFeedReadAt] = useState<string | null>(null);
  const [coverageReadAt, setCoverageReadAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [liveState, setLiveState] = useState<'connecting' | 'connected' | 'unavailable'>('connecting');
  const generation = useRef(0);
  const inFlight = useRef(false);
  const lastFeedAttempt = useRef(0);

  const loadStats = useCallback(async (includeCoverage = true) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++generation.current;
    lastFeedAttempt.current = Date.now();
    setLoading(true);
    try {
      // Keep the existing bounded, index-ordered feed. It is a recent observation
      // window, not an image count, worker heartbeat or full-corpus denominator.
      const feedRead = async () => {
        const result = await supabase.from('vehicle_observations')
          .select('id, vehicle_id, observed_at, ingested_at, confidence_score, structured_data')
          .eq('kind', 'condition')
          .contains('structured_data', { analysis_kind: 'image_deep_byok' })
          .order('ingested_at', { ascending: false })
          .limit(20);
        if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw new Error('Recent activity returned no readable result.');
        return result.data.map(a => {
          const sd = (a.structured_data || {}) as { image_id?: string; agent_model?: string };
          const confidence = numberOrUnknown(a.confidence_score);
          return {
            observationId: a.id,
            imageId: typeof sd.image_id === 'string' ? sd.image_id : null,
            vehicleId: a.vehicle_id,
            model: typeof sd.agent_model === 'string' ? sd.agent_model : null,
            confidence: confidence != null && confidence <= 1 ? confidence : null,
            timestamp: a.ingested_at || a.observed_at || null,
          };
        });
      };
      const coverageRead = async () => {
        // This existing RPC includes cascade evidence counts as well as the
        // personal-corpus counter rollup. Do not call it for every feed event.
        const { data, error } = await supabase.rpc('get_image_ecosystem_status');
        if (error) throw error;
        const cov = (data as { coverage?: Record<string, unknown> } | null)?.coverage;
        if (!cov) return null;
        return {
          photos: countOrUnknown(cov.photos), gated: countOrUnknown(cov.gated_t0),
          deep: countOrUnknown(cov.seen_t1), placed: countOrUnknown(cov.placed_t2),
          vehicles: countOrUnknown(cov.vehicles), pctDeep: numberOrUnknown(cov.pct_deep),
          pctEngine: numberOrUnknown(cov.pct_engine), pctClip: numberOrUnknown(cov.pct_clip),
        };
      };
      const [feed, rollup] = await Promise.allSettled([feedRead(), includeCoverage ? coverageRead() : Promise.resolve(null)]);
      if (request !== generation.current) return;
      if (feed.status === 'fulfilled') {
        setActivity(feed.value); setFeedError(null); setFeedReadAt(new Date().toISOString());
      } else setFeedError(errorMessage(feed.reason));
      if (includeCoverage) {
        if (rollup.status === 'fulfilled') {
          setCoverage(rollup.value); setCoverageError(null); setCoverageReadAt(new Date().toISOString());
        } else setCoverageError(errorMessage(rollup.reason));
      }
    } finally {
      if (request === generation.current) { inFlight.current = false; setLoading(false); }
    }
  }, []);

  useEffect(() => {
    void loadStats();
    return () => { generation.current++; inFlight.current = false; };
  }, [loadStats]);

  useEffect(() => {
    if (!autoRefresh) return;
    let active = true;
    let pending: ReturnType<typeof setTimeout> | null = null;
    setLiveState('connecting');
    const channel = supabase.channel('image-processing-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vehicle_observations' }, payload => {
        const row = payload.new as { kind?: string; structured_data?: { analysis_kind?: string } };
        if (row.kind !== 'condition' || row.structured_data?.analysis_kind !== 'image_deep_byok' || document.visibilityState !== 'visible' || pending) return;
        // Coalesce bursts; the recent feed refreshes at most once a minute.
        pending = setTimeout(() => {
          pending = null;
          if (active && document.visibilityState === 'visible') void loadStats(false);
        }, Math.max(0, 60_000 - (Date.now() - lastFeedAttempt.current)));
      }).subscribe(status => {
        if (active) setLiveState(status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'unavailable' : 'connecting');
      });
    return () => { active = false; if (pending) clearTimeout(pending); void supabase.removeChannel(channel); };
  }, [autoRefresh, loadStats]);

  const confident = activity?.filter(a => a.confidence != null && a.confidence >= 0.6).length;
  const knownConfidence = activity?.filter(a => a.confidence != null).length;
  return (
    <div className="image-processing-page">
      <header className="image-processing-header">
        <div>
          <PrefetchLink to="/admin">← Mission Control</PrefetchLink>
          <h1>Image processing</h1>
          <p>Recent retained analysis and personal-corpus coverage.</p>
        </div>
        <div className="image-processing-actions">
          <button className="button button-primary" disabled={loading} onClick={() => void loadStats()}>{loading ? 'Refreshing…' : 'Refresh data'}</button>
          <button className="button" aria-pressed={autoRefresh} onClick={() => setAutoRefresh(value => !value)}>{autoRefresh ? 'Feed updates on' : 'Feed updates off'}</button>
        </div>
      </header>
      {loading && <p role="status">Reading processing data…</p>}
      {autoRefresh && <p role="status" className={liveState === 'unavailable' ? 'image-processing-error' : 'image-processing-note'}>
        {liveState === 'connected' ? 'Listening for analysis events. The recent feed updates at most once a minute while this page is visible; coverage updates with Refresh data.' : liveState === 'unavailable' ? 'Live updates are unavailable. Use Refresh data to read the latest results.' : 'Connecting to feed updates…'}
      </p>}
      {feedError && <p role="alert" className="image-processing-error">Recent activity could not be refreshed: {feedError} {activity !== null ? 'Showing the last successful feed.' : 'Activity counts are unknown.'}</p>}
      {coverageError && <p role="alert" className="image-processing-error">Coverage could not be refreshed: {coverageError} {coverage !== null ? 'Showing the last successful coverage.' : 'Coverage is unknown.'}</p>}

      <div className="image-processing-stats">
        <section className="card image-processing-stat" aria-labelledby="image-processing-recent-title">
          <h2 id="image-processing-recent-title">Recent analysis observations</h2>
          <div className="image-processing-number">{showCount(activity?.length)}</div>
          <p>Up to 20 latest matching observations, ordered by time received. These are not unique-image or fleet totals.</p>
        </section>
        <section className="card image-processing-stat" aria-labelledby="image-processing-confidence-title">
          <h2 id="image-processing-confidence-title">Reported confidence ≥ 60%</h2>
          <div className="image-processing-number">{showCount(confident)}</div>
          <p>{activity !== null ? `${showCount(knownConfidence)} of ${activity.length} observations report confidence; ${activity.length - (knownConfidence ?? 0)} unknown.` : 'Confidence counts are unknown until the feed loads.'} Model confidence is not independent validation.</p>
        </section>
        <section className="card image-processing-stat" aria-labelledby="image-processing-coverage-title">
          <h2 id="image-processing-coverage-title">Personal-corpus coverage</h2>
          <div className="image-processing-number">{showPercent(coverage?.pctDeep)}</div>
          <p>Deep-analysis markers among gated photos.</p>
          <dl className="image-processing-coverage">
            <dt>Deep / gated photos</dt><dd>{showCount(coverage?.deep)} / {showCount(coverage?.gated)}</dd>
            <dt>Cached photos / vehicles</dt><dd>{showCount(coverage?.photos)} / {showCount(coverage?.vehicles)}</dd>
            <dt>Engine placement / gated</dt><dd>{showPercent(coverage?.pctEngine)}</dd>
            <dt>CLIP / placed photos</dt><dd>{showPercent(coverage?.pctClip)}</dd>
          </dl>
          <p>{coverageReadAt ? `Read ${showTime(coverageReadAt)}. Counter refresh time is not supplied by this reader.` : 'Coverage has not loaded.'}</p>
          {!loading && !coverageError && coverage === null && <p>The reader has not reported a coverage rollup.</p>}
        </section>
      </div>

      <section className="card image-processing-feed" aria-labelledby="image-processing-feed-title">
        <div className="image-processing-section-heading">
          <h2 id="image-processing-feed-title">Recent activity</h2>
          {feedReadAt && <p>Read {showTime(feedReadAt)}</p>}
        </div>
        {activity === null ? <p className="image-processing-empty">{loading ? 'Loading the recent feed…' : 'Recent activity is unavailable. Use Refresh data to retry.'}</p> : activity.length === 0 ? <p className="image-processing-empty">No matching recent analysis observations were returned. This does not establish that processing is stopped.</p> : (
          <ul className="image-processing-list">
            {activity.map(item => <li key={item.observationId}>
              <div className="image-processing-activity">
                <span className="image-processing-identity">{item.imageId ? `Image ${item.imageId.slice(0, 8)}` : `Observation ${item.observationId.slice(0, 8)}`}</span>
                <span>{item.model || 'Model not reported'}</span>
                <span>{item.confidence == null ? 'Confidence unknown' : `${Math.round(item.confidence * 100)}% reported confidence`}</span>
              </div>
              <div className="image-processing-activity-context">
                <span>Received: {showTime(item.timestamp)}</span>
                {item.vehicleId && <PrefetchLink to={`/vehicle/${item.vehicleId}`}>Open vehicle</PrefetchLink>}
              </div>
            </li>)}
          </ul>
        )}
      </section>

      <details className="card image-processing-reference">
        <summary>How this is measured</summary>
        <p>The feed reads condition observations marked <code>image_deep_byok</code>. A received observation is evidence of retained analysis, not a worker-health guarantee.</p>
        <p>The existing <code>get_image_ecosystem_status()</code> reader reports the cached personal corpus (<code>is_external=false</code>). It does not establish coverage of all fleet images.</p>
        <p>Deep and engine percentages use gated photos as their denominator. CLIP uses placed photos. Missing counters or zero-denominator ratios remain unknown.</p>
        <p>Image depth uses <code>ai_scan_metadata.byok_deep_analysis</code>; coverage is maintained by the existing <code>image_coverage_by_vehicle</code> owner. Reading this page does not refresh that cache.</p>
      </details>
      <nav className="image-processing-actions" aria-label="Related operations">
        <PrefetchLink to="/admin/scripts">Script coverage →</PrefetchLink>
        <PrefetchLink to="/admin/status">System status →</PrefetchLink>
      </nav>
    </div>
  );
}
