/**
 * Image Display Priority Service
 *
 * Sorts vehicle images by display priority using the vehicle_zone system:
 * 1. Money shots (3/4 views) - highest priority, newest/best quality first
 * 2. Primary exterior views - front, rear, side
 * 3. Interior + mechanical highlights
 * 4. Detail, panels, wheels
 * 5. Work documentation - buried at the end
 *
 * Replaces the legacy angle-based scoring system. All scoring is now driven
 * by `vehicle_zone` values (41-zone taxonomy) with `zone_confidence` as a
 * quality multiplier.
 */

import {
  ZONE_DISPLAY_PRIORITY,
  ANGLE_TO_ZONE_MAP,
  resolveToZone,
} from '../constants/vehicleZones';

interface VehicleImage {
  id: string;
  image_url: string;
  thumbnail_url?: string;
  medium_url?: string;
  large_url?: string;
  taken_at?: string;
  uploaded_at?: string;
  created_at?: string;
  category?: string;
  is_sensitive?: boolean;
  sensitivity_type?: string;
  exif_data?: any;
  // New vehicle_zone system (preferred)
  vehicle_zone?: string;
  zone_confidence?: number;
  photo_quality_score?: number;
  // DEPRECATED: Legacy angle tagging (from vehicle_image_angles).
  // Kept for backward compatibility during migration. Use vehicle_zone instead.
  angles?: Array<{
    angle_name: string;
    is_essential: boolean;
    category: string;
    confidence_score?: number;
    perspective?: string;
  }>;
}

// ---------------------------------------------------------------------------
// DEPRECATED -- Legacy angle priority map.
// Kept only for fallback when vehicle_zone is not yet populated.
// New images should always have vehicle_zone set by YONO.
// ---------------------------------------------------------------------------
/** @deprecated Use ZONE_DISPLAY_PRIORITY from constants/vehicleZones instead */
export const ESSENTIAL_ANGLE_PRIORITY: Record<string, number> = {
  'Front Quarter (Driver)': 100,
  'Front Quarter (Passenger)': 95,
  'Rear Quarter (Driver)': 90,
  'Rear Quarter (Passenger)': 85,
  'Profile (Driver Side)': 80,
  'Profile (Passenger Side)': 75,
  'Front Straight': 70,
  'Rear Straight': 65,
  'Dashboard (Full View)': 60,
  'Driver Seat': 55,
  'Passenger Seat': 50,
  'Rear Seats': 45,
  'Engine (Full View)': 40,
  'Engine (Driver Side)': 35,
  'Engine (Passenger Side)': 30,
  'VIN (Door Jamb)': 25,
  'VIN (Dashboard)': 20,
  'Frame (Driver Front)': 15,
  'Frame (Passenger Front)': 14,
  'Frame (Driver Rear)': 13,
  'Frame (Passenger Rear)': 12,
  'Front Suspension': 11,
  'Rear Suspension': 10,
};

/**
 * Calculate display priority score for an image.
 *
 * Scoring hierarchy:
 *   1. vehicle_zone priority (from ZONE_DISPLAY_PRIORITY) -- primary signal
 *   2. zone_confidence multiplier -- higher confidence = higher score
 *   3. photo_quality_score bonus -- YONO quality assessment
 *   4. Category fallback -- when no zone data exists
 *   5. Recency bonus -- newer money shots rank higher
 *   6. Penalty for work docs / sensitive images
 */
