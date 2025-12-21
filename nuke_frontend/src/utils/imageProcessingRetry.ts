/**
 * Image Processing Retry Utility
 * Handles retry logic for failed image processing operations
 */

import { supabase } from '../lib/supabase';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  exponentialBackoff: boolean;
  retryableErrors: string[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 2000,
  exponentialBackoff: true,
  retryableErrors: [
    'NETWORK_ERROR',
    'TIMEOUT',
    'RATE_LIMIT',
    'TEMPORARY_FAILURE',
    'SERVICE_UNAVAILABLE',
    '429', // Rate limited
    '503', // Service unavailable
    '504', // Gateway timeout
  ],
};

export class ImageProcessingRetryManager {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    imageId?: string
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.config.exponentialBackoff
            ? this.config.baseDelay * Math.pow(2, attempt - 1)
            : this.config.baseDelay;

          console.log(
            `Retrying ${operationName} for image ${imageId} (attempt ${attempt + 1}/${this.config.maxRetries + 1}) after ${delay}ms delay`
          );

          await this.delay(delay);
        }

        const result = await operation();

        if (attempt > 0) {
          console.log(`${operationName} succeeded on retry ${attempt} for image ${imageId}`);

          // Log successful retry for monitoring
          await this.logRetrySuccess(operationName, imageId, attempt);
        }

        return result;
      } catch (error: any) {
        lastError = error;
        const isRetryable = this.isRetryableError(error);

        console.error(
          `${operationName} failed for image ${imageId} (attempt ${attempt + 1}):`,
          error.message
        );

        if (!isRetryable || attempt === this.config.maxRetries) {
          // Log final failure for monitoring
          await this.logRetryFailure(operationName, imageId, attempt + 1, error);
          break;
        }
      }
    }

    throw lastError || new Error(`${operationName} failed after ${this.config.maxRetries + 1} attempts`);
  }

  private isRetryableError(error: any): boolean {
    const errorString = error?.message?.toUpperCase() || '';
    const statusCode = error?.status?.toString() || error?.code?.toString() || '';

    return this.config.retryableErrors.some(retryableError =>
      errorString.includes(retryableError.toUpperCase()) ||
      statusCode === retryableError
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async logRetrySuccess(operationName: string, imageId?: string, attempts?: number) {
    try {
      await supabase.from('image_processing_logs').insert({
        image_id: imageId,
        operation: operationName,
        status: 'success_after_retry',
        attempts,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to log retry success:', error);
    }
  }

  private async logRetryFailure(
    operationName: string,
    imageId?: string,
    attempts?: number,
    error?: any
  ) {
    try {
      await supabase.from('image_processing_logs').insert({
        image_id: imageId,
        operation: operationName,
        status: 'failed_after_retries',
        attempts,
        error_message: error?.message || 'Unknown error',
        created_at: new Date().toISOString(),
      });
    } catch (logError) {
      console.error('Failed to log retry failure:', logError);
    }
  }
}

// Global retry manager instance
export const imageRetryManager = new ImageProcessingRetryManager();

/**
 * Retry failed image analysis operations
 */
export async function retryFailedImageAnalysis(vehicleId?: string): Promise<{
  processed: number;
  successful: number;
  failed: number;
}> {
  const results = { processed: 0, successful: 0, failed: 0 };

  try {
    // Find images that failed analysis or are missing analysis data
    let query = supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id')
      .or('analysis_status.eq.failed,analysis_status.is.null,analysis_complete.eq.false')
      .limit(50); // Process in batches to avoid overwhelming the system

    if (vehicleId) {
      query = query.eq('vehicle_id', vehicleId);
    }

    const { data: failedImages, error } = await query;

    if (error) {
      throw error;
    }

    if (!failedImages || failedImages.length === 0) {
      console.log('No failed images found for retry');
      return results;
    }

    console.log(`Found ${failedImages.length} images requiring retry`);

    // Process images with controlled concurrency
    const BATCH_SIZE = 3;
    for (let i = 0; i < failedImages.length; i += BATCH_SIZE) {
      const batch = failedImages.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (image) => {
        results.processed++;

        try {
          await imageRetryManager.executeWithRetry(
            async () => {
              const { data, error: analysisError } = await supabase.functions.invoke(
                'ai-tag-image-angles',
                {
                  body: {
                    imageId: image.id,
                    imageUrl: image.image_url,
                    vehicleId: image.vehicle_id,
                  },
                }
              );

              if (analysisError) {
                throw new Error(`Analysis failed: ${analysisError.message}`);
              }

              return data;
            },
            'image_analysis',
            image.id
          );

          results.successful++;
          console.log(`Successfully reprocessed image ${image.id}`);
        } catch (error) {
          results.failed++;
          console.error(`Failed to reprocess image ${image.id}:`, error);
        }
      });

      await Promise.allSettled(batchPromises);

      // Small delay between batches to avoid overwhelming the system
      if (i + BATCH_SIZE < failedImages.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`Retry completed: ${results.processed} processed, ${results.successful} successful, ${results.failed} failed`);
  } catch (error) {
    console.error('Error in retryFailedImageAnalysis:', error);
    throw error;
  }

  return results;
}