/**
 * Image Coverage Tracker
 *
 * Analyzes vehicle image coverage using the vehicle_zone system:
 * - "Every inch of this thing has been photographed"
 * - Tracks which zones have documented images
 * - Calculates coverage percentage against essential zones
 * - Identifies missing coverage areas
 *
 * Uses `vehicle_zone` (41-zone taxonomy) as the primary classification.
 * Falls back to legacy `angle_family` / `angle_name` data where zone has
 * not yet been populated. Legacy paths are marked DEPRECATED.
 */

import { supabase } from '../lib/supabase';
import {
  ZONE_CATEGORIES,
  ZONE_LABELS,
  ESSENTIAL_ZONES,
  ZONE_DISPLAY_PRIORITY,
  ANGLE_FAMILY_TO_ZONE_MAP,
  resolveToZone,
  getZoneLabel,
  getZoneCategory,
} from '../constants/vehicleZones';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverageZone {
  zone: string;
  label: string;
  category: string;
  is_essential: boolean;
}

// DEPRECATED: Keep CoverageAngle as an alias for backward compatibility
/** @deprecated Use CoverageZone instead */
export interface CoverageAngle {
  angle_name: string;
  category: 'exterior' | 'interior' | 'engine' | 'undercarriage' | 'detail' | 'document';
  is_essential: boolean;
  description?: string;
}

export interface CoverageStatus {
  zone: string;
  label: string;
  category: string;
  is_essential: boolean;
  has_coverage: boolean;
  image_count: number;
  best_image_id?: string;
  best_confidence?: number;
  images: Array<{
    id: string;
    image_url: string;
    confidence: number;
    zone: string;
  }>;
  // DEPRECATED: kept for backward compatibility
  angle_name: string;
  angle_family: string;
}

export interface VehicleCoverageReport {
  vehicle_id: string;
  total_images: number;
  classified_images: number;
  essential_coverage: {
    covered: number;
    total: number;
    percentage: number;
  };
  category_coverage: {
    exterior: { covered: number; total: number; percentage: number };
    interior: { covered: number; total: number; percentage: number };
    mechanical: { covered: number; total: number; percentage: number };
    detail: { covered: number; total: number; percentage: number };
    // DEPRECATED: legacy categories kept for backward compat
    engine: { covered: number; total: number; percentage: number };
    undercarriage: { covered: number; total: number; percentage: number };
    document: { covered: number; total: number; percentage: number };
  };
  zone_statuses: CoverageStatus[];
  missing_essential: string[];
  recommendations: string[];
  // DEPRECATED: alias
  angle_statuses: CoverageStatus[];
}

// ---------------------------------------------------------------------------
// Essential zones
// ---------------------------------------------------------------------------

/**
 * Get essential zones for coverage checking.
 * Tries the DB table first (image_coverage_angles), falls back to constants.
 */
export async function getEssentialZones(): Promise<CoverageZone[]> {
  try {
    const { data, error } = await supabase
      .from('image_coverage_angles')
      .select('angle_name, category, is_essential, description, display_name')
      .eq('is_essential', true)
      .order('category', { ascending: true })
      .order('priority_order', { ascending: true, nullsLast: true })
      .order('angle_name', { ascending: true });

    if (error) throw error;

    if (data && data.length > 0) {
      return data.map((row) => {
        const zoneName = resolveToZone(row.angle_name);
        return {
          zone: zoneName,
          label: row.display_name || getZoneLabel(zoneName),
          category: getZoneCategory(zoneName) || row.category,
          is_essential: row.is_essential,
        };
      });
    }

    return getDefaultEssentialZones();
  } catch {
    return getDefaultEssentialZones();
  }
}

/** @deprecated Use getEssentialZones instead */
export async function getEssentialAngles(): Promise<CoverageAngle[]> {
  const zones = await getEssentialZones();
  // DEPRECATED: migrate to vehicle_zone
  return zones.map((z) => ({
    angle_name: z.label,
    category: mapCategoryToLegacy(z.category),
    is_essential: z.is_essential,
  }));
}

function mapCategoryToLegacy(category: string): CoverageAngle['category'] {
  const map: Record<string, CoverageAngle['category']> = {
    EXTERIOR: 'exterior',
    INTERIOR: 'interior',
    MECHANICAL: 'engine',
    DETAIL: 'detail',
    PANELS: 'exterior',
    WHEELS: 'exterior',
    OTHER: 'document',
  };
  return map[category] || 'exterior';
}

/**
 * Default essential zones from constants (no DB required)
 */
function getDefaultEssentialZones(): CoverageZone[] {
  return ESSENTIAL_ZONES.map((zone) => ({
    zone,
    label: getZoneLabel(zone),
    category: getZoneCategory(zone) || 'OTHER',
    is_essential: true,
  }));
}

// ---------------------------------------------------------------------------
// Coverage analysis
// ---------------------------------------------------------------------------

/**
 * Analyze coverage for a specific vehicle using vehicle_zone data.
 */
export async function analyzeVehicleCoverage(vehicleId: string): Promise<VehicleCoverageReport> {
  try {
    const essentialZones = await getEssentialZones();

    // Get all images for this vehicle, including vehicle_zone
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, thumbnail_url, created_at, vehicle_zone, zone_confidence, photo_quality_score')
      .eq('vehicle_id', vehicleId);

    if (imagesError) throw imagesError;

    // Count images that have a vehicle_zone assigned
    const classifiedImages = (images || []).filter(
      (img) => img.vehicle_zone && img.vehicle_zone !== 'other',
    );

    // Build coverage status for each essential zone
    const zoneStatuses: CoverageStatus[] = essentialZones.map((essential) => {
      // Find images matching this zone
      const matchingImages: CoverageStatus['images'] = [];

      // Primary path: match on vehicle_zone
      (images || []).forEach((img) => {
        const imgZone = (img.vehicle_zone || '').trim().toLowerCase();
        if (imgZone === essential.zone) {
          matchingImages.push({
            id: img.id,
            image_url: img.image_url || img.thumbnail_url || '',
            confidence: typeof img.zone_confidence === 'number' ? img.zone_confidence : 0,
            zone: imgZone,
          });
        }
      });

      // Find best image (highest confidence)
      const bestImage =
        matchingImages.length > 0
          ? matchingImages.reduce((best, current) =>
              current.confidence > (best.confidence || 0) ? current : best,
            )
          : undefined;

      return {
        zone: essential.zone,
        label: essential.label,
        category: essential.category,
        is_essential: essential.is_essential,
        has_coverage: matchingImages.length > 0,
        image_count: matchingImages.length,
        best_image_id: bestImage?.id,
        best_confidence: bestImage?.confidence,
        images: matchingImages,
        // DEPRECATED: backward compat aliases
        angle_name: essential.label,
        angle_family: essential.zone,
      };
    });

    // Calculate coverage statistics
    const essentialStatuses = zoneStatuses.filter((s) => s.is_essential);
    const essentialCovered = essentialStatuses.filter((s) => s.has_coverage).length;
    const essentialTotal = essentialStatuses.length;

    // Category coverage
    const categoryCoverage = {
      exterior: calculateZoneCategoryCoverage(images || [], 'EXTERIOR'),
      interior: calculateZoneCategoryCoverage(images || [], 'INTERIOR'),
      mechanical: calculateZoneCategoryCoverage(images || [], 'MECHANICAL'),
      detail: calculateZoneCategoryCoverage(images || [], 'DETAIL'),
      // DEPRECATED: legacy category aliases
      engine: calculateZoneCategoryCoverage(images || [], 'MECHANICAL'),
      undercarriage: calculateSingleZoneCoverage(images || [], 'ext_undercarriage'),
      document: calculateZoneCategoryCoverage(images || [], 'OTHER'),
    };

    // Missing essential zones
    const missingEssential = essentialStatuses
      .filter((s) => !s.has_coverage)
      .map((s) => s.label);

    // Generate recommendations
    const recommendations = generateRecommendations(zoneStatuses, missingEssential);

    return {
      vehicle_id: vehicleId,
      total_images: images?.length || 0,
      classified_images: classifiedImages.length,
      essential_coverage: {
        covered: essentialCovered,
        total: essentialTotal,
        percentage:
          essentialTotal > 0 ? Math.round((essentialCovered / essentialTotal) * 100) : 0,
      },
      category_coverage: categoryCoverage,
      zone_statuses: zoneStatuses,
      missing_essential: missingEssential,
      recommendations,
      // DEPRECATED: alias
      angle_statuses: zoneStatuses,
    };
  } catch (error) {
    console.error('Error analyzing vehicle coverage:', error);
    throw error;
  }
}

