/**
 * Comparables Resource
 */

import type Nuke from '../index';
import type { CompsResponse, CompsGetParams, RequestOptions } from '../types';

export class Comps {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Find comparable vehicle sales
   *
   * @example
   * ```typescript
   * // By make/model/year
   * const result = await nuke.agps.get({
   *   make: 'Porsche',
   *   model: '911',
   *   year: 1973,
   *   year_range: 3,
   *   limit: 20,
   * });
   *
   * console.log(result.summary); // { avg_price, median_price, min_price, max_price }
   * console.log(result.data);    // comparable sold vehicles
   *
   * // By VIN (resolves make/model/year automatically)
   * const result = await nuke.agps.get({ vin: 'WP0AB0916KS121279' });
   * ```
   */
  async get(
    params: CompsGetParams,
    options?: RequestOptions
  ): Promise<CompsResponse> {
    const queryParams = new URLSearchParams();

    if (params.make) queryParams.set('make', params.make);
    if (params.model) queryParams.set('model', params.model);
    if (params.year) queryParams.set('year', String(params.year));
    if (params.vin) queryParams.set('vin', params.vin);
    if (params.year_range) queryParams.set('year_range', String(params.year_range));
    if (params.min_price) queryParams.set('min_price', String(params.min_price));
    if (params.max_price) queryParams.set('max_price', String(params.max_price));
    if (params.limit) queryParams.set('limit', String(params.limit));

    const query = queryParams.toString();
    return this.client.request<CompsResponse>(
      'GET',
      `api-v1-comps?${query}`,
      undefined,
      options
    );
  }
}
