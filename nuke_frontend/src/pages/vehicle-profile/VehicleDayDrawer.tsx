/**
 * VehicleDayDrawer — the complete day document for one vehicle-day.
 *
 * C10 depth contract: clicking a day answers "what happened that day"
 * completely, in place — every photo (square thumbs, lazy), first/last/span,
 * the work-session story, dollar lines, and a deep link to /journal/:date.
 * Reuses the user-profile day-receipt drawer pattern (UserBarcodeTimeline):
 * inline below the grid, additive, reversible (ESC / click-out / ✕).
 *
 * Data: photos come from one indexed vehicle_images query (day window on
 * taken_at — same attribution as get_vehicle_contribution_days); the work
 * story and event lines come from context timelineEvents (already loaded
 * via the security-definer profile RPC) so the drawer adds exactly ONE
 * cheap query per day viewed.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useVehicleProfile } from './VehicleProfileContext';
import { openVehiclePhoto } from './VehiclePhotoLightbox';

interface DayPhoto {
  id: string;
  image_url: string;
  taken_at: string | null;
}

/** Minimal shape of context timeline events the drawer reads. */
interface DayEvent {
  id?: string;
  event_date?: string | null;
  event_type?: string | null;
  title?: string | null;
  cost_amount?: number | null;
  metadata?: {
    duration_minutes?: number | null;
    work_type?: string | null;
    work_description?: string | null;
    synthetic_day?: boolean;
  } | null;
}

