/**
 * Image Coverage Tracker
 * 
 * Analyzes vehicle image coverage to determine completeness:
 * - "Every inch of this thing has been photographed"
 * - Tracks which angles/parts/areas are documented
 * - Calculates coverage percentage
 * - Identifies missing coverage areas
 */

import { supabase } from '../lib/supabase';

export interface CoverageAngle {
  angle_name: string;
  category: 'exterior' | 'interior' | 'engine' | 'undercarriage' | 'detail' | 'document';
  is_essential: boolean;
  description?: string;
}

export interface CoverageStatus {
  angle_name: string;
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
    angle_family: string;
  }>;
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
    engine: { covered: number; total: number; percentage: number };
    undercarriage: { covered: number; total: number; percentage: number };
    detail: { covered: number; total: number; percentage: number };
    document: { covered: number; total: number; percentage: number };
  };
  angle_statuses: CoverageStatus[];
  missing_essential: string[];
  recommendations: string[];
}

/**
 * Get all essential angles that should be photographed
 */
export async function getEssentialAngles(): Promise<CoverageAngle[]> {
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
      return data.map(angle => ({
        angle_name: angle.display_name || angle.angle_name, // Use display_name if available
        category: angle.category as CoverageAngle['category'],
        is_essential: angle.is_essential,
        description: angle.description
      }));
    }
    
    // Fallback to hardcoded essential angles
    return getDefaultEssentialAngles();
  } catch (error) {
    console.error('Error loading essential angles:', error);
    // Fallback to hardcoded essential angles
    return getDefaultEssentialAngles();
  }
}

/**
 * Get default essential angles if table doesn't exist
 */
function getDefaultEssentialAngles(): CoverageAngle[] {
  return [
    // Exterior essentials
    { angle_name: 'Front Quarter (Driver)', category: 'exterior', is_essential: true },
    { angle_name: 'Front Quarter (Passenger)', category: 'exterior', is_essential: true },
    { angle_name: 'Rear Quarter (Driver)', category: 'exterior', is_essential: true },
    { angle_name: 'Rear Quarter (Passenger)', category: 'exterior', is_essential: true },
    { angle_name: 'Profile (Driver Side)', category: 'exterior', is_essential: true },
    { angle_name: 'Profile (Passenger Side)', category: 'exterior', is_essential: true },
    { angle_name: 'Front Straight', category: 'exterior', is_essential: true },
    { angle_name: 'Rear Straight', category: 'exterior', is_essential: true },
    
    // Interior essentials
    { angle_name: 'Dashboard (Full View)', category: 'interior', is_essential: true },
    { angle_name: 'Driver Seat', category: 'interior', is_essential: true },
    
    // Engine essentials
    { angle_name: 'Engine (Full View)', category: 'engine', is_essential: true },
    
    // Document essentials
    { angle_name: 'VIN (Door Jamb)', category: 'document', is_essential: true },
    { angle_name: 'VIN (Dashboard)', category: 'document', is_essential: true },
  ];
}

/**
 * Analyze coverage for a specific vehicle
 */
