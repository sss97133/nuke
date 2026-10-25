/**
 * ObservationPage.tsx
 *
 * Layer 5 of the click-through chain — one observation, its source artifact,
 * its witnesses, its supersession lineage, and related observations.
 *
 * Mounted at /vehicle/:vehicleId/observation/:obsId. This is the page each
 * DayPage row drills into. Every linkable atom inside structured_data
 * (merchant, source_url, supersedes lineage) is rendered as a navigable
 * resource — not a popup.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Link from '../../components/PrefetchLink';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/button';
import './vehicle-evidence-detail.css';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { publicObservationData, publicObservationArtifact, OBSERVATION_PRIVACY_NOTICE } from './observationPrivacy';

interface ObservationRow {
  id: string;
  vehicle_id: string;
  kind: string;
  observed_at: string | null;
  ingested_at: string;
  source_url: string | null;
  source_id: string | null;
  confidence: string | null;
  confidence_score: number | null;
  content_text: string | null;
  structured_data: Record<string, unknown> | null;
  property_id: string | null;
  is_superseded: boolean;
  superseded_by: string | null;
  source_slug: string | null;
  source_name: string | null;
}

interface RelatedObservation {
  id: string;
  kind: string;
  observed_at: string | null;
  content_text: string | null;
  merchant: string | null;
}

interface VehicleSummary {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const isImageUrl = (url: string): boolean =>
  /\.(jpe?g|png|webp|gif|heic|tiff?)(\?.*)?$/i.test(url);

const labelCase = (key: string): string =>
  key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const ObservationPageContent: React.FC = () => {
  const { vehicleId, obsId } = useParams<{ vehicleId: string; obsId: string }>();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [observation, setObs] = useState<ObservationRow | null>(null);
  const [loadedSubject, setLoadedSubject] = useState<string | null>(null);
  const [related, setRelated] = useState<RelatedObservation[]>([]);
  const [supersededBy, setSupersededBy] = useState<ObservationRow | null>(null);
  const [supersedes, setSupersedes] = useState<ObservationRow | null>(null);
  const [witnessImageUrl, setWitnessImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksUnavailable, setLinksUnavailable] = useState(false);
  const subject = `${vehicleId}:${obsId}`;
  const obs = loadedSubject === subject ? observation : null;

  useEffect(() => {
    if (!vehicleId || !obsId) return;
    let cancelled = false;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 10_000);
    setLoading(true);
    setError(null);
    setLoadedSubject(null);
    setObs(null);
    setVehicle(null);
    setRelated([]);
    setSupersededBy(null);
    setSupersedes(null);
    setLinksLoading(false);
    setLinksUnavailable(false);

    (async () => {
      try {
        // The URL supplies two IDs; both must describe the same visible entity.
        const vehRes = await supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .abortSignal(controller.signal)
          .maybeSingle();
        if (cancelled) return;
        if (vehRes.error) throw new Error('Unable to load this vehicle. Try again.');
        if (!vehRes.data || vehRes.data.id !== vehicleId) {
          throw new Error('Vehicle unavailable.');
        }
        setVehicle(vehRes.data as VehicleSummary);

        const obsRes = await supabase
          .from('vehicle_observations')
          .select(`
              id, vehicle_id, kind, observed_at, ingested_at, source_id,
              confidence, confidence_score, structured_data, property_id,
              is_superseded, superseded_by,
              observation_sources!left(display_name, slug)
            `)
          .eq('id', obsId)
          .eq('vehicle_id', vehicleId)
          .abortSignal(controller.signal)
          .maybeSingle();

        if (cancelled) return;

        if (obsRes.error) throw new Error('Unable to load this observation. Try again.');
        if (!obsRes.data || obsRes.data.id !== obsId || obsRes.data.vehicle_id !== vehicleId) {
          throw new Error('Observation unavailable for this vehicle.');
        }

        const rawObs = obsRes.data as any;
        const observation: ObservationRow = {
          ...rawObs,
          source_slug: rawObs.observation_sources?.slug ?? null,
          source_name: rawObs.observation_sources?.display_name ?? null,
        };
        setObs(observation);
        setLoadedSubject(`${vehicleId}:${obsId}`);

        // Lineage walks — best-effort, non-blocking
        const lineageQueries: Promise<void>[] = [];
        setLinksLoading(true);
        if (observation.superseded_by) {
          lineageQueries.push(
            supabase
              .from('vehicle_observations')
              .select(`id, vehicle_id, kind, observed_at, ingested_at, source_id,
                confidence, confidence_score, structured_data, property_id,
                is_superseded, superseded_by`)
              .eq('id', observation.superseded_by)
              .eq('vehicle_id', vehicleId)
              .abortSignal(controller.signal)
              .maybeSingle()
              .then(({ data, error }) => {
                if (!cancelled && error) setLinksUnavailable(true);
                if (!cancelled && !error && data?.vehicle_id === vehicleId && data.id === observation.superseded_by) setSupersededBy(data as ObservationRow);
              }) as unknown as Promise<void>,
          );
        }
        const originalId = (observation.structured_data as any)?.supersedes_original_id;
        if (originalId) {
          lineageQueries.push(
            supabase
              .from('vehicle_observations')
              .select(`id, vehicle_id, kind, observed_at, ingested_at, source_id,
                confidence, confidence_score, structured_data, property_id,
                is_superseded, superseded_by`)
              .eq('id', originalId)
              .eq('vehicle_id', vehicleId)
              .abortSignal(controller.signal)
              .maybeSingle()
              .then(({ data, error }) => {
                if (!cancelled && error) setLinksUnavailable(true);
                if (!cancelled && !error && data?.vehicle_id === vehicleId && data.id === originalId) setSupersedes(data as ObservationRow);
              }) as unknown as Promise<void>,
          );
        }

        // Related: same merchant on this vehicle (cap at 10, excluding self).
        const merchant = (observation.structured_data as any)?.merchant;
        if (merchant && typeof merchant === 'string') {
          lineageQueries.push(
            supabase
              .from('vehicle_observations')
              .select('id, vehicle_id, kind, observed_at')
              .eq('vehicle_id', vehicleId)
              .eq('is_superseded', false)
              .neq('id', obsId)
              .filter('structured_data->>merchant', 'eq', merchant)
              .order('observed_at', { ascending: false })
              .limit(10)
              .abortSignal(controller.signal)
              .then(({ data, error }) => {
                if (!cancelled && error) setLinksUnavailable(true);
                if (!cancelled && !error && data) {
                  setRelated(
                    (data as any[]).filter(r => r.vehicle_id === vehicleId && r.id !== obsId).map((r) => ({
                      id: r.id,
                      kind: r.kind,
                      observed_at: r.observed_at,
                      content_text: r.content_text,
                      merchant: r.structured_data?.merchant ?? null,
                    })),
                  );
                }
              }) as unknown as Promise<void>,
          );
        }

        const linkReads = await Promise.allSettled(lineageQueries);
        if (!cancelled) {
          if (linkReads.some(result => result.status === 'rejected')) setLinksUnavailable(true);
          setLinksLoading(false);
        }
      } catch (failure) {
        if (!cancelled) {
          setObs(null);
          setLoadedSubject(null);
          // Reader errors can contain internal SQL and source payloads.
          const messages = ['Vehicle unavailable.', 'Unable to load this vehicle. Try again.',
            'Observation unavailable for this vehicle.', 'Unable to load this observation. Try again.'];
          const message = failure instanceof Error ? failure.message : '';
          setError(messages.includes(message) ? message : 'Unable to load this observation. Try again.');
        }
      } finally {
        window.clearTimeout(deadline);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(deadline);
    };
  }, [vehicleId, obsId, readAttempt]);

  // Original documents and OCR labels have no verified name-publication consent.
  const sourceArtifact = publicObservationArtifact();
  const visibleData = useMemo(() => publicObservationData(obs?.structured_data ?? null), [obs]);

  const vehLabel = vehicle && vehicle.id === vehicleId
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  const observedDate = obs?.observed_at?.slice(0, 10) || '';
  const obsTitle = useMemo(() => {
    if (!obs) return '';
    return `${labelCase(obs.kind)} observation`;
  }, [obs]);

  return (
    <div className="evidence-detail observation-evidence-detail"
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '16px 12px 48px',
        color: 'var(--text)',
      }}
    >
      <nav
        aria-label="breadcrumb"
        style={{
          color: 'var(--text-secondary)',
          marginBottom: 12,
          fontWeight: 700,
        }}
      >
        <Link to={`/vehicle/${vehicleId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {vehLabel || 'Vehicle'}
        </Link>
        {observedDate && (
          <>
            <span style={{ margin: '0 6px' }}>/</span>
            <Link
              to={`/vehicle/${vehicleId}/day/${observedDate}`}
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              {observedDate}
            </Link>
          </>
        )}
        <span style={{ margin: '0 6px' }}>/</span>
        <span style={{ color: 'var(--text)' }}>Observation</span>
      </nav>

      {loading && !obs && (
        <div role="status" style={{ color: 'var(--text-secondary)', padding: 12 }}>Loading observation…</div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            color: 'var(--error, #c00)',
            padding: 12,
            border: '1px solid var(--error)',
          }}
        >
          <p>{error}</p>
          <Button type="button" variant="secondary" onClick={() => setReadAttempt(value => value + 1)}>Retry read</Button>
        </div>
      )}

      {obs && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
            <span
              style={{
                fontWeight: 700,
                border: '1px solid var(--border)',
                padding: '2px 6px',
              }}
            >
              {obs.kind}
            </span>
            <span
              style={{
                color: 'var(--text-secondary)',
              }}
            >
              {obs.source_slug || obs.source_name || '—'}
            </span>
            {obs.confidence_score != null && Number.isFinite(obs.confidence_score) && (
              <span style={{ color: 'var(--text-secondary)', }}>
                Stored confidence: {Math.round(obs.confidence_score * 100)}% · Verification unassessed
              </span>
            )}
            {obs.is_superseded && (
              <span
                style={{
                  fontWeight: 700,
                  border: '1px solid var(--warning, #cc8800)',
                  color: 'var(--warning, #cc8800)',
                  padding: '1px 4px',
                }}
              >
                Superseded
              </span>
            )}
          </div>

          <h1
            style={{
              fontWeight: 700,
              margin: '0 0 8px',
              wordBreak: 'break-word',
            }}
          >
            {obsTitle}
          </h1>

          <p style={{ color: 'var(--text-secondary)' }}>{OBSERVATION_PRIVACY_NOTICE}</p>

          <div className="evidence-metadata"
            style={{
              color: 'var(--text-secondary)',
              marginBottom: 16,
            }}
          >
            observed_at: {formatDate(obs.observed_at)} · ingested: {formatDate(obs.ingested_at)} · id: {obs.id}
          </div>

          {/* Source artifact (image or URL) */}
          {sourceArtifact && (() => {
            const sd = (obs.structured_data || {}) as Record<string, unknown>;
            const witnessImageId = typeof sd.witness_image_id === 'string' ? (sd.witness_image_id as string) : null;
            const installWitnessImageId = typeof sd.install_witness_image_id === 'string' ? (sd.install_witness_image_id as string) : null;
            const imageId = witnessImageId || installWitnessImageId;
            return (
            <section style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontWeight: 700,
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Source Artifact
              </h2>
              {isImageUrl(sourceArtifact) ? (
                <AnnotatedImage
                  src={sourceArtifact}
                  fullSrc={sourceArtifact}
                  structuredData={(obs.structured_data || {}) as Record<string, unknown>}
                />
              ) : (
                <a
                  href={sourceArtifact}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--text)',
                    wordBreak: 'break-all',
                  }}
                >
                  {sourceArtifact}
                </a>
              )}
              {imageId && (
                <div style={{ marginTop: 6 }}>
                  <Link
                    to={`/vehicle/${vehicleId}/image/${imageId}`}
                    style={{
                      display: 'inline-block',
                      fontWeight: 700,
                      color: 'var(--text)',
                      textDecoration: 'none',
                      border: '1px solid var(--border)',
                      padding: '2px 6px',
                    }}
                  >
                    OPEN IMAGE DETAIL →
                  </Link>
                </div>
              )}
            </section>
            );
          })()}

          {/* Structured data */}
          {Object.keys(visibleData).length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontWeight: 700,
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Structured Data
              </h2>
              <StructuredDataTable data={visibleData} />
            </section>
          )}

          {linksLoading && <p role="status">Reading linked observations…</p>}
          {linksUnavailable && <div className="evidence-read-notice">
            <p role="status">Linked observations could not be read completely. Their absence has not been established.</p>
            <Button type="button" variant="secondary" disabled={linksLoading} onClick={() => setReadAttempt(value => value + 1)}>Retry linked observations</Button>
          </div>}
          {/* Supersession lineage */}
          {(supersededBy || supersedes) && (
            <section style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontWeight: 700,
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Supersession Lineage
              </h2>
              {supersedes && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, marginRight: 6 }}>Supersedes:</span>
                  <Link to={`/vehicle/${vehicleId}/observation/${supersedes.id}`} style={{ color: 'inherit' }}>
                    {formatDate(supersedes.observed_at)} · {supersedes.kind}
                  </Link>
                </div>
              )}
              {supersededBy && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, marginRight: 6 }}>Superseded by:</span>
                  <Link to={`/vehicle/${vehicleId}/observation/${supersededBy.id}`} style={{ color: 'inherit' }}>
                    {formatDate(supersededBy.observed_at)} · {supersededBy.kind}
                  </Link>
                </div>
              )}
            </section>
          )}

          {/* Related observations from same merchant */}
          {related.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontWeight: 700,
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Other Observations From Same Merchant · {related.length}
              </h2>
              <div style={{ border: '1px solid var(--border)' }}>
                {related.map((r, i) => (
                  <Link
                    key={r.id}
                    className="evidence-related-row"
                    to={`/vehicle/${vehicleId}/observation/${r.id}`}
                    style={{
                      display: 'grid',
                      gap: 8,
                      padding: '6px 8px',
                      color: 'var(--text)',
                      textDecoration: 'none',
                      borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {r.observed_at ? r.observed_at.slice(0, 10) : '—'}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        border: '1px solid var(--text, #1a1a1a)',
                        padding: '1px 4px',
                        textAlign: 'center',
                      }}
                    >
                      {r.kind}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {labelCase(r.kind)} observation
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

type AnnotatedBbox = {
  label: string;
  bbox: [number, number, number, number];
  color: string;
  group: string;
};

const collectBboxes = (sd: Record<string, unknown>): AnnotatedBbox[] => {
  const out: AnnotatedBbox[] = [];
  const isValidBbox = (b: unknown): b is [number, number, number, number] =>
    Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number');

  const components = sd.components_seen;
  if (Array.isArray(components)) {
    for (const c of components) {
      if (c && typeof c === 'object' && isValidBbox((c as any).bbox)) {
        out.push({ label: String((c as any).label ?? '?'), bbox: (c as any).bbox, color: '#00cc66', group: 'component' });
      }
    }
  }
  const damageLocalized = sd.damage_localized;
  if (Array.isArray(damageLocalized)) {
    for (const d of damageLocalized) {
      if (d && typeof d === 'object' && isValidBbox((d as any).bbox)) {
        out.push({
          label: String((d as any).description ?? (d as any).text ?? 'damage'),
          bbox: (d as any).bbox,
          color: '#cc3333',
          group: 'damage',
        });
      }
    }
  }
  const textRegions = sd.text_regions;
  if (Array.isArray(textRegions)) {
    for (const t of textRegions) {
      if (t && typeof t === 'object' && isValidBbox((t as any).bbox)) {
        out.push({
          label: String((t as any).text ?? 'text').slice(0, 40),
          bbox: (t as any).bbox,
          color: '#3388ff',
          group: 'text',
        });
      }
    }
  }
  return out;
};

const AnnotatedImage: React.FC<{
  src: string;
  fullSrc: string;
  structuredData: Record<string, unknown>;
}> = ({ src, fullSrc, structuredData }) => {
  const [showAnnotations, setShowAnnotations] = useState(true);
  const bboxes = useMemo(() => collectBboxes(structuredData), [structuredData]);
  const hasAnnotations = bboxes.length > 0;

  return (
    <div>
      {hasAnnotations && (
        <div style={{ marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowAnnotations((v) => !v)}
            style={{
              fontWeight: 700,
              border: '1px solid var(--border)',
              padding: '3px 8px',
              background: showAnnotations ? 'var(--text)' : 'transparent',
              color: showAnnotations ? 'var(--bg, #fff)' : 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {showAnnotations ? '● annotations on' : '○ annotations off'} ({bboxes.length})
          </button>
          <span style={{ color: 'var(--text-secondary)', }}>
            green=component · red=damage · blue=text
          </span>
        </div>
      )}
      <a
        href={fullSrc}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open source artifact full size"
        style={{ display: 'inline-block', border: '1px solid var(--border)', position: 'relative', maxWidth: '100%' }}
      >
        <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
          <img
            src={src}
            alt="Source artifact"
            loading="lazy"
            decoding="async"
            style={{
              display: 'block',
              width: 'auto',
              height: 'auto',
              maxWidth: 480,
              maxHeight: 1400,
              background: 'var(--bg, #fff)',
            }}
          />
          {showAnnotations && hasAnnotations && (
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            >
              {bboxes.map((b, i) => {
                const [x1, y1, x2, y2] = b.bbox;
                return (
                  <g key={i}>
                    <rect
                      x={x1}
                      y={y1}
                      width={Math.max(1, x2 - x1)}
                      height={Math.max(1, y2 - y1)}
                      fill="none"
                      stroke={b.color}
                      strokeWidth={4}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={x1 + 4}
                      y={y1 - 4 < 14 ? y1 + 16 : y1 - 4}
                      fill={b.color}
                      fontSize={20}
                      fontFamily="Arial, sans-serif"
                      fontWeight={700}
                      style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 3 }}
                    >
                      {b.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </a>
    </div>
  );
};

const StructuredDataTable: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const rows = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-secondary)' }}>(no fields)</div>;
  }
  return (
    <div style={{ border: '1px solid var(--border)' }}>
      {rows.map(([k, v], i) => {
        const isStr = typeof v === 'string';
        const looksUrl = isStr && /^https?:\/\//.test(v as string);
        const looksImg = looksUrl && isImageUrl(v as string);
        const isObj = typeof v === 'object';
        return (
          <div className="evidence-field-row"
            key={k}
            style={{
              display: 'grid',
              gap: 12,
              padding: '6px 8px',
              borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
              alignItems: 'start',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                color: 'var(--text-secondary)',
              }}
            >
              {labelCase(k)}
            </span>
            <span style={{ wordBreak: 'break-word' }}>
              {looksImg ? (
                <a href={v as string} target="_blank" rel="noopener noreferrer">
                  <img
                    width={240}
                    height={180}
                    src={optimizeImageUrl(v as string, 'small') || (v as string)}
                    alt={k}
                    loading="lazy"
                    style={{
                      display: 'block',
                      maxWidth: 240,
                      maxHeight: 180,
                      border: '1px solid var(--text-disabled, #ddd)',
                    }}
                  />
                </a>
              ) : looksUrl ? (
                <a href={v as string} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                  {v as string}
                </a>
              ) : isObj ? (
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(v, null, 2)}
                </pre>
              ) : (
                String(v)
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// Remount local reader state at the viewer/subject boundary; a token refresh for
// the same user leaves the current inspection intact.
const ObservationPage: React.FC = () => {
  const { user, loading } = useAuth();
  const { vehicleId, obsId } = useParams();
  if (loading) return <main className="evidence-detail"><p role="status">Checking access…</p></main>;
  return <ObservationPageContent key={`${user?.id || 'public'}:${vehicleId}:${obsId}`} />;
};

export default ObservationPage;
