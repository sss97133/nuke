/**
 * DayPage.tsx
 *
 * Full-page route view of one build-log day.
 * Mounted at /vehicle/:vehicleId/day/:date — pairs with the popup view
 * that's already embedded in BarcodeTimeline. The popup stays as the
 * hover/preview surface; this route is the deep-dive where every atom
 * (photo, receipt, component event, line item) should be navigable.
 *
 * Layer 4-5 of the click-through chain (per 09-click-through-chains.md):
 * timeline cell → day route → individual event → ground-truth artifact.
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { DailyReceipt, DaySessionInfo } from './hooks/useBuildLog';
import DayCard from './DayCard';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { publicObservationData, publicObservationArtifact, OBSERVATION_PRIVACY_NOTICE } from './observationPrivacy';

interface DayPageVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

interface DayObservation {
  id: string;
  vehicle_id: string;
  kind: string;
  observed_at: string | null;
  ingested_at: string;
  source_url: string | null;
  confidence: string | null;
  confidence_score: number | null;
  content_text: string | null;
  structured_data: Record<string, unknown> | null;
  source_slug: string | null;
  source_name: string | null;
}

const formatDateLong = (iso: string): string => {
  try {
    const d = new Date(iso + 'T12:00:00Z');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
};

const DayPage: React.FC = () => {
  const { vehicleId, date } = useParams<{ vehicleId: string; date: string }>();
  const [vehicle, setVehicle] = useState<DayPageVehicle | null>(null);
  const [detailRow, setDetail] = useState<DailyReceipt | null>(null);
  const [observationRows, setObservations] = useState<DayObservation[]>([]);
  const [loadedSubject, setLoadedSubject] = useState<string | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [observationsError, setObservationsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readError, setError] = useState<string | null>(null);
  const subject = `${vehicleId}:${date}`;
  const current = loadedSubject === subject;
  const detail = current ? detailRow : null;
  const observations = current ? observationRows : [];
  const error = current ? readError : null;

  useEffect(() => {
    if (!vehicleId || !date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLoadedSubject(null);
    setVehicle(null);
    setDetail(null);
    setObservations([]);
    setDetailError(false);
    setObservationsError(false);

    // A half-open UTC interval includes Postgres sub-millisecond timestamps.
    const dayStart = `${date}T00:00:00Z`;
    const start = Date.parse(dayStart);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== date) {
      setError('Invalid calendar date.');
      setLoadedSubject(subject);
      setLoading(false);
      return;
    }
    const dayEnd = new Date(start + 86_400_000).toISOString();
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 10_000);

    (async () => {
      try {
        const vehRes = await supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .abortSignal(controller.signal)
          .maybeSingle();
        if (cancelled) return;
        if (vehRes.error) throw new Error('Unable to load this vehicle. Try again.');
        if (!vehRes.data || vehRes.data.id !== vehicleId) throw new Error('Vehicle unavailable.');
        setVehicle(vehRes.data as DayPageVehicle);

        // This ordering is a consumer boundary, not authorization for the RPC.
        const [dayRes, obsRes] = await Promise.allSettled([
          supabase.rpc('get_daily_work_receipt', {
            p_vehicle_id: vehicleId,
            p_date: date,
          }).abortSignal(controller.signal),
          supabase
            .from('vehicle_observations')
            .select(`
              id, vehicle_id, kind, observed_at, ingested_at,
              confidence, confidence_score, structured_data,
              observation_sources!left(display_name, slug)
            `)
            .eq('vehicle_id', vehicleId)
            .eq('is_superseded', false)
            .gte('observed_at', dayStart)
            .lt('observed_at', dayEnd)
            .order('observed_at', { ascending: true })
            .limit(500)
            .abortSignal(controller.signal),
        ]);
        if (cancelled) return;
        if (dayRes.status === 'rejected' || dayRes.value.error || dayRes.value.data?.error) {
          setDetailError(true);
        } else if (dayRes.value.data) {
          const row = dayRes.value.data as DailyReceipt;
          if (row.vehicle?.id === vehicleId && row.receipt_date === date) setDetail(row);
          else setDetailError(true);
        }

        if (obsRes.status === 'rejected' || obsRes.value.error || !Array.isArray(obsRes.value.data)) {
          setObservationsError(true);
        } else {
          const rows = obsRes.value.data as (DayObservation & { observation_sources?: { slug?: string; display_name?: string } })[];
          if (rows.some(row => {
            const observed = row.observed_at ? Date.parse(row.observed_at) : NaN;
            return row.vehicle_id !== vehicleId || !Number.isFinite(observed) || observed < start || observed >= start + 86_400_000;
          })) {
            setObservationsError(true);
          } else setObservations(rows.map(row => ({ ...row,
            source_slug: row.observation_sources?.slug ?? null,
            source_name: row.observation_sources?.display_name ?? null,
          })));
        }
      } catch (failure) {
        if (!cancelled) {
          const message = failure instanceof Error ? failure.message : '';
          setError(message === 'Vehicle unavailable.' ? message : 'Unable to load this vehicle. Try again.');
        }
      } finally {
        window.clearTimeout(deadline);
        if (!cancelled) {
          setLoadedSubject(subject);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(deadline);
    };
  }, [vehicleId, date]);

  if (!vehicleId || !date) {
    return <div style={{ padding: 24, fontFamily: 'Arial', fontSize: 10 }}>Missing vehicleId or date.</div>;
  }

  // Derive a minimal WorkSession shape for DayCard. If the day has a real
  // session, prefer it; otherwise synthesize a placeholder so DayCard can
  // still render photos / receipts / component_events from the RPC payload.
  const sessionInfo: DaySessionInfo | null = detail?.work_session ?? null;
  const session = {
    date,
    title: sessionInfo?.title || (detail?.summary?.has_session ? 'Work day' : 'Build log day'),
    work_type: sessionInfo?.work_type || 'work',
    image_count: sessionInfo?.image_count || detail?.photo_count || 0,
    duration_minutes: sessionInfo?.duration_minutes || 0,
    total_parts_cost: sessionInfo?.total_parts_cost || detail?.parts_total || 0,
    has_receipts: (detail?.parts_count || 0) > 0,
    work_description: sessionInfo?.work_description || '',
    status: sessionInfo?.status || 'complete',
  };

  const vehLabel = vehicle?.id === vehicleId
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '16px 12px 48px',
        fontFamily: 'Arial, sans-serif',
        color: 'var(--text, #1a1a1a)',
      }}
    >
      {/* Breadcrumb */}
      <nav
        aria-label="breadcrumb"
        style={{
          fontSize: 8,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary, #666)',
          marginBottom: 12,
          fontWeight: 700,
        }}
      >
        <Link to={`/vehicle/${vehicleId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {vehLabel || 'Vehicle'}
        </Link>
        <span style={{ margin: '0 6px' }}>/</span>
        <span>Day</span>
        <span style={{ margin: '0 6px' }}>/</span>
        <span style={{ color: 'var(--text, #1a1a1a)' }}>{date}</span>
      </nav>

      <h1
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          margin: '0 0 4px',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        {formatDateLong(date)}
      </h1>
      <div
        style={{
          fontSize: 9,
          color: 'var(--text-secondary, #666)',
          marginBottom: 16,
          fontFamily: 'Courier New, monospace',
        }}
      >
        UTC observation day · {date}
        {detail && <> · {detail.photo_count} PHOTOS · {detail.parts_count} PART ITEMS · {detail.component_events?.length ?? 0} EVENTS · {detail.line_items?.length ?? 0} LINE ITEMS</>}
        {current && !error && !observationsError && <> · {observations.length} OBSERVATIONS RETURNED{observations.length === 500 ? ' · READ LIMIT 500; MORE MAY EXIST' : ''}</>}
      </div>

      {(loading || !current) && (
        <div role="status" style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading day…</div>
      )}

      {error && (
        <div role="alert" style={{ fontSize: 10, color: 'var(--error, #c00)', padding: 12, border: '2px solid var(--error, #c00)' }}>
          {error}
        </div>
      )}

      {current && !error && detailError && <p role="alert" style={{ fontSize: 10 }}>Build-log details unavailable. Try again.</p>}
      {current && !error && observationsError && <p role="alert" style={{ fontSize: 10 }}>Observations unavailable. Try again.</p>}

      {!loading && current && !error && !detailError && !detail && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12, border: '2px solid var(--text-disabled, #ccc)' }}>
          No build-log details returned for this date. This read does not establish complete source coverage.
        </div>
      )}

      {detail && (
        <DayCard
          session={session}
          detail={detail}
          isLoading={false}
          onExpand={() => {}}
          vehicleId={vehicleId}
          isPopup={true}
          hideOpenFullLink={true}
        />
      )}

      {/* All vehicle_observations witnessed on this date — every row is a
          drill-down target. Click expands inline; structured_data and source_url
          surface here directly so the chain doesn't dead-end in a popup. */}
      {observations.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              margin: '0 0 8px',
              borderBottom: '2px solid var(--text, #1a1a1a)',
              paddingBottom: 4,
              fontFamily: 'Arial, sans-serif',
            }}
          >
            Observations on this UTC day · {observations.length} returned
          </h2>
          <ObservationsList key={subject} observations={observations} vehicleId={vehicleId} />
        </section>
      )}
    </div>
  );
};

interface ObservationsListProps {
  observations: DayObservation[];
  vehicleId: string;
}

const ObservationsList: React.FC<ObservationsListProps> = ({ observations, vehicleId }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => setExpanded((m) => ({ ...m, [id]: !m[id] }));

  return (
    <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
      {observations.map((obs, idx) => {
        const visibleData = publicObservationData(obs.structured_data);
        const isOpen = !!expanded[obs.id];
        const time = obs.observed_at
          ? new Date(obs.observed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
          : '—';
        const conf = obs.confidence_score !== null
          ? `${Math.round((obs.confidence_score || 0) * 100)}%`
          : (obs.confidence || '').toUpperCase();

        // Surface temporal-confidence signals when present (purchase date
        // recovered from file timestamp, low confidence, scanned-later, etc.)
        const sd = (obs.structured_data || {}) as Record<string, unknown>;
        const dateLowConf =
          sd.observed_at_confidence === 'low' || sd.observed_at_source === 'file_upload_timestamp_ms';
        const scannedAt = typeof sd.observed_at_original === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(sd.observed_at_original)
          ? sd.observed_at_original : null;

        return (
          <div
            key={obs.id}
            style={{
              borderTop: idx === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
              background: isOpen ? 'var(--bg-alt, #f9f9f9)' : 'transparent',
            }}
          >
            <button
              type="button"
              onClick={() => toggle(obs.id)}
              aria-expanded={isOpen}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '46px 10px 70px minmax(0, 1fr) 56px 34px',
                gap: 4,
                alignItems: 'center',
                padding: '6px 8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'Arial, sans-serif',
                color: 'var(--text, #1a1a1a)',
              }}
            >
              <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9, color: 'var(--text-secondary, #666)' }}>
                {time}
              </span>
              <span
                title={dateLowConf ? 'Purchase date is low-confidence (recovered from file timestamp; printed receipt date still pending OCR)' : ''}
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textAlign: 'center',
                  color: dateLowConf ? 'var(--warning, #cc8800)' : 'transparent',
                  cursor: dateLowConf ? 'help' : 'default',
                }}
              >
                {dateLowConf ? '!' : ''}
              </span>
              <span
                style={{
                  fontSize: 7,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  border: '1px solid var(--text, #1a1a1a)',
                  padding: '1px 4px',
                  textAlign: 'center',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                {obs.kind}
              </span>
              <span
                style={{
                  fontSize: 10,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: isOpen ? 'normal' : 'nowrap',
                }}
              >
                {obs.kind.replace(/_/g, ' ')} observation
              </span>
              <span title={obs.source_slug || obs.source_name || undefined} style={{ fontFamily: 'Courier New, monospace', fontSize: 9, color: 'var(--text-secondary, #666)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {obs.source_slug || obs.source_name || '—'}
              </span>
              <span
                style={{
                  fontFamily: 'Courier New, monospace',
                  fontSize: 9,
                  textAlign: 'right',
                  color: 'var(--text-secondary, #666)',
                }}
              >
                {conf}
              </span>
            </button>

            {isOpen && (
              <div style={{ padding: '6px 12px 10px', fontSize: 10, fontFamily: 'Arial, sans-serif' }}>
                <p>{OBSERVATION_PRIVACY_NOTICE}</p>
                {(scannedAt || dateLowConf) && (
                  <div
                    style={{
                      marginBottom: 6,
                      padding: '4px 6px',
                      border: '1px solid var(--warning, #cc8800)',
                      background: 'var(--bg, #fff)',
                      fontSize: 9,
                      fontFamily: 'Courier New, monospace',
                      color: 'var(--text, #1a1a1a)',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2, fontFamily: 'Arial, sans-serif' }}>
                      Temporal layers
                    </div>
                    <div>purchased: {obs.observed_at ? obs.observed_at.slice(0, 10) : '—'} (low-confidence; file-upload timestamp)</div>
                    {scannedAt && <div>scanned/ingested: {scannedAt.slice(0, 10)}</div>}
                    <div style={{ color: 'var(--text-secondary, #666)' }}>installed: unknown — needs install observation referencing this part</div>
                  </div>
                )}
                {(() => {
                  // Surface the source artifact as an image when the URL points to
                  // a file (receipt scan, photo, document image). Falls back to a
                  // clickable URL for non-image sources (web pages, archives).
                  const sd = obs.structured_data as Record<string, unknown> | null;
                  const candidate = publicObservationArtifact();
                  if (!candidate) return null;
                  const isImage = /\.(jpe?g|png|webp|gif|heic|tiff?)(\?.*)?$/i.test(candidate);
                  if (isImage) {
                    // Route through Supabase's render endpoint (medium = 600px,
                    // q85) so we serve ~50-150KB instead of multi-MB originals.
                    // First request transforms, every subsequent hit is CDN-cached.
                    const thumbSrc = optimizeImageUrl(candidate, 'medium') || candidate;
                    const witnessImageId =
                      (typeof sd.witness_image_id === 'string' && (sd.witness_image_id as string)) ||
                      (typeof sd.install_witness_image_id === 'string' && (sd.install_witness_image_id as string)) ||
                      null;
                    return (
                      <div style={{ marginBottom: 8 }}>
                        <a
                          href={candidate}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open source artifact full size"
                          style={{ display: 'inline-block', border: '2px solid var(--text, #1a1a1a)' }}
                        >
                          <img
                            src={thumbSrc}
                            alt="Source artifact"
                            loading="lazy"
                            decoding="async"
                            style={{
                              display: 'block',
                              maxWidth: '100%',
                              maxHeight: 480,
                              objectFit: 'contain',
                              background: 'var(--bg, #fff)',
                            }}
                          />
                        </a>
                        {witnessImageId && (
                          <div style={{ marginTop: 4 }}>
                            <Link
                              to={`/vehicle/${vehicleId}/image/${witnessImageId}`}
                              style={{
                                display: 'inline-block',
                                fontFamily: 'Arial, sans-serif',
                                fontSize: 7,
                                fontWeight: 700,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: 'var(--text, #1a1a1a)',
                                textDecoration: 'none',
                                border: '2px solid var(--text, #1a1a1a)',
                                padding: '2px 6px',
                              }}
                            >
                              OPEN IMAGE DETAIL →
                            </Link>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 6 }}>
                        Source URL:
                      </span>
                      <a
                        href={candidate}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: 'Courier New, monospace', fontSize: 9, color: 'var(--text, #1a1a1a)', wordBreak: 'break-all' }}
                      >
                        {candidate}
                      </a>
                    </div>
                  );
                })()}
                {Object.keys(visibleData).length > 0 && (
                  <div>
                    <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                      Structured Data
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: '6px 8px',
                        background: 'var(--bg, #fff)',
                        border: '1px solid var(--text-disabled, #ddd)',
                        fontFamily: 'Courier New, monospace',
                        fontSize: 9,
                        lineHeight: 1.4,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        maxHeight: 240,
                        overflow: 'auto',
                      }}
                    >
                      {JSON.stringify(visibleData, null, 2)}
                    </pre>
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 8, color: 'var(--text-secondary, #666)', fontFamily: 'Courier New, monospace', display: 'flex', flexWrap: 'wrap', overflowWrap: 'anywhere', alignItems: 'center', gap: 8 }}>
                  <span>observation_id: {obs.id}</span>
                  <span>·</span>
                  <span>ingested: {new Date(obs.ingested_at).toISOString().slice(0, 19)}</span>
                  <Link
                    to={`/vehicle/${vehicleId}/observation/${obs.id}`}
                    style={{
                      marginLeft: 'auto',
                      fontFamily: 'Arial, sans-serif',
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text, #1a1a1a)',
                      textDecoration: 'none',
                      border: '2px solid var(--text, #1a1a1a)',
                      padding: '2px 6px',
                    }}
                  >
                    OPEN OBSERVATION →
                  </Link>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DayPage;