export async function analyzeVehicleCoverage(vehicleId: string): Promise<VehicleCoverageReport> {
  try {
    // Get all essential angles
    const essentialAngles = await getEssentialAngles();
    
    // Get all images for this vehicle
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, thumbnail_url, created_at')
      .eq('vehicle_id', vehicleId);

    if (imagesError) throw imagesError;

    // Get all classifications for this vehicle
    const { data: classifications, error: classError } = await supabase
      .from('ai_angle_classifications_audit')
      .select('*')
      .eq('vehicle_id', vehicleId);

    if (classError) throw classError;

    // Get angle mappings
    const { data: angleMappings, error: mappingError } = await supabase
      .from('vehicle_image_angles')
      .select(`
        image_id,
        angle_id,
        confidence_score,
        image_coverage_angles (
          angle_name,
          category,
          is_essential
        )
      `)
      .eq('vehicle_id', vehicleId);

    if (mappingError) {
      console.warn('Error loading angle mappings:', mappingError);
    }

    // Build coverage status for each essential angle
    const angleStatuses: CoverageStatus[] = essentialAngles.map(angle => {
      // Find images that match this angle
      const matchingImages: CoverageStatus['images'] = [];
      
      // Check angle mappings first
      const mappedImages = (angleMappings || []).filter(m => 
        m.image_coverage_angles?.angle_name === angle.angle_name
      );
      
      mappedImages.forEach(m => {
        const img = images?.find(i => i.id === m.image_id);
        if (img) {
          matchingImages.push({
            id: img.id,
            image_url: img.image_url || img.thumbnail_url || '',
            confidence: m.confidence_score || 0,
            angle_family: angle.category
          });
        }
      });

      // Also check classifications by angle_family and view_axis
      // Map angle_family + view_axis to angle_name (matching the backfill function logic)
      const classMatches = (classifications || []).filter(c => {
        const primaryLabel = c.primary_label?.toLowerCase() || '';
        const angleFamily = c.angle_family?.toLowerCase() || '';
        const viewAxis = c.view_axis?.toLowerCase() || '';
        const partName = (c.raw_classification as any)?.part_name?.toLowerCase() || '';
        
        // Map angle_family + view_axis to display names (matching database display_name)
        const matchesAngle = (() => {
          const angleNameLower = angle.angle_name.toLowerCase();
          
          // Exterior mappings
          if (angleFamily === 'front_corner' || angleFamily === 'front') {
            if ((viewAxis.includes('left') || viewAxis.includes('driver')) && 
                (angleNameLower.includes('front quarter') && angleNameLower.includes('driver'))) {
              return true;
            }
            if ((viewAxis.includes('right') || viewAxis.includes('passenger')) && 
                (angleNameLower.includes('front quarter') && angleNameLower.includes('passenger'))) {
              return true;
            }
            if (!viewAxis && angleNameLower.includes('front straight')) {
              return true;
            }
          }
          
          if (angleFamily === 'rear_corner' || angleFamily === 'rear') {
            if ((viewAxis.includes('left') || viewAxis.includes('driver')) && 
                (angleNameLower.includes('rear quarter') && angleNameLower.includes('driver'))) {
              return true;
            }
            if ((viewAxis.includes('right') || viewAxis.includes('passenger')) && 
                (angleNameLower.includes('rear quarter') && angleNameLower.includes('passenger'))) {
              return true;
            }
            if (!viewAxis && angleNameLower.includes('rear straight')) {
              return true;
            }
          }
          
          if (angleFamily === 'side') {
            if ((viewAxis.includes('left') || viewAxis.includes('driver')) && 
                angleNameLower.includes('profile') && angleNameLower.includes('driver')) {
              return true;
            }
            if ((viewAxis.includes('right') || viewAxis.includes('passenger')) && 
                angleNameLower.includes('profile') && angleNameLower.includes('passenger')) {
              return true;
            }
          }
          
          // Interior mappings
          if ((angleFamily === 'interior' || angleFamily === 'dash') && 
              angleNameLower.includes('dashboard')) {
            return true;
          }
          if (angleFamily === 'interior' && angleNameLower.includes('driver seat')) {
            return true;
          }
          if (angleFamily === 'interior' && angleNameLower.includes('passenger seat')) {
            return true;
          }
          
          // Engine mappings
          if (angleFamily === 'engine_bay') {
            if (angleNameLower.includes('engine') && angleNameLower.includes('full')) {
              return true;
            }
            if (angleNameLower.includes('engine') && (viewAxis.includes('driver') || viewAxis.includes('left'))) {
              return true;
            }
            if (angleNameLower.includes('engine') && (viewAxis.includes('passenger') || viewAxis.includes('right'))) {
              return true;
            }
          }
          
          // VIN/document mappings
          if ((angleFamily === 'vin_plate' || angleFamily === 'document') && 
              angleNameLower.includes('vin')) {
            return true;
          }
          
          // Fallback: check if primary_label matches
          if (primaryLabel.includes(angleNameLower.split(' ')[0])) {
            return true;
          }
          
          return false;
        })();
        
        return matchesAngle;
      });

      classMatches.forEach(c => {
        const img = images?.find(i => i.id === c.image_id);
        if (img && !matchingImages.find(m => m.id === img.id)) {
          matchingImages.push({
            id: img.id,
            image_url: img.image_url || img.thumbnail_url || '',
            confidence: c.confidence || 0,
            angle_family: c.angle_family || ''
          });
        }
      });

      // Find best image (highest confidence)
      const bestImage = matchingImages.length > 0
        ? matchingImages.reduce((best, current) => 
            current.confidence > (best.confidence || 0) ? current : best
          )
        : undefined;

      return {
        angle_name: angle.angle_name,
        category: angle.category,
        is_essential: angle.is_essential,
        has_coverage: matchingImages.length > 0,
        image_count: matchingImages.length,
        best_image_id: bestImage?.id,
        best_confidence: bestImage?.confidence,
        images: matchingImages
      };
    });

    // Calculate coverage statistics
    const essentialStatuses = angleStatuses.filter(s => s.is_essential);
    const essentialCovered = essentialStatuses.filter(s => s.has_coverage).length;
    const essentialTotal = essentialStatuses.length;

    // Category coverage
    const categoryCoverage = {
      exterior: calculateCategoryCoverage(angleStatuses, 'exterior'),
      interior: calculateCategoryCoverage(angleStatuses, 'interior'),
      engine: calculateCategoryCoverage(angleStatuses, 'engine'),
      undercarriage: calculateCategoryCoverage(angleStatuses, 'undercarriage'),
      detail: calculateCategoryCoverage(angleStatuses, 'detail'),
      document: calculateCategoryCoverage(angleStatuses, 'document')
    };

    // Missing essential angles
    const missingEssential = essentialStatuses
      .filter(s => !s.has_coverage)
      .map(s => s.angle_name);

    // Generate recommendations
    const recommendations = generateRecommendations(angleStatuses, missingEssential);

    return {
      vehicle_id: vehicleId,
      total_images: images?.length || 0,
      classified_images: classifications?.length || 0,
      essential_coverage: {
        covered: essentialCovered,
        total: essentialTotal,
        percentage: essentialTotal > 0 ? Math.round((essentialCovered / essentialTotal) * 100) : 0
      },
      category_coverage: categoryCoverage,
      angle_statuses: angleStatuses,
      missing_essential: missingEssential,
      recommendations
    };
  } catch (error) {
    console.error('Error analyzing vehicle coverage:', error);
    throw error;
  }
}

