/**
 * Vision Resource — nuke.vision.*
 *
 * Vehicle image intelligence powered by YONO — Nuke's local vision model.
 * Zero cost for all endpoints (local inference, no cloud API calls).
 *
 * Capabilities:
 * - Make classification with hierarchical family grouping (EfficientNet-B0)
 * - Vehicle zone identification (41 zones, e.g. ext_front_driver, int_dashboard)
 * - Condition scoring (1-10 scale)
 * - Damage and modification flag detection
 * - Photo quality and type assessment
 * - Optional comparable sales lookup
 *
 * @example
 * ```typescript
 * import Nuke from '@nuke1/sdk';
 *
 * const nuke = new Nuke('nk_live_...');
 *
 * // Quick make classification (~500ms, $0)
 * const result = await nuke.vision.classify('https://cdn.example.com/car.jpg');
 * console.log(result.make);       // 'Porsche'
 * console.log(result.family);     // 'german'
 * console.log(result.confidence); // 0.91
 *
 * // Full vehicle intelligence (~5s, $0)
 * const analysis = await nuke.vision.analyze('https://cdn.example.com/car.jpg');
 * console.log(analysis.vehicle_zone);       // 'ext_front_driver'
 * console.log(analysis.condition_score);    // 7.5
 * console.log(analysis.damage_flags);       // ['minor_scratches']
 * console.log(analysis.modification_flags); // ['aftermarket_wheels']
 *
 * // Batch classification (up to 100 images, $0)
 * const batch = await nuke.vision.batch([
 *   'https://cdn.example.com/car1.jpg',
 *   'https://cdn.example.com/car2.jpg',
 * ]);
 * console.log(`Classified ${batch.count} images`);
 *
 * // Health check
 * const health = await nuke.vision.health();
 * console.log(health.sidecar_status.status); // 'ok'
 * ```
 */

import type Nuke from '../index';
import type { RequestOptions } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Result from `nuke.vision.classify()`.
 *
 * Quick make classification using YONO's hierarchical EfficientNet-B0.
 * Tier-1 predicts family (german/american/japanese/...), tier-2 predicts
 * specific make within that family.
 */
export interface VisionClassifyResult {
  /** Best make prediction (e.g. 'Porsche', 'Ford', 'Toyota') */
  make: string | null;
  /**
   * Vehicle family/origin group from tier-1 hierarchical classifier.
   * One of: 'american' | 'german' | 'japanese' | 'british' | 'italian' | 'french' | 'swedish'
   * Null when the sidecar is unavailable.
   */
  family: string | null;
  /** Confidence score for the family prediction (0.0-1.0). Null when family is null. */
  family_confidence: number | null;
  /** Confidence score for the make prediction (0.0-1.0) */
  confidence: number;
  /** Top-K predictions as [make, confidence] pairs, sorted by confidence descending */
  top5: Array<[string, number]>;
  /** Whether the image appears to contain a vehicle */
  is_vehicle: boolean;
  /** Inference source: 'yono' when sidecar is running, 'unavailable' otherwise */
  source: 'yono' | 'unavailable';
  /**
   * YONO internal inference source detail.
   * e.g. 'tier2_german' for hierarchical, 'flat' for flat classifier.
   */
  yono_source: string;
  /** YONO inference time in milliseconds (model only, excludes network) */
  ms: number;
  /** Cost in USD. Always 0 — YONO is local inference. */
  cost_usd: number;
  /** Total round-trip time in milliseconds (includes network to sidecar) */
  elapsed_ms: number;
  /** Error message when the sidecar is unavailable */
  error?: string;
}

/**
 * Result from `nuke.vision.analyze()`.
 *
 * Full vehicle image intelligence: classification + zone detection +
 * condition scoring + damage/modification flags. Runs classify and
 * Florence-2 analysis in parallel against the YONO sidecar.
 */
