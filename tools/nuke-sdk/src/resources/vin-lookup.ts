/**
 * VIN Lookup Resource
 */

import type Nuke from '../index';
import type { VinLookupResponse, RequestOptions } from '../types';

export class VinLookup {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Look up a vehicle by VIN — returns core profile + valuation + counts + images
   *
   * @example
   * ```typescript
   * const profile = await nuke.vinLookup.get('WP0AB0916KS121279');
   * console.log(profile.year, profile.make, profile.model);
   * console.log(profile.valuation?.estimated_value);
   * console.log(profile.counts.observations);
   * ```
   */
  async get(
    vin: string,
    options?: RequestOptions
  ): Promise<VinLookupResponse> {
    const response = await this.client.request<{ data: VinLookupResponse }>(
      'GET',
      `api-v1-vin-lookup/${encodeURIComponent(vin)}`,
      undefined,
      options
    );
    return response.data;
  }
}
