/**
 * Listings Resource
 */

import type Nuke from '../index';
import type {
  ExternalListing,
  ListingListParams,
  PaginatedResponse,
  RequestOptions,
} from '../types';

export class Listings {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * List external auction/marketplace listings
   *
   * @example
   * ```typescript
   * // All listings for a vehicle
   * const { data, pagination } = await nuke.listings.list({ vehicle_id: 'uuid' });
   *
   * // BaT sold listings
   * const { data } = await nuke.listings.list({ platform: 'bat', status: 'sold' });
   *
   * for (const listing of data) {
   *   console.log(listing.platform, listing.final_price, listing.listing_url);
   * }
   * ```
   */
  async list(
    params?: ListingListParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<ExternalListing>> {
    const queryParams = new URLSearchParams();

    if (params?.vehicle_id) queryParams.set('vehicle_id', params.vehicle_id);
    if (params?.vin) queryParams.set('vin', params.vin);
    if (params?.platform) queryParams.set('platform', params.platform);
    if (params?.status) queryParams.set('status', params.status);
    if (params?.page) queryParams.set('page', String(params.page));
    if (params?.limit) queryParams.set('limit', String(params.limit));

    const query = queryParams.toString();
    const endpoint = query ? `api-v1-listings?${query}` : 'api-v1-listings';

    return this.client.request<PaginatedResponse<ExternalListing>>(
      'GET',
      endpoint,
      undefined,
      options
    );
  }

  /**
   * Iterate through all listings using async iteration
   *
   * @example
   * ```typescript
   * for await (const listing of nuke.listings.listAll({ platform: 'bat' })) {
   *   console.log(listing.listing_url);
   * }
   * ```
   */
  async *listAll(
    params?: Omit<ListingListParams, 'page'>
  ): AsyncGenerator<ExternalListing> {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.list({ ...params, page });

      for (const listing of response.data) {
        yield listing;
      }

      hasMore = response.pagination.has_more ?? (response.data.length === (params?.limit || 20));
      page++;
    }
  }
}
