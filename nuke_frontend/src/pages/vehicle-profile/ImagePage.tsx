/**
 * ImagePage.tsx
 *
 * The image as a first-class navigable resource. Mounted at
 * /vehicle/:vehicleId/image/:imageId. Closes the click-through chain:
 * timeline cell → day → observation → image → back to every observation
 * that shares this image as evidence.
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

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

const ImagePage: React.FC = () => {
  const { vehicleId, imageId } = useParams<{ vehicleId: string; imageId: string }>();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [imageRow, setImage] = useState<ImageRow | null>(null);
  const [loadedSubject, setLoadedSubject] = useState<string | null>(null);
  const [witnessed, setWitnessed] = useState<WitnessedObservation[]>([]);
  const [attribution, setAttribution] = useState<DeviceAttribution | null>(null);
  const [attributionUnavailable, setAttributionUnavailable] = useState(false);
  const [substrate, setSubstrate] = useState<SubstrateBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    setAttributionUnavailable(false);
    setSubstrate(null);

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
        setImage(imgRes.data as ImageRow);
        setLoadedSubject(`${vehicleId}:${imageId}`);

        // Dependent reads only follow a visible, correctly bound image.
        const [witRes, attribRes] = await Promise.all([
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
        if (!cancelled && attribRes?.data) setAttribution(attribRes.data as DeviceAttribution);

        if (cancelled) return;
        setAttributionUnavailable(!!attribRes.error);

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
          supabase.from('vehicle_images').select('*').eq('id', imageId).eq('vehicle_id', vehicleId).limit(1).abortSignal(controller.signal),
          supabase.from('vehicles').select('*').eq('id', vehicleId).limit(1).abortSignal(controller.signal),
          supabase.from('observation_witnesses').select('*').eq('image_id', imageId).limit(200).abortSignal(controller.signal),
        ]);

        if (cancelled) return;
        const witnessRows = ((witFullRes.data || []) as Row[]).filter(row => row.image_id === imageId);
        const unavailableRelations = [
          ['vehicle_images', imgFullRes], ['vehicles', vehFullRes], ['observation_witnesses', witFullRes],
        ].filter(([, result]) => (result as { error?: unknown }).error).map(([name]) => name as string);
        const obsIds = Array.from(new Set(witnessRows.map((r) => r.observation_id).filter(Boolean))) as string[];

        let obsRows: Row[] = [];
        let discoveryRows: Row[] = [];
        let sourceRows: Row[] = [];
        if (obsIds.length > 0) {
          const obsRes = await supabase.from('vehicle_observations').select('*').in('id', obsIds).limit(200).abortSignal(controller.signal);
          if (obsRes.error) unavailableRelations.push('vehicle_observations');
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
            vehicles: (vehFullRes.data || []) as Row[],
          });
        }

      } catch (failure) {
        if (!cancelled) {
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
  }, [vehicleId, imageId]);

  const vehLabel = vehicle?.id === vehicleId
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  // Use the raw image_url. The Supabase render endpoint with only width set
  // defaults to resize=cover and produces distorted/cropped output on portrait
  // iPhone captures. For a single-image detail view, bandwidth is acceptable.
  const renderSrc = image?.image_url || null;

  return (
    <div
      style={{
        padding: '12px 12px 24px',
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
        <span style={{ color: 'var(--text, #1a1a1a)' }}>Image</span>
        {image?.vision_gate_status && (
          <span style={{ border: '2px solid var(--text, #1a1a1a)', padding: '1px 5px' }}>
            {image.vision_gate_status}
          </span>
        )}
        {image?.source && (
          <span style={{ fontFamily: 'Courier New, monospace', textTransform: 'none', letterSpacing: 0 }}>
            {image.source}
          </span>
        )}
        {image?.is_primary && (
          <span style={{ border: '1px solid var(--success, #0a7)', color: 'var(--success, #0a7)', padding: '1px 4px' }}>
            Primary
          </span>
        )}
      </nav>

      {loading && !image && (
        <div role="status" style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading image…</div>
      )}

      {error && (
        <div role="alert" style={{ fontSize: 10, color: 'var(--error, #c00)', padding: 12, border: '2px solid var(--error, #c00)' }}>
          {error}
        </div>
      )}

      {image && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 480px) 1fr',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* LEFT: image pane, sticky so substrate scrolls beside it */}
          <aside
            style={{
              position: 'sticky',
              top: 12,
              alignSelf: 'start',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {renderSrc && (
              <a
                href={image.image_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', border: '2px solid var(--text, #1a1a1a)', lineHeight: 0 }}
              >
                <img
                  src={renderSrc}
                  alt={image.caption || image.file_name || 'Vehicle image'}
                  decoding="async"
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
            {image.vision_gate_agent_reasoning && (
              <div style={{ fontSize: 10, fontFamily: 'Arial, sans-serif', lineHeight: 1.4, color: 'var(--text, #1a1a1a)' }}>
                {image.vision_gate_agent_reasoning}
              </div>
            )}
            <div style={{ fontSize: 9, fontFamily: 'Courier New, monospace', lineHeight: 1.5, color: 'var(--text-secondary, #666)' }}>
              <div>id · {image.id}</div>
              {image.file_name && <div>file · {image.file_name}</div>}
              {image.taken_at && <div>taken · {image.taken_at.slice(0, 19).replace('T', ' ')}</div>}
              {image.created_at && <div>created · {image.created_at.slice(0, 19).replace('T', ' ')}</div>}
            </div>

            {/* Chain of Custody — sourced from device_attributions */}
            <div style={{ border: '2px solid var(--text, #1a1a1a)', padding: '6px 8px' }}>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'Arial, sans-serif', borderBottom: '2px solid var(--text, #1a1a1a)', paddingBottom: 2, marginBottom: 4 }}>
                Device metadata
              </div>
              {attributionUnavailable && <div style={{ fontSize: 9 }}>Device metadata unavailable.</div>}
              {attribution ? (
                <div style={{ fontSize: 9, fontFamily: 'Courier New, monospace', lineHeight: 1.5, color: 'var(--text, #1a1a1a)' }}>
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
                <div style={{ fontSize: 9, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary, #666)' }}>
                  <div>unauthenticated · no EXIF identity captured</div>
                  {image.source && <div>source · {image.source}</div>}
                </div>
              )}
            </div>
          </aside>

          {/* RIGHT: substrate pane */}
          <div style={{ minWidth: 0 }}>
          {witnessed.length > 0 && (
            <section style={{ marginBottom: 16 }}>
              <h2
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  margin: '0 0 4px',
                  paddingBottom: 2,
                  borderBottom: '2px solid var(--text, #1a1a1a)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                Recorded vehicle observation links · {witnessed.length}
              </h2>
              <div style={{ fontSize: 9, marginBottom: 4 }}>One observation can have several source roles. Independent support remains unassessed.</div>
              <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
                {witnessed.map((w, i) => (
                  <Link
                    key={`${w.id}:${w.witness_role}`}
                    to={`/vehicle/${w.vehicle_id}/observation/${w.id}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '92px 80px 110px 1fr 80px',
                      gap: 8,
                      padding: '6px 8px',
                      fontFamily: 'Arial, sans-serif',
                      fontSize: 10,
                      color: 'var(--text, #1a1a1a)',
                      textDecoration: 'none',
                      borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9, color: 'var(--text-secondary)' }}>
                      {w.observed_at ? w.observed_at.slice(0, 10) : '—'}
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
                      {w.kind}
                    </span>
                    <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10 }}>
                      {w.part_number || w.vendor || ''}
                    </span>
                    <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {w.content_text || '—'}
                    </span>
                    <span style={{ fontSize: 8, color: 'var(--text-secondary, #666)', textAlign: 'right' }}>
                      {w.witness_role}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {substrate && (
            <section style={{ marginTop: 32 }}>
              <h2
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  margin: '0 0 4px',
                  paddingBottom: 2,
                  borderBottom: '2px solid var(--text, #1a1a1a)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                Substrate · raw database rows touching this image
              </h2>
              <div
                style={{
                  fontSize: 9,
                  fontFamily: 'Courier New, monospace',
                  color: 'var(--text-secondary, #666)',
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
          border: '2px solid var(--text, #1a1a1a)',
          padding: 8,
          fontFamily: 'Courier New, monospace',
          fontSize: 9,
          color: 'var(--text-secondary, #666)',
        }}
      >
        <div style={{ fontWeight: 700, color: 'var(--text, #1a1a1a)' }}>{name}</div>
        <div>{unavailable ? 'Read unavailable' : '0 rows returned'}</div>
      </div>
    );
  }

  const cols = Array.from(rows.reduce<Set<string>>((acc, r) => {
    Object.keys(r).forEach((k) => acc.add(k));
    return acc;
  }, new Set<string>()));

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontFamily: 'Courier New, monospace',
          fontSize: 10,
          fontWeight: 700,
          marginBottom: 2,
        }}
      >
        {name} · {rows.length} row{rows.length === 1 ? '' : 's'}
      </div>
      <div style={{ overflowX: 'auto', border: '2px solid var(--text, #1a1a1a)' }}>
        <table
          style={{
            borderCollapse: 'collapse',
            fontFamily: 'Courier New, monospace',
            fontSize: 9,
            minWidth: '100%',
          }}
        >
          <thead>
            <tr style={{ background: 'var(--text, #1a1a1a)', color: 'var(--bg, #fff)' }}>
              {cols.map((c) => (
                <th
                  key={c}
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--bg, #fff)',
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
                        color: v === null || v === undefined ? 'var(--text-secondary, #999)' : 'var(--text, #1a1a1a)',
                        fontStyle: v === null || v === undefined ? 'italic' : 'normal',
                      }}
                      title={isObj ? undefined : display}
                    >
                      <div
                        style={{
                          padding: '4px 8px',
                          maxHeight: 180,
                          overflow: isObj ? 'auto' : 'hidden',
                          whiteSpace: isObj ? 'pre' : 'nowrap',
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

export default ImagePage;
