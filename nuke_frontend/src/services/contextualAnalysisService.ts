/**
 * Contextual Analysis Service
 * 
 * Triggers contextual batch analysis for image batches that need analysis
 */

import { supabase } from '../lib/supabase';

interface ContextualAnalysisResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

export class ContextualAnalysisService {
  /**
   * Trigger contextual analysis for a timeline event with images
   */
  static async analyzeEventBatch(
    eventId: string,
    vehicleId: string,
    userId: string,
    imageIds: string[]
  ): Promise<ContextualAnalysisResult> {
    try {
      // Update status to processing
      await supabase
        .from('timeline_events')
        .update({ contextual_analysis_status: 'processing' })
        .eq('id', eventId);

      // Invoke edge function
      const { data, error } = await supabase.functions.invoke('analyze-batch-contextual', {
        body: {
          event_id: eventId,
          vehicle_id: vehicleId,
          user_id: userId,
          image_ids: imageIds
        }
      });

      if (error) {
        // Update status to failed
        await supabase
          .from('timeline_events')
          .update({ contextual_analysis_status: 'failed' })
          .eq('id', eventId);

        return { success: false, error: error.message };
      }

      // Update status to completed
      await supabase
        .from('timeline_events')
        .update({ contextual_analysis_status: 'completed' })
        .eq('id', eventId);

      return { success: true, eventId };

    } catch (error: any) {
      console.error('Contextual analysis failed:', error);
      
      // Update status to failed
      await supabase
        .from('timeline_events')
        .update({ contextual_analysis_status: 'failed' })
        .eq('id', eventId);

      return { success: false, error: error.message };
    }
  }

  /**
   * Find all events with pending contextual analysis
   */
  static async findPendingAnalysisEvents(vehicleId?: string): Promise<Array<{
    id: string;
    vehicle_id: string;
    user_id: string;
    title: string;
    event_date: string;
    image_count: number;
  }>> {
    try {
      let query = supabase
        .from('timeline_events')
        .select('id, vehicle_id, user_id, title, event_date, metadata')
        .eq('contextual_analysis_status', 'pending')
        .order('event_date', { ascending: false })
        .limit(100);

      if (vehicleId) {
        query = query.eq('vehicle_id', vehicleId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Get image counts for each event
      const eventsWithCounts = await Promise.all(
        (data || []).map(async (event) => {
          const { count } = await supabase
            .from('vehicle_images')
            .select('id', { count: 'exact', head: true })
            .eq('timeline_event_id', event.id);

          return {
            id: event.id,
            vehicle_id: event.vehicle_id,
            user_id: event.user_id,
            title: event.title,
            event_date: event.event_date,
            image_count: count || 0
          };
        })
      );

      // Filter to only events with images
      return eventsWithCounts.filter(e => e.image_count > 0);

    } catch (error) {
      console.error('Error finding pending analysis events:', error);
      return [];
    }
  }

  /**
   * Process all pending analysis events for a vehicle
   */
  static async processPendingForVehicle(vehicleId: string): Promise<{
    processed: number;
    failed: number;
  }> {
    const pendingEvents = await this.findPendingAnalysisEvents(vehicleId);
    
    let processed = 0;
    let failed = 0;

    for (const event of pendingEvents) {
      // Get image IDs for this event
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('id')
        .eq('timeline_event_id', event.id);

      if (!images || images.length === 0) continue;

      const result = await this.analyzeEventBatch(
        event.id,
        event.vehicle_id,
        event.user_id,
        images.map(img => img.id)
      );

      if (result.success) {
        processed++;
      } else {
        failed++;
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return { processed, failed };
  }
}

