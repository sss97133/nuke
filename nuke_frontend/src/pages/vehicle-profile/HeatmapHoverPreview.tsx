import React from 'react';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

interface PhotoAnalysis {
  total_photos: number;
  analyzed_count: number;
  avg_condition: number | null;
  avg_quality: number | null;
  zones_present: string[];
  zone_distribution: Record<string, number>;
  best_photo_url: string | null;
}

interface EventDay {
  date: string;
  label: string;
  level: number;
  items: { k: string; v: string }[];
  total: string;
  heroThumb?: string;
  serviceProvider?: string;
  locationName?: string;
  photoAnalysis?: PhotoAnalysis;
  hasWorkSession?: boolean;
  workMeta?: {
    work_type: string;
    image_count: number;
    duration_minutes: number;
    total_parts_cost: number;
    total_labor_cost: number;
    total_job_cost: number;
    work_description: string;
  };
}

const WORK_TYPE_COLORS: Record<string, string> = {
  fabrication: 'var(--error, #c00)',
  heavy_work: 'var(--warning, #c80)',
  parts_and_work: 'var(--info, #08c)',
  parts_received: 'var(--text-secondary, #888)',
  work: 'var(--text, #333)',
};

const WORK_TYPE_LABELS: Record<string, string> = {
  fabrication: 'FAB',
  heavy_work: 'HEAVY',
  parts_and_work: 'PARTS+WORK',
  parts_received: 'PARTS',
  work: 'WORK',
};

// Human-readable zone labels (top zones only)
const ZONE_LABELS: Record<string, string> = {
  ext_front: 'Front',
  ext_rear: 'Rear',
  ext_side_driver: 'Driver Side',
  ext_side_passenger: 'Pass. Side',
  ext_front_driver: 'Front Driver',
  ext_front_passenger: 'Front Pass.',
  ext_rear_driver: 'Rear Driver',
  ext_rear_passenger: 'Rear Pass.',
  mech_engine_bay: 'Engine Bay',
  mech_undercarriage: 'Undercarriage',
  mech_exhaust: 'Exhaust',
  mech_suspension: 'Suspension',
  mech_brakes: 'Brakes',
  mech_drivetrain: 'Drivetrain',
  int_dash: 'Dashboard',
  int_front_seats: 'Front Seats',
  int_rear_seats: 'Rear Seats',
  int_cargo: 'Cargo',
  panel_door_fl: 'Door FL',
  panel_door_fr: 'Door FR',
  panel_hood: 'Hood',
  panel_trunk: 'Trunk/Tailgate',
  panel_roof: 'Roof',
  panel_fender_fl: 'Fender FL',
  panel_fender_fr: 'Fender FR',
  panel_quarter_rl: 'Quarter RL',
  panel_quarter_rr: 'Quarter RR',
  detail_badge: 'Badge/Emblem',
  detail_wheel: 'Wheel',
  detail_damage: 'Damage Detail',
  detail_vin: 'VIN Plate',
};

function formatDate(ds: string): string {
  try {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return ds;
  }
}

/** Format zone distribution as compact summary: "Engine Bay 3, Exhaust 2, Suspension 1" */
function formatZoneSummary(pa: PhotoAnalysis): string | null {
  const dist = pa.zone_distribution;
  if (!dist || Object.keys(dist).length === 0) return null;

  // Sort by count descending, take top 3
  const sorted = Object.entries(dist)
    .filter(([z]) => z !== 'unknown')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (sorted.length === 0) return null;

  return sorted
    .map(([zone, count]) => `${ZONE_LABELS[zone] || zone.replace(/_/g, ' ')} ${count}`)
    .join(', ');
}

interface Props {
  event: EventDay;
  cellRect: DOMRect;
}

