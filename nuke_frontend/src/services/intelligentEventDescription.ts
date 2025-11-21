/**
 * Intelligent Event Description Service
 * 
 * Generates rich, contextual descriptions for timeline and contribution events
 * using processed image data (Rekognition, Appraiser Brain, SPID)
 */

import { supabase } from '../lib/supabase';

export interface EventImageAnalysis {
  imageId: string;
  imageUrl: string;
  rekognition?: {
    labels?: Array<{ name: string; confidence: number }>;
  };
  appraiser?: {
    [key: string]: boolean | string;
  };
  spid?: {
    rpo_codes?: string[];
    engine_code?: string;
    paint_code_exterior?: string;
  };
  tags?: Array<{ tag_name: string; tag_type: string }>;
}

export interface IntelligentDescription {
  summary: string;
  details: string[];
  detectedFeatures: string[];
  quality: 'high' | 'medium' | 'low';
}

/**
 * Generate intelligent description for a timeline event
 */
export async function generateTimelineEventDescription(
  eventId: string,
  vehicleId: string,
  eventDate: string
): Promise<IntelligentDescription> {
  try {
    // 1. Fetch all images for this event date
    const { data: images } = await supabase
      .from('vehicle_images')
      .select(`
        id,
        image_url,
        ai_scan_metadata,
        taken_at
      `)
      .eq('vehicle_id', vehicleId)
      .gte('taken_at', `${eventDate}T00:00:00`)
      .lte('taken_at', `${eventDate}T23:59:59`)
      .order('taken_at', { ascending: true });

    if (!images || images.length === 0) {
      return {
        summary: 'No images available for this event.',
        details: [],
        detectedFeatures: [],
        quality: 'low'
      };
    }

    // 2. Analyze processed image data
    const analyses: EventImageAnalysis[] = images.map(img => ({
      imageId: img.id,
      imageUrl: img.image_url,
      rekognition: img.ai_scan_metadata?.rekognition,
      appraiser: img.ai_scan_metadata?.appraiser,
      spid: img.ai_scan_metadata?.spid,
      tags: [] // Will fetch separately if needed
    }));

    // 3. Fetch tags for these images
    const imageIds = images.map(img => img.id);
    if (imageIds.length > 0) {
      const { data: tags } = await supabase
        .from('image_tags')
        .select('image_id, tag_name, tag_type')
        .in('image_id', imageIds);

      // Group tags by image
      const tagsByImage = new Map<string, Array<{ tag_name: string; tag_type: string }>>();
      tags?.forEach(tag => {
        if (!tagsByImage.has(tag.image_id)) {
          tagsByImage.set(tag.image_id, []);
        }
        tagsByImage.get(tag.image_id)!.push({ tag_name: tag.tag_name, tag_type: tag.tag_type });
      });

      analyses.forEach(analysis => {
        analysis.tags = tagsByImage.get(analysis.imageId) || [];
      });
    }

    // 4. Generate intelligent description
    return buildIntelligentDescription(analyses, images.length);
  } catch (error) {
    console.error('Error generating intelligent description:', error);
    return {
      summary: 'Unable to generate description at this time.',
      details: [],
      detectedFeatures: [],
      quality: 'low'
    };
  }
}

/**
 * Build intelligent description from image analyses
 */
function buildIntelligentDescription(
  analyses: EventImageAnalysis[],
  imageCount: number
): IntelligentDescription {
  const detectedFeatures: string[] = [];
  const details: string[] = [];
  
  // Aggregate Rekognition labels
  const allLabels = new Map<string, number>();
  analyses.forEach(analysis => {
    analysis.rekognition?.labels?.forEach(label => {
      const current = allLabels.get(label.name) || 0;
      allLabels.set(label.name, current + label.confidence);
    });
  });

  // Top detected items
  const topLabels = Array.from(allLabels.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);
  
  detectedFeatures.push(...topLabels);

  // Aggregate Appraiser data
  const appraiserData: Record<string, any> = {};
  analyses.forEach(analysis => {
    if (analysis.appraiser) {
      Object.entries(analysis.appraiser).forEach(([key, value]) => {
        if (!appraiserData[key]) {
          appraiserData[key] = [];
        }
        appraiserData[key].push(value);
      });
    }
  });

  // Build details from appraiser data
  if (appraiserData.is_stock?.some(v => v === false)) {
    details.push('Non-stock modifications detected');
  }
  if (appraiserData.wiring_quality?.some(v => v === 'clean')) {
    details.push('Clean wiring observed');
  }
  if (appraiserData.rust_damage?.some(v => v === true)) {
    details.push('Rust or damage noted');
  }

  // Aggregate tags
  const allTags = new Set<string>();
  analyses.forEach(analysis => {
    analysis.tags?.forEach(tag => {
      if (tag.tag_type === 'part' || tag.tag_type === 'modification') {
        allTags.add(tag.tag_name);
      }
    });
  });

  if (allTags.size > 0) {
    detectedFeatures.push(...Array.from(allTags).slice(0, 5));
  }

  // Check for SPID data
  const hasSPID = analyses.some(a => a.spid?.rpo_codes && a.spid.rpo_codes.length > 0);
  if (hasSPID) {
    details.push('Factory build sheet (SPID) documented');
    const spidData = analyses.find(a => a.spid);
    if (spidData?.spid?.engine_code) {
      details.push(`Engine code: ${spidData.spid.engine_code}`);
    }
  }

  // Generate summary
  let summary = '';
  if (imageCount === 1) {
    summary = `Documented with ${imageCount} photograph`;
  } else {
    summary = `Documented with ${imageCount} photographs`;
  }

  if (detectedFeatures.length > 0) {
    summary += ` showing ${detectedFeatures.slice(0, 3).join(', ')}`;
    if (detectedFeatures.length > 3) {
      summary += ` and ${detectedFeatures.length - 3} more`;
    }
  }

  // Determine quality
  let quality: 'high' | 'medium' | 'low' = 'low';
  if (imageCount >= 5 && (detectedFeatures.length >= 3 || details.length >= 2)) {
    quality = 'high';
  } else if (imageCount >= 2 || detectedFeatures.length >= 1) {
    quality = 'medium';
  }

  return {
    summary,
    details,
    detectedFeatures: Array.from(new Set(detectedFeatures)),
    quality
  };
}

/**
 * Generate intelligent description for a contribution event
 */
export async function generateContributionEventDescription(
  contribution: any
): Promise<IntelligentDescription> {
  const metadata = contribution.metadata || {};
  const vehicleId = contribution.related_vehicle_id;

  if (!vehicleId) {
    return {
      summary: metadata.title || contribution.contribution_type.replace('_', ' '),
      details: [],
      detectedFeatures: [],
      quality: 'low'
    };
  }

  // Use the same logic as timeline events
  const eventDate = contribution.contribution_date || contribution.created_at?.split('T')[0];
  return generateTimelineEventDescription(contribution.id, vehicleId, eventDate);
}

