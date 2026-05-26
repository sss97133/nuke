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

const FEATURED_VEHICLE_ID = 'e04bf9c5-b488-433b-be9a-3d307861d90b';

interface VehicleRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  primary_image_url: string | null;
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
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [vehicleRes, imagesRes, obsRes, allObsRes] = await Promise.all([
          supabase.from('vehicles').select('id, year, make, model, vin, primary_image_url').eq('id', vehicleId).maybeSingle(),
          supabase.from('vehicle_images').select('id, image_url, taken_at, created_at')
            .eq('vehicle_id', vehicleId)
            .eq('is_duplicate', false)
            .eq('is_document', false)
            .order('taken_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false })
            .limit(48),
          supabase.from('vehicle_observations').select('id, kind, observed_at, content_text, source_url')
            .eq('vehicle_id', vehicleId)
            .eq('is_superseded', false)
            .order('observed_at', { ascending: false, nullsFirst: false })
            .limit(40),
          supabase.from('vehicle_observations').select('kind, observed_at', { count: 'exact' })
            .eq('vehicle_id', vehicleId)
            .eq('is_superseded', false)
            .limit(2000),
        ]);

        if (cancelled) return;
        if (vehicleRes.error) throw vehicleRes.error;
        if (!vehicleRes.data) throw new Error('Vehicle not found');

        setVehicle(vehicleRes.data as VehicleRow);
        setImages((imagesRes.data || []) as ImageRow[]);
        setObservations((obsRes.data || []) as ObservationRow[]);

        const allObs = (allObsRes.data || []) as { kind: string; observed_at: string | null }[];
        const byKind: Record<string, number> = {};
        let first: string | null = null;
        let last: string | null = null;
        for (const r of allObs) {
          byKind[r.kind] = (byKind[r.kind] || 0) + 1;
          if (r.observed_at) {
            if (!first || r.observed_at < first) first = r.observed_at;
            if (!last || r.observed_at > last) last = r.observed_at;
          }
        }

        const [{ count: imageCount }, { count: eventCount }] = await Promise.all([
          supabase.from('vehicle_images').select('id', { count: 'exact', head: true })
            .eq('vehicle_id', vehicleId).eq('is_duplicate', false).eq('is_document', false),
          supabase.from('vehicle_events').select('id', { count: 'exact', head: true })
            .eq('vehicle_id', vehicleId),
        ]);

        setStats({
          total_observations: allObsRes.count ?? allObs.length,
          total_images: imageCount ?? 0,
          total_events: eventCount ?? 0,
          by_kind: byKind,
          first_observed: first,
          last_observed: last,
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

  const heroUrl = images[0]?.image_url || vehicle?.primary_image_url || null;

  const monthGroups = useMemo(() => {
    const groups: Record<string, ObservationRow[]> = {};
    for (const o of observations) {
      const key = o.observed_at ? o.observed_at.slice(0, 7) : '----';
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [observations]);

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, borderBottom: '2px solid #222' }}>
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
        <div style={{ padding: '32px', borderBottom: '2px solid #222' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase' }}>
              Photo Record · {stats?.total_images?.toLocaleString()} total · showing latest {images.length}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {images.map(img => (
              <div key={img.id} style={{ aspectRatio: '4/3', background: '#111', border: '2px solid #1a1a1a', overflow: 'hidden', position: 'relative' }}>
                <img src={img.image_url} alt="" width={400} height={300}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
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
      {monthGroups.length > 0 && (
        <div style={{ padding: '32px', borderBottom: '2px solid #222' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase', marginBottom: 16 }}>
            Recent Testimony · last {observations.length} observations
          </div>
          {monthGroups.map(([month, rows]) => (
            <div key={month} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontFamily: MONO_FONT, color: '#666', marginBottom: 8, borderBottom: '1px solid #1a1a1a', paddingBottom: 4 }}>
                {month === '----' ? 'UNDATED' : month}
              </div>
              {rows.map(o => (
                <div key={o.id} style={{ padding: '8px 0', borderBottom: '1px solid #151515', display: 'grid', gridTemplateColumns: '90px 140px 1fr', gap: 12, alignItems: 'baseline' }}>
                  <div style={{ fontSize: 10, fontFamily: MONO_FONT, color: '#888' }}>{fmtDate(o.observed_at)}</div>
                  <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#fa3', textTransform: 'uppercase' }}>{o.kind}</div>
                  <div style={{ fontSize: 11, color: '#ccc', lineHeight: 1.4 }}>
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
    <div style={{ padding: '20px 24px', borderRight: '2px solid #222' }}>
      <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: MONO_FONT, color: '#fff', marginTop: 6, lineHeight: 1 }}>{value}</div>
    </div>
  );
}
