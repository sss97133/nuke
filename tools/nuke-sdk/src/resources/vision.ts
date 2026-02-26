/**
 * Vision Resource — nuke.vision.*
 *
 * Vehicle image classification powered by YONO (free, local) with
 * Gemini/GPT-4o fallback for full analysis. Zero cost for make classification.
 *
 * @example
 * ```typescript
 * const nuke = new Nuke('nk_live_...');
 *
 * // Free make classification ($0)
 * const result = await nuke.vision.classify('https://cdn.example.com/car.jpg');
 * // → { make: 'Porsche', confidence: 0.91, top5: [...], cost_usd: 0 }
 *
 * // Full analysis (falls back to cloud if needed)
 * const analysis = await nuke.vision.analyze('https://cdn.example.com/car.jpg');
 * // → { make: 'Porsche', confidence: 0.91, category: 'exterior', angle: '...', ... }
 *
 * // Batch classification
 * const batch = await nuke.vision.batch([
 *   { image_url: 'https://...' },
 *   { image_url: 'https://...' },
 * ]);
 * // → { results: [...], count: 2, cost_usd: 0 }
 * ```
 */

import type Nuke from '../index';
import type { RequestOptions } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────

export interface VisionClassifyResult {
  /** Best make prediction */
  make: string | null;
  /** Confidence score 0.0–1.0 */
  confidence: number;
  /** Top-K predictions as [make, confidence] pairs */
  top5: Array<[string, number]>;
  /** Whether the image appears to contain a vehicle */
  is_vehicle: boolean;
  /** Inference source: 'yono' (free) or 'unavailable' */
  source: 'yono' | 'unavailable';
  /** Inference time in milliseconds */
  ms: number;
  /** Cost in USD (0 for YONO) */
  cost_usd: number;
  /** Total elapsed time in milliseconds */
  elapsed_ms: number;
}

export interface VisionAnalyzeResult {
  /** Make prediction */
  make: string | null;
  /** Classification confidence 0.0–1.0 */
  confidence: number;
  /** Top-K make predictions */
  top5: Array<[string, number]>;
  /** Image category: exterior | interior | engine | undercarriage | document | damage */
  category: string | null;
  /** Detailed subject taxonomy (e.g. 'exterior.panel.door.front.driver') */
  subject: string | null;
  /** Human-readable description of the photo */
  description: string | null;
  /** Condition observations */
  condition_notes: string | null;
  /** Whether visible damage is present */
  visible_damage: boolean | null;
  /** Camera position in spherical coordinates relative to vehicle center */
  camera_position: {
    azimuth_deg: number;
    elevation_deg: number;
    distance_mm: number;
    confidence: number;
  } | null;
  /** YONO classification details */
  yono: {
    make: string;
    confidence: number;
    ms: number;
  } | null;
  /** Source: 'yono' | 'yono+cloud' | 'unavailable' */
  source: string;
  /** Cost in USD (0 for YONO-only, small for cloud) */
  cost_usd: number;
  /** Total elapsed time in milliseconds */
  elapsed_ms: number;
}

export interface VisionBatchItem {
  /** Image URL to classify */
  image_url: string;
  /** Number of top predictions to return (default 5) */
  top_k?: number;
}

export interface VisionBatchResult {
  results: Array<Omit<VisionClassifyResult, 'elapsed_ms'> & { image_url: string }>;
  count: number;
  errors: number;
  cost_usd: number;
  elapsed_ms: number;
}

export interface VisionClassifyParams {
  /** Image URL (public, accessible by the YONO sidecar) */
  image_url: string;
  /** Number of top predictions to return (default 5, max 20) */
  top_k?: number;
}

export interface VisionAnalyzeParams {
  /** Image URL */
  image_url: string;
  /** Optional vehicle ID for context-aware analysis */
  vehicle_id?: string;
}

// ── Resource ──────────────────────────────────────────────────────────────

export class Vision {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Classify a vehicle image — returns make, confidence, and top-5 predictions.
   *
   * Powered by YONO (free, local inference). Cost: $0.
   * Falls back gracefully if the YONO sidecar is not running.
   *
   * @example
   * ```typescript
   * const result = await nuke.vision.classify({
   *   image_url: 'https://cdn.bringatrailer.com/...',
   * });
   *
   * if (result.confidence > 0.7) {
   *   console.log(`It's a ${result.make} (${(result.confidence * 100).toFixed(0)}% confident)`);
   * }
   * ```
   */
  async classify(
    params: VisionClassifyParams | string,
    options?: RequestOptions
  ): Promise<VisionClassifyResult> {
    const body =
      typeof params === 'string' ? { image_url: params } : params;
    return this.client.request<VisionClassifyResult>(
      'POST',
      'api-v1-vision/classify',
      body,
      options
    );
  }

  /**
   * Analyze a vehicle image — returns full analysis including category, angle,
   * condition notes, and camera position.
   *
   * Uses YONO for make classification (free). Uses Gemini/GPT-4o for full
   * scene analysis when YONO is available. Cost: $0–$0.004/image.
   *
   * @example
   * ```typescript
   * const analysis = await nuke.vision.analyze({
   *   image_url: 'https://cdn.bringatrailer.com/...',
   *   vehicle_id: 'abc123', // optional, for context
   * });
   *
   * console.log(analysis.category);      // 'exterior'
   * console.log(analysis.subject);       // 'exterior.panel.door.front.driver'
   * console.log(analysis.condition_notes); // 'Surface rust on lower quarters'
   * ```
   */
  async analyze(
    params: VisionAnalyzeParams | string,
    options?: RequestOptions
  ): Promise<VisionAnalyzeResult> {
    const body =
      typeof params === 'string' ? { image_url: params } : params;
    return this.client.request<VisionAnalyzeResult>(
      'POST',
      'api-v1-vision/analyze',
      body,
      options
    );
  }

  /**
   * Classify multiple vehicle images in a single request.
   *
   * All classifications run via YONO (free). Max 100 images per batch.
   * Cost: $0.
   *
   * @example
   * ```typescript
   * const batch = await nuke.vision.batch([
   *   { image_url: 'https://...' },
   *   { image_url: 'https://...' },
   *   { image_url: 'https://...', top_k: 10 },
   * ]);
   *
   * console.log(`Classified ${batch.count} images for $${batch.cost_usd}`);
   * batch.results.forEach(r => console.log(r.make, r.confidence));
   * ```
   */
  async batch(
    images: VisionBatchItem[] | string[],
    options?: RequestOptions
  ): Promise<VisionBatchResult> {
    const normalized = images.map((img) =>
      typeof img === 'string' ? { image_url: img } : img
    );
    return this.client.request<VisionBatchResult>(
      'POST',
      'api-v1-vision/batch',
      { images: normalized },
      options
    );
  }
}