export interface VisionAnalyzeResult {
  // ── Classification (from YONO EfficientNet) ──
  /** Best make prediction */
  make: string | null;
  /** Vehicle family/origin group */
  family: string | null;
  /** Family confidence (0.0-1.0) */
  family_confidence: number | null;
  /** Make classification confidence (0.0-1.0) */
  confidence: number;
  /** Top-K make predictions as [make, confidence] pairs */
  top5: Array<[string, number]>;
  /** Whether the image appears to contain a vehicle */
  is_vehicle: boolean | null;

  // ── Zone Detection (from YONO zone classifier) ──
  /**
   * Vehicle zone/angle classification.
   * Examples: 'ext_front_driver', 'ext_rear_passenger', 'int_dashboard',
   * 'int_rear_seat', 'engine_bay', 'undercarriage', 'wheel_detail'
   * Full set: 41 zones covering exterior angles, interior views, and detail shots.
   */
  vehicle_zone: string | null;
  /** Zone classification confidence (0.0-1.0) */
  zone_confidence: number | null;
  /** Zone model source (e.g. 'zone_classifier', 'florence2') */
  zone_source: string | null;

  // ── Condition Analysis (from Florence-2 + fine-tuned heads) ──
  /**
   * Vehicle condition score on a 1-10 scale.
   * 1-3: Poor (significant damage, rust, non-running)
   * 4-5: Fair (running but needs work)
   * 6-7: Good (driver quality, minor wear)
   * 8-9: Excellent (well-maintained, minimal wear)
   * 10: Concours/showroom condition
   */
  condition_score: number | null;
  /**
   * Detected damage indicators.
   * Examples: 'minor_scratches', 'dent', 'rust', 'cracked_glass',
   * 'paint_fade', 'body_damage', 'missing_parts'
   */
  damage_flags: string[];
  /**
   * Detected aftermarket modifications.
   * Examples: 'aftermarket_wheels', 'lowered', 'custom_paint',
   * 'roll_cage', 'performance_exhaust', 'light_bar', 'body_kit'
   */
  modification_flags: string[];
  /**
   * Interior quality assessment.
   * Values: 'poor' | 'fair' | 'good' | 'excellent' | null
   * Null for exterior-only photos.
   */
  interior_quality: string | null;
  /**
   * Photo technical quality score (1-5).
   * 1: Unusable (blurry, dark, obstructed)
   * 2: Poor (low resolution, bad angle)
   * 3: Acceptable (clear but not ideal)
   * 4: Good (well-lit, clear subject)
   * 5: Professional (studio quality, perfect framing)
   */
  photo_quality: number | null;
  /**
   * Photo content type.
   * Values: 'exterior' | 'interior' | 'engine' | 'undercarriage' |
   * 'detail' | 'document' | 'unknown'
   */
  photo_type: string | null;

  // ── Comparable Sales (optional) ──
  /**
   * Comparable recent sales for the identified make.
   * Only populated when `include_comps: true` is passed in params.
   */
  comps: Array<Record<string, unknown>> | null;

  // ── Meta ──
  /** Overall inference source: 'yono' | 'yono_classify_only' | 'yono_analyze_only' | 'unavailable' */
  source: string;
  /** Classify model identifier */
  classify_model: string | null;
  /** Analyze model identifier */
  analyze_model: string | null;
  /** Classify inference time in ms */
  classify_ms: number | null;
  /** Analyze inference time in ms */
  analyze_ms: number | null;
  /** Cost in USD. Always 0 — all YONO inference is free. */
  cost_usd: number;
  /** Total round-trip time in milliseconds */
  elapsed_ms: number;
  /** The image URL that was analyzed */
  image_url: string;
}

/** A single item in a batch classify request */
export interface VisionBatchItem {
  /** Image URL to classify (must be publicly accessible) */
  image_url: string;
  /** Number of top predictions to return (default 5, max 20) */
  top_k?: number;
}

