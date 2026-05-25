/**
 * VehicleMediaKit — curated slideshow over BYOK vision-gate verdicts.
 *
 * For in-progress vehicles with a thin single hero, this component reaches into
 * `vehicle_images.ai_scan_metadata.byok_deep_analysis` (produced by
 * scripts/deep-image-analysis-byok.mjs) and picks up to 5 images across diverse
 * scene_types — body_exterior, engine_bay, undercarriage/fabrication_in_progress,
 * body_interior — plus the most-recent any-scene as a "current state" frame.
 *
 * The component is render-null if fewer than 3 distinct scene_types are
 * available. Parent (VehicleHeroImage) falls back to single-hero in that case.
 *
 * scene_type values come from the BYOK script (see scripts/deep-image-analysis-byok.mjs
 * lines 18-41). The script does NOT emit "frame" or "tooling_area" — the agent
 * brief mentioned those as conceptual labels; the canonical enum uses
 * "undercarriage" and "fabrication_in_progress" instead.
 */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';

type AnalyzedImage = {
  id: string;
  image_url: string;
  large_url: string | null;
  taken_at: string | null;
  created_at: string;
  scene_type: string | null;
  build_phase_guess: string | null;
};

interface VehicleMediaKitProps {
  vehicleId: string;
  onImageClick?: () => void;
  /** Called once curation resolves with the count of curated frames (0 if fallback). */
  onCurationResolved?: (count: number) => void;
}

// Scene preference order — the "media kit" recipe.
// Matches the BYOK enum (see scripts/deep-image-analysis-byok.mjs:21).
const SCENE_PREFERENCE: Array<{ key: string; matches: string[]; label: string }> = [
  { key: 'exterior', matches: ['body_exterior'], label: 'EXTERIOR' },
  { key: 'engine', matches: ['engine_bay'], label: 'ENGINE BAY' },
  { key: 'underbody', matches: ['undercarriage', 'fabrication_in_progress'], label: 'UNDERBODY' },
  { key: 'interior', matches: ['body_interior'], label: 'INTERIOR' },
];

const AUTO_ADVANCE_MS = 5000;

function supabaseRender(url: string | null | undefined, width: number, quality = 85): string | null {
  if (!url) return null;
  const marker = '/storage/v1/object/public/';
  const idx = url.indexOf(marker);
  if (idx < 0) return url;
  const base = url.slice(0, idx);
  const path = url.slice(idx + marker.length).split('?')[0];
  if (!path) return url;
  return `${base}/storage/v1/render/image/public/${path}?width=${width}&quality=${quality}&resize=contain`;
}