function calculateCategoryCoverage(
  statuses: CoverageStatus[],
  category: string
): { covered: number; total: number; percentage: number } {
  const categoryStatuses = statuses.filter(s => s.category === category);
  const covered = categoryStatuses.filter(s => s.has_coverage).length;
  const total = categoryStatuses.length;
  
  return {
    covered,
    total,
    percentage: total > 0 ? Math.round((covered / total) * 100) : 0
  };
}

function generateRecommendations(
  statuses: CoverageStatus[],
  missingEssential: string[]
): string[] {
  const recommendations: string[] = [];

  if (missingEssential.length > 0) {
    recommendations.push(`Missing ${missingEssential.length} essential angle${missingEssential.length !== 1 ? 's' : ''}: ${missingEssential.slice(0, 3).join(', ')}${missingEssential.length > 3 ? '...' : ''}`);
  }

  // Check for low confidence images
  const lowConfidence = statuses.filter(s => 
    s.has_coverage && s.best_confidence && s.best_confidence < 70
  );
  if (lowConfidence.length > 0) {
    recommendations.push(`${lowConfidence.length} angle${lowConfidence.length !== 1 ? 's' : ''} have low confidence scores - consider retaking photos`);
  }

  // Category-specific recommendations
  const categoryStatuses = {
    exterior: statuses.filter(s => s.category === 'exterior'),
    interior: statuses.filter(s => s.category === 'interior'),
    engine: statuses.filter(s => s.category === 'engine')
  };

  Object.entries(categoryStatuses).forEach(([category, angles]) => {
    const covered = angles.filter(a => a.has_coverage).length;
    const total = angles.length;
    if (covered < total * 0.5) {
      recommendations.push(`${category.charAt(0).toUpperCase() + category.slice(1)} coverage is incomplete (${covered}/${total} angles)`);
    }
  });

  if (recommendations.length === 0) {
    recommendations.push('Excellent coverage! All essential angles are documented.');
  }

  return recommendations;
}

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
    missing_count: report.missing_essential.length
  };
}

