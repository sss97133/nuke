/**
 * Image Set Grouping Service
 * Groups images by work sessions and estimates value for each project phase
 * Uses timeline events and image metadata to identify related work
 */

import { supabase } from '../lib/supabase';

export interface WorkSession {
  date: string;
  imageCount: number;
  systemsWorked: string[];
  estimatedValue: number;
  laborHours?: number;
  confidence: number;
  images: Array<{
    id: string;
    url: string;
    thumbnailUrl?: string;
    tags: string[];
  }>;
}

export interface ImageGroupingResult {
  workSessions: WorkSession[];
  totalEstimatedValue: number;
  totalLaborHours: number;
  systemsDetected: string[];
  confidence: number;
}

export class ImageSetGroupingService {
  /**
   * Group images by work sessions and estimate values
   * This implements the "paint job group 1-4" concept by identifying related work
   */
  static async groupImagesByWorkSessions(vehicleId: string): Promise<ImageGroupingResult> {
    try {
      // Get work sessions with their images and detected work
      const { data: sessions, error } = await supabase.rpc(
        'get_vehicle_work_sessions',
        { p_vehicle_id: vehicleId }
      );

      if (error) {
        console.warn('Work sessions RPC failed, using fallback method:', error);
        return await this.fallbackGrouping(vehicleId);
      }

      // Process sessions into structured format
      const workSessions: WorkSession[] = await Promise.all(
        sessions.map(async (session: any) => {
          const systemsWorked = this.categorizeWork(session.detected_work);
          const estimatedValue = this.estimateSessionValue(systemsWorked, session.image_count);

          // Get actual images for this session
          const { data: images } = await supabase
            .from('vehicle_images')
            .select(`
              id,
              image_url,
              thumbnail_url,
              image_tags!inner (tag_name)
            `)
            .eq('vehicle_id', vehicleId)
            .gte('taken_at', `${session.work_date}T00:00:00`)
            .lt('taken_at', `${session.work_date}T23:59:59`);

          const sessionImages = images?.map(img => ({
            id: img.id,
            url: img.image_url,
            thumbnailUrl: img.thumbnail_url,
            tags: (img as any).image_tags?.map((t: any) => t.tag_name) || []
          })) || [];

          return {
            date: session.work_date,
            imageCount: session.image_count,
            systemsWorked,
            estimatedValue,
            laborHours: session.labor_hours || this.estimateLaborHours(systemsWorked),
            confidence: this.calculateSessionConfidence(session.image_count, systemsWorked.length),
            images: sessionImages
          };
        })
      );

      // Calculate totals
      const totalEstimatedValue = workSessions.reduce((sum, session) => sum + session.estimatedValue, 0);
      const totalLaborHours = workSessions.reduce((sum, session) => sum + (session.laborHours || 0), 0);
      const allSystems = new Set<string>();
      workSessions.forEach(session => {
        session.systemsWorked.forEach(system => allSystems.add(system));
      });

      const overallConfidence = workSessions.length > 0
        ? Math.round(workSessions.reduce((sum, s) => sum + s.confidence, 0) / workSessions.length)
        : 0;

      return {
        workSessions: workSessions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
        totalEstimatedValue,
        totalLaborHours,
        systemsDetected: Array.from(allSystems),
        confidence: overallConfidence
      };

    } catch (error) {
      console.error('Image grouping error:', error);
      return await this.fallbackGrouping(vehicleId);
    }
  }

  /**
   * Fallback grouping when RPC is unavailable
   */
  private static async fallbackGrouping(vehicleId: string): Promise<ImageGroupingResult> {
    const { data: images } = await supabase
      .from('vehicle_images')
      .select(`
        id,
        image_url,
        thumbnail_url,
        taken_at,
        image_tags (tag_name, metadata)
      `)
      .eq('vehicle_id', vehicleId)
      .not('taken_at', 'is', null)
      .order('taken_at');

    if (!images || images.length === 0) {
      return {
        workSessions: [],
        totalEstimatedValue: 0,
        totalLaborHours: 0,
        systemsDetected: [],
        confidence: 0
      };
    }

    // Group by date
    const sessionMap = new Map<string, any[]>();
    images.forEach(img => {
      const date = img.taken_at?.split('T')[0];
      if (date) {
        if (!sessionMap.has(date)) sessionMap.set(date, []);
        sessionMap.get(date)!.push(img);
      }
    });

    // Process each session
    const workSessions: WorkSession[] = Array.from(sessionMap.entries())
      .filter(([_, imgs]) => imgs.length >= 3) // Only sessions with multiple images
      .map(([date, imgs]) => {
        const allTags = imgs.flatMap(img =>
          (img as any).image_tags?.map((t: any) => t.tag_name) || []
        );
        const systemsWorked = this.categorizeWork(allTags.join(', '));
        const estimatedValue = this.estimateSessionValue(systemsWorked, imgs.length);

        return {
          date,
          imageCount: imgs.length,
          systemsWorked,
          estimatedValue,
          laborHours: this.estimateLaborHours(systemsWorked),
          confidence: this.calculateSessionConfidence(imgs.length, systemsWorked.length),
          images: imgs.map(img => ({
            id: img.id,
            url: img.image_url,
            thumbnailUrl: img.thumbnail_url,
            tags: allTags.filter(tag =>
              (img as any).image_tags?.some((t: any) => t.tag_name === tag)
            )
          }))
        };
      });

    const totalEstimatedValue = workSessions.reduce((sum, session) => sum + session.estimatedValue, 0);
    const totalLaborHours = workSessions.reduce((sum, session) => sum + (session.laborHours || 0), 0);
    const allSystems = new Set<string>();
    workSessions.forEach(session => {
      session.systemsWorked.forEach(system => allSystems.add(system));
    });

    return {
      workSessions,
      totalEstimatedValue,
      totalLaborHours,
      systemsDetected: Array.from(allSystems),
      confidence: workSessions.length > 0 ? 75 : 0
    };
  }

