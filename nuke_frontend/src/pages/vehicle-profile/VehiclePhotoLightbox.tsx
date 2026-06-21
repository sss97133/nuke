/**
 * VehiclePhotoLightbox — Instagram-grade mechanics, evidence-grade content.
 *
 * Full-bleed photo viewer for the vehicle profile. C10: the image IS the
 * document; beside it rides the evidence rail (taken-at, source, day link,
 * vehicle, extracted vision atoms) and the chain terminates at the original
 * storage object (shelf 3).
 *
 * Mechanics: instant (render-endpoint sizes + neighbor preload), ←/→ arrows,
 * ESC / click-out closes, URL-addressable via ?photo=<image_id> (replaceState
 * — opening/closing never touches scroll position).
 *
 * Open from anywhere inside the profile: openVehiclePhoto(imageId).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { useVehicleProfile } from './VehicleProfileContext';

const OPEN_EVENT = 'nuke:vehicle-photo-open';
const DAY_EVENT = 'nuke:vehicle-day-open';

/** Open the profile lightbox on a given vehicle_images.id. */
export function openVehiclePhoto(imageId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { imageId } }));
}

/** Open the profile lightbox by image URL (hero slots that only know the URL). */
export function openVehiclePhotoByUrl(imageUrl: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { imageUrl } }));
}

/** Ask the barcode timeline to open the day drawer for a date. */
export function openVehicleDay(date: string): void {
  window.dispatchEvent(new CustomEvent(DAY_EVENT, { detail: { date } }));
}

export const VEHICLE_DAY_OPEN_EVENT = DAY_EVENT;

interface PhotoRow {
  id: string;
  image_url: string;
  taken_at: string | null;
  source: string | null;
}

function renderUrl(url: string, width: number, quality = 80): string {
  const marker = '/storage/v1/object/public/';
  const idx = url.indexOf(marker);
  if (idx < 0) return url;
  return `${url.slice(0, idx)}/storage/v1/render/image/public/${url.slice(idx + marker.length).split('?')[0]}?width=${width}&quality=${quality}&resize=contain`;
}

function setPhotoParam(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('photo', id);
  else url.searchParams.delete('photo');
  window.history.replaceState(window.history.state, '', url.toString());
}

const SOURCE_LABELS: Record<string, string> = {
  user_upload: 'OWNER UPLOAD',
  owner_upload: 'OWNER UPLOAD',
  iphoto: 'OWNER ARCHIVE',
  ssd_blast: 'OWNER ARCHIVE',
  hd_archive: 'OWNER ARCHIVE',
  external_import: 'IMPORT',
  bat_import: 'BAT LISTING',
};

const mono: React.CSSProperties = { fontFamily: "'Courier New', Courier, monospace" };

const railLabel: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: '#888',
};

const railValue: React.CSSProperties = { ...mono, fontSize: 10, color: '#eee', lineHeight: 1.5 };

// Per-vehicle photo index cache (id-ordered by taken_at) for prev/next.
const photoIndexCache = new Map<string, PhotoRow[]>();
// Per-image vision atoms cache.
const atomsCache = new Map<string, Record<string, unknown> | null>();