interface VehicleDayDrawerProps {
  date: string; // YYYY-MM-DD
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

/** Supabase render-endpoint thumbnail (resize=contain per platform rule). */
function renderThumb(url: string, width = 200): string {
  const marker = '/storage/v1/object/public/';
  const idx = url.indexOf(marker);
  if (idx < 0) return url;
  return `${url.slice(0, idx)}/storage/v1/render/image/public/${url.slice(idx + marker.length).split('?')[0]}?width=${width}&quality=70&resize=contain`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtSpan(first: string | null, last: string | null): string {
  if (!first || !last) return '';
  const a = new Date(first).getTime();
  const b = new Date(last).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return '';
  const mins = Math.round((b - a) / 60000);
  if (mins < 1) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}H ${m}M SPAN` : `${m}M SPAN`;
}

function fmtMoney(n: number | null | undefined): string {
  const v = Number(n || 0);
  if (!v) return '';
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtDayHeader(date: string): string {
  const d = new Date(date + 'T12:00:00');
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase();
}

const mono: React.CSSProperties = { fontFamily: "var(--vp-font-mono, 'Courier New', monospace)" };

// Session-scoped photo cache so re-opening a day never refetches.
const dayPhotoCache = new Map<string, DayPhoto[]>();

const VehicleDayDrawer: React.FC<VehicleDayDrawerProps> = ({ date, onClose, onPrev, onNext }) => {
  const { vehicleId, timelineEvents } = useVehicleProfile();
  const [photos, setPhotos] = useState<DayPhoto[] | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // ── Photos of the day (one query, cached) ──
  useEffect(() => {
    if (!vehicleId || !date) return;
    const key = `${vehicleId}|${date}`;
    const cached = dayPhotoCache.get(key);
    if (cached) { setPhotos(cached); return; }
    let cancelled = false;
    setPhotos(null);
    supabase
      .from('vehicle_images')
      .select('id, image_url, taken_at')
      .eq('vehicle_id', vehicleId)
      .gte('taken_at', `${date}T00:00:00Z`)
      .lt('taken_at', `${date}T23:59:59.999Z`)
      .not('is_duplicate', 'is', true)
      .order('taken_at', { ascending: true })
      .limit(120)
      .then(({ data, error }) => {
        if (cancelled) return;
        const rows = (!error && Array.isArray(data)) ? (data as DayPhoto[]).filter(p => p.image_url) : [];
        dayPhotoCache.set(key, rows);
        setPhotos(rows);
      });
    return () => { cancelled = true; };
  }, [vehicleId, date]);

  // ── Day events from the already-loaded timeline ──
  const dayEvents = useMemo(
    () => ((timelineEvents || []) as DayEvent[]).filter((ev) => String(ev.event_date || '').slice(0, 10) === date),
    [timelineEvents, date],
  );
  const workEvents = useMemo(
    () => dayEvents.filter((ev) => String(ev.event_type || '') === 'work_session' && !ev.metadata?.synthetic_day),
    [dayEvents],
  );
  const otherEvents = useMemo(
    () => dayEvents.filter((ev) => !['work_session', 'photo_session'].includes(String(ev.event_type || ''))),
    [dayEvents],
  );

  const first = photos && photos.length > 0 ? photos[0].taken_at : null;
  const last = photos && photos.length > 0 ? photos[photos.length - 1].taken_at : null;
  const span = fmtSpan(first, last);
  const dayTotal = workEvents.reduce((sum, ev) => sum + (Number(ev.cost_amount) || 0), 0);

  const loading = photos === null;
  const isEmpty = !loading && photos.length === 0 && workEvents.length === 0 && otherEvents.length === 0;

  return (
    <div
      ref={drawerRef}
      data-day-drawer
      style={{
        borderTop: '2px solid var(--vp-ink, #1a1a1a)',
        background: 'var(--vp-surface, #fff)',
        padding: '8px 12px 10px',
        maxHeight: '46vh',
        overflowY: 'auto',
      }}
    >
      {/* Header: date · span · nav · close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>{fmtDayHeader(date)}</span>
        {photos && photos.length > 0 && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--vp-pencil, #888)' }}>
            {fmtTime(first)}–{fmtTime(last)}{span ? ` · ${span}` : ''}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {onPrev && (
          <button onClick={onPrev} aria-label="Previous day" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 700, padding: '2px 4px' }}>← PREV</button>
        )}
        {onNext && (
          <button onClick={onNext} aria-label="Next day" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 700, padding: '2px 4px' }}>NEXT →</button>
        )}
        <Link
          to={`/journal/${date}`}
          style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--vp-pencil, #888)', textDecoration: 'none', border: '1px solid var(--vp-ghost, #ddd)', padding: '2px 5px' }}
        >
          JOURNAL →
        </Link>
        <button onClick={onClose} aria-label="Close day" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '0 2px' }}>✕</button>
      </div>

      {loading && <div style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>LOADING…</div>}
      {isEmpty && <div style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>NO ACTIVITY</div>}

      {/* Facet chips — only the facets this day touched */}
      {!loading && !isEmpty && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {photos.length > 0 && <span style={{ ...mono, fontSize: 8, border: '1px solid var(--vp-ghost, #ddd)', padding: '1px 5px' }}>PHOTOS {photos.length}</span>}
          {workEvents.length > 0 && <span style={{ ...mono, fontSize: 8, border: '1px solid var(--vp-ghost, #ddd)', padding: '1px 5px' }}>WORK {workEvents.length}</span>}
          {dayTotal > 0 && <span style={{ ...mono, fontSize: 8, border: '1px solid var(--vp-ghost, #ddd)', padding: '1px 5px' }}>{fmtMoney(dayTotal)}</span>}
        </div>
      )}

      {/* Work story */}
      {workEvents.map((ev) => {
        const meta = ev.metadata || {};
        const mins = Number(meta.duration_minutes) || 0;
        const hrs = mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : '';
        const cost = fmtMoney(ev.cost_amount);
        return (
          <div key={ev.id || ev.title} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 9 }}>
              <span style={{ fontWeight: 700 }}>{ev.title || meta.work_type || 'WORK SESSION'}</span>
              <span style={mono}>{[hrs, cost].filter(Boolean).join(' · ') || '—'}</span>
            </div>
            {meta.work_description && (
              <div style={{ fontSize: 9, color: 'var(--vp-pencil, #888)', marginTop: 2, lineHeight: 1.5 }}>
                {String(meta.work_description)}
              </div>
            )}
          </div>
        );
      })}

      {/* Other event lines (sales, listings, milestones) */}
      {otherEvents.map((ev) => (
        <div key={ev.id || `${ev.event_type}-${ev.title}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 9, marginBottom: 3 }}>
          <span>{ev.title || String(ev.event_type || '').replace(/_/g, ' ')}</span>
          <span style={mono}>{fmtMoney(ev.cost_amount) || ''}</span>
        </div>
      ))}

      {/* Photo grid — square thumbs, lazy, render-endpoint sized */}
      {!loading && photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 3, marginTop: 4 }}>
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => openVehiclePhoto(p.id)}
              title={fmtTime(p.taken_at)}
              style={{ display: 'block', padding: 0, border: '1px solid var(--vp-ghost, #ddd)', background: 'var(--vp-row-alt, #f9f9f9)', cursor: 'pointer', aspectRatio: '1 / 1', overflow: 'hidden' }}
            >
              <img
                src={renderThumb(p.image_url, 200)}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default VehicleDayDrawer;
