/**
 * ImageZoneSection — Collapsible zone-grouped image section for the gallery.
 *
 * Groups images by vehicle_zone into logical sections (EXTERIOR, ENGINE BAY, etc.)
 * with collapsible headers showing zone label + image count.
 * Sorts images within each section by photo_quality_score DESC.
 * Surfaces YONO vision data (condition_score, damage_flags) as small overlays.
 */
import React, { useState } from 'react';
import { SensitiveImageOverlay } from './SensitiveImageOverlay';

// --- Zone-to-Section Mapping ---

export interface ZoneSectionDef {
  key: string;
  label: string;
  /** Matcher: returns true if an image belongs in this section */
  match: (img: any) => boolean;
  /** If true, this is a virtual section computed across all images (e.g. HIGHLIGHTS) */
  virtual?: boolean;
}

/**
 * Canonical zone section definitions.
 * Order matters: images are assigned to the FIRST matching section.
 * HIGHLIGHTS is virtual and computed separately.
 */
export const ZONE_SECTIONS: ZoneSectionDef[] = [
  // HIGHLIGHTS removed — highlights should be human-curated, not auto-scored
  {
    key: 'exterior',
    label: 'EXTERIOR',
    match: (img) => {
      const zone = String(img?.vehicle_zone || '').toLowerCase();
      return zone.startsWith('ext_') && zone !== 'ext_undercarriage';
    },
  },
  {
    key: 'engine_bay',
    label: 'ENGINE BAY',
    match: (img) => {
      const zone = String(img?.vehicle_zone || '').toLowerCase();
      return zone === 'mech_engine_bay';
    },
  },
  {
    key: 'interior',
    label: 'INTERIOR',
    match: (img) => {
      const zone = String(img?.vehicle_zone || '').toLowerCase();
      return zone.startsWith('int_');
    },
  },
  {
    key: 'undercarriage',
    label: 'UNDERCARRIAGE',
    match: (img) => {
      const zone = String(img?.vehicle_zone || '').toLowerCase();
      return (
        zone === 'ext_undercarriage' ||
        zone === 'mech_suspension' ||
        zone === 'mech_transmission'
      );
    },
  },
  {
    key: 'wheels',
    label: 'WHEELS',
    match: (img) => {
      const zone = String(img?.vehicle_zone || '').toLowerCase();
      return zone.startsWith('wheel_');
    },
  },
  {
    key: 'detail',
    label: 'DETAIL',
    match: (img) => {
      const zone = String(img?.vehicle_zone || '').toLowerCase();
      return zone.startsWith('detail_');
    },
  },
  {
    key: 'documents',
    label: 'DOCUMENTS',
    match: (img) => {
      return (
        img?.is_document === true ||
        (img?.document_category != null && String(img.document_category).trim() !== '')
      );
    },
  },
  {
    key: 'uncategorized',
    label: 'UNCATEGORIZED',
    match: (img) => {
      const zone = String(img?.vehicle_zone || '').trim().toLowerCase();
      return !zone || zone === 'other' || zone === 'null' || zone === 'undefined';
    },
  },
];

/**
 * Assign images to zone sections. Each image appears in at most one non-virtual section,
 * but may also appear in HIGHLIGHTS if it qualifies.
 */
export function groupImagesByZone(images: any[]): { section: ZoneSectionDef; images: any[] }[] {
  const result: { section: ZoneSectionDef; images: any[] }[] = [];
  const assigned = new Set<string>();

  // 1. Build virtual sections first (HIGHLIGHTS)
  for (const section of ZONE_SECTIONS) {
    if (!section.virtual) continue;
    const matching = images.filter((img) => section.match(img));
    // Sort by photo_quality_score DESC, then by position/created_at
    const sorted = sortByQuality(matching);
    result.push({ section, images: sorted });
    // Virtual sections do NOT consume images from other sections
  }

  // 2. Build physical sections
  for (const section of ZONE_SECTIONS) {
    if (section.virtual) continue;
    const matching = images.filter((img) => {
      const id = String(img?.id || '');
      if (assigned.has(id)) return false;
      return section.match(img);
    });
    // Mark as assigned
    for (const img of matching) {
      const id = String(img?.id || '');
      if (id) assigned.add(id);
    }
    const sorted = sortByQuality(matching);
    if (sorted.length > 0) {
      result.push({ section, images: sorted });
    }
  }

  // 3. Catch any remaining images not matched by any section
  const remaining = images.filter((img) => !assigned.has(String(img?.id || '')));
  if (remaining.length > 0) {
    const uncatSection = ZONE_SECTIONS.find((s) => s.key === 'uncategorized');
    if (uncatSection) {
      // Merge with existing uncategorized if it exists
      const existing = result.find((r) => r.section.key === 'uncategorized');
      if (existing) {
        existing.images = sortByQuality([...existing.images, ...remaining]);
      } else {
        result.push({ section: uncatSection, images: sortByQuality(remaining) });
      }
    }
  }

  return result;
}

