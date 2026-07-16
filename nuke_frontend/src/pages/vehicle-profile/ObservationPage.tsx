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
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

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

const ObservationPage: React.FC = () => {
  const { vehicleId, obsId } = useParams<{ vehicleId: string; obsId: string }>();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [obs, setObs] = useState<ObservationRow | null>(null);
  const [related, setRelated] = useState<RelatedObservation[]>([]);
  const [supersededBy, setSupersededBy] = useState<ObservationRow | null>(null);
  const [supersedes, setSupersedes] = useState<ObservationRow | null>(null);
  const [witnessImageUrl, setWitnessImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId || !obsId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const [vehRes, obsRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .maybeSingle(),
        supabase
          .from('vehicle_observations')
          .select(`
            id, vehicle_id, kind, observed_at, ingested_at, source_url, source_id,
            confidence, confidence_score, content_text, structured_data, property_id,
            is_superseded, superseded_by,
            observation_sources!left(display_name, slug)
          `)
          .eq('id', obsId)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (obsRes.error || !obsRes.data) {
        setError(`Observation not found: ${obsRes.error?.message || 'no row'}`);
        setLoading(false);
        return;
      }

      const rawObs = obsRes.data as any;
      const observation: ObservationRow = {
        ...rawObs,
        source_slug: rawObs.observation_sources?.slug ?? null,
        source_name: rawObs.observation_sources?.display_name ?? null,
      };
      setObs(observation);
      setVehicle(vehRes.data as VehicleSummary | null);

      // Lineage walks — best-effort, non-blocking
      const lineageQueries: Promise<void>[] = [];
      if (observation.superseded_by) {
        lineageQueries.push(
          supabase
            .from('vehicle_observations')
            .select(`id, vehicle_id, kind, observed_at, ingested_at, source_url, source_id,
              confidence, confidence_score, content_text, structured_data, property_id,
              is_superseded, superseded_by`)
            .eq('id', observation.superseded_by)
            .maybeSingle()
            .then(({ data }) => {
              if (!cancelled && data) setSupersededBy(data as ObservationRow);
            }) as unknown as Promise<void>,
        );
      }
      const originalId = (observation.structured_data as any)?.supersedes_original_id;
      if (originalId) {
        lineageQueries.push(
          supabase
            .from('vehicle_observations')
            .select(`id, vehicle_id, kind, observed_at, ingested_at, source_url, source_id,
              confidence, confidence_score, content_text, structured_data, property_id,
              is_superseded, superseded_by`)
            .eq('id', originalId)
            .maybeSingle()
            .then(({ data }) => {
              if (!cancelled && data) setSupersedes(data as ObservationRow);
            }) as unknown as Promise<void>,
        );
      }

      // Witness image lookup — if structured_data references a witness image,
      // fetch its public URL so AnnotatedImage can render the artifact + bboxes.
      const sd = observation.structured_data as Record<string, unknown> | null;
      const witnessImageId =
        sd && typeof sd.witness_image_id === 'string'
          ? (sd.witness_image_id as string)
          : sd && typeof sd.install_witness_image_id === 'string'
          ? (sd.install_witness_image_id as string)
          : sd && typeof sd.image_id === 'string'
          ? (sd.image_id as string)
          : null;
      if (witnessImageId) {
        lineageQueries.push(
          supabase
            .from('vehicle_images')
            .select('image_url')
            .eq('id', witnessImageId)
            .maybeSingle()
            .then(({ data }) => {
              if (!cancelled && data && (data as any).image_url) {
                setWitnessImageUrl((data as any).image_url as string);
              }
            }) as unknown as Promise<void>,
        );
      }

      // Related: same merchant on this vehicle (cap at 10, excluding self).
      const merchant = (observation.structured_data as any)?.merchant;
      if (merchant && typeof merchant === 'string') {
        lineageQueries.push(
          supabase
            .from('vehicle_observations')
            .select('id, kind, observed_at, content_text, structured_data')
            .eq('vehicle_id', vehicleId)
            .eq('is_superseded', false)
            .neq('id', obsId)
            .filter('structured_data->>merchant', 'eq', merchant)
            .order('observed_at', { ascending: false })
            .limit(10)
            .then(({ data }) => {
              if (!cancelled && data) {
                setRelated(
                  (data as any[]).map((r) => ({
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

      await Promise.all(lineageQueries);
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [vehicleId, obsId]);

  const sourceArtifact = useMemo(() => {
    if (!obs) return null;
    const sd = obs.structured_data as Record<string, unknown> | null;
    const candidate =
      obs.source_url ||
      (sd && typeof sd.file_url === 'string' ? (sd.file_url as string) : '') ||
      (sd && typeof sd.image_url === 'string' ? (sd.image_url as string) : '') ||
      witnessImageUrl ||
      '';
    return candidate || null;
  }, [obs, witnessImageUrl]);

  const vehLabel = vehicle
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  const observedDate = obs?.observed_at?.slice(0, 10) || '';
  const obsTitle = useMemo(() => {
    if (!obs) return '';
    const sd = obs.structured_data as Record<string, unknown> | null;
    if (obs.content_text) return obs.content_text;
    if (sd) {
      const sval =
        sd.label || sd.value || sd.title || sd.summary || sd.merchant || sd.wire_id || sd.property_key;
      if (sval) return String(sval);
    }
    return `(${obs.kind})`;
  }, [obs]);

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
        <span style={{ color: 'var(--text, #1a1a1a)' }}>Observation</span>
      </nav>

      {loading && !obs && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading observation…</div>
      )}

      {error && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--error, #c00)',
            padding: 12,
            border: '2px solid var(--error, #c00)',
          }}
        >
          {error}
        </div>
      )}

      {obs && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                border: '2px solid var(--text, #1a1a1a)',
                padding: '2px 6px',
                fontFamily: 'Arial, sans-serif',
              }}
            >
              {obs.kind}
            </span>
            <span
              style={{
                fontSize: 9,
                color: 'var(--text-secondary, #666)',
                fontFamily: 'Courier New, monospace',
              }}
            >
              {obs.source_slug || obs.source_name || '—'}
            </span>
            {obs.confidence_score !== null && (
              <span style={{ fontSize: 9, color: 'var(--text-secondary, #666)', fontFamily: 'Courier New, monospace' }}>
                {Math.round((obs.confidence_score || 0) * 100)}%
              </span>
            )}
            {obs.is_superseded && (
              <span
                style={{
                  fontSize: 7,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
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
              fontSize: 14,
              fontWeight: 700,
              margin: '0 0 8px',
              fontFamily: 'Arial, sans-serif',
              wordBreak: 'break-word',
            }}
          >
            {obsTitle}
          </h1>

          <div
            style={{
              fontSize: 9,
              fontFamily: 'Courier New, monospace',
              color: 'var(--text-secondary, #666)',
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
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '2px solid var(--text, #1a1a1a)',
                  fontFamily: 'Arial, sans-serif',
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
                    fontFamily: 'Courier New, monospace',
                    fontSize: 9,
                    color: 'var(--text, #1a1a1a)',
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
            </section>
            );
          })()}

          {/* Structured data */}
          {obs.structured_data && Object.keys(obs.structured_data).length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '2px solid var(--text, #1a1a1a)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                Structured Data
              </h2>
              <StructuredDataTable data={obs.structured_data} />
            </section>
          )}

          {/* Supersession lineage */}
          {(supersededBy || supersedes) && (
            <section style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '2px solid var(--text, #1a1a1a)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                Supersession Lineage
              </h2>
              {supersedes && (
                <div style={{ fontSize: 10, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, marginRight: 6 }}>Supersedes:</span>
                  <Link to={`/vehicle/${vehicleId}/observation/${supersedes.id}`} style={{ color: 'inherit' }}>
                    {formatDate(supersedes.observed_at)} · {supersedes.kind}
                  </Link>
                </div>
              )}
              {supersededBy && (
                <div style={{ fontSize: 10, marginBottom: 4 }}>
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
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '2px solid var(--text, #1a1a1a)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                Other Observations From Same Merchant · {related.length}
              </h2>
              <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
                {related.map((r, i) => (
                  <Link
                    key={r.id}
                    to={`/vehicle/${vehicleId}/observation/${r.id}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '92px 70px 1fr',
                      gap: 8,
                      padding: '6px 8px',
                      fontFamily: 'Arial, sans-serif',
                      fontSize: 10,
                      color: 'var(--text, #1a1a1a)',
                      textDecoration: 'none',
                      borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
                    }}
                  >
                    <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9, color: 'var(--text-secondary)' }}>
                      {r.observed_at ? r.observed_at.slice(0, 10) : '—'}
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
                      }}
                    >
                      {r.kind}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.content_text || '—'}
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
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              border: '2px solid var(--text, #1a1a1a)',
              padding: '3px 8px',
              background: showAnnotations ? 'var(--text, #1a1a1a)' : 'transparent',
              color: showAnnotations ? 'var(--bg, #fff)' : 'var(--text, #1a1a1a)',
              cursor: 'pointer',
              fontFamily: 'Arial, sans-serif',
            }}
          >
            {showAnnotations ? '● annotations on' : '○ annotations off'} ({bboxes.length})
          </button>
          <span style={{ fontSize: 9, color: 'var(--text-secondary, #666)', fontFamily: 'Courier New, monospace' }}>
            green=component · red=damage · blue=text
          </span>
        </div>
      )}
      <a
        href={fullSrc}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open source artifact full size"
        style={{ display: 'inline-block', border: '2px solid var(--text, #1a1a1a)', position: 'relative', maxWidth: '100%' }}
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
    return <div style={{ fontSize: 9, color: 'var(--text-secondary, #666)' }}>(no fields)</div>;
  }
  return (
    <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
      {rows.map(([k, v], i) => {
        const isStr = typeof v === 'string';
        const looksUrl = isStr && /^https?:\/\//.test(v as string);
        const looksImg = looksUrl && isImageUrl(v as string);
        const isObj = typeof v === 'object';
        return (
          <div
            key={k}
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 1fr',
              gap: 12,
              padding: '6px 8px',
              fontSize: 10,
              borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
              alignItems: 'start',
            }}
          >
            <span
              style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary, #666)',
              }}
            >
              {labelCase(k)}
            </span>
            <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10, wordBreak: 'break-word' }}>
              {looksImg ? (
                <a href={v as string} target="_blank" rel="noopener noreferrer">
                  <img
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
                    fontSize: 9,
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

export default ObservationPage;