const VehiclePhotoLightbox: React.FC = () => {
  const { vehicleId, vehicle } = useVehicleProfile();
  // target: how the viewer was opened — by id (normal) or by URL (hero slots).
  const [target, setTarget] = useState<{ id?: string; url?: string } | null>(null);
  const [rows, setRows] = useState<PhotoRow[] | null>(null);
  const [atoms, setAtoms] = useState<Record<string, unknown> | null>(null);
  const [fullLoaded, setFullLoaded] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // ── Open via custom event or ?photo= on mount ──
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.imageId) { setTarget({ id: String(d.imageId) }); setPhotoParam(String(d.imageId)); }
      else if (d.imageUrl) setTarget({ url: String(d.imageUrl) });
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    const param = new URLSearchParams(window.location.search).get('photo');
    if (param) setTarget({ id: param });
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    setPhotoParam(null);
  }, []);

  // Resolve URL-opens to an id once the index is available.
  const photoId = useMemo(() => {
    if (!target) return null;
    if (target.id) return target.id;
    if (target.url && rows) {
      const hit = rows.find(r => r.image_url === target.url);
      return hit ? hit.id : null;
    }
    return null;
  }, [target, rows]);

  // Keep ?photo= in sync once a URL-open resolves to an id.
  useEffect(() => {
    if (target?.url && photoId) setPhotoParam(photoId);
  }, [target, photoId]);

  // ── Photo index for the vehicle (one light query, cached) ──
  useEffect(() => {
    if (!target || !vehicleId || rows) return;
    const cached = photoIndexCache.get(vehicleId);
    if (cached) { setRows(cached); return; }
    let cancelled = false;
    supabase
      .from('vehicle_images')
      .select('id, image_url, taken_at, source')
      .eq('vehicle_id', vehicleId)
      .not('is_duplicate', 'is', true)
      .not('image_url', 'is', null)
      .order('taken_at', { ascending: true, nullsFirst: false })
      .limit(3000)
      .then(({ data, error }) => {
        if (cancelled || error || !Array.isArray(data)) return;
        photoIndexCache.set(vehicleId, data as PhotoRow[]);
        setRows(data as PhotoRow[]);
      });
    return () => { cancelled = true; };
  }, [target, vehicleId, rows]);

  // If the requested id isn't in the (REST-capped) index, fetch that single
  // row and merge it in — an id-open must never render an empty viewer.
  useEffect(() => {
    if (!rows || !target?.id || !vehicleId) return;
    if (rows.some(r => r.id === target.id)) return;
    let cancelled = false;
    supabase
      .from('vehicle_images')
      .select('id, image_url, taken_at, source')
      .eq('id', target.id)
      .maybeSingle()
      .then(({ data }: { data: PhotoRow | null }) => {
        if (cancelled || !data?.image_url) return;
        const merged = [...rows, data as PhotoRow].sort((a, b) =>
          String(a.taken_at || '9999').localeCompare(String(b.taken_at || '9999')));
        photoIndexCache.set(vehicleId, merged);
        setRows(merged);
      });
    return () => { cancelled = true; };
  }, [rows, target, vehicleId]);

  const index = useMemo(() => (rows && photoId ? rows.findIndex(r => r.id === photoId) : -1), [rows, photoId]);
  const current = index >= 0 && rows ? rows[index] : null;

  // ── Vision atoms for the current frame (cheap single-row query; omit when empty) ──
  useEffect(() => {
    if (!current) { setAtoms(null); return; }
    const cached = atomsCache.get(current.id);
    if (cached !== undefined) { setAtoms(cached); return; }
    let cancelled = false;
    setAtoms(null);
    supabase
      .from('vehicle_images')
      .select('ai_scan_metadata')
      .eq('id', current.id)
      .maybeSingle()
      .then(({ data }: { data: { ai_scan_metadata?: { byok_deep_analysis?: Record<string, unknown> } } | null }) => {
        if (cancelled) return;
        const byok = data?.ai_scan_metadata?.byok_deep_analysis || null;
        atomsCache.set(current.id, byok);
        setAtoms(byok);
      });
    return () => { cancelled = true; };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((dir: -1 | 1) => {
    if (!rows || index < 0) return;
    const next = rows[index + dir];
    if (next) { setTarget({ id: next.id }); setPhotoParam(next.id); setFullLoaded(false); }
  }, [rows, index]);

  // ── Keyboard: ESC closes, arrows navigate ──
  useEffect(() => {
    if (!target) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [target, close, go]);

  // ── Preload neighbors so arrows feel instant ──
  useEffect(() => {
    if (!rows || index < 0) return;
    for (const n of [rows[index - 1], rows[index + 1]]) {
      if (n?.image_url) { const img = new Image(); img.src = renderUrl(n.image_url, 1260); }
    }
  }, [rows, index]);

  useEffect(() => { setFullLoaded(false); }, [photoId]);

  if (!target) return null;
  // URL-opens that don't resolve to an index row still get a viewer on the
  // raw URL (minimal rail) — never a dead click.
  const stageUrl = (index >= 0 && rows ? rows[index].image_url : null) || target.url || null;
  if (!stageUrl) return null;

  // Day membership (for the "PART OF" link) from the cached index.
  const dayStr = current?.taken_at ? String(current.taken_at).slice(0, 10) : null;
  const dayCount = dayStr && rows ? rows.filter(r => String(r.taken_at || '').slice(0, 10) === dayStr).length : 0;
  const takenLabel = current?.taken_at
    ? new Date(current.taken_at).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const sourceLabel = current?.source ? (SOURCE_LABELS[current.source] || String(current.source).toUpperCase().replace(/_/g, ' ')) : null;
  const v = vehicle as { year?: number; make?: string; model?: string } | null;
  const vehicleLabel = [v?.year, v?.make, v?.model].filter(Boolean).join(' ');
  const atomEntries: Array<[string, string]> = [];
  if (atoms) {
    for (const k of ['scene_type', 'build_phase_guess', 'work_activity', 'subject', 'notable_details']) {
      const val = (atoms as Record<string, unknown>)[k];
      if (typeof val === 'string' && val.trim()) atomEntries.push([k.replace(/_/g, ' ').toUpperCase(), val.trim()]);
    }
  }

  return createPortal(
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) close(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      style={{
        position: 'fixed', inset: 0, zIndex: 10050,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'row',
      }}
    >
      {/* Stage */}
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        {/* instant low-res layer */}
        {!fullLoaded && (
          <img
            src={renderUrl(stageUrl, 64, 40)}
            alt="" aria-hidden
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', filter: 'blur(8px)', pointerEvents: 'none' }}
          />
        )}
        <img
          key={photoId || stageUrl}
          src={renderUrl(stageUrl, 1260)}
          alt=""
          onLoad={() => setFullLoaded(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
        />
        {/* Prev / Next */}
        {rows && index > 0 && (
          <button onClick={() => go(-1)} aria-label="Previous photo"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, background: 'rgba(0,0,0,0.55)', color: '#fff', border: '2px solid rgba(255,255,255,0.2)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {'<'}
          </button>
        )}
        {rows && index >= 0 && index < rows.length - 1 && (
          <button onClick={() => go(1)} aria-label="Next photo"
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, background: 'rgba(0,0,0,0.55)', color: '#fff', border: '2px solid rgba(255,255,255,0.2)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {'>'}
          </button>
        )}
        {/* Counter */}
        {rows && index >= 0 && (
          <div style={{ ...mono, position: 'absolute', top: 10, left: 10, fontSize: 9, color: '#bbb', background: 'rgba(0,0,0,0.55)', padding: '2px 6px' }}>
            {index + 1} / {rows.length}
          </div>
        )}
        <button onClick={close} aria-label="Close photo viewer"
          style={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, background: 'rgba(0,0,0,0.55)', color: '#fff', border: '2px solid rgba(255,255,255,0.2)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          ✕
        </button>
      </div>

      {/* Evidence rail */}
      <div style={{
        width: 240, flexShrink: 0, borderLeft: '2px solid #333',
        background: '#111', padding: '14px 12px', overflowY: 'auto',
        display: window.innerWidth < 700 ? 'none' : 'block',
      }}>
        {takenLabel && (
          <div style={{ marginBottom: 10 }}>
            <div style={railLabel}>TAKEN</div>
            <div style={railValue}>{takenLabel}</div>
          </div>
        )}
        {sourceLabel && (
          <div style={{ marginBottom: 10 }}>
            <div style={railLabel}>SOURCE</div>
            <div style={railValue}>{sourceLabel}</div>
          </div>
        )}
        {dayStr && dayCount > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={railLabel}>PART OF</div>
            <button
              onClick={() => { close(); openVehicleDay(dayStr); }}
              style={{ ...railValue, background: 'none', border: 'none', borderBottom: '1px solid #555', cursor: 'pointer', padding: 0, textAlign: 'left' }}
            >
              {dayStr} — {dayCount} PHOTO{dayCount === 1 ? '' : 'S'}
            </button>
          </div>
        )}
        {vehicleLabel && (
          <div style={{ marginBottom: 10 }}>
            <div style={railLabel}>VEHICLE</div>
            <div style={railValue}>{vehicleLabel.toUpperCase()}</div>
          </div>
        )}
        {atomEntries.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={railLabel}>VISION ATOMS</div>
            {atomEntries.map(([k, val]) => (
              <div key={k} style={{ marginTop: 4 }}>
                <div style={{ ...railLabel, fontSize: 7, color: '#666' }}>{k}</div>
                <div style={{ ...railValue, fontSize: 9 }}>{val}</div>
              </div>
            ))}
          </div>
        )}
        {stageUrl && (
          <div style={{ marginTop: 14 }}>
            <a
              href={stageUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...railLabel, color: '#bbb', textDecoration: 'none', border: '1px solid #444', padding: '3px 6px', display: 'inline-block' }}
            >
              ORIGINAL ↗
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default VehiclePhotoLightbox;
