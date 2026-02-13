/**
 * Vehicle Auction Resource
 */

import type Nuke from '../index';
import type { VehicleAuctionResponse, RequestOptions } from '../types';

export class VehicleAuction {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Get auction results, bid counts, comments, and AI sentiment for a vehicle
   *
   * @example
   * ```typescript
   * const auction = await nuke.vehicleAuction.get('WP0AB0916KS121279');
   * console.log(auction.listings);
   * console.log(auction.comments.total_count);
   * console.log(auction.sentiment?.overall, auction.sentiment?.score);
   * ```
   */
  async get(
    vin: string,
    options?: RequestOptions
  ): Promise<VehicleAuctionResponse> {
    const response = await this.client.request<{ data: VehicleAuctionResponse }>(
      'GET',
      `api-v1-vehicle-auction/${encodeURIComponent(vin)}`,
      undefined,
      options
    );
    return response.data;
  }
}
