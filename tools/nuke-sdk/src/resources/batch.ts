/**
 * Batch Operations Resource
 */

import type Nuke from '../index';
import type { BatchIngestParams, BatchResult, RequestOptions } from '../types';

export class Batch {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Bulk import vehicles and observations
   *
   * @example
   * ```typescript
   * const result = await nuke.batch.ingest({
   *   vehicles: [
   *     {
   *       year: 1970,
   *       make: 'Porsche',
   *       model: '911S',
   *       vin: 'WP0AA0918LS123456',
   *       observations: [
   *         {
   *           source_type: 'manual',
   *           observation_kind: 'mileage_reading',
   *           data: { mileage: 45000 },
   *         },
   *       ],
   *     },
   *     {
   *       year: 1973,
   *       make: 'Porsche',
   *       model: '911 Carrera RS',
   *       vin: 'WP0ZZZ91ZKS100001',
   *     },
   *   ],
   *   options: {
   *     match_by: 'vin',
   *     skip_duplicates: true,
   *   },
   * });
   *
   * console.log(`Created: ${result.created}, Skipped: ${result.skipped}`);
   * ```
   */
  async ingest(
    params: BatchIngestParams,
    options?: RequestOptions
  ): Promise<BatchResult & { success: boolean; summary: string }> {
    const response = await this.client.request<{
      success: boolean;
      result: BatchResult;
      summary: string;
    }>('POST', 'api-v1-batch', params, options);

    return {
      ...response.result,
      success: response.success,
      summary: response.summary,
    };
  }

  /**
   * Helper to chunk large arrays for batch processing
   *
   * @example
   * ```typescript
   * const vehicles = [...]; // 5000 vehicles
   *
   * for (const chunk of nuke.batch.chunk(vehicles, 500)) {
   *   await nuke.batch.ingest({ vehicles: chunk });
   * }
   * ```
   */
  chunk<T>(items: T[], size: number = 500): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Process a large batch with automatic chunking and progress callback
   *
   * @example
   * ```typescript
   * const vehicles = [...]; // 5000 vehicles
   *
   * const results = await nuke.batch.ingestAll(
   *   { vehicles },
   *   { chunkSize: 500 },
   *   (progress) => console.log(`${progress.processed}/${progress.total}`)
   * );
   *
   * console.log(`Total created: ${results.created}`);
   * ```
   */
  async ingestAll(
    params: BatchIngestParams,
    options?: { chunkSize?: number; requestOptions?: RequestOptions },
    onProgress?: (progress: {
      processed: number;
      total: number;
      created: number;
      failed: number;
    }) => void
  ): Promise<BatchResult> {
    const chunkSize = options?.chunkSize || 500;
    const total = params.vehicles.length;

    const aggregatedResult: BatchResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      vehicles: [],
    };

    let processed = 0;
    let indexOffset = 0;

    for (const vehicleChunk of this.chunk(params.vehicles, chunkSize)) {
      const result = await this.ingest(
        { vehicles: vehicleChunk, options: params.options },
        options?.requestOptions
      );

      // Aggregate results
      aggregatedResult.created += result.created;
      aggregatedResult.updated += result.updated;
      aggregatedResult.skipped += result.skipped;
      aggregatedResult.failed += result.failed;

      // Adjust indices and add to vehicles array
      for (const v of result.vehicles) {
        aggregatedResult.vehicles.push({
          ...v,
          index: v.index + indexOffset,
        });
      }

      processed += vehicleChunk.length;
      indexOffset += vehicleChunk.length;

      if (onProgress) {
        onProgress({
          processed,
          total,
          created: aggregatedResult.created,
          failed: aggregatedResult.failed,
        });
      }
    }

    return aggregatedResult;
  }
}
