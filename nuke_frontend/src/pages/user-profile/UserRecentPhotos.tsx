/**
 * UserRecentPhotos — dense recent-photos strip for the user profile.
 *
 * Replaces PublicImageGallery on the profile (that component is shared with
 * Profile.tsx / Profile.legacy.tsx, so it is left untouched for other consumers).
 *
 * Data: vehicle_images by user_id, ordered by REAL recency — taken_at DESC.
 *  - Owner path includes NULL-vehicle (inbox) images; left-joins the vehicle
 *    so the lightbox rail can name it (NULL → UNFILED, never fabricated).
 *  - Visitor path only vehicle-attached images on public vehicles (RLS-aligned).
 *
 * Why taken_at, not created_at (audit P2, USER_PROFILE_AUDIT.md:30-31): the
 * grid keyed on created_at surfaced an 8-year-old bulk import (capture_relay_ios
 * Aug-2018 photos imported 2026-06-14) at the top as "recent". taken_at is the
 * truth of when the WORK happened — same bug class as the TODAY card.
 *
 * Header shows EXACT totals via count/head queries (no top-K pretence):
 *   "20,978 IMAGES · 154 THIS WEEK"
 *
 * Every thumb is a button (tenet 1): click opens the in-place evidence
 * lightbox (?photo=<id>, ESC / click-out closes, ←/→ navigate) — the same
 * evidence-rail mechanics as the vehicle profile's VehiclePhotoLightbox, but
 * indexed over THESE grid rows (that component is hard-bound to a single
 * vehicle's VehicleProfileContext, so it can't be reused across his 131
 * vehicles). No parallel data system: the lightbox reads the rows the grid
 * already loaded.
 *
 * Self-guarding: returns null while loading and at 0 images (No Empty Shells).
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';

interface UserRecentPhotosProps {
  userId: string;
  isOwnProfile: boolean;
}

interface VehicleRef {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
}

interface PhotoRow {
  id: string;
  image_url: string | null;
  thumbnail_url: string | null;
  storage_path: string | null;
  source: string | null;
  source_url: string | null;
  taken_at: string | null;
  created_at: string | null;
  vehicle?: VehicleRef | VehicleRef[] | null;
}

const GRID_LIMIT = 60;

// Source guards carried over from PublicImageGallery — keep scraped/imported
// imagery out of the personal strip. Applied to displayed thumbs only;
// header counts stay exact.
const SOURCE_BLOCKLIST = new Set([
  'bat_import',
  'bat_listing',
  'external_import',
  'organization_import',
  'scraper',
  'url_scraper',
  'classic_com_indexing',
  'classic_scrape',
  'collector_scrape',
]);

const IMPORT_PATH_TOKENS = [
  'import_queue',
  'external_import',
  'organization_import',
  'bat_import',
  'classic.com/veh',
  'bringatrailer.com/wp-content/uploads',
];

const looksImported = (value?: string | null): boolean => {
  if (!value) return false;
  const lower = String(value).toLowerCase();
  return IMPORT_PATH_TOKENS.some(token => lower.includes(token));
};

const passesSourceGuards = (img: PhotoRow): boolean => {
  const src = String(img.source || '').toLowerCase();
  if (src && SOURCE_BLOCKLIST.has(src)) return false;
  if (looksImported(img.storage_path)) return false;
  if (looksImported(img.image_url)) return false;
  if (String(img.source_url || '').trim().startsWith('http')) return false;
  return true;
};

/** Day (YYYY-MM-DD) for the journal click-through — EXIF taken_at, created_at fallback. */
const journalDay = (img: PhotoRow): string | null => {
  const stamp = img.taken_at || img.created_at;
  if (!stamp || stamp.length < 10) return null;
  return stamp.slice(0, 10);
};

const GRID_COLUMNS = `id, image_url, thumbnail_url, storage_path, source, source_url, taken_at, created_at`;
const VEHICLE_FIELDS = `id, year, make, model`;

