/**
 * Signal Resource — nuke.signal.*
 *
 * Market signal scoring: answers "is this a good deal?"
 *
 * Combines comparable sales, listing price vs market, heat score, and auction
 * sentiment into a single 0-100 deal score with a confidence-weighted breakdown.
 *
 * This is the monetization unlock for insurance platforms, dealer tools, and
 * anyone building deal-finding applications on top of Nuke.
 *
 * @example
 * ```typescript
 * const nuke = new Nuke('nk_live_...');
 *
 * // Score by vehicle ID
 * const score = await nuke.signal.score({ vehicle_id: 'uuid-here' });
 *
 * // Score by VIN
 * const score = await nuke.signal.score({ vin: '1GCNK13T6XF234567' });
 *
 * // Shorthand (vehicle ID string)
 * const score = await nuke.signal.score('uuid-here');
 *
 * console.log(score.deal_score);        // 87
 * console.log(score.deal_score_label);  // 'strong_buy'
 * console.log(score.price_vs_market);   // -12 (12% below market)
 * console.log(score.comp_count);        // 14
 * console.log(score.confidence);        // 0.84
 * ```
 */

import type Nuke from '../index';
import type { SignalScore, SignalScoreParams, RequestOptions } from '../types';

export class Signal {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Get the market signal score for a vehicle.
   *
   * Returns a deal score (0–100), heat score, price vs market percentage,
   * comp count, and signal weight breakdown. Higher deal score = better deal.
   *
   * Accepts a vehicle UUID string directly for convenience, or a params object
   * with `vehicle_id` or `vin`.
   *
   * @throws {NukeAPIError} 404 if no valuation exists for this vehicle yet.
   *   In that case, call `nuke.valuations.get()` first to trigger computation.
   *
   * @example
   * ```typescript
   * // By vehicle ID (string shorthand)
   * const score = await nuke.signal.score('abc123');
   *
   * // By VIN
   * const score = await nuke.signal.score({ vin: 'WP0AB0916KS121279' });
   *
   * if (score.deal_score_label === 'strong_buy') {
   *   console.log(`Strong deal: ${score.price_vs_market}% below market`);
   *   console.log(`Based on ${score.comp_count} comparable sales`);
   * }
   * ```
   */
  async score(
    params: SignalScoreParams | string,
    options?: RequestOptions
  ): Promise<SignalScore> {
    const queryParams = new URLSearchParams();

    if (typeof params === 'string') {
      queryParams.set('vehicle_id', params);
    } else {
      if (params.vehicle_id) queryParams.set('vehicle_id', params.vehicle_id);
      if (params.vin) queryParams.set('vin', params.vin);
    }

    const response = await this.client.request<{ data: SignalScore }>(
      'GET',
      `api-v1-signal?${queryParams.toString()}`,
      undefined,
      options
    );
    return response.data;
  }
}
