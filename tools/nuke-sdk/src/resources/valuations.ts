/**
 * Valuations Resource
 */

import type Nuke from '../index';
import type { Valuation, ValuationGetParams, RequestOptions } from '../types';

export class Valuations {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Get a vehicle valuation (Nuke Estimate)
   *
   * @example
   * ```typescript
   * // By vehicle ID
   * const val = await nuke.valuations.get({ vehicle_id: 'uuid-here' });
   *
   * // By VIN
   * const val = await nuke.valuations.get({ vin: 'WP0AB0916KS121279' });
   *
   * console.log(val.estimated_value, val.confidence_score, val.deal_score_label);
   * ```
   */
  async get(
    params: ValuationGetParams,
    options?: RequestOptions
  ): Promise<Valuation> {
    const queryParams = new URLSearchParams();

    if (params.vehicle_id) queryParams.set('vehicle_id', params.vehicle_id);
    if (params.vin) queryParams.set('vin', params.vin);

    const query = queryParams.toString();
    const response = await this.client.request<{ data: Valuation }>(
      'GET',
      `api-v1-valuations?${query}`,
      undefined,
      options
    );
    return response.data;
  }
}
