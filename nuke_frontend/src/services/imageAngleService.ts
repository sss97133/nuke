/**
 * Image Angle Service
 * 
 * Provides query functions for accessing classified images by angle, view, elevation, etc.
 * This makes the classification data queryable and useful.
 */

import { supabase } from '../lib/supabase';

export interface ImageAngleFilter {
  vehicleId?: string;
  angleFamily?: string | string[];
  viewAxis?: string | string[];
  elevation?: string | string[];
  distance?: string | string[];
  role?: string | string[];
  minConfidence?: number;
  hasSpatialData?: boolean;
  partName?: string;
  systemArea?: string;
  needsReview?: boolean;
}

export interface ClassifiedImage {
  id: string;
  image_url: string;
  vehicle_id: string;
  angle_family: string;
  primary_label: string;
  view_axis?: string;
  elevation?: string;
  distance?: string;
  focal_length?: string;
  role?: string;
  confidence: number;
  mapped_to_angle_id?: string;
  mapped_angle_name?: string;
  part_name?: string;
  spatial_x?: number;
  spatial_y?: number;
  spatial_z?: number;
  created_at: string;
}

/**
 * Get images filtered by angle classification
 */
export async function getImagesByAngle(filter: ImageAngleFilter): Promise<ClassifiedImage[]> {
  let query = supabase
    .from('image_angle_classifications_view')
    .select('*');

  if (filter.vehicleId) {
    query = query.eq('vehicle_id', filter.vehicleId);
  }

  if (filter.angleFamily) {
    if (Array.isArray(filter.angleFamily)) {
      query = query.in('angle_family', filter.angleFamily);
    } else {
      query = query.eq('angle_family', filter.angleFamily);
    }
  }

  if (filter.viewAxis) {
    if (Array.isArray(filter.viewAxis)) {
      query = query.in('view_axis', filter.viewAxis);
    } else {
      query = query.eq('view_axis', filter.viewAxis);
    }
  }

  if (filter.elevation) {
    if (Array.isArray(filter.elevation)) {
      query = query.in('elevation', filter.elevation);
    } else {
      query = query.eq('elevation', filter.elevation);
    }
  }

  if (filter.distance) {
    if (Array.isArray(filter.distance)) {
      query = query.in('distance', filter.distance);
    } else {
      query = query.eq('distance', filter.distance);
    }
  }

  if (filter.role) {
    if (Array.isArray(filter.role)) {
      query = query.in('role', filter.role);
    } else {
      query = query.eq('role', filter.role);
    }
  }

  if (filter.minConfidence) {
    query = query.gte('confidence', filter.minConfidence);
  }

  if (filter.needsReview !== undefined) {
    // This would need to be added to the view or queried separately
    // For now, we'll filter by confidence < 80 as a proxy
    if (filter.needsReview) {
      query = query.lt('confidence', 80);
    }
  }

  const { data, error } = await query.order('confidence', { ascending: false });

  if (error) {
    console.error('Error fetching images by angle:', error);
    throw error;
  }

  // Apply spatial/part filters if needed (these would require joining with image_spatial_metadata)
  let results = data || [];

  if (filter.partName || filter.systemArea || filter.hasSpatialData) {
    // Fetch spatial metadata separately and merge
    const imageIds = results.map(r => r.image_id);
    if (imageIds.length > 0) {
      let spatialQuery = supabase
        .from('image_spatial_metadata')
        .select('image_id, part_name, system_area, spatial_x, spatial_y, spatial_z')
        .in('image_id', imageIds);

      if (filter.partName) {
        spatialQuery = spatialQuery.ilike('part_name', `%${filter.partName}%`);
      }

      if (filter.systemArea) {
        spatialQuery = spatialQuery.ilike('system_area', `%${filter.systemArea}%`);
      }

      const { data: spatialData } = await spatialQuery;

      if (filter.hasSpatialData) {
        const spatialImageIds = new Set((spatialData || []).map(s => s.image_id));
        results = results.filter(r => spatialImageIds.has(r.image_id));
      }

      // Merge spatial data
      const spatialMap = new Map((spatialData || []).map(s => [s.image_id, s]));
      results = results.map(r => ({
        ...r,
        part_name: spatialMap.get(r.image_id)?.part_name,
        system_area: spatialMap.get(r.image_id)?.system_area,
        spatial_x: spatialMap.get(r.image_id)?.spatial_x,
        spatial_y: spatialMap.get(r.image_id)?.spatial_y,
        spatial_z: spatialMap.get(r.image_id)?.spatial_z,
      }));
    }
  }

  return results as ClassifiedImage[];
}

