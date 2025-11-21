/**
 * Image Display Priority Service
 * 
 * Sorts vehicle images by display priority:
 * 1. Essential angles (money shots) - newest/best quality first
 * 2. Supporting angles - chronological
 * 3. Historical documentation - chronological
 * 4. Work documentation - buried at the end
 */

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
  // Image angle tagging (from vehicle_image_angles)
  angles?: Array<{
    angle_name: string;
    is_essential: boolean;
    category: string;
    confidence_score?: number;
    perspective?: string;
  }>;
}

// Essential angles that should be displayed first (the "money shots")
export const ESSENTIAL_ANGLE_PRIORITY: Record<string, number> = {
  // Exterior hero shots (highest priority)
  'Front Quarter (Driver)': 100,
  'Front Quarter (Passenger)': 95,
  'Rear Quarter (Driver)': 90,
  'Rear Quarter (Passenger)': 85,
  'Profile (Driver Side)': 80,
  'Profile (Passenger Side)': 75,
  'Front Straight': 70,
  'Rear Straight': 65,
  
  // Interior hero shots
  'Dashboard (Full View)': 60,
  'Driver Seat': 55,
  'Passenger Seat': 50,
  'Rear Seats': 45,
  
  // Engine bay beauty shots
  'Engine (Full View)': 40,
  'Engine (Driver Side)': 35,
  'Engine (Passenger Side)': 30,
  
  // VIN documentation (important but not "hero" shots)
  'VIN (Door Jamb)': 25,
  'VIN (Dashboard)': 20,
  
  // Undercarriage (technical, lower priority)
  'Frame (Driver Front)': 15,
  'Frame (Passenger Front)': 14,
  'Frame (Driver Rear)': 13,
  'Frame (Passenger Rear)': 12,
  'Front Suspension': 11,
  'Rear Suspension': 10,
};

/**
 * Calculate display priority score for an image
 */
function calculatePriorityScore(image: VehicleImage): number {
  let score = 0;
  
  // 1. Check if it's a work documentation image or low-quality type (should be buried)
  const category = (image.category || '').toLowerCase();
  const isDocument = category.includes('document') || category.includes('receipt') || category.includes('invoice') || category.includes('screenshot');
  const isPart = category.includes('part') || category.includes('component') || category.includes('tool');
  
  if ((image.is_sensitive && (
    image.sensitivity_type === 'work_order' ||
    image.sensitivity_type === 'internal_only'
  )) || isDocument) {
    return -1000; // Very low priority - buried at the end
  }

  if (isPart) {
    return -500; // Low priority - below vehicle shots but above docs
  }
  
  // 2. Check for essential angles
  if (image.angles && image.angles.length > 0) {
    // Get the highest priority angle for this image
    const highestAnglePriority = Math.max(
      ...image.angles.map(angle => {
        const basePriority = ESSENTIAL_ANGLE_PRIORITY[angle.angle_name] || 0;
        
        // Bonus for high confidence
        const confidenceBonus = (angle.confidence_score || 50) / 10;
        
        // Bonus for good perspective (wide angle for exteriors, standard for interiors)
        let perspectiveBonus = 0;
        if (angle.perspective === 'wide_angle' && angle.category === 'exterior') {
          perspectiveBonus = 10;
        } else if (angle.perspective === 'standard' && angle.category === 'interior') {
          perspectiveBonus = 10;
        }
        
        return basePriority + confidenceBonus + perspectiveBonus;
      })
    );
    
    score += highestAnglePriority;
  }
  
  // 3. Recency bonus for essential angles (newer is better for money shots)
  if (score > 50) { // Only for high-priority angles
    const imageDate = new Date(image.taken_at || image.uploaded_at || image.created_at || Date.now());
    const now = new Date();
    const daysSinceImage = (now.getTime() - imageDate.getTime()) / (1000 * 60 * 60 * 24);
    
    // Newer images get bonus (up to +20 for images less than 30 days old)
    if (daysSinceImage < 30) {
      score += (30 - daysSinceImage) / 30 * 20;
    }
  }
  
  // 4. Category bonuses
  if (image.category === 'hero') score += 50;
  if (image.category === 'exterior') score += 20;
  if (image.category === 'interior') score += 15;
  if (image.category === 'engine') score += 10;
  
  return score;
}

/**
 * Sort images by display priority
 */
export function sortImagesByPriority(images: VehicleImage[]): VehicleImage[] {
  // Calculate scores for all images
  const imagesWithScores = images.map(image => ({
    image,
    score: calculatePriorityScore(image),
    date: new Date(image.taken_at || image.uploaded_at || image.created_at || Date.now())
  }));
  
  // Sort by:
  // 1. Priority score (descending) - high priority first
  // 2. Within same score tier, by date (descending) - newest first for hero shots
  // 3. For negative scores (work docs), oldest first
  return imagesWithScores.sort((a, b) => {
    // First by score
    if (Math.abs(a.score - b.score) > 5) { // 5-point tolerance for same "tier"
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
  }).map(item => item.image);
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
    heroShots: sorted.filter(img => calculatePriorityScore(img) >= 50),
    supporting: sorted.filter(img => {
      const score = calculatePriorityScore(img);
      return score >= 10 && score < 50;
    }),
    historical: sorted.filter(img => {
      const score = calculatePriorityScore(img);
      return score >= 0 && score < 10;
    }),
    workDocs: sorted.filter(img => calculatePriorityScore(img) < 0)
  };
}

/**
 * Get the "lead" image (best hero shot)
 */
export function getLeadImage(images: VehicleImage[]): VehicleImage | null {
  const sorted = sortImagesByPriority(images);
  return sorted[0] || null;
}

