/**
 * WalkAroundCarousel — Horizontal scrollable strip showing one "best" image
 * per zone category in canonical walk-around order.
 *
 * Sits below the hero image on the vehicle profile page. Gives an instant
 * visual summary of how well a vehicle is documented from all angles.
 */
import React, { useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalkAroundImage {
  id: string;
  image_url: string;
  vehicle_zone?: string | null;
  zone_confidence?: number | null;
  photo_quality_score?: number | null;
  storage_path?: string | null;
}

export interface WalkAroundCarouselProps {
  images: WalkAroundImage[];
  onSlotClick?: (zoneKey: string, imageId?: string) => void;
}

// ---------------------------------------------------------------------------
// Walk-around order definition
// ---------------------------------------------------------------------------

interface WalkAroundSlot {
  label: string;
  key: string;
  zones: string[];
}

const WALK_AROUND_ORDER: WalkAroundSlot[] = [
  { label: 'FRONT', key: 'front', zones: ['ext_front'] },
  { label: 'FRONT \u00BE', key: 'front_34', zones: ['ext_front_driver', 'ext_front_passenger'] },
  { label: 'DRIVER', key: 'driver', zones: ['ext_driver_side'] },
  { label: 'REAR \u00BE', key: 'rear_34', zones: ['ext_rear_driver', 'ext_rear_passenger'] },
  { label: 'REAR', key: 'rear', zones: ['ext_rear'] },
  { label: 'PASS.', key: 'passenger', zones: ['ext_passenger_side'] },
  { label: 'INTERIOR', key: 'interior', zones: ['int_dashboard', 'int_front_seats', 'int_rear_seats', 'int_cargo'] },
  { label: 'ENGINE', key: 'engine', zones: ['mech_engine_bay'] },
  { label: 'UNDER', key: 'under', zones: ['ext_undercarriage', 'mech_suspension', 'mech_transmission'] },
  { label: 'WHEELS', key: 'wheels', zones: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] },
  { label: 'DETAIL', key: 'detail', zones: ['detail_vin', 'detail_badge', 'detail_damage', 'detail_odometer'] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Supabase public object URL into a render/resize URL.
 * Returns null if the URL is not a Supabase storage URL.
 */
function toRenderUrl(publicUrl: string, width: number, height: number, quality = 75): string | null {
  try {
    const url = String(publicUrl || '').trim();
    if (!url) return null;
    const marker = '/storage/v1/object/public/';
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    const base = url.slice(0, idx);
    const path = url.slice(idx + marker.length).split('?')[0];
    if (!path) return null;
    return `${base}/storage/v1/render/image/public/${path}?width=${width}&height=${height}&quality=${quality}&resize=cover`;
  } catch {
    return null;
  }
}

interface SlotData {
  slot: WalkAroundSlot;
  bestImage: WalkAroundImage | null;
  count: number;
}

function computeSlots(images: WalkAroundImage[]): SlotData[] {
  // Build a zone -> images index
  const byZone = new Map<string, WalkAroundImage[]>();
  for (const img of images) {
    const zone = String(img.vehicle_zone || '').trim().toLowerCase();
    if (!zone || zone === 'other' || zone === 'null' || zone === 'undefined') continue;
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone)!.push(img);
  }

  return WALK_AROUND_ORDER.map((slot) => {
    // Collect all images matching any zone in this slot
    const candidates: WalkAroundImage[] = [];
    for (const z of slot.zones) {
      const found = byZone.get(z);
      if (found) candidates.push(...found);
    }

    if (candidates.length === 0) {
      return { slot, bestImage: null, count: 0 };
    }

    // Pick best: highest photo_quality_score, then highest zone_confidence
    const sorted = [...candidates].sort((a, b) => {
      const qa = typeof a.photo_quality_score === 'number' ? a.photo_quality_score : 0;
      const qb = typeof b.photo_quality_score === 'number' ? b.photo_quality_score : 0;
      if (qa !== qb) return qb - qa;
      const ca = typeof a.zone_confidence === 'number' ? a.zone_confidence : 0;
      const cb = typeof b.zone_confidence === 'number' ? b.zone_confidence : 0;
      return cb - ca;
    });

    return { slot, bestImage: sorted[0], count: candidates.length };
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WalkAroundCarousel: React.FC<WalkAroundCarouselProps> = ({ images, onSlotClick }) => {
  const slots = useMemo(() => computeSlots(images), [images]);
  const filledCount = useMemo(() => slots.filter((s) => s.bestImage !== null).length, [slots]);
  const totalSlots = WALK_AROUND_ORDER.length;

  // Don't render at all if there are zero zone-tagged images
  const hasAnyZonedImages = useMemo(
    () => images.some((img) => {
      const z = String(img.vehicle_zone || '').trim().toLowerCase();
      return z && z !== 'other' && z !== 'null' && z !== 'undefined';
    }),
    [images],
  );
  if (!hasAnyZonedImages) return null;

  const coverageColor =
    filledCount >= 8 ? 'var(--success, #22c55e)' :
    filledCount >= 5 ? 'var(--warning, #eab308)' :
    'var(--error, #ef4444)';

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1600px',
        margin: '0 auto',
        padding: '4px 12px 8px',
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        scrollSnapType: 'x mandatory',
        scrollbarWidth: 'none',          /* Firefox */
        msOverflowStyle: 'none',         /* IE/Edge */
      }}
      className="walk-around-carousel"
    >
      {/* Hide scrollbar for Webkit via injected style (one-time) */}
      <style>{`.walk-around-carousel::-webkit-scrollbar { display: none; }`}</style>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: '8px',
          alignItems: 'flex-start',
          width: 'max-content',
        }}
      >
        {slots.map(({ slot, bestImage, count }) => (
          <div
            key={slot.key}
            onClick={() => onSlotClick?.(slot.key, bestImage?.id)}
            style={{
              scrollSnapAlign: 'start',
              flexShrink: 0,
              width: '120px',
              cursor: bestImage ? 'pointer' : 'default',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
            }}
          >
            {/* Thumbnail or placeholder */}
            {bestImage ? (
              <div
                style={{
                  width: '120px',
                  height: '80px',
                  borderRadius: '2px',
                  overflow: 'hidden',
                  backgroundColor: 'var(--grey-100, #f5f5f5)',
                }}
              >
                <img
                  src={toRenderUrl(bestImage.image_url, 160, 100, 75) || bestImage.image_url}
                  alt={slot.label}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </div>
            ) : (
              <div
                style={{
                  width: '120px',
                  height: '80px',
                  borderRadius: '2px',
                  border: '1px dashed var(--border, #d4d4d4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'transparent',
                }}
              >
                <span
                  style={{
                    fontSize: '9px',
                    fontFamily: 'var(--font-mono, "SF Mono", "Fira Code", "Fira Mono", monospace)',
                    color: 'var(--text-muted, #a3a3a3)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  {slot.label}
                </span>
              </div>
            )}

            {/* Zone label */}
            <span
              style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono, "SF Mono", "Fira Code", "Fira Mono", monospace)',
                color: bestImage ? 'var(--text-muted, #a3a3a3)' : 'var(--text-muted, #a3a3a3)',
                letterSpacing: '0.04em',
                lineHeight: 1.2,
                textAlign: 'center',
                opacity: bestImage ? 1 : 0.5,
              }}
            >
              {slot.label}
            </span>

            {/* Photo count */}
            {count > 0 && (
              <span
                style={{
                  fontSize: '9px',
                  fontFamily: 'var(--font-mono, "SF Mono", "Fira Code", "Fira Mono", monospace)',
                  color: 'var(--text-muted, #a3a3a3)',
                  opacity: 0.7,
                  lineHeight: 1,
                }}
              >
                {count} photo{count === 1 ? '' : 's'}
              </span>
            )}
          </div>
        ))}

        {/* Coverage summary */}
        <div
          style={{
            scrollSnapAlign: 'end',
            flexShrink: 0,
            width: '80px',
            height: '80px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px',
          }}
        >
          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              fontFamily: 'var(--font-mono, "SF Mono", "Fira Code", "Fira Mono", monospace)',
              color: coverageColor,
              lineHeight: 1,
            }}
          >
            {filledCount}/{totalSlots}
          </span>
          <span
            style={{
              fontSize: '9px',
              fontFamily: 'var(--font-mono, "SF Mono", "Fira Code", "Fira Mono", monospace)',
              color: 'var(--text-muted, #a3a3a3)',
              lineHeight: 1,
            }}
          >
            angles
          </span>
        </div>
      </div>
    </div>
  );
};

export default WalkAroundCarousel;