/** Sort images by photo_quality_score DESC (best first), then most recent taken_at/created_at */
function sortByQuality(images: any[]): any[] {
  return [...images].sort((a, b) => {
    const qa = typeof a?.photo_quality_score === 'number' ? a.photo_quality_score : 0;
    const qb = typeof b?.photo_quality_score === 'number' ? b.photo_quality_score : 0;
    if (qa !== qb) return qb - qa; // higher quality first

    // Tie-break: most recent taken_at (freshest first), fallback to created_at
    const dateA = a?.taken_at ? new Date(a.taken_at).getTime() : (a?.created_at ? new Date(a.created_at).getTime() : 0);
    const dateB = b?.taken_at ? new Date(b.taken_at).getTime() : (b?.created_at ? new Date(b.created_at).getTime() : 0);
    if (dateA !== dateB) return dateB - dateA;

    // Final tie-break: position
    const posA = typeof a?.position === 'number' ? a.position : Infinity;
    const posB = typeof b?.position === 'number' ? b.position : Infinity;
    return posA - posB;
  });
}

// --- Helper: Get optimal image URL ---

const getOptimalImageUrl = (image: any, size: 'thumbnail' | 'medium' | 'large' | 'full' = 'medium'): string => {
  if (image.variants && typeof image.variants === 'object') {
    const variant = image.variants[size];
    if (variant) return variant;
    if (size === 'thumbnail') return image.variants.thumbnail || image.variants.medium || image.thumbnail_url || image.image_url;
    if (size === 'medium') return image.variants.medium || image.variants.large || image.variants.thumbnail || image.medium_url || image.image_url;
  }
  if (size === 'thumbnail') return image.thumbnail_url || image.image_url;
  if (size === 'medium') return image.medium_url || image.image_url;
  return image.image_url || '';
};

// --- Component Props ---

interface ImageZoneSectionProps {
  section: ZoneSectionDef;
  images: any[];
  defaultOpen: boolean;
  imagesPerRow: number;
  vehicleId: string;
  onImageClick: (image: any, globalIndex: number) => void;
  /** Map from image.id to global index in displayedImages (for lightbox) */
  globalIndexMap: Map<string, number>;
  selectMode?: boolean;
  selectedImages?: Set<string>;
  onImageSelect?: (imageId: string, event: React.MouseEvent) => void;
  /** When set (e.g. for listing-only fallback), use this instead of section.label in the header */
  sectionLabelOverride?: string;
}

