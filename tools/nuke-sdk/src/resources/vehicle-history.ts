/**
 * Vehicle History Resource
 */

import type Nuke from '../index';
import type { VehicleHistoryResponse, VehicleHistoryParams, RequestOptions } from '../types';

export class VehicleHistory {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Get paginated observation timeline for a vehicle by VIN
   *
   * @example
   * ```typescript
   * const history = await nuke.vehicleHistory.list('WP0AB0916KS121279', { limit: 20 });
   * console.log(history.data.vehicle);
   * for (const obs of history.data.observations) {
   *   console.log(obs.kind, obs.observed_at, obs.structured_data);
   * }
   * ```
   */
  async list(
    vin: string,
    params?: VehicleHistoryParams,
    options?: RequestOptions
  ): Promise<VehicleHistoryResponse> {
    const queryParams = new URLSearchParams();

    if (params?.page) queryParams.set('page', String(params.page));
    if (params?.limit) queryParams.set('limit', String(params.limit));
    if (params?.kind) queryParams.set('kind', params.kind);

    const query = queryParams.toString();
    const endpoint = `api-v1-vehicle-history/${encodeURIComponent(vin)}${query ? '?' + query : ''}`;

    return this.client.request<VehicleHistoryResponse>(
      'GET',
      endpoint,
      undefined,
      options
    );
  }
}
