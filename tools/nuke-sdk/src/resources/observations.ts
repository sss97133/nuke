/**
 * Observations Resource
 */

import type Nuke from '../index';
import type {
  Observation,
  ObservationCreateParams,
  ObservationListParams,
  PaginatedResponse,
  RequestOptions,
} from '../types';

export class Observations {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Create a new observation
   *
   * Observations are immutable data points about a vehicle. They include
   * source type, kind, and arbitrary data with confidence scoring.
   *
   * @example
   * ```typescript
   * const observation = await nuke.observations.create({
   *   vehicle_id: 'uuid-here',
   *   source_type: 'manual',
   *   observation_kind: 'mileage_reading',
   *   data: {
   *     mileage: 45000,
   *     date: '2024-01-15',
   *   },
   *   confidence: 0.95,
   * });
   * ```
   *
   * @example
   * // You can also use VIN instead of vehicle_id
   * const observation = await nuke.observations.create({
   *   vin: 'WP0AA0918LS123456',
   *   source_type: 'auction',
   *   observation_kind: 'sale_result',
   *   data: {
   *     sale_price: 125000,
   *     platform: 'bring-a-trailer',
   *   },
   * });
   */
  async create(
    params: ObservationCreateParams,
    options?: RequestOptions
  ): Promise<Observation> {
    const response = await this.client.request<{ data: Observation }>(
      'POST',
      'api-v1-observations',
      params,
      options
    );
    return response.data;
  }

  /**
   * List observations for a vehicle
   *
   * @example
   * ```typescript
   * // By vehicle ID
   * const { data } = await nuke.observations.list({ vehicle_id: 'uuid-here' });
   *
   * // By VIN
   * const { data } = await nuke.observations.list({ vin: 'WP0AA0918LS123456' });
   *
   * // Filter by kind
   * const { data } = await nuke.observations.list({
   *   vehicle_id: 'uuid-here',
   *   kind: 'mileage_reading',
   * });
   * ```
   */
  async list(
    params: ObservationListParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<Observation>> {
    const queryParams = new URLSearchParams();

    if (params.vehicle_id) queryParams.set('vehicle_id', params.vehicle_id);
    if (params.vin) queryParams.set('vin', params.vin);
    if (params.kind) queryParams.set('kind', params.kind);
    if (params.page) queryParams.set('page', String(params.page));
    if (params.limit) queryParams.set('limit', String(params.limit));

    const query = queryParams.toString();
    const endpoint = `api-v1-observations?${query}`;

    return this.client.request<PaginatedResponse<Observation>>(
      'GET',
      endpoint,
      undefined,
      options
    );
  }

  /**
   * Iterate through all observations using async iteration
   *
   * @example
   * ```typescript
   * for await (const obs of nuke.observations.listAll({ vehicle_id: 'uuid-here' })) {
   *   console.log(obs.observation_kind, obs.data);
   * }
   * ```
   */
  async *listAll(
    params: Omit<ObservationListParams, 'page'>
  ): AsyncGenerator<Observation> {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.list({ ...params, page });

      for (const observation of response.data) {
        yield observation;
      }

      hasMore = page < response.pagination.pages;
      page++;
    }
  }
}

/**
 * Common observation kinds for reference
 */
export const ObservationKinds = {
  // Vehicle state
  MILEAGE_READING: 'mileage_reading',
  CONDITION_REPORT: 'condition_report',
  OWNERSHIP_CHANGE: 'ownership_change',

  // Sales
  LISTING: 'listing',
  SALE_RESULT: 'sale_result',
  PRICE_CHANGE: 'price_change',

  // Service
  SERVICE_RECORD: 'service_record',
  MODIFICATION: 'modification',

  // Documentation
  DOCUMENT_SCAN: 'document_scan',
  PHOTO_SET: 'photo_set',

  // External data
  AUCTION_COMMENT: 'auction_comment',
  FORUM_POST: 'forum_post',
  SOCIAL_MENTION: 'social_mention',
} as const;

export type ObservationKind = (typeof ObservationKinds)[keyof typeof ObservationKinds];