  /**
   * Categorize detected work into systems
   */
  private static categorizeWork(detectedWork: string): string[] {
    const work = detectedWork.toLowerCase();
    const systems: string[] = [];

    // Engine work
    if (work.includes('engine') || work.includes('block') || work.includes('intake') ||
        work.includes('valve cover') || work.includes('air cleaner')) {
      systems.push('Engine Work');
    }

    // Body work
    if (work.includes('fender') || work.includes('rocker panel') || work.includes('cab corner') ||
        work.includes('door shell') || work.includes('quarter panel') || work.includes('floor pan')) {
      systems.push('Body Work');
    }

    // Suspension work
    if (work.includes('shock') || work.includes('suspension') || work.includes('control arm') ||
        work.includes('torsion bar') || work.includes('lift kit')) {
      systems.push('Suspension Work');
    }

    // Paint work
    if (work.includes('paint') || work.includes('primer') || work.includes('body work')) {
      systems.push('Paint Work');
    }

    // Interior work
    if (work.includes('interior') || work.includes('seat') || work.includes('dashboard')) {
      systems.push('Interior Work');
    }

    // Electrical work
    if (work.includes('electrical') || work.includes('wiring') || work.includes('lighting')) {
      systems.push('Electrical Work');
    }

    return systems.length > 0 ? systems : ['General Maintenance'];
  }

  /**
   * Estimate value for a work session based on systems and documentation
   */
  private static estimateSessionValue(systemsWorked: string[], imageCount: number): number {
    let baseValue = 0;

    // Base values by system type
    systemsWorked.forEach(system => {
      switch (system) {
        case 'Engine Work':
          baseValue += 2000;
          break;
        case 'Body Work':
          baseValue += 1500;
          break;
        case 'Paint Work':
          baseValue += 3000;
          break;
        case 'Suspension Work':
          baseValue += 800;
          break;
        case 'Interior Work':
          baseValue += 1000;
          break;
        case 'Electrical Work':
          baseValue += 500;
          break;
        default:
          baseValue += 300;
      }
    });

    // Documentation bonus (more images = better documentation = higher confidence in estimate)
    const docMultiplier = Math.min(1.5, 1 + (imageCount / 20));

    return Math.round(baseValue * docMultiplier);
  }

  /**
   * Estimate labor hours for systems worked
   */
  private static estimateLaborHours(systemsWorked: string[]): number {
    let hours = 0;

    systemsWorked.forEach(system => {
      switch (system) {
        case 'Engine Work':
          hours += 16; // 2 days
          break;
        case 'Body Work':
          hours += 24; // 3 days
          break;
        case 'Paint Work':
          hours += 40; // 5 days
          break;
        case 'Suspension Work':
          hours += 8; // 1 day
          break;
        case 'Interior Work':
          hours += 12; // 1.5 days
          break;
        case 'Electrical Work':
          hours += 6; // 0.75 days
          break;
        default:
          hours += 4; // 0.5 days
      }
    });

    return hours;
  }

  /**
   * Calculate confidence for a work session
   */
  private static calculateSessionConfidence(imageCount: number, systemCount: number): number {
    let confidence = 60; // Base confidence

    // More images = higher confidence
    if (imageCount > 10) confidence += 20;
    else if (imageCount > 5) confidence += 10;

    // Multiple systems = more complex work = higher value confidence
    if (systemCount > 2) confidence += 15;
    else if (systemCount > 1) confidence += 8;

    return Math.min(95, confidence);
  }
}