function calculatePriorityScore(image: VehicleImage): number {
  let score = 0;

  // ---- Penalty tier: bury work docs & sensitive content ----
  const category = (image.category || '').toLowerCase();
  const isDocument =
    category.includes('document') ||
    category.includes('receipt') ||
    category.includes('invoice') ||
    category.includes('screenshot');
  const isPart =
    category.includes('part') ||
    category.includes('component') ||
    category.includes('tool');

  if (
    (image.is_sensitive &&
      (image.sensitivity_type === 'work_order' ||
        image.sensitivity_type === 'internal_only')) ||
    isDocument
  ) {
    return -1000;
  }

  if (isPart) {
    return -500;
  }

  // ---- Primary scoring: vehicle_zone ----
  const zone = image.vehicle_zone?.trim().toLowerCase();
  if (zone && zone !== 'other' && zone !== 'null' && zone !== 'undefined') {
    const basePriority = ZONE_DISPLAY_PRIORITY[zone] || 0;

    // zone_confidence multiplier: range 0-100, normalize to 0-1, scale effect
    // A perfect confidence (100) adds up to +10 bonus; zero confidence adds nothing
    const confidence = typeof image.zone_confidence === 'number' ? image.zone_confidence : 50;
    const confidenceBonus = (confidence / 100) * 10;

    score += basePriority + confidenceBonus;
  }
  // ---- Fallback: legacy angle data (DEPRECATED path) ----
  else if (image.angles && image.angles.length > 0) {
    // DEPRECATED: migrate to vehicle_zone
    const highestAnglePriority = Math.max(
      ...image.angles.map((angle) => {
        const basePriority = ESSENTIAL_ANGLE_PRIORITY[angle.angle_name] || 0;
        const confidenceBonus = (angle.confidence_score || 50) / 10;
        let perspectiveBonus = 0;
        if (angle.perspective === 'wide_angle' && angle.category === 'exterior') {
          perspectiveBonus = 10;
        } else if (angle.perspective === 'standard' && angle.category === 'interior') {
          perspectiveBonus = 10;
        }
        return basePriority + confidenceBonus + perspectiveBonus;
      }),
    );
    score += highestAnglePriority;
  }

  // ---- Photo quality bonus (from YONO) ----
  if (typeof image.photo_quality_score === 'number' && image.photo_quality_score > 0) {
    // Score is 1-5; map to 0-15 bonus
    score += (image.photo_quality_score / 5) * 15;
  }

  // ---- Recency bonus for money shots ----
  if (score > 50) {
    const imageDate = new Date(
      image.taken_at || image.uploaded_at || image.created_at || Date.now(),
    );
    const now = new Date();
    const daysSinceImage =
      (now.getTime() - imageDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceImage < 30) {
      score += ((30 - daysSinceImage) / 30) * 20;
    }
  }

  // ---- Category fallback bonus (when no zone data at all) ----
  if (!zone && (!image.angles || image.angles.length === 0)) {
    if (category === 'hero') score += 50;
    if (category === 'exterior') score += 20;
    if (category === 'interior') score += 15;
    if (category === 'engine') score += 10;
  }

  return score;
}

/**
 * Sort images by display priority
 */
export function sortImagesByPriority(images: VehicleImage[]): VehicleImage[] {
  const imagesWithScores = images.map((image) => ({
    image,
    score: calculatePriorityScore(image),
    date: new Date(
      image.taken_at || image.uploaded_at || image.created_at || Date.now(),
    ),
  }));

  return imagesWithScores
    .sort((a, b) => {
      // First by score
      if (Math.abs(a.score - b.score) > 5) {
        return b.score - a.score;
      }

      // Within same tier, sort by date
      if (a.score < 0 && b.score < 0) {
        // Work docs: oldest first (buried but chronological)
        return a.date.getTime() - b.date.getTime();
      } else {
        // Hero/normal shots: newest first
        return b.date.getTime() - a.date.getTime();
      }
    })
    .map((item) => item.image);
}

/**
 * Group images by priority tier for display
 */
export function groupImagesByTier(images: VehicleImage[]): {
  heroShots: VehicleImage[];
  supporting: VehicleImage[];
  historical: VehicleImage[];
  workDocs: VehicleImage[];
} {
  const sorted = sortImagesByPriority(images);

  return {
    heroShots: sorted.filter((img) => calculatePriorityScore(img) >= 50),
    supporting: sorted.filter((img) => {
      const s = calculatePriorityScore(img);
      return s >= 10 && s < 50;
    }),
    historical: sorted.filter((img) => {
      const s = calculatePriorityScore(img);
      return s >= 0 && s < 10;
    }),
    workDocs: sorted.filter((img) => calculatePriorityScore(img) < 0),
  };
}

/**
 * Get the "lead" image (best hero shot)
 */
export function getLeadImage(images: VehicleImage[]): VehicleImage | null {
  const sorted = sortImagesByPriority(images);
  return sorted[0] || null;
}
