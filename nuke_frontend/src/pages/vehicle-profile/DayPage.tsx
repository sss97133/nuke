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

interface DayPageVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

interface DayObservation {
  id: string;
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
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

const DayPage: React.FC = () => {
  const { vehicleId, date } = useParams<{ vehicleId: string; date: string }>();
  const [vehicle, setVehicle] = useState<DayPageVehicle | null>(null);
  const [detail, setDetail] = useState<DailyReceipt | null>(null);
  const [observations, setObservations] = useState<DayObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId || !date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Day boundary in UTC; observed_at is stored as timestamptz.
    const dayStart = `${date}T00:00:00Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    (async () => {
      const [vehRes, dayRes, obsRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .maybeSingle(),
        supabase.rpc('get_daily_work_receipt', {
          p_vehicle_id: vehicleId,
          p_date: date,
        }),
        supabase
          .from('vehicle_observations')
          .select(`
            id, kind, observed_at, ingested_at, source_url,
            confidence, confidence_score, content_text, structured_data,
            observation_sources!left(display_name, slug)
          `)
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .gte('observed_at', dayStart)
          .lte('observed_at', dayEnd)
          .order('observed_at', { ascending: true })
          .limit(500),
      ]);

      if (cancelled) return;

      if (vehRes.error) {
        setError(`Vehicle load failed: ${vehRes.error.message}`);
        setLoading(false);
        return;
      }
      setVehicle(vehRes.data as DayPageVehicle | null);

      if (!dayRes.error && dayRes.data) {
        setDetail(dayRes.data as DailyReceipt);
      }

      if (!obsRes.error && obsRes.data) {
        setObservations(
          (obsRes.data as any[]).map((r) => ({
            id: r.id,
            kind: r.kind,
            observed_at: r.observed_at,
            ingested_at: r.ingested_at,
            source_url: r.source_url,
            confidence: r.confidence,
            confidence_score: r.confidence_score,
            content_text: r.content_text,
            structured_data: r.structured_data,
            source_slug: r.observation_sources?.slug ?? null,
            source_name: r.observation_sources?.display_name ?? null,
          })),
        );
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
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

  const vehLabel = vehicle
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
        {detail?.photo_count ?? 0} PHOTOS · {detail?.parts_count ?? 0} RECEIPTS · {detail?.component_events?.length ?? 0} EVENTS · {detail?.line_items?.length ?? 0} LINE ITEMS · {observations.length} OBSERVATIONS
      </div>

      {loading && !detail && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading day…</div>
      )}

      {error && (
        <div style={{ fontSize: 10, color: 'var(--error, #c00)', padding: 12, border: '2px solid var(--error, #c00)' }}>
          {error}
        </div>
      )}

      {!loading && !error && !detail && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12, border: '2px solid var(--text-disabled, #ccc)' }}>
          No build-log data on file for this date. The cell on the heatmap may correspond to a
          receipt or photo that lives in a different table — drill into the source via the
          vehicle profile timeline.
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
            Observations on this day · {observations.length}
          </h2>
          <ObservationsList observations={observations} vehicleId={vehicleId} />
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
        const isOpen = !!expanded[obs.id];
        const time = obs.observed_at
          ? new Date(obs.observed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
          : '—';
        const conf = obs.confidence_score !== null
          ? `${Math.round((obs.confidence_score || 0) * 100)}%`
          : (obs.confidence || '').toUpperCase();

        // Surface temporal-confidence signals when present (purchase date
        // recovered from file timestamp, low confidence, scanned-later, etc.)
        const sd = (obs.structured_data || {}) as Record<string, unknown>;
        const dateLowConf =
          sd.observed_at_confidence === 'low' || sd.observed_at_source === 'file_upload_timestamp_ms';
        const scannedAt = typeof sd.observed_at_original === 'string' ? (sd.observed_at_original as string) : null;

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
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '52px 16px 86px 1fr 90px 48px',
                gap: 8,
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
                {obs.content_text || (() => {
                  const sd = obs.structured_data;
                  if (sd && typeof sd === 'object') {
                    const summary = sd.label || sd.value || sd.title || sd.summary || sd.wire_id || sd.property_key;
                    if (summary) return String(summary);
                  }
                  return '(no content_text)';
                })()}
              </span>
              <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9, color: 'var(--text-secondary, #666)' }}>
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
                  const candidate =
                    obs.source_url ||
                    (sd && typeof sd.file_url === 'string' ? (sd.file_url as string) : '') ||
                    (sd && typeof sd.image_url === 'string' ? (sd.image_url as string) : '');
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
                {obs.structured_data && Object.keys(obs.structured_data).length > 0 && (
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
                      {JSON.stringify(obs.structured_data, null, 2)}
                    </pre>
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 8, color: 'var(--text-secondary, #666)', fontFamily: 'Courier New, monospace', display: 'flex', alignItems: 'center', gap: 8 }}>
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