const HeatmapHoverPreview: React.FC<Props> = ({ event, cellRect }) => {
  const PREVIEW_W = 200;
  const MARGIN = 6;

  // Position: right of cell, flip left near viewport edge, clamp vertically
  let left = cellRect.right + MARGIN;
  if (left + PREVIEW_W > window.innerWidth - 8) {
    left = cellRect.left - PREVIEW_W - MARGIN;
  }
  let top = cellRect.top;
  const maxTop = window.innerHeight - 220;
  if (top > maxTop) top = maxTop;
  if (top < 4) top = 4;

  const wm = event.workMeta;
  const pa = event.photoAnalysis;
  const workType = wm?.work_type || '';
  const typeColor = WORK_TYPE_COLORS[workType] || WORK_TYPE_COLORS.work;
  const typeLabel = WORK_TYPE_LABELS[workType] || (workType ? workType.replace(/_/g, ' ').toUpperCase() : '');
  const heroUrl = event.heroThumb ? optimizeImageUrl(event.heroThumb, 'small') : null;

  const durationStr = wm && wm.duration_minutes > 0
    ? `${Math.floor(wm.duration_minutes / 60)}h ${wm.duration_minutes % 60}m`
    : null;

  const desc = wm?.work_description || '';
  const truncDesc = desc.length > 60 ? desc.slice(0, 60) + '...' : desc;
  const costStr = event.total !== '—' ? event.total : null;

  const photoCount = pa?.total_photos || wm?.image_count || 0;
  const analyzedCount = pa?.analyzed_count || 0;
  const zoneSummary = pa ? formatZoneSummary(pa) : null;

  return (
    <div
      className="hm-hover-preview"
      style={{
        position: 'fixed',
        left,
        top,
        width: PREVIEW_W,
        zIndex: 1200,
        pointerEvents: 'none',
        border: '2px solid var(--vp-ink, #1a1a1a)',
        background: 'var(--vp-surface, #fff)',
        fontFamily: 'var(--vp-font-mono, Courier New, monospace)',
        opacity: 1,
        animation: 'hm-hover-fade-in 80ms ease-out',
      }}
    >
      {heroUrl && (
        <img
          className="hm-hover-preview__img"
          src={heroUrl}
          alt=""
          style={{
            display: 'block',
            width: '100%',
            height: 80,
            objectFit: 'cover',
          }}
        />
      )}
      <div className="hm-hover-preview__body" style={{ padding: '4px 6px' }}>
        {/* Date */}
        <div style={{ fontSize: '8px', color: 'var(--vp-pencil, #888)' }}>
          {formatDate(event.date)}
        </div>

        {/* Work type dot + label */}
        {typeLabel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <span style={{
              display: 'inline-block',
              width: 6, height: 6,
              background: typeColor,
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: '8px',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              {typeLabel}
            </span>
          </div>
        )}

        {/* Duration + photo count + condition */}
        {(durationStr || photoCount > 0) && (
          <div style={{ fontSize: '7px', color: 'var(--vp-pencil, #888)', marginTop: 2 }}>
            {durationStr}
            {durationStr && photoCount > 0 && ' · '}
            {photoCount > 0 && `${photoCount} photos`}
            {pa?.avg_condition != null && (
              <span style={{ marginLeft: 4 }}>
                · cond {pa.avg_condition}/5
              </span>
            )}
          </div>
        )}

        {/* Zone distribution summary */}
        {zoneSummary && (
          <div style={{ fontSize: '7px', color: 'var(--vp-pencil, #888)', marginTop: 2, fontFamily: 'Arial, sans-serif', lineHeight: 1.3 }}>
            {zoneSummary}
          </div>
        )}

        {/* Analysis coverage indicator */}
        {pa && pa.total_photos > 0 && (
          <div style={{ fontSize: '6px', color: 'var(--vp-text-faint, #bbb)', marginTop: 2, letterSpacing: '0.04em' }}>
            {analyzedCount}/{pa.total_photos} ANALYZED
          </div>
        )}

        {/* Description */}
        {truncDesc && (
          <div style={{ fontSize: '7px', color: 'var(--vp-pencil, #888)', marginTop: 2, fontFamily: 'Arial, sans-serif', lineHeight: 1.4 }}>
            {truncDesc}
          </div>
        )}

        {/* Non-work day label */}
        {!wm && event.label && (
          <div style={{ fontSize: '7px', color: 'var(--vp-pencil, #888)', marginTop: 2, fontFamily: 'Arial, sans-serif' }}>
            {event.label.length > 60 ? event.label.slice(0, 60) + '...' : event.label}
          </div>
        )}

        {/* Cost */}
        {costStr && (
          <div style={{ fontSize: '8px', fontWeight: 700, marginTop: 2 }}>
            {costStr}
          </div>
        )}

        {/* Service provider */}
        {event.serviceProvider && (
          <div style={{ fontSize: '7px', color: 'var(--vp-pencil, #888)', marginTop: 2, fontFamily: 'Arial, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {event.serviceProvider}
          </div>
        )}
      </div>
    </div>
  );
};

export default HeatmapHoverPreview;