/** First vehicle row from a PostgREST embed (object or array shape). */
const vehicleOf = (img: PhotoRow): VehicleRef | null => {
  const v = img.vehicle;
  if (!v) return null;
  return (Array.isArray(v) ? v[0] : v) || null;
};

const vehicleLabel = (img: PhotoRow): string => {
  const v = vehicleOf(img);
  if (!v) return 'UNFILED';
  const parts = [v.year, v.make, v.model].filter(Boolean).join(' ').trim();
  return parts ? parts.toUpperCase() : 'UNFILED';
};

const SOURCE_LABELS: Record<string, string> = {
  user_upload: 'OWNER UPLOAD',
  owner_upload: 'OWNER UPLOAD',
  capture_relay_ios: 'OWNER CAPTURE (iOS)',
  photo_auto_sync: 'OWNER SYNC',
  iphoto: 'OWNER ARCHIVE',
  ssd_blast: 'OWNER ARCHIVE',
  hd_archive: 'OWNER ARCHIVE',
  'drop-folder': 'OWNER ARCHIVE',
  image_intake: 'OWNER ARCHIVE',
  dropbox_import: 'OWNER ARCHIVE',
  daily_receipt: 'DAILY RECEIPT',
};

const sourceLabelOf = (src: string | null): string | null =>
  src ? (SOURCE_LABELS[src] || src.toUpperCase().replace(/_/g, ' ')) : null;

/** Render-endpoint URL at a target width (transcodes HEIC; never a raw multi-MB original). */
const stageUrl = (url: string, width: number): string =>
  optimizeImageUrl(url, width >= 1000 ? 'large' : 'medium') || url;

// ── Analysis record, loaded on demand for the open frame ──
interface ImageAnalysis {
  status: string | null;          // ai_processing_status
  componentCount: number | null;  // ai_component_count
  model: string | null;           // vision_model_version
  scannedAt: string | null;       // vision_analyzed_at | ai_last_scanned
  imageType: string | null;       // classification.image_type
  classConfidence: number | null; // classification.confidence
  description: string | null;     // classification.description
  caption: string | null;
  medium: string | null;
  atoms: Array<[string, string]>; // byok_deep_analysis surfaced keys
}

const analysisCache = new Map<string, ImageAnalysis>();

const railLabel: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700,
  letterSpacing: '0.12em', color: '#888',
};
const railValue: React.CSSProperties = {
  fontFamily: "'Courier New', Courier, monospace", fontSize: 10, color: '#eee', lineHeight: 1.5,
};
const railLink: React.CSSProperties = {
  ...railValue, textDecoration: 'none', border: '1px solid #444',
  padding: '3px 6px', display: 'inline-block', cursor: 'pointer',
};

/**
 * RecentPhotoLightbox — in-place evidence viewer for the user-profile photo
 * grid. Same evidence-rail mechanics as the vehicle profile's
 * VehiclePhotoLightbox (taken · source · vehicle · analysis · original), but
 * indexed over THESE grid rows so it works across his 131 vehicles + unfiled
 * inbox (the vehicle lightbox is hard-bound to one VehicleProfileContext).
 *
 * Two paths per image (founder requirement):
 *   → VEHICLE:  /vehicle/:id when attributed.
 *   → ANALYSIS: attributed → /vehicle/:id?photo=<id> (full analysis lightbox);
 *               unfiled (owner) → /photo-library (review/assign). Real
 *               classification/atoms shown inline; honest "NOT ANALYZED YET"
 *               when the record carries none (C0 — never fabricated).
 */