/** Individual result within a batch response */
export interface VisionBatchItemResult {
  /** The image URL that was classified */
  image_url: string;
  /** Best make prediction */
  make?: string;
  /** Vehicle family/origin group */
  family?: string | null;
  /** Family confidence */
  family_confidence?: number | null;
  /** Make confidence (0.0-1.0) */
  confidence?: number;
  /** Top-K predictions as [make, confidence] pairs */
  top5?: Array<[string, number]>;
  /** Whether a vehicle was detected */
  is_vehicle?: boolean;
  /** YONO inference time in ms */
  ms?: number;
  /** Cost in USD */
  cost_usd?: number;
  /** Error message if classification failed for this image */
  error?: string;
}

/** Result from `nuke.vision.batch()` */
export interface VisionBatchResult {
  /** Array of classification results, one per input image */
  results: VisionBatchItemResult[];
  /** Total number of images processed */
  count: number;
  /** Number of images that failed classification */
  errors: number;
  /** Total cost in USD. Always 0 — YONO is free. */
  cost_usd: number;
  /** Total elapsed time in milliseconds */
  elapsed_ms: number;
}

/** Parameters for `nuke.vision.classify()` */
export interface VisionClassifyParams {
  /** Image URL (must be publicly accessible by the YONO sidecar) */
  image_url: string;
  /** Number of top predictions to return (default 5, max 20) */
  top_k?: number;
}

/** Parameters for `nuke.vision.analyze()` */
export interface VisionAnalyzeParams {
  /** Image URL (must be publicly accessible) */
  image_url: string;
  /**
   * Whether to include comparable sales data in the response.
   * When true, fetches recent auction results for the identified make.
   * Adds ~200ms to response time.
   * @default false
   */
  include_comps?: boolean;
}

/** Health/info response from `nuke.vision.health()` */
export interface VisionHealthResult {
  /** API name */
  name: string;
  /** API version (e.g. '1.1') */
  version: string;
  /** Available endpoint descriptions */
  endpoints: {
    classify: string;
    analyze: string;
    batch: string;
  };
  /** Pricing info */
  cost: string;
  /** Model descriptions */
  model: {
    classify: string;
    analyze: string;
  };
  /** YONO sidecar health status */
  sidecar_status: {
    /** 'ok' when sidecar is running, 'unavailable' otherwise */
    status: string;
    /** Tier-1 family classifier status */
    tier1?: string;
    /** Number of tier-2 family models loaded */
    tier2_families?: number;
    /** Total flat classifier classes */
    flat_classes?: number;
    /** Whether Florence-2 vision analysis is available */
    vision_available?: boolean;
    /** Vision analysis mode (e.g. 'finetuned_v2') */
    vision_mode?: string;
    /** Zone classifier status */
    zone_classifier?: string;
  };
}

// ── Resource ──────────────────────────────────────────────────────────────