/**
 * Get all front corner angle shots for a vehicle
 */
export async function getFrontCornerShots(vehicleId: string): Promise<ClassifiedImage[]> {
  return getImagesByAngle({
    vehicleId,
    angleFamily: ['front_corner', 'front'],
    minConfidence: 80
  });
}

/**
 * Get all engine bay images
 */
export async function getEngineBayImages(vehicleId: string): Promise<ClassifiedImage[]> {
  return getImagesByAngle({
    vehicleId,
    angleFamily: 'engine_bay',
    minConfidence: 80
  });
}

/**
 * Get all interior images
 */
export async function getInteriorImages(vehicleId: string): Promise<ClassifiedImage[]> {
  return getImagesByAngle({
    vehicleId,
    angleFamily: ['interior', 'dash'],
    minConfidence: 80
  });
}

/**
 * Get labor/repair images (before, during, after)
 */
export async function getLaborImages(vehicleId: string): Promise<ClassifiedImage[]> {
  return getImagesByAngle({
    vehicleId,
    role: ['labor_step', 'before', 'during', 'after'],
    minConfidence: 70
  });
}

/**
 * Get images by part name (close-up detail shots)
 */
export async function getImagesByPart(vehicleId: string, partName: string): Promise<ClassifiedImage[]> {
  return getImagesByAngle({
    vehicleId,
    partName,
    minConfidence: 70
  });
}

/**
 * Get coverage summary for a vehicle
 */
export async function getAngleCoverageSummary(vehicleId: string) {
  const { data, error } = await supabase
    .from('image_angle_classifications_view')
    .select('angle_family, confidence, was_mapped')
    .eq('vehicle_id', vehicleId);

  if (error) {
    console.error('Error fetching coverage summary:', error);
    throw error;
  }

  const summary: Record<string, {
    count: number;
    avgConfidence: number;
    mapped: number;
  }> = {};

  (data || []).forEach(item => {
    if (!summary[item.angle_family]) {
      summary[item.angle_family] = {
        count: 0,
        avgConfidence: 0,
        mapped: 0
      };
    }

    summary[item.angle_family].count++;
    summary[item.angle_family].avgConfidence += item.confidence || 0;
    if (item.was_mapped) {
      summary[item.angle_family].mapped++;
    }
  });

  // Calculate averages
  Object.keys(summary).forEach(family => {
    const s = summary[family];
    s.avgConfidence = Math.round(s.avgConfidence / s.count);
  });

  return summary;
}

/**
 * Get images that need review (low confidence or validation issues)
 */
export async function getImagesNeedingReview(vehicleId?: string): Promise<ClassifiedImage[]> {
  let query = supabase
    .from('ai_angle_classifications_audit')
    .select(`
      *,
      vehicle_images!inner(image_url, vehicle_id)
    `)
    .eq('needs_review', true)
    .order('confidence', { ascending: true });

  if (vehicleId) {
    query = query.eq('vehicle_images.vehicle_id', vehicleId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching images needing review:', error);
    throw error;
  }

  return (data || []).map(item => ({
    id: item.image_id,
    image_url: item.vehicle_images?.image_url,
    vehicle_id: item.vehicle_id,
    angle_family: item.angle_family,
    primary_label: item.primary_label,
    view_axis: item.view_axis,
    elevation: item.elevation,
    distance: item.distance,
    focal_length: item.focal_length,
    role: item.role,
    confidence: item.confidence,
    mapped_to_angle_id: item.mapped_to_angle_id,
    created_at: item.created_at
  })) as ClassifiedImage[];
}

