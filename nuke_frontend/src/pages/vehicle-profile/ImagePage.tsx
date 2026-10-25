/**
 * ImagePage.tsx
 *
 * The image as a first-class navigable resource. Mounted at
 * /vehicle/:vehicleId/image/:imageId. Closes the click-through chain:
 * timeline cell → day → observation → image → back to every observation
 * that shares this image as evidence.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Link from '../../components/PrefetchLink';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/button';
import './vehicle-evidence-detail.css';
import { supabase } from '../../lib/supabase';
import { vehicleImageRowColumns } from '../../lib/vehicleImageColumns';
import { webSourceUrl } from './hooks/useVehicleImageEvidence';

interface ImageRow {
  id: string;
  vehicle_id: string;
  image_url: string;
  thumbnail_url: string | null;
  medium_url: string | null;
  created_at: string | null;
  taken_at: string | null;
  source: string | null;
  vision_gate_status: string | null;
  vision_gate_agent_reasoning: string | null;
  caption: string | null;
  file_name: string | null;
  is_primary: boolean | null;
}

interface VehicleSummary {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

interface DeviceAttribution {
  camera_make: string | null;
  camera_model: string | null;
  software: string | null;
  device_fingerprint: string | null;
  attribution_source: string | null;
  extraction_method: string | null;
  confidence_score: number | null;
  datetime_original: string | null;
  latitude: number | null;
  longitude: number | null;
  camera_serial: string | null;
}

interface WitnessedObservation {
  id: string;
  vehicle_id: string;
  kind: string;
  observed_at: string | null;
  content_text: string | null;
  part_number: string | null;
  vendor: string | null;
  witness_role: string;
}

type Row = Record<string, unknown>;

interface SubstrateBundle {
  unavailableRelations: string[];
  vehicle_images: Row[];
  observation_witnesses: Row[];
  vehicle_observations: Row[];
  observation_discoveries: Row[];
  observation_sources: Row[];
  vehicles: Row[];
}

const ImagePageContent: React.FC = () => {
  const { vehicleId, imageId } = useParams<{ vehicleId: string; imageId: string }>();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [imageRow, setImage] = useState<ImageRow | null>(null);
  const [loadedSubject, setLoadedSubject] = useState<string | null>(null);
  const [witnessed, setWitnessed] = useState<WitnessedObservation[]>([]);
  const [attribution, setAttribution] = useState<DeviceAttribution | null>(null);
  const [attributionStatus, setAttributionStatus] = useState<'pending' | 'ready' | 'unavailable'>('pending');
  const [witnessStatus, setWitnessStatus] = useState<'pending' | 'ready' | 'unavailable'>('pending');
  const [detailError, setDetailError] = useState(false);
  const [substrate, setSubstrate] = useState<SubstrateBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const image = loadedSubject === `${vehicleId}:${imageId}` ? imageRow : null;

  useEffect(() => {
    if (!vehicleId || !imageId) return;
    let cancelled = false;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 10_000);
    setLoading(true);
    setError(null);
    setLoadedSubject(null);
    setVehicle(null);
    setImage(null);
    setWitnessed([]);
    setAttribution(null);
    setAttributionStatus('pending');
    setWitnessStatus('pending');
    setDetailError(false);
    setSubstrate(null);

    (async () => {
      let acceptedImage = false;
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
        setVehicle(vehRes.data as VehicleSummary);

        const imgRes = await supabase
          .from('vehicle_images')
          .select(`
              id, vehicle_id, image_url, thumbnail_url, medium_url,
              created_at, taken_at, source,
              vision_gate_status, vision_gate_agent_reasoning,
              caption, file_name, is_primary
            `)
          .eq('id', imageId)
          .eq('vehicle_id', vehicleId)
          .abortSignal(controller.signal)
          .maybeSingle();
        if (cancelled) return;
        if (imgRes.error) throw new Error('Unable to load this image. Try again.');
        if (!imgRes.data || imgRes.data.id !== imageId || imgRes.data.vehicle_id !== vehicleId) {
          throw new Error('Image unavailable for this vehicle.');
        }
        acceptedImage = true;
        setImage(imgRes.data as ImageRow);
        setLoadedSubject(`${vehicleId}:${imageId}`);

        // Dependent reads only follow a visible, correctly bound image.
        const [witnessRead, attributionRead] = await Promise.allSettled([
          supabase
            .from('observation_witnesses')
            .select(`
              witness_role,
              observation:vehicle_observations!observation_id(
                id, vehicle_id, kind, observed_at, content_text, structured_data, is_superseded
              )
            `)
            .eq('image_id', imageId)
            .abortSignal(controller.signal)
            .limit(100),
          supabase
            .from('device_attributions')
            .select(`
              camera_make, camera_model, software, device_fingerprint,
              attribution_source, extraction_method, confidence_score,
              datetime_original, latitude, longitude, camera_serial
            `)
            .eq('image_id', imageId)
            .abortSignal(controller.signal)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        const witRes = witnessRead.status === 'fulfilled' ? witnessRead.value : { data: null, error: true };
        const attribRes = attributionRead.status === 'fulfilled' ? attributionRead.value : { data: null, error: true };
        if (!attribRes.error && attribRes.data) setAttribution(attribRes.data as DeviceAttribution);
        setAttributionStatus(attribRes.error ? 'unavailable' : 'ready');
        setWitnessStatus(witRes.error ? 'unavailable' : 'ready');

        if (!witRes.error && witRes.data) {
          const rows: WitnessedObservation[] = [];
          for (const w of witRes.data as any[]) {
            const obs = w.observation;
            if (!obs || obs.is_superseded || !obs.vehicle_id) continue;
            const sd = obs.structured_data || {};
            rows.push({
              id: obs.id,
              vehicle_id: obs.vehicle_id,
              kind: obs.kind,
              observed_at: obs.observed_at,
              content_text: obs.content_text,
              part_number: sd.part_number ?? null,
              vendor: sd.vendor ?? sd.merchant ?? null,
              witness_role: w.witness_role,
            });
          }
          rows.sort((a, b) => (b.observed_at || '').localeCompare(a.observed_at || ''));
          setWitnessed(rows);
        }

        // --- Substrate inspector: fetch every row in every relation that touches
        // this image, return raw DB shape (no curation). The point is to expose
        // the substrate as it actually exists, not as a rendered summary.
        const [
          imgFullRes,
          vehFullRes,
          witFullRes,
        ] = await Promise.all([
          supabase.from('vehicle_images').select(await vehicleImageRowColumns()).eq('id', imageId).eq('vehicle_id', vehicleId).limit(1).abortSignal(controller.signal),
          // The row as the caller may see it (the owner's purchase facts only for the owner).
          supabase.rpc('vehicle_row_read', { p_vehicle_id: vehicleId }).abortSignal(controller.signal),
          supabase.from('observation_witnesses').select('*').eq('image_id', imageId).limit(200).abortSignal(controller.signal),
        ]);

        if (cancelled) return;
        const witnessRows = ((witFullRes.data || []) as Row[]).filter(row => row.image_id === imageId);
        const unavailableRelations = [
          ['vehicle_images', imgFullRes], ['vehicles', vehFullRes], ['observation_witnesses', witFullRes],
        ].filter(([, result]) => (result as { error?: unknown }).error).map(([name]) => name as string);
        const obsIds = Array.from(new Set(witnessRows.map((r) => r.observation_id).filter(Boolean))) as string[];

        // A failed bridge read cannot establish empty downstream collections.
        if (witFullRes.error) unavailableRelations.push('vehicle_observations', 'observation_discoveries', 'observation_sources');
        let obsRows: Row[] = [];
        let discoveryRows: Row[] = [];
        let sourceRows: Row[] = [];
        if (obsIds.length > 0) {
          const obsRes = await supabase.from('vehicle_observations').select('*').in('id', obsIds).limit(200).abortSignal(controller.signal);
          if (obsRes.error) unavailableRelations.push('vehicle_observations', 'observation_sources');
          obsRows = (obsRes.data || []) as Row[];

          const sourceIds = Array.from(new Set(obsRows.map((r) => r.source_id).filter(Boolean))) as string[];
          if (sourceIds.length > 0) {
            const srcRes = await supabase.from('observation_sources').select('*').in('id', sourceIds).limit(50).abortSignal(controller.signal);
            if (srcRes.error) unavailableRelations.push('observation_sources');
            sourceRows = (srcRes.data || []) as Row[];
          }

          const discRes = await supabase
            .from('observation_discoveries')
            .select('*')
            .in('observation_id', obsIds)
            .abortSignal(controller.signal)
            .limit(200);
          if (!discRes.error) discoveryRows = (discRes.data || []) as Row[];
          else unavailableRelations.push('observation_discoveries');
        }

        if (!cancelled) {
          setSubstrate({
            unavailableRelations,
            vehicle_images: ((imgFullRes.data || []) as Row[]).filter(row => row.id === imageId && row.vehicle_id === vehicleId),
            observation_witnesses: witnessRows,
            vehicle_observations: obsRows,
            observation_discoveries: discoveryRows,
            observation_sources: sourceRows,
            vehicles: vehFullRes.data ? [vehFullRes.data as Row] : [],

          });
        }

      } catch (failure) {
        if (!cancelled && acceptedImage) {
          // Failure in optional details does not erase the already verified image binding.
          setDetailError(true);
          setAttributionStatus(status => status === 'pending' ? 'unavailable' : status);
          setWitnessStatus(status => status === 'pending' ? 'unavailable' : status);
        } else if (!cancelled) {
          setImage(null);
          setLoadedSubject(null);
          const messages = ['Vehicle unavailable.', 'Unable to load this vehicle. Try again.',
            'Image unavailable for this vehicle.', 'Unable to load this image. Try again.'];
          const message = failure instanceof Error ? failure.message : '';
          setError(messages.includes(message) ? message : 'Unable to load this image. Try again.');
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
  }, [vehicleId, imageId, readAttempt]);

  const vehLabel = vehicle && vehicle.id === vehicleId
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  // Use the raw image_url. The Supabase render endpoint with only width set
  // defaults to resize=cover and produces distorted/cropped output on portrait
  // iPhone captures. For a single-image detail view, bandwidth is acceptable.
  const renderSrc = webSourceUrl(image?.image_url);

  return (
    <div className="evidence-detail image-evidence-detail"
      style={{
        padding: '12px 12px 24px',
        color: 'var(--text)',
      }}
    >
      <nav
        aria-label="breadcrumb"
        style={{
          color: 'var(--text-secondary)',
          marginBottom: 8,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Link to={`/vehicle/${vehicleId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {vehLabel || 'Vehicle'}
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--text)' }}>Image</span>
        {image?.vision_gate_status && (
          <span style={{ border: '1px solid var(--border)', padding: '1px 5px' }}>
            {image.vision_gate_status}
          </span>
        )}
        {image?.source && (
          <span>
            {image.source}
          </span>
        )}
        {image?.is_primary && (
          <span style={{ border: '1px solid var(--success, #0a7)', color: 'var(--success, #0a7)', padding: '1px 4px' }}>
            Primary
          </span>
        )}
      </nav>

      <h1>Image evidence</h1>
      {loading && !image && (
        <div role="status" style={{ color: 'var(--text-secondary)', padding: 12 }}>Loading image…</div>
      )}

      {error && (
        <div role="alert" style={{ color: 'var(--error, #c00)', padding: 12, border: '1px solid var(--error)' }}>
          <p>{error}</p>
          <Button type="button" variant="secondary" onClick={() => setReadAttempt(value => value + 1)}>Retry read</Button>
        </div>
      )}

      {image && (
        <div className="image-evidence-layout"
          style={{
            display: 'grid',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* LEFT: image pane, sticky so substrate scrolls beside it */}
          <aside className="image-evidence-media"
            style={{
              alignSelf: 'start',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {renderSrc && (
              <a
                href={renderSrc!}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', border: '1px solid var(--border)', lineHeight: 0 }}
              >
                <img
                  src={renderSrc}
                  alt={image.caption || image.file_name || 'Vehicle image'}
                  decoding="async"
                  width={1200}
                  height={900}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    maxHeight: 'calc(100vh - 120px)',
                    objectFit: 'contain',
                  }}
                />
              </a>
            )}
            {!renderSrc && <p role="status">Original image URL unavailable.</p>}
            {image.vision_gate_agent_reasoning && (
              <div style={{ lineHeight: 1.4, color: 'var(--text)' }}>
                {image.vision_gate_agent_reasoning}
              </div>
            )}
            <div className="evidence-metadata" style={{ lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              <div>id · {image.id}</div>
              {image.file_name && <div>file · {image.file_name}</div>}
              {image.taken_at && <div>taken · {image.taken_at.slice(0, 19).replace('T', ' ')}</div>}
              {image.created_at && <div>created · {image.created_at.slice(0, 19).replace('T', ' ')}</div>}
            </div>

            {/* Chain of Custody — sourced from device_attributions */}
            <div style={{ border: '1px solid var(--border)', padding: '6px 8px' }}>
              <div style={{ fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: 2, marginBottom: 4 }}>
                Device metadata
              </div>
              {attributionStatus === 'pending' && <p role="status">Reading device metadata…</p>}
              {attributionStatus === 'unavailable' && <p role="status">Device metadata unavailable. Its absence has not been established.</p>}
              {attributionStatus === 'ready' && (attribution ? (
                <div style={{ lineHeight: 1.5, color: 'var(--text)' }}>
                  {(attribution.camera_make || attribution.camera_model) && (
                    <div>device · {[attribution.camera_make, attribution.camera_model].filter(Boolean).join(' ')}</div>
                  )}
                  {attribution.camera_serial && <div>serial · {attribution.camera_serial}</div>}
                  {attribution.software && <div>software · {attribution.software}</div>}
                  {attribution.datetime_original && (
                    <div>shot · {String(attribution.datetime_original).slice(0, 19).replace('T', ' ')}</div>
                  )}
                  {attribution.latitude != null && attribution.longitude != null && (
                    <div>gps · {attribution.latitude.toFixed(5)}, {attribution.longitude.toFixed(5)}</div>
                  )}
                  {attribution.extraction_method && (
                    <div>method · {attribution.extraction_method}</div>
                  )}
                  {attribution.confidence_score != null && (
                    <div>confidence · {attribution.confidence_score}%</div>
                  )}
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)' }}>
                  <div>No visible device metadata returned. Device identity is unknown.</div>
                  {image.source && <div>source · {image.source}</div>}
                </div>
              ))}
            </div>
          </aside>

          {/* RIGHT: substrate pane */}
          <div style={{ minWidth: 0 }}>
          {witnessStatus === 'pending' && <p role="status">Reading observation links…</p>}
          {witnessStatus === 'unavailable' && <p role="status">Observation links unavailable. Their absence has not been established.</p>}
          {witnessed.length > 0 && (
            <section style={{ marginBottom: 16 }}>
              <h2
                style={{
                  fontWeight: 700,
                  margin: '0 0 4px',
                  paddingBottom: 2,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Recorded vehicle observation links · {witnessed.length}
              </h2>
              <div style={{ marginBottom: 4 }}>One observation can have several source roles. Independent support remains unassessed.</div>
              <div style={{ border: '1px solid var(--border)' }}>
                {witnessed.map((w, i) => (
                  <Link
                    key={`${w.id}:${w.witness_role}`}
                    className="evidence-witness-row"
                    to={`/vehicle/${w.vehicle_id}/observation/${w.id}`}
                    style={{
                      display: 'grid',
                      gap: 8,
                      padding: '6px 8px',
                      color: 'var(--text)',
                      textDecoration: 'none',
                      borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {w.observed_at ? w.observed_at.slice(0, 10) : '—'}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        border: '1px solid var(--text, #1a1a1a)',
                        padding: '1px 4px',
                        textAlign: 'center',
                      }}
                    >
                      {w.kind}
                    </span>
                    <span>
                      {w.part_number || w.vendor || ''}
                    </span>
                    <span>
                      {w.content_text || '—'}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {w.witness_role}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {detailError && <div className="evidence-read-notice"><p role="status">Record details could not be read completely. Coverage is unknown.</p></div>}
          {(detailError || witnessStatus === 'unavailable' || attributionStatus === 'unavailable' || !!substrate?.unavailableRelations.length) && <Button type="button" variant="secondary" disabled={loading} onClick={() => setReadAttempt(value => value + 1)}>Retry details</Button>}
          {loading && !substrate && <p role="status">Reading record details…</p>}
          {substrate && (
            <section style={{ marginTop: 32 }}>
              <h2
                style={{
                  fontWeight: 700,
                  margin: '0 0 4px',
                  paddingBottom: 2,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Substrate · raw database rows touching this image
              </h2>
              <div
                style={{
                  color: 'var(--text-secondary)',
                  margin: '4px 0 12px',
                }}
              >
                Visible rows returned by bounded reads, in native shape. Read limits and permissions can restrict this view; it does not establish complete evidence coverage.
              </div>
              {(['vehicle_images', 'observation_witnesses', 'vehicle_observations',
                'observation_discoveries', 'observation_sources', 'vehicles'] as const).map(name => (
                <SubstrateTable key={name} name={name} rows={substrate[name]} unavailable={substrate.unavailableRelations.includes(name)} />
              ))}
            </section>
          )}
          </div>
        </div>
      )}
    </div>
  );
};

// SubstrateTable: render any [{...}, {...}] as a literal table with the
// union of columns as headers. JSONB values render as pretty-printed JSON
// in-cell so the structure is visible without click ceremony. The goal is
// not aesthetic — it's *transparency*. The shape on the screen should match
// the shape in postgres.
const SubstrateTable: React.FC<{ name: string; rows: Record<string, unknown>[]; unavailable?: boolean }> = ({ name, rows, unavailable }) => {
  if (unavailable || !rows || rows.length === 0) {
    return (
      <div
        style={{
          marginBottom: 12,
          border: '1px solid var(--border)',
          padding: 8,
          color: 'var(--text-secondary)',
        }}
      >
        <div style={{ fontWeight: 700, color: 'var(--text)' }}>{name}</div>
        <div>{unavailable ? 'Read unavailable' : '0 rows returned'}</div>
      </div>
    );
  }

  const cols = Array.from(rows.reduce<Set<string>>((acc, r) => {
    Object.keys(r).forEach((k) => acc.add(k));
    return acc;
  }, new Set<string>()));

  return (
    <div className="evidence-substrate" style={{ marginBottom: 16 }}>
      <div
        style={{
          fontWeight: 700,
          marginBottom: 2,
        }}
      >
        {name} · {rows.length} row{rows.length === 1 ? '' : 's'}
      </div>
      <div className="evidence-table-scroll" role="region" aria-label={`${name} returned rows`} tabIndex={0} style={{ overflowX: 'auto', border: '1px solid var(--border)' }}>
        <table
          style={{
            borderCollapse: 'collapse',
            minWidth: '100%',
          }}
        >
          <thead>
            <tr style={{ background: 'var(--surface-secondary)', color: 'var(--text)' }}>
              {cols.map((c) => (
                <th
                  key={c}
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--border)',
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
                  verticalAlign: 'top',
                }}
              >
                {cols.map((c) => {
                  const v = r[c];
                  const isObj = v !== null && typeof v === 'object';
                  const display = v === null || v === undefined
                    ? 'NULL'
                    : isObj
                      ? JSON.stringify(v, null, 2)
                      : String(v);
                  return (
                    <td
                      key={c}
                      style={{
                        padding: 0,
                        borderRight: '1px solid var(--text-disabled, #eee)',
                        maxWidth: isObj ? 520 : 360,
                        verticalAlign: 'top',
                        color: v === null || v === undefined ? 'var(--text-secondary, #999)' : 'var(--text)',
                        fontStyle: v === null || v === undefined ? 'italic' : 'normal',
                      }}
                      title={isObj ? undefined : display}
                    >
                      <div
                        style={{
                          padding: '4px 8px',
                          maxHeight: 180,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          textOverflow: isObj ? 'clip' : 'ellipsis',
                        }}
                      >
                        {display}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Remount local reader state at the viewer/subject boundary; a token refresh for
// the same user leaves the current inspection intact.
const ImagePage: React.FC = () => {
  const { user, loading } = useAuth();
  const { vehicleId, imageId } = useParams();
  if (loading) return <main className="evidence-detail"><p role="status">Checking access…</p></main>;
  return <ImagePageContent key={`${user?.id || 'public'}:${vehicleId}:${imageId}`} />;
};

export default ImagePage;