const ImageZoneSection: React.FC<ImageZoneSectionProps> = ({
  section,
  images,
  defaultOpen,
  imagesPerRow,
  vehicleId,
  onImageClick,
  globalIndexMap,
  selectMode = false,
  selectedImages,
  onImageSelect,
  sectionLabelOverride,
}) => {
  const [collapsed, setCollapsed] = useState(!defaultOpen);

  if (images.length === 0) return null;

  const displayLabel = sectionLabelOverride ?? section.label;

  return (
    <div data-zone-section={section.key} style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Section Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          cursor: 'pointer',
          backgroundColor: 'var(--grey-50, #fafafa)',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: 'Arial, Helvetica, sans-serif',
              color: 'var(--text)',
              letterSpacing: '0.5px',
            }}
          >
            {displayLabel}
          </span>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              fontFamily: 'Arial, Helvetica, sans-serif',
              color: 'var(--text-muted)',
              backgroundColor: 'var(--grey-200, #e5e5e5)',
              padding: '1px 6px',
              minWidth: '18px',
              textAlign: 'center',
            }}
          >
            {images.length}
          </span>
        </div>
        <span
          style={{
            fontSize: '9px',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}
        >
          {collapsed ? '\u25B6' : '\u25BC'}
        </span>
      </div>

      {/* Image Grid (expanded) */}
      {!collapsed && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${imagesPerRow}, 1fr)`,
            gap: 0,
          }}
        >
          {images.map((image) => {
            const globalIndex = globalIndexMap.get(String(image.id || '')) ?? -1;
            const isSelected = selectMode && selectedImages?.has(image.id);
            const deepScore = image.ai_scan_metadata?.deep_analysis?.condition_detail?.overall_score;
            const conditionScore =
              typeof deepScore === 'number' ? deepScore :
              typeof image.condition_score === 'number' ? image.condition_score : null;
            const isDeepScore = typeof deepScore === 'number';
            const damageFlags: string[] = Array.isArray(image.damage_flags)
              ? image.damage_flags
              : [];
            const hasDamage = damageFlags.length > 0;

            return (
              <div
                key={image.id}
                style={{
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  backgroundColor: 'var(--grey-100)',
                  aspectRatio: '1 / 1',
                  border: 'none',
                }}
                onClick={(e) => {
                  if (selectMode && onImageSelect) {
                    onImageSelect(image.id, e);
                  } else {
                    onImageClick(image, globalIndex);
                  }
                }}
              >
                {/* Selection Checkbox */}
                {selectMode && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'var(--space-1)',
                      left: 'var(--space-1)',
                      width: '24px',
                      height: '24px',
                      backgroundColor: isSelected ? 'var(--grey-900)' : 'var(--white)',
                      border: '2px solid var(--grey-900)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 20,
                      cursor: 'pointer',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onImageSelect?.(image.id, e);
                    }}
                  >
                    {isSelected && (
                      <span style={{ color: 'var(--white)', fontWeight: 'bold', fontSize: '13px' }}>
                        X
                      </span>
                    )}
                  </div>
                )}

                {/* Image */}
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden',
                    backgroundColor: 'var(--grey-100)',
                    position: 'relative',
                  }}
                >
                  <SensitiveImageOverlay
                    imageId={image.id}
                    vehicleId={vehicleId}
                    imageUrl={getOptimalImageUrl(image, 'medium')}
                    isSensitive={image.is_sensitive || false}
                    sensitiveType={image.sensitive_type}
                    objectFit="cover"
                  />
                </div>

                {/* Condition Score Badge (bottom-left) */}
                {conditionScore != null && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      left: '4px',
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      color: '#fff',
                      padding: '1px 5px',
                      fontSize: '9px',
                      fontWeight: 700,
                      fontFamily: 'Arial, Helvetica, sans-serif',
                      zIndex: 10,
                      lineHeight: '14px',
                    }}
                    title={`Condition: ${conditionScore}/${isDeepScore ? 10 : 5}`}
                  >
                    {'\u2605'}{conditionScore}{isDeepScore ? '' : ''}
                  </div>
                )}

                {/* Damage Indicator (bottom-left, next to condition) */}
                {hasDamage && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      left: conditionScore != null ? '42px' : '4px',
                      width: '8px',
                      height: '8px', backgroundColor: '#e53e3e',
                      border: '1px solid rgba(255,255,255,0.8)',
                      zIndex: 10,
                    }}
                    title={`Damage: ${damageFlags.join(', ')}`}
                  />
                )}

                {/* Fabrication Stage Badge (bottom-right) */}
                {image.ai_scan_metadata?.deep_analysis?.fabrication_stage && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      right: '4px',
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      color: 'rgba(255, 255, 255, 0.85)',
                      padding: '1px 5px',
                      fontSize: '8px',
                      fontWeight: 700,
                      fontFamily: 'Arial, Helvetica, sans-serif',
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.03em',
                      zIndex: 10,
                      lineHeight: '12px',
                    }}
                    title={`Stage: ${image.ai_scan_metadata.deep_analysis.fabrication_stage.replace(/_/g, ' ')}`}
                  >
                    {image.ai_scan_metadata.deep_analysis.fabrication_stage.replace(/_/g, ' ')}
                  </div>
                )}

                {/* Photo Quality Badge (top-right, subtle) */}
                {typeof image.photo_quality_score === 'number' && image.photo_quality_score >= 4 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      backgroundColor: 'rgba(0, 0, 0, 0.55)',
                      color: '#ffd700',
                      padding: '1px 4px',
                      fontSize: '8px',
                      fontWeight: 700,
                      fontFamily: 'Arial, Helvetica, sans-serif',
                      zIndex: 10,
                      lineHeight: '12px',
                    }}
                    title={`Photo quality: ${image.photo_quality_score}/5`}
                  >
                    Q{image.photo_quality_score}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ImageZoneSection;