/**
 * Calculate coverage for a zone category using vehicle_zone data.
 */
function calculateZoneCategoryCoverage(
  images: Array<{ vehicle_zone?: string }>,
  categoryKey: string,
): { covered: number; total: number; percentage: number } {
  const categoryZones = ZONE_CATEGORIES[categoryKey as keyof typeof ZONE_CATEGORIES];
  if (!categoryZones) return { covered: 0, total: 0, percentage: 0 };

  const total = categoryZones.length;
  const coveredZones = new Set<string>();

  for (const img of images) {
    const zone = (img.vehicle_zone || '').trim().toLowerCase();
    if ((categoryZones as readonly string[]).includes(zone)) {
      coveredZones.add(zone);
    }
  }

  const covered = coveredZones.size;
  return {
    covered,
    total,
    percentage: total > 0 ? Math.round((covered / total) * 100) : 0,
  };
}

/**
 * Calculate coverage for a single specific zone.
 */
function calculateSingleZoneCoverage(
  images: Array<{ vehicle_zone?: string }>,
  targetZone: string,
): { covered: number; total: number; percentage: number } {
  const hasImage = images.some(
    (img) => (img.vehicle_zone || '').trim().toLowerCase() === targetZone,
  );
  return {
    covered: hasImage ? 1 : 0,
    total: 1,
    percentage: hasImage ? 100 : 0,
  };
}

function generateRecommendations(
  statuses: CoverageStatus[],
  missingEssential: string[],
): string[] {
  const recommendations: string[] = [];

  if (missingEssential.length > 0) {
    recommendations.push(
      `Missing ${missingEssential.length} essential zone${missingEssential.length !== 1 ? 's' : ''}: ${missingEssential.slice(0, 3).join(', ')}${missingEssential.length > 3 ? '...' : ''}`,
    );
  }

  // Check for low confidence images
  const lowConfidence = statuses.filter(
    (s) => s.has_coverage && s.best_confidence != null && s.best_confidence < 70,
  );
  if (lowConfidence.length > 0) {
    recommendations.push(
      `${lowConfidence.length} zone${lowConfidence.length !== 1 ? 's' : ''} have low confidence scores - consider retaking photos`,
    );
  }

  // Category-specific recommendations
  const categoryChecks = [
    { name: 'Exterior', category: 'EXTERIOR', statuses: statuses.filter((s) => s.category === 'EXTERIOR') },
    { name: 'Interior', category: 'INTERIOR', statuses: statuses.filter((s) => s.category === 'INTERIOR') },
    { name: 'Mechanical', category: 'MECHANICAL', statuses: statuses.filter((s) => s.category === 'MECHANICAL') },
  ];

  for (const check of categoryChecks) {
    const covered = check.statuses.filter((a) => a.has_coverage).length;
    const total = check.statuses.length;
    if (total > 0 && covered < total * 0.5) {
      recommendations.push(
        `${check.name} coverage is incomplete (${covered}/${total} zones)`,
      );
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('Excellent coverage! All essential zones are documented.');
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Summary helpers
// ---------------------------------------------------------------------------

/**
 * Get coverage summary for quick display
 */
export async function getCoverageSummary(vehicleId: string): Promise<{
  essential_percentage: number;
  total_images: number;
  missing_count: number;
}> {
  const report = await analyzeVehicleCoverage(vehicleId);
  return {
    essential_percentage: report.essential_coverage.percentage,
    total_images: report.total_images,
    missing_count: report.missing_essential.length,
  };
}
