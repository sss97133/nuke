/**
 * LiveIntakeScreen — /intake/live
 *
 * The owner watches the BYOK fleet burn (scripts/daily-receipt/byok-burn-all.sh)
 * fill out the timeline in real time:
 *   TOP    — fleet burn ticker: per-vehicle approved-analyzed / approved-total
 *            progress bars, the vehicle currently burning highlighted, fleet
 *            totals + ETA at the observed 30-min rate.
 *   CENTER — the filling timeline: most recently analyzed frames stream in as
 *            cards (thumbnail, day, vehicle, one-line verdict), newest first.
 *   SIDE   — day-rollup feed: work_sessions created today.
 *
 * One round trip per poll: public.intake_live_state() RPC (see migration
 * 20260611210500_intake_live_state_rpc.sql). Polls every 15s — no websockets.
 * Design: PAPER-adjacent light theme per unified design system — Arial,
 * 2px solid borders, zero radius/shadows/gradients, 14px content floor,
 * 9px caps chrome labels. Reads like a lab instrument.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

const POLL_MS = 15_000;
const FEED_LIMIT = 30;
const BURNING_WINDOW_MS = 15 * 60_000; // last verdict within 15 min = burning

interface FleetRow {
  vehicle_id: string;
  vehicle_name: string | null;
  total: number;
  analyzed: number;
  last_analyzed_at: string | null;
}

interface FeedFrame {
  id: string;
  vehicle_id: string;
  vehicle_name: string | null;
  image_url: string;
  taken_at: string | null;
  analyzed_at: string;
  line: string | null;
  scene_type: string | null;
  build_phase: string | null;
  intent: string | null;
  confidence: string | null;
}

interface SessionRow {
  id: string;
  vehicle_id: string;
  vehicle_name: string | null;
  session_date: string;
  title: string | null;
  image_count: number | null;
  summary: string | null;
  created_at: string;
}

interface IntakeState {
  server_time: string;
  fleet: FleetRow[];
  analyzed_last_30m: number;
  feed: FeedFrame[];
  sessions_today: SessionRow[];
}

function dayOf(ts: string | null): string {
  if (!ts) return 'UNDATED';
  return ts.slice(0, 10);
}

function clockOf(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function fmtEta(remaining: number, perMin: number): string {
  if (remaining <= 0) return 'DRAINED';
  if (perMin <= 0) return 'NO RATE OBSERVED';
  const mins = Math.round(remaining / perMin);
  if (mins < 60) return `~${mins}M`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `~${h}H ${mins % 60}M`;
  return `~${Math.floor(h / 24)}D ${h % 24}H`;
}

const S: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: 'Arial, sans-serif',
    color: '#000',
    background: '#fff',
    minHeight: '100vh',
    padding: '12px',
  },
  chrome: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#666',
    borderBottom: '2px solid #000',
    paddingBottom: 8,
    marginBottom: 12,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  sectionLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#666',
    marginBottom: 6,
  },
  totalsRow: {
    border: '2px solid #000',
    padding: '8px 10px',
    fontSize: 14,
    display: 'flex',
    gap: 24,
    flexWrap: 'wrap',
    marginBottom: 8,
    fontFamily: '"Courier New", monospace',
  },
  fleetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '2px 12px',
    border: '2px solid #000',
    padding: 8,
  },
  fleetRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 90px 78px',
    alignItems: 'center',
    gap: 8,
    padding: '1px 2px',
    fontSize: 14,
    lineHeight: '18px',
  },
  fleetName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  bar: {
    height: 10,
    border: '1px solid #000',
    background: '#fff',
    position: 'relative',
  },
  barFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    background: '#000',
  },
  count: {
    fontFamily: '"Courier New", monospace',
    fontSize: 12,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  main: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)',
    gap: 12,
    marginTop: 16,
    alignItems: 'start',
  },
  card: {
    border: '2px solid #000',
    background: '#fff',
    display: 'grid',
    gridTemplateColumns: '128px minmax(0, 1fr)',
    gap: 0,
    marginBottom: 8,
  },
  thumbBox: {
    width: 128,
    height: 96,
    background: '#fafafa',
    borderRight: '2px solid #000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardBody: { padding: '6px 10px', minWidth: 0 },
  cardMeta: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#666',
    marginBottom: 4,
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardLine: { fontSize: 14, lineHeight: '19px' },
  cardTags: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#666',
    marginTop: 4,
    fontFamily: '"Courier New", monospace',
  },
  sessionRow: {
    border: '2px solid #000',
    padding: '6px 10px',
    marginBottom: 8,
  },
  link: { color: '#000', textDecoration: 'underline' },
  empty: {
    border: '2px solid #000',
    background: '#fafafa',
    padding: 16,
    fontSize: 14,
  },
};

const LiveIntakeScreen: React.FC = () => {
  const [state, setState] = useState<IntakeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPollAt, setLastPollAt] = useState<string | null>(null);
  const initialLoadDoneRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const { data, error: rpcError } = await supabase.rpc('intake_live_state', {
        p_feed_limit: FEED_LIMIT,
        p_sessions_limit: 30,
      });
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const next = data as unknown as IntakeState;
      if (!initialLoadDoneRef.current) {
        // first paint: everything is "already there" — no entry animation
        for (const f of next.feed ?? []) seenIdsRef.current.add(f.id);
        initialLoadDoneRef.current = true;
      }
      setError(null);
      setState(next);
      setLastPollAt(new Date().toISOString());
    };

    poll();
    const t = window.setInterval(() => {
      if (!document.hidden) poll();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const fleet = state?.fleet ?? [];
  const feed = state?.feed ?? [];
  const sessions = state?.sessions_today ?? [];

  const totals = fleet.reduce(
    (acc, f) => {
      acc.total += f.total;
      acc.analyzed += f.analyzed;
      return acc;
    },
    { total: 0, analyzed: 0 },
  );
  const remaining = totals.total - totals.analyzed;
  const ratePerMin = (state?.analyzed_last_30m ?? 0) / 30;
  const serverNow = state ? new Date(state.server_time).getTime() : Date.now();
  const burningId = fleet
    .filter(
      (f) =>
        f.last_analyzed_at &&
        serverNow - new Date(f.last_analyzed_at).getTime() < BURNING_WINDOW_MS,
    )
    .sort(
      (a, b) =>
        new Date(b.last_analyzed_at as string).getTime() -
        new Date(a.last_analyzed_at as string).getTime(),
    )[0]?.vehicle_id;

  return (
    <div style={S.page}>
      <style>{`
        @keyframes intake-card-enter {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .intake-card-enter { animation: intake-card-enter 180ms cubic-bezier(0.16, 1, 0.3, 1); }
        @media (max-width: 760px) { .intake-main { grid-template-columns: 1fr !important; } }
      `}</style>

      <div style={S.chrome}>
        <span>NUKE · LIVE INTAKE · FLEET BURN</span>
        <span>
          {error
            ? `ERROR · ${error}`
            : state
              ? `LIVE · POLL ${POLL_MS / 1000}S · LAST ${clockOf(lastPollAt)}`
              : 'CONNECTING…'}
        </span>
      </div>

      {/* ── TOP: fleet burn ticker ──────────────────────────────────── */}
      <div style={S.sectionLabel}>FLEET BURN · {fleet.length} VEHICLES</div>
      <div style={S.totalsRow}>
        <span>
          ANALYZED {totals.analyzed}/{totals.total}
          {totals.total > 0 && ` (${((100 * totals.analyzed) / totals.total).toFixed(1)}%)`}
        </span>
        <span>REMAINING {remaining}</span>
        <span>RATE {state?.analyzed_last_30m ?? 0}/30MIN</span>
        <span>ETA {fmtEta(remaining, ratePerMin)}</span>
      </div>
      {fleet.length > 0 ? (
        <div style={S.fleetGrid}>
          {fleet.map((f) => {
            const pct = f.total > 0 ? (100 * f.analyzed) / f.total : 0;
            const burning = f.vehicle_id === burningId;
            return (
              <div
                key={f.vehicle_id}
                style={{
                  ...S.fleetRow,
                  ...(burning ? { background: '#000', color: '#fff' } : null),
                }}
              >
                <span style={{ ...S.fleetName, display: 'flex', gap: 6, alignItems: 'center' }}>
                  {burning && <span style={{ flex: 'none' }}>●</span>}
                  <Link
                    to={`/vehicle/${f.vehicle_id}`}
                    style={{
                      ...S.link,
                      ...S.fleetName,
                      ...(burning ? { color: '#fff' } : null),
                    }}
                  >
                    {f.vehicle_name ?? f.vehicle_id.slice(0, 8)}
                  </Link>
                  {burning && (
                    <span style={{ flex: 'none', fontSize: 9, letterSpacing: '0.08em' }}>
                      BURNING
                    </span>
                  )}
                </span>
                <span
                  style={{
                    ...S.bar,
                    ...(burning ? { borderColor: '#fff', background: '#000' } : null),
                  }}
                >
                  <span
                    style={{
                      ...S.barFill,
                      width: `${pct}%`,
                      ...(burning ? { background: '#fff' } : null),
                    }}
                  />
                </span>
                <span style={S.count}>
                  {f.analyzed}/{f.total}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        state && <div style={S.empty}>NO APPROVED USER-UPLOAD FRAMES IN THE BURN QUEUE.</div>
      )}

      <div className="intake-main" style={S.main}>
        {/* ── CENTER: the filling timeline ──────────────────────────── */}
        <div>
          <div style={S.sectionLabel}>
            FRESH FRAMES · NEWEST FIRST · LAST {FEED_LIMIT}
          </div>
          {feed.length === 0 && state && (
            <div style={S.empty}>NO ANALYZED FRAMES YET — THE BURN IS WARMING UP.</div>
          )}
          {feed.map((fr) => {
            const isNew = !seenIdsRef.current.has(fr.id);
            if (isNew) seenIdsRef.current.add(fr.id);
            const thumb = optimizeImageUrl(fr.image_url, 'small');
            return (
              <div key={fr.id} className={isNew ? 'intake-card-enter' : undefined} style={S.card}>
                <div style={S.thumbBox}>
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={fr.line ?? 'analyzed frame'}
                      width={128}
                      height={96}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <span style={{ fontSize: 9, color: '#999' }}>NO IMAGE</span>
                  )}
                </div>
                <div style={S.cardBody}>
                  <div style={S.cardMeta}>
                    <Link to={`/vehicle/${fr.vehicle_id}/day/${dayOf(fr.taken_at)}`} style={S.link}>
                      DAY {dayOf(fr.taken_at)}
                    </Link>
                    <Link to={`/vehicle/${fr.vehicle_id}`} style={S.link}>
                      {fr.vehicle_name ?? fr.vehicle_id.slice(0, 8)}
                    </Link>
                    <span>ANALYZED {clockOf(fr.analyzed_at)}</span>
                  </div>
                  <div style={S.cardLine}>{fr.line ?? '(no verdict line)'}</div>
                  <div style={S.cardTags}>
                    {[
                      fr.scene_type,
                      fr.build_phase,
                      fr.intent,
                      fr.confidence != null ? `CONF ${fr.confidence}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── SIDE: day-rollup feed ─────────────────────────────────── */}
        <div>
          <div style={S.sectionLabel}>
            TIMELINE FILLING OUT · WORK SESSIONS CREATED TODAY · {sessions.length}
          </div>
          {sessions.length === 0 && state && (
            <div style={S.empty}>NO DAY ROLLUPS CREATED TODAY YET.</div>
          )}
          {sessions.map((s) => (
            <div key={s.id} style={S.sessionRow}>
              <div style={S.cardMeta}>
                <Link to={`/vehicle/${s.vehicle_id}/day/${s.session_date}`} style={S.link}>
                  {s.session_date}
                </Link>
                <Link to={`/vehicle/${s.vehicle_id}`} style={S.link}>
                  {s.vehicle_name ?? s.vehicle_id.slice(0, 8)}
                </Link>
                <span>{s.image_count ?? 0} FRAMES</span>
                <span>ROLLED UP {clockOf(s.created_at)}</span>
              </div>
              <div style={{ ...S.cardLine, fontSize: 14 }}>
                {s.title && s.title !== 'Shop work' ? `${s.title} — ` : ''}
                {s.summary || '(no summary yet)'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LiveIntakeScreen;