function buildSrcSet(url: string | null | undefined): { src: string; srcSet: string } | null {
  if (!url) return null;
  const w420 = supabaseRender(url, 420);
  const w840 = supabaseRender(url, 840);
  const w1260 = supabaseRender(url, 1260);
  if (!w420 || !w840 || !w1260) {
    // Non-Supabase URL — emit a single-src entry.
    return { src: url, srcSet: '' };
  }
  return {
    src: w840,
    srcSet: `${w420} 420w, ${w840} 840w, ${w1260} 1260w`,
  };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

const VehicleMediaKit: React.FC<VehicleMediaKitProps> = ({ vehicleId, onImageClick, onCurationResolved }) => {
  const [analyzed, setAnalyzed] = useState<AnalyzedImage[] | null>(null);
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [paused, setPaused] = useState(false);
  const advanceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pull analyzed rows. We don't expect more than a few hundred per vehicle
      // with byok_deep_analysis present (vehicle 83f6f033 has 23/1366). Cap at 200.
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, large_url, taken_at, created_at, ai_scan_metadata')
        .eq('vehicle_id', vehicleId)
        .not('ai_scan_metadata->byok_deep_analysis', 'is', null)
        .order('taken_at', { ascending: false, nullsFirst: false })
        .limit(200);

      if (cancelled) return;
      if (error || !data) {
        setAnalyzed([]);
        onCurationResolved?.(0);
        return;
      }

      const rows: AnalyzedImage[] = data.map((r: any) => {
        const ba = r.ai_scan_metadata?.byok_deep_analysis || {};
        return {
          id: r.id,
          image_url: r.image_url,
          large_url: r.large_url,
          taken_at: r.taken_at,
          created_at: r.created_at,
          scene_type: ba.scene_type ?? null,
          build_phase_guess: ba.build_phase_guess ?? null,
        };
      });
      setAnalyzed(rows);
    })();
    return () => { cancelled = true; };
  }, [vehicleId, onCurationResolved]);

  const curated = useMemo(() => {
    if (!analyzed || analyzed.length === 0) return [];

    const picks: Array<AnalyzedImage & { label: string }> = [];
    const usedIds = new Set<string>();

    // Pass 1: one image per scene category, in preference order.
    for (const cat of SCENE_PREFERENCE) {
      const candidate = analyzed.find(
        (r) => r.scene_type && cat.matches.includes(r.scene_type) && !usedIds.has(r.id),
      );
      if (candidate) {
        picks.push({ ...candidate, label: cat.label });
        usedIds.add(candidate.id);
      }
    }

    // Pass 2: add the most-recent any-scene as a "current state" 5th frame.
    if (picks.length < 5) {
      const current = analyzed.find((r) => !usedIds.has(r.id));
      if (current) {
        picks.push({ ...current, label: 'CURRENT STATE' });
      }
    }

    return picks;
  }, [analyzed]);

  // Distinct scene types across the curated set — gate at >= 3.
  const distinctScenes = useMemo(() => {
    const s = new Set<string>();
    for (const p of curated) if (p.scene_type) s.add(p.scene_type);
    return s.size;
  }, [curated]);

  const enabled = analyzed !== null && curated.length >= 3 && distinctScenes >= 3;

  useEffect(() => {
    if (analyzed === null) return;
    onCurationResolved?.(enabled ? curated.length : 0);
  }, [analyzed, enabled, curated.length, onCurationResolved]);

  // Auto-advance.
  useEffect(() => {
    if (!enabled || reducedMotion || paused || curated.length <= 1) return;
    advanceTimerRef.current = window.setTimeout(() => {
      setIndex((i) => (i + 1) % curated.length);
    }, AUTO_ADVANCE_MS);
    return () => {
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    };
  }, [enabled, reducedMotion, paused, index, curated.length]);

  if (!enabled) return null;

  const current = curated[index];
  const srcInfo = buildSrcSet(current.large_url || current.image_url);
  if (!srcInfo) return null;

  const dateLabel = formatDate(current.taken_at || current.created_at);

  return (
    <div
      style={{
        width: '100%',
        height: 'var(--h-hero, 420px)',
        aspectRatio: 'auto',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'var(--text)',
        cursor: onImageClick ? 'pointer' : 'default',
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onClick={onImageClick}
      role="region"
      aria-label="Vehicle media kit slideshow"
    >
      {/* Image — eager/async/high-priority on first frame for LCP */}
      <img
        key={current.id}
        src={srcInfo.src}
        srcSet={srcInfo.srcSet || undefined}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 1260px"
        alt={current.label}
        loading={index === 0 ? 'eager' : 'lazy'}
        decoding="async"
        {...(index === 0 ? { fetchpriority: 'high' as any } : {})}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: 'center',
        }}
      />

      {/* Scene label — top-left corner */}
      <div
        style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(0,0,0,0.55)',
          color: 'var(--surface-elevated, #fff)',
          padding: '4px 8px',
          fontFamily: 'Arial, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase' as const,
          border: '2px solid rgba(255,255,255,0.15)',
          zIndex: 2,
        }}
      >
        {current.label}
        {dateLabel ? ` · ${dateLabel}` : ''}
      </div>

      {/* Prev chevron */}
      {curated.length > 1 && (
        <button
          type="button"
          aria-label="Previous image"
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => (i - 1 + curated.length) % curated.length);
          }}
          style={{
            position: 'absolute',
            top: '50%',
            left: '10px',
            transform: 'translateY(-50%)',
            width: '32px',
            height: '32px',
            background: 'rgba(0,0,0,0.55)',
            color: 'var(--surface-elevated, #fff)',
            border: '2px solid rgba(255,255,255,0.15)',
            fontFamily: 'Arial, sans-serif',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            zIndex: 2,
            transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {'<'}
        </button>
      )}

      {/* Next chevron */}
      {curated.length > 1 && (
        <button
          type="button"
          aria-label="Next image"
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => (i + 1) % curated.length);
          }}
          style={{
            position: 'absolute',
            top: '50%',
            right: '10px',
            transform: 'translateY(-50%)',
            width: '32px',
            height: '32px',
            background: 'rgba(0,0,0,0.55)',
            color: 'var(--surface-elevated, #fff)',
            border: '2px solid rgba(255,255,255,0.15)',
            fontFamily: 'Arial, sans-serif',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            zIndex: 2,
            transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {'>'}
        </button>
      )}

      {/* Dot indicators */}
      {curated.length > 1 && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '6px',
            zIndex: 2,
          }}
        >
          {curated.map((p, i) => (
            <button
              key={p.id}
              type="button"
              aria-label={`Show image ${i + 1} of ${curated.length}`}
              onClick={(e) => {
                e.stopPropagation();
                setIndex(i);
              }}
              style={{
                width: i === index ? '12px' : '8px',
                height: '8px',
                background: i === index ? 'var(--surface-elevated, #fff)' : 'rgba(255,255,255,0.4)',
                border: '2px solid rgba(0,0,0,0.4)',
                padding: 0,
                cursor: 'pointer',
                transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default VehicleMediaKit;