const RecentPhotoLightbox: React.FC<{
  rows: PhotoRow[];
  index: number;
  isOwnProfile: boolean;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
}> = ({ rows, index, isOwnProfile, onClose, onStep }) => {
  const img = rows[index];
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);

  // Per-frame analysis (one cheap single-row query, cached).
  useEffect(() => {
    if (!img) return;
    const cached = analysisCache.get(img.id);
    if (cached) { setAnalysis(cached); return; }
    let cancelled = false;
    setAnalysis(null);
    supabase
      .from('vehicle_images')
      .select('ai_processing_status, ai_component_count, vision_model_version, vision_analyzed_at, ai_last_scanned, ai_scan_metadata, caption, image_medium')
      .eq('id', img.id)
      .maybeSingle()
      .then(({ data }: { data: any | null }) => {
        if (cancelled || !data) return;
        const meta = data.ai_scan_metadata || {};
        const cls = meta.classification || {};
        const byok = meta.byok_deep_analysis || {};
        const atoms: Array<[string, string]> = [];
        for (const k of ['scene_type', 'build_phase_guess', 'work_activity', 'subject', 'notable_details']) {
          const val = byok[k];
          if (typeof val === 'string' && val.trim()) atoms.push([k.replace(/_/g, ' ').toUpperCase(), val.trim()]);
        }
        const rec: ImageAnalysis = {
          status: data.ai_processing_status || null,
          componentCount: typeof data.ai_component_count === 'number' ? data.ai_component_count : null,
          model: data.vision_model_version || null,
          scannedAt: data.vision_analyzed_at || data.ai_last_scanned || null,
          imageType: typeof cls.image_type === 'string' ? cls.image_type : null,
          classConfidence: typeof cls.confidence === 'number' ? cls.confidence : null,
          description: typeof cls.description === 'string' ? cls.description : null,
          caption: data.caption || null,
          medium: data.image_medium || null,
          atoms,
        };
        analysisCache.set(img.id, rec);
        setAnalysis(rec);
      });
    return () => { cancelled = true; };
  }, [img?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!img) return null;
  const url = img.image_url || img.thumbnail_url;
  if (!url) return null;

  const vehicle = vehicleOf(img);
  const takenLabel = img.taken_at
    ? new Date(img.taken_at).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const srcLabel = sourceLabelOf(img.source);

  // ── The two paths ──
  const vehiclePath = vehicle ? `/vehicle/${vehicle.id}` : null;
  const analysisPath = vehicle
    ? `/vehicle/${vehicle.id}?photo=${img.id}`   // full analysis lightbox on the vehicle
    : (isOwnProfile ? '/photo-library' : null);  // owner reviews/assigns the unfiled image

  // Has the image genuinely been analyzed? completed+0 atoms+rate-limited
  // classification = not really. Be honest (C0).
  const hasRealAtoms = !!(analysis && analysis.atoms.length > 0);
  const hasUsefulClass = !!(
    analysis && analysis.imageType && analysis.imageType !== 'other'
    && (analysis.classConfidence ?? 0) >= 0.4
  );
  const analyzed = hasRealAtoms || hasUsefulClass;

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Photo viewer"
      style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'row' }}
    >
      {/* Stage */}
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <img
          key={img.id}
          src={stageUrl(url, 1260)}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
        />
        {index > 0 && (
          <button onClick={() => onStep(-1)} aria-label="Previous photo"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, background: 'rgba(0,0,0,0.55)', color: '#fff', border: '2px solid rgba(255,255,255,0.2)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{'<'}</button>
        )}
        {index < rows.length - 1 && (
          <button onClick={() => onStep(1)} aria-label="Next photo"
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, background: 'rgba(0,0,0,0.55)', color: '#fff', border: '2px solid rgba(255,255,255,0.2)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{'>'}</button>
        )}
        <div style={{ fontFamily: "'Courier New', Courier, monospace", position: 'absolute', top: 10, left: 10, fontSize: 9, color: '#bbb', background: 'rgba(0,0,0,0.55)', padding: '2px 6px' }}>
          {index + 1} / {rows.length}
        </div>
        <button onClick={onClose} aria-label="Close photo viewer"
          style={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, background: 'rgba(0,0,0,0.55)', color: '#fff', border: '2px solid rgba(255,255,255,0.2)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>✕</button>
      </div>

      {/* Evidence rail */}
      <div style={{ width: 240, flexShrink: 0, borderLeft: '2px solid #333', background: '#111', padding: '14px 12px', overflowY: 'auto', display: window.innerWidth < 700 ? 'none' : 'block' }}>
        {takenLabel && (
          <div style={{ marginBottom: 10 }}>
            <div style={railLabel}>TAKEN</div>
            <div style={railValue}>{takenLabel}</div>
          </div>
        )}
        {srcLabel && (
          <div style={{ marginBottom: 10 }}>
            <div style={railLabel}>SOURCE</div>
            <div style={railValue}>{srcLabel}</div>
          </div>
        )}
        {/* PATH 1 → the vehicle / asset */}
        <div style={{ marginBottom: 10 }}>
          <div style={railLabel}>VEHICLE</div>
          {vehiclePath ? (
            <a href={vehiclePath} style={{ ...railValue, color: '#9cf', borderBottom: '1px solid #456', textDecoration: 'none' }}>
              {vehicleLabel(img)} →
            </a>
          ) : (
            <div style={railValue}>UNFILED — not yet on a vehicle</div>
          )}
        </div>
        {/* PATH 2 → the analysis of this image */}
        <div style={{ marginBottom: 10 }}>
          <div style={railLabel}>ANALYSIS</div>
          {analysis === null ? (
            <div style={{ ...railValue, color: '#777' }}>loading…</div>
          ) : analyzed ? (
            <>
              {analysis.imageType && analysis.imageType !== 'other' && (
                <div style={railValue}>
                  {analysis.imageType.toUpperCase().replace(/_/g, ' ')}
                  {analysis.classConfidence != null ? ` · ${Math.round(analysis.classConfidence * 100)}%` : ''}
                </div>
              )}
              {analysis.atoms.map(([k, val]) => (
                <div key={k} style={{ marginTop: 4 }}>
                  <div style={{ ...railLabel, fontSize: 7, color: '#666' }}>{k}</div>
                  <div style={{ ...railValue, fontSize: 9 }}>{val}</div>
                </div>
              ))}
              {analysis.componentCount ? (
                <div style={{ ...railValue, fontSize: 9, color: '#aaa', marginTop: 4 }}>{analysis.componentCount} COMPONENTS</div>
              ) : null}
            </>
          ) : (
            <div style={{ ...railValue, color: '#c96' }}>NOT ANALYZED YET</div>
          )}
          {analysisPath && (
            <div style={{ marginTop: 6 }}>
              <a href={analysisPath} style={railLink}>
                {analyzed ? 'OPEN ANALYSIS ↗' : (vehicle ? 'OPEN ANALYSIS ↗' : 'REVIEW / ASSIGN ↗')}
              </a>
            </div>
          )}
        </div>
        {/* PATH 3 → the original storage object */}
        <div style={{ marginTop: 14 }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...railLabel, color: '#bbb', textDecoration: 'none', border: '1px solid #444', padding: '3px 6px', display: 'inline-block' }}>
            ORIGINAL ↗
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const UserRecentPhotos: React.FC<UserRecentPhotosProps> = ({ userId, isOwnProfile }) => {
  const [images, setImages] = useState<PhotoRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [weekCount, setWeekCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    // One round-trip. Returns the rows + counts, or throws the PostgREST error.
    const fetchOnce = async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // Visitor path inner-joins vehicles and keeps only public ones; owner
      // path LEFT-joins so NULL-vehicle inbox images still count and the
      // lightbox rail can name the vehicle (or UNFILED) without re-querying.
      const countSelect = isOwnProfile
        ? 'id'
        : 'id, vehicle:vehicles!vehicle_images_vehicle_id_fkey!inner(id)';
      const gridSelect = isOwnProfile
        ? `${GRID_COLUMNS}, vehicle:vehicles!vehicle_images_vehicle_id_fkey(${VEHICLE_FIELDS})`
        : `${GRID_COLUMNS}, vehicle:vehicles!vehicle_images_vehicle_id_fkey!inner(${VEHICLE_FIELDS})`;

      const withVisibility = <T,>(query: T): T => {
        if (isOwnProfile) return query;
        return (query as any).eq('vehicle.is_public', true);
      };

      // Load-bearing pair: the grid (the actual photos, taken_at DESC) and the
      // exact total for the badge. These two must succeed for the section to
      // render. The "THIS WEEK" count is intentionally NOT here — it is an
      // expensive taken_at-range count on a 1M-row table that can exceed the
      // 15s anon statement timeout (→ 500); it is fetched best-effort below so
      // its failure degrades the badge, never the whole section.
      const [totalRes, gridRes] = await Promise.all([
        withVisibility(
          supabase
            .from('vehicle_images')
            .select(countSelect, { count: 'exact', head: true })
            .eq('user_id', userId)
            .not('is_duplicate', 'is', true)
        ),
        withVisibility(
          supabase
            .from('vehicle_images')
            .select(gridSelect)
            .eq('user_id', userId)
            .not('is_duplicate', 'is', true)
            .order('taken_at', { ascending: false, nullsFirst: false })
            .limit(GRID_LIMIT)
        ),
      ]);

      if (totalRes.error) throw totalRes.error;
      if (gridRes.error) throw gridRes.error;

      return {
        rows: ((gridRes.data || []) as unknown as PhotoRow[]).filter(passesSourceGuards),
        total: totalRes.count || 0,
        weekAgo,
      };
    };

    // Best-effort "THIS WEEK" — real work shot this week (taken_at, not import
    // time). Never throws into the main path; on timeout/error the badge just
    // omits it (weekCount stays 0 → hidden).
    const fetchWeek = async (weekAgo: string): Promise<number> => {
      try {
        const countSelect = isOwnProfile
          ? 'id'
          : 'id, vehicle:vehicles!vehicle_images_vehicle_id_fkey!inner(id)';
        let q = supabase
          .from('vehicle_images')
          .select(countSelect, { count: 'exact', head: true })
          .eq('user_id', userId)
          .not('is_duplicate', 'is', true)
          .gte('taken_at', weekAgo);
        if (!isOwnProfile) q = (q as any).eq('vehicle.is_public', true);
        const { count, error } = await q;
        if (error) return 0;
        return count || 0;
      } catch {
        return 0;
      }
    };

    // A real PostgREST error carries a message/code. On a fresh page load the
    // GoTrue session is still resolving, and the auth event that lands
    // mid-flight tears down the in-flight request — it rejects with an EMPTY
    // error (no message, no code). That is a transient abort, not a failure.
    const isTransientAbort = (e: unknown): boolean => {
      const err = e as { message?: string; code?: string } | null;
      return !err?.message && !err?.code;
    };

    const load = async () => {
      try {
        // Gate on the auth bootstrap: await the session so no auth event fires
        // mid-query and aborts it. Without this the three parallel queries are
        // torn down on first load and the section renders falsely empty.
        await supabase.auth.getSession();
        if (cancelled) return;

        // Retry through the settle window on a transient abort; surface a real
        // PostgREST error immediately (cleared honestly below — C0, no shell).
        const delays = [0, 150, 400];
        let result: Awaited<ReturnType<typeof fetchOnce>> | null = null;
        let lastErr: unknown = null;
        for (const d of delays) {
          if (cancelled) return;
          if (d) await new Promise(r => setTimeout(r, d));
          if (cancelled) return;
          try {
            result = await fetchOnce();
            break;
          } catch (error) {
            lastErr = error;
            if (!isTransientAbort(error)) throw error;
          }
        }
        if (cancelled) return;
        if (!result) throw lastErr;

        setTotalCount(result.total);
        setImages(result.rows);
        setLoading(false);

        // Badge enrichment — best-effort, never blocks or clears the section.
        const week = await fetchWeek(result.weekAgo);
        if (!cancelled && week > 0) setWeekCount(week);
      } catch (error) {
        if (cancelled) return;
        console.error('[UserRecentPhotos] load failed:', error);
        setImages([]);
        setTotalCount(0);
        setWeekCount(0);
        setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [userId, isOwnProfile]);

  // ── In-place evidence lightbox (tenet 1: every thumb is a button) ──
  // Renderable rows only — a thumb that failed to render or has no URL is not
  // a valid lightbox target, so prev/next never lands on a dead frame.
  const viewable = useMemo(
    () => images.filter(img => (img.thumbnail_url || img.image_url) && !failedIds.has(img.id)),
    [images, failedIds],
  );

  const [openId, setOpenId] = useState<string | null>(null);

  const setPhotoParam = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('photo', id);
    else url.searchParams.delete('photo');
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);

  const open = useCallback((id: string) => { setOpenId(id); setPhotoParam(id); }, [setPhotoParam]);
  const close = useCallback(() => { setOpenId(null); setPhotoParam(null); }, [setPhotoParam]);

  // Restore an open lightbox from ?photo= on mount / once rows resolve (URL-addressable, C10).
  useEffect(() => {
    if (openId || viewable.length === 0) return;
    const param = new URLSearchParams(window.location.search).get('photo');
    if (param && viewable.some(r => r.id === param)) setOpenId(param);
  }, [viewable, openId]);

  const openIndex = useMemo(
    () => (openId ? viewable.findIndex(r => r.id === openId) : -1),
    [openId, viewable],
  );

  const step = useCallback((dir: -1 | 1) => {
    if (openIndex < 0) return;
    const next = viewable[openIndex + dir];
    if (next) open(next.id);
  }, [openIndex, viewable, open]);

  // ESC closes, ←/→ navigate; lock body scroll while open.
  useEffect(() => {
    if (!openId) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey, true);
    };
  }, [openId, close, step]);

  // No Empty Shells: nothing while loading, nothing at 0 images.
  if (loading) return null;
  if (totalCount === 0 || images.length === 0) return null;

  const headerLine = `${totalCount.toLocaleString('en-US')} IMAGES${
    weekCount > 0 ? ` · ${weekCount.toLocaleString('en-US')} THIS WEEK` : ''
  }`;

  return (
    <CollapsibleWidget
      title="RECENT PHOTOS"
      variant="profile"
      badge={
        <span
          style={{
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {headerLine}
        </span>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))',
          gap: '2px',
        }}
      >
        {images.map(img => {
          const rawUrl = img.thumbnail_url || img.image_url;
          if (!rawUrl) return null;
          // A failed render is hidden, never swapped for the raw original:
          // the newest uploads are multi-MB HEIC that no browser can decode,
          // so the old raw fallback turned a transient miss into a permanent
          // broken + heavy image (audit P1a).
          if (failedIds.has(img.id)) return null;
          const src = optimizeImageUrl(rawUrl, 'thumbnail') || rawUrl;
          // Every thumb is a button → opens the in-place evidence lightbox.
          return (
            <button
              key={img.id}
              type="button"
              onClick={() => open(img.id)}
              title={journalDay(img) || undefined}
              aria-label="Open photo"
              style={{
                display: 'block',
                lineHeight: 0,
                padding: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
              }}
            >
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => {
                  setFailedIds(prev => {
                    if (prev.has(img.id)) return prev;
                    const next = new Set(prev);
                    next.add(img.id);
                    return next;
                  });
                }}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  objectFit: 'cover',
                  display: 'block',
                  background: '#eeeeee',
                }}
              />
            </button>
          );
        })}
      </div>
      {openIndex >= 0 && (
        <RecentPhotoLightbox
          rows={viewable}
          index={openIndex}
          isOwnProfile={isOwnProfile}
          onClose={close}
          onStep={step}
        />
      )}
    </CollapsibleWidget>
  );
};

export default UserRecentPhotos;