export class Vision {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Classify a vehicle image — returns make, family, confidence, and top-5 predictions.
   *
   * Powered by YONO's hierarchical EfficientNet-B0. Cost: $0.
   * Response time: ~500ms (warm sidecar) to ~15s (cold start).
   *
   * Accepts either a URL string or a params object.
   *
   * @example
   * ```typescript
   * // Simple string shorthand
   * const result = await nuke.vision.classify('https://cdn.bringatrailer.com/wp-content/uploads/2024/01/porsche.jpg');
   *
   * console.log(result.make);       // 'Porsche'
   * console.log(result.family);     // 'german'
   * console.log(result.confidence); // 0.91
   * console.log(result.cost_usd);   // 0
   *
   * // With params object
   * const result = await nuke.vision.classify({
   *   image_url: 'https://cdn.bringatrailer.com/...',
   *   top_k: 10,
   * });
   *
   * // Check if it's a vehicle at all
   * if (!result.is_vehicle) {
   *   console.log('Not a vehicle image');
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
   * Full vehicle image intelligence — returns classification, zone, condition,
   * damage flags, modification flags, and optionally comparable sales.
   *
   * Runs YONO classify + Florence-2 analysis in parallel. Cost: $0.
   * Response time: ~5s (both models run concurrently on the sidecar).
   *
   * Accepts either a URL string or a params object. Use params to enable
   * `include_comps` for comparable sales data.
   *
   * @example
   * ```typescript
   * // Simple URL string
   * const analysis = await nuke.vision.analyze('https://cdn.example.com/car.jpg');
   *
   * console.log(analysis.make);              // 'Mercedes-Benz'
   * console.log(analysis.vehicle_zone);      // 'ext_front_three_quarter'
   * console.log(analysis.condition_score);   // 7.5
   * console.log(analysis.damage_flags);      // ['minor_scratches']
   * console.log(analysis.modification_flags);// ['aftermarket_wheels']
   * console.log(analysis.photo_quality);     // 4
   * console.log(analysis.photo_type);        // 'exterior'
   *
   * // With comparable sales
   * const analysis = await nuke.vision.analyze({
   *   image_url: 'https://cdn.example.com/car.jpg',
   *   include_comps: true,
   * });
   *
   * if (analysis.comps) {
   *   console.log(`Found ${analysis.comps.length} comparable sales`);
   * }
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
      { ...options, timeout: options?.timeout ?? 90_000 }
    );
  }

  /**
   * Classify multiple vehicle images in a single request.
   *
   * All classifications run via YONO (free). Max 100 images per batch.
   * Cost: $0. Images are classified concurrently on the sidecar.
   *
   * Accepts an array of URL strings or VisionBatchItem objects.
   *
   * @example
   * ```typescript
   * // Simple URL array
   * const batch = await nuke.vision.batch([
   *   'https://cdn.example.com/car1.jpg',
   *   'https://cdn.example.com/car2.jpg',
   *   'https://cdn.example.com/car3.jpg',
   * ]);
   *
   * console.log(`Classified ${batch.count} images, ${batch.errors} failed`);
   * for (const r of batch.results) {
   *   if (r.error) {
   *     console.log(`${r.image_url}: FAILED - ${r.error}`);
   *   } else {
   *     console.log(`${r.image_url}: ${r.make} (${r.confidence?.toFixed(2)})`);
   *   }
   * }
   *
   * // With custom top_k per image
   * const batch = await nuke.vision.batch([
   *   { image_url: 'https://...', top_k: 10 },
   *   { image_url: 'https://...', top_k: 3 },
   * ]);
   * ```
   */
  async batch(
    images: VisionBatchItem[] | string[],
    options?: RequestOptions
  ): Promise<VisionBatchResult> {
    const normalized: VisionBatchItem[] = images.map((img) =>
      typeof img === 'string' ? { image_url: img } : img
    );
    return this.client.request<VisionBatchResult>(
      'POST',
      'api-v1-vision/batch',
      { images: normalized },
      { ...options, timeout: options?.timeout ?? 120_000 }
    );
  }

  /**
   * Check YONO sidecar health and API status.
   *
   * Returns the API version, available endpoints, model info, and
   * live sidecar status including loaded models and capabilities.
   *
   * Use this to verify the vision system is operational before running
   * large batch jobs.
   *
   * @example
   * ```typescript
   * const health = await nuke.vision.health();
   *
   * console.log(health.version);                     // '1.1'
   * console.log(health.sidecar_status.status);       // 'ok'
   * console.log(health.sidecar_status.tier2_families); // 6
   * console.log(health.sidecar_status.vision_available); // true
   *
   * if (health.sidecar_status.status !== 'ok') {
   *   console.warn('YONO sidecar is down — classify/analyze will return null results');
   * }
   * ```
   */
  async health(options?: RequestOptions): Promise<VisionHealthResult> {
    return this.client.request<VisionHealthResult>(
      'GET',
      'api-v1-vision',
      undefined,
      options
    );
  }
}
