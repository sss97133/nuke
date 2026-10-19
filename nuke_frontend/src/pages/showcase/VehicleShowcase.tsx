/**
 * VehicleShowcase — single-vehicle public lineage demo.
 *
 * Renders one canonical chassis as a complete testimony graph: hero photo,
 * stats bar, photo grid, observation timeline grouped by month, observation
 * kind breakdown. Read-only, public, fast.
 *
 * Routes:
 *   /showcase            → default featured vehicle (K5)
 *   /showcase/:vehicleId → arbitrary vehicle by UUID
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { evidenceSpan, parseTestimonySummary, splitTestimony } from './showcaseTestimony';
import './VehicleShowcase.css';

// The owner's K5 (VIN CKR187F127263). e04bf9c5 is a different, GAA-listed 2WD 1977 Blazer that once held misfiled
// archive photos (docs/wiring/receipts/2026-06-11_k5-doppelganger-reattribution.md); it is not this truck.
const FEATURED_VEHICLE_ID = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

interface VehicleRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
}

interface ImageRow {
  id: string;
  image_url: string;
  taken_at: string | null;
  created_at: string;
}

interface ObservationRow {
  id: string;
  kind: string;
  observed_at: string | null;
  content_text: string | null;
  source_url: string | null;
  image_id?: string | null;
}

interface Stats {
  total_observations: number;
  total_images: number;
  total_events: number;
  by_kind: Record<string, number>;
  first_observed: string | null;
  last_observed: string | null;
}

const TYPE_FONT = "'Arial', sans-serif";
const MONO_FONT = "'Courier New', monospace";

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

function yearSpan(first: string | null, last: string | null): string {
  if (!first || !last) return '—';
  const f = new Date(first).getFullYear();
  const l = new Date(last).getFullYear();
  if (f === l) return `${f}`;
  return `${f}–${l}`;
}

export default function VehicleShowcase() {
  const params = useParams<{ vehicleId?: string }>();
  const vehicleId = params.vehicleId || FEATURED_VEHICLE_ID;

  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [primaryUrl, setPrimaryUrl] = useState<string | null>(null);
  const [visibleImageIds, setVisibleImageIds] = useState<ReadonlySet<string>>(new Set());
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [vehicleRes, imagesRes, obsRes, summaryRes, primaryRes] = await Promise.all([
          supabase.from('vehicles').select('id, year, make, model, vin').eq('id', vehicleId).maybeSingle(),
          supabase.from('vehicle_images').select('id, image_url, taken_at, created_at')
            .eq('vehicle_id', vehicleId)
            .eq('is_duplicate', false)
            .eq('is_document', false)
            .order('taken_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false })
            .limit(48),
          supabase.from('vehicle_observations').select('id, kind, observed_at, content_text, source_url, image_id:structured_data->>image_id')
            .eq('vehicle_id', vehicleId)
            .eq('is_superseded', false)
            .order('observed_at', { ascending: false, nullsFirst: false })
            .limit(40),
          // Counts by kind and the first/last observed, as this viewer may read them: one value, no row cap.
          supabase.rpc('vehicle_testimony_summary', { p_vehicle_id: vehicleId }),
          // The primary photo through the viewer's own read, so the gate decides (never vehicles.primary_image_url,
          // a storage URL that routes around it).
          supabase.from('vehicle_images').select('image_url').eq('vehicle_id', vehicleId).eq('is_primary', true).limit(1),
        ]);

        if (cancelled) return;
        if (vehicleRes.error) throw vehicleRes.error;
        if (!vehicleRes.data) throw new Error('Vehicle not found');

        setVehicle(vehicleRes.data as VehicleRow);
        setImages((imagesRes.data || []) as ImageRow[]);
        setPrimaryUrl(((primaryRes.data || []) as { image_url: string }[])[0]?.image_url ?? null);
        const obsRows = (obsRes.data || []) as ObservationRow[];
        setObservations(obsRows);
        // Which of the media observations' frames this viewer may see: their own read of vehicle_images, gate applied.
        const imageIds = [...new Set(obsRows.filter(o => o.kind === 'media' && o.image_id).map(o => o.image_id as string))];
        const { data: readable } = imageIds.length
          ? await supabase.from('vehicle_images').select('id').in('id', imageIds)
          : { data: [] as { id: string }[] };
        if (cancelled) return;
        setVisibleImageIds(new Set(((readable || []) as { id: string }[]).map(r => r.id)));

        const summary = summaryRes.error ? null : parseTestimonySummary(summaryRes.data);

        const [{ count: imageCount }, { count: eventCount }, { data: earliestPhoto }, { count: obsCount }] = await Promise.all([
          supabase.from('vehicle_images').select('id', { count: 'exact', head: true })
            .eq('vehicle_id', vehicleId).eq('is_duplicate', false).eq('is_document', false)
            .not('is_superseded', 'is', true),
          supabase.from('vehicle_events').select('id', { count: 'exact', head: true })
            .eq('vehicle_id', vehicleId),
          supabase.from('vehicle_images').select('taken_at')
            .eq('vehicle_id', vehicleId).eq('is_duplicate', false).eq('is_document', false)
            .not('taken_at', 'is', null).order('taken_at', { ascending: true }).limit(1),
          // Without the summary, still count the observations (the breakdown is then left out).
          summary ? Promise.resolve({ count: summary.total }) : supabase.from('vehicle_observations')
            .select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId).eq('is_superseded', false),
        ]);
        // The record spans its photos' capture times as well as its observation clocks.
        const latestPhoto = ((imagesRes.data || []) as ImageRow[]).find(i => i.taken_at)?.taken_at ?? null;
        const span = evidenceSpan(summary?.first ?? null, summary?.last ?? null, (earliestPhoto as { taken_at: string | null }[] | null)?.[0]?.taken_at, latestPhoto);

        setStats({
          total_observations: obsCount ?? 0,
          total_images: imageCount ?? 0,
          total_events: eventCount ?? 0,
          by_kind: summary?.byKind ?? {},
          first_observed: span.first,
          last_observed: span.last,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [vehicleId]);

  const title = useMemo(() => {
    if (!vehicle) return 'Loading…';
    return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  }, [vehicle]);

  // Resized through the image endpoint: originals run to 3 MB, and HEIC originals do not draw in most browsers.
  const heroUrl = optimizeImageUrl(primaryUrl || images[0]?.image_url || null, 'large');

  const testimony = useMemo(() => splitTestimony(observations, visibleImageIds), [observations, visibleImageIds]);

  const monthGroups = useMemo(() => {
    const groups: Record<string, ObservationRow[]> = {};
    for (const o of testimony.listed) {
      const key = o.observed_at ? o.observed_at.slice(0, 7) : '----';
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [testimony]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#888', fontFamily: TYPE_FONT, padding: 48, fontSize: 11 }}>
        LOADING SHOWCASE…
      </div>
    );
  }
  if (error || !vehicle) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f88', fontFamily: TYPE_FONT, padding: 48, fontSize: 11 }}>
        ERROR: {error || 'no vehicle'}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#eee', fontFamily: TYPE_FONT, padding: '0 0 48px 0' }}>
      {/* Hero */}
      <div style={{ width: '100%', aspectRatio: '16/9', maxHeight: '70vh', background: '#000', overflow: 'hidden', position: 'relative', borderBottom: '2px solid #222' }}>
        {heroUrl && (
          <img src={heroUrl} alt={title} width={1920} height={1080}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="eager" />
        )}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 32px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase', marginBottom: 8 }}>
            Nuke Showcase · Single Chassis Lineage
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>{title}</div>
          {vehicle.vin && (
            <div style={{ fontSize: 11, color: '#aaa', fontFamily: MONO_FONT, marginTop: 6 }}>VIN {vehicle.vin}</div>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="showcase-stats">
          <Stat label="Observations" value={stats.total_observations.toLocaleString()} />
          <Stat label="Images" value={stats.total_images.toLocaleString()} />
          <Stat label="Auction Events" value={stats.total_events.toLocaleString()} />
          <Stat label="Years Observed" value={yearSpan(stats.first_observed, stats.last_observed)} />
        </div>
      )}

      {/* Kind breakdown */}
      {stats && Object.keys(stats.by_kind).length > 0 && (
        <div style={{ padding: '32px 32px 16px 32px', borderBottom: '2px solid #222' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase', marginBottom: 16 }}>
            Testimony Breakdown
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {Object.entries(stats.by_kind).sort((a, b) => b[1] - a[1]).map(([kind, n]) => (
              <div key={kind} style={{ padding: '10px 14px', border: '2px solid #2a2a2a', minWidth: 120 }}>
                <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{kind}</div>
                <div style={{ fontSize: 20, fontFamily: MONO_FONT, color: '#fff', marginTop: 4 }}>{n.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Photo grid */}
      {images.length > 0 && (
        <div className="showcase-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase' }}>
              Photo Record · {stats?.total_images?.toLocaleString()} total · showing latest {images.length}
            </div>
          </div>
          <div className="showcase-grid">
            {images.map(img => (
              <div key={img.id} style={{ aspectRatio: '4/3', background: '#111', border: '2px solid #1a1a1a', overflow: 'hidden', position: 'relative' }}>
                <img src={optimizeImageUrl(img.image_url, 'medium') ?? img.image_url} alt="" width={400} height={300}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy"
                  onError={e => { (e.currentTarget.parentElement as HTMLElement).hidden = true; }} />
                {img.taken_at && (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 8px',
                    fontSize: 8, fontFamily: MONO_FONT, color: '#bbb', background: 'rgba(0,0,0,0.7)', letterSpacing: '0.05em' }}>
                    {fmtDate(img.taken_at)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Observation timeline */}
      {observations.length > 0 && (
        <div className="showcase-section">
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase', marginBottom: 16 }}>
            Recent Testimony · last {observations.length} observations
          </div>
          {testimony.photos && (
            <div className="showcase-photo-row">
              <div className="showcase-photo-row__date">
                {fmtDate(testimony.photos.first) === fmtDate(testimony.photos.last)
                  ? fmtDate(testimony.photos.last) : `${fmtDate(testimony.photos.first)} – ${fmtDate(testimony.photos.last)}`}
              </div>
              <div className="showcase-photo-row__kind">media</div>
              <div>
                <div className="showcase-photo-row__line">
                  {testimony.photos.count.toLocaleString()} photos
                  {testimony.photos.shown < testimony.photos.count && ` · ${(testimony.photos.count - testimony.photos.shown).toLocaleString()} not public`}
                </div>
                <div className="showcase-photo-row__thumbs">
                  {testimony.photos.photos.map(p => (
                    <a key={p.id} className="showcase-photo-row__thumb" href={p.url} target="_blank" rel="noopener noreferrer">
                      <img src={optimizeImageUrl(p.url, 'small') ?? p.url} alt="" width={96} height={72} loading="lazy"
                        onError={e => { (e.currentTarget.parentElement as HTMLElement).hidden = true; }} />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}
          {monthGroups.map(([month, rows]) => (
            <div key={month} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontFamily: MONO_FONT, color: '#666', marginBottom: 8, borderBottom: '1px solid #1a1a1a', paddingBottom: 4 }}>
                {month === '----' ? 'UNDATED' : month}
              </div>
              {rows.map(o => (
                <div key={o.id} className="showcase-obs-row">
                  <div style={{ fontSize: 10, fontFamily: MONO_FONT, color: '#888' }}>{fmtDate(o.observed_at)}</div>
                  <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#fa3', textTransform: 'uppercase' }}>{o.kind}</div>
                  <div className="showcase-obs-row__text" style={{ fontSize: 11, color: '#ccc', lineHeight: 1.4 }}>
                    {o.content_text ? o.content_text.slice(0, 280) : <span style={{ color: '#555' }}>(structured)</span>}
                    {o.source_url && (
                      <span style={{ marginLeft: 8 }}>
                        <a href={o.source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#5af', fontSize: 9, textDecoration: 'none' }}>
                          [SOURCE]
                        </a>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: 32, color: '#666', fontSize: 10 }}>
        <div style={{ marginBottom: 8 }}>
          This page renders <span style={{ color: '#fa3' }}>{stats?.total_observations.toLocaleString() || '—'}</span> observations
          across <span style={{ color: '#fa3' }}>{stats ? yearSpan(stats.first_observed, stats.last_observed) : '—'}</span> on a single chassis.
        </div>
        <div style={{ fontSize: 9, color: '#444' }}>
          Vehicle is the entity. Every photo, every record, every comment is testimony from a source, at a time, with a trust level.
          Nothing is overwritten. {' '}
          <Link to="/atlas" style={{ color: '#5af', textDecoration: 'none' }}>See the full atlas →</Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="showcase-stat">
      <div className="showcase-stat__label">{label}</div>
      <div className="showcase-stat__value">{value}</div>
    </div>
  );
}
