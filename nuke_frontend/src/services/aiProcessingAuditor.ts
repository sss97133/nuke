/**
 * AI Processing Auditor
 * 
 * Finds and fixes stuck AI analysis jobs
 * Integrated with autonomous data auditor
 */

import { supabase } from '../lib/supabase';

interface ProcessingStatus {
  total_pending: number;
  total_stuck: number;  // Pending for >24 hours
  total_failed: number;
  oldest_pending: string | null;
}

export class AIProcessingAuditor {
  /**
   * Get current processing status
   */
  static async getStatus(): Promise<ProcessingStatus> {
    const { data: pending } = await supabase
      .from('vehicle_images')
      .select('created_at')
      .eq('ai_processing_status', 'pending')
      .order('created_at', { ascending: true });
    
    const { count: failed } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('ai_processing_status', 'failed');
    
    // Stuck = pending for more than 24 hours
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: stuck } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('ai_processing_status', 'pending')
      .lt('created_at', dayAgo);
    
    return {
      total_pending: pending?.length || 0,
      total_stuck: stuck || 0,
      total_failed: failed || 0,
      oldest_pending: pending?.[0]?.created_at || null
    };
  }
  
  /**
   * Process stuck images (pending for >1 hour)
   */
  static async processStuckImages(limit: number = 50): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    console.log('🔍 Finding stuck AI processing jobs...');
    
    // Find images pending for >1 hour
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data: stuckImages } = await supabase
      .from('vehicle_images')
      .select('id, vehicle_id, image_url')
      .eq('ai_processing_status', 'pending')
      .lt('created_at', hourAgo)
      .not('image_url', 'is', null)
      .limit(limit);
    
    if (!stuckImages || stuckImages.length === 0) {
      console.log('✅ No stuck images found');
      return { processed: 0, succeeded: 0, failed: 0 };
    }
    
    console.log(`📸 Processing ${stuckImages.length} stuck images...`);
    
    let succeeded = 0;
    let failed = 0;
    
    for (const image of stuckImages) {
      try {
        console.log(`  Processing: ${image.id.substring(0, 8)}...`);
        
        // Mark as processing
        await supabase
          .from('vehicle_images')
          .update({
            ai_processing_status: 'processing',
            ai_processing_started_at: new Date().toISOString()
          })
          .eq('id', image.id);
        
        // Call tier 1 analysis
        const { data, error: funcError } = await supabase.functions.invoke('analyze-image-tier1', {
          body: {
            image_url: image.image_url,
            vehicle_id: image.vehicle_id,
            image_id: image.id
          }
        });
        
        if (funcError || !data?.success) {
          throw new Error(funcError?.message || 'Analysis failed');
        }
        
        // Mark as complete
        await supabase
          .from('vehicle_images')
          .update({
            ai_processing_status: 'complete',
            ai_processing_completed_at: new Date().toISOString()
          })
          .eq('id', image.id);
        
        console.log(`  ✅ Complete`);
        succeeded++;
        
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error: any) {
        console.error(`  ❌ Failed: ${error.message}`);
        
        // Mark as failed (don't leave stuck on "pending")
        await supabase
          .from('vehicle_images')
          .update({
            ai_processing_status: 'failed',
            ai_processing_error: error.message
          })
          .eq('id', image.id);
        
        failed++;
      }
    }
    
    console.log(`\n✅ Processed: ${succeeded} | ❌ Failed: ${failed}`);
    
    return {
      processed: stuckImages.length,
      succeeded,
      failed
    };
  }
  
  /**
   * Retry failed images (maybe API was down, worth another try)
   */
  static async retryFailedImages(limit: number = 20): Promise<{
    retried: number;
    succeeded: number;
    failed: number;
  }> {
    console.log('🔄 Retrying failed images...');
    
    const { data: failedImages } = await supabase
      .from('vehicle_images')
      .select('id, vehicle_id, image_url')
      .eq('ai_processing_status', 'failed')
      .not('image_url', 'is', null)
      .limit(limit);
    
    if (!failedImages || failedImages.length === 0) {
      console.log('✅ No failed images to retry');
      return { retried: 0, succeeded: 0, failed: 0 };
    }
    
    console.log(`🔄 Retrying ${failedImages.length} failed images...`);
    
    let succeeded = 0;
    const failed = 0;
    
    for (const image of failedImages) {
      // Reset to pending, then let processStuckImages handle it
      await supabase
        .from('vehicle_images')
        .update({
          ai_processing_status: 'pending',
          ai_processing_error: null,
          ai_processing_started_at: null
        })
        .eq('id', image.id);
    }
    
    // Process them
    const result = await this.processStuckImages(failedImages.length);
    
    return {
      retried: failedImages.length,
      succeeded: result.succeeded,
      failed: result.failed
    };
  }
}

