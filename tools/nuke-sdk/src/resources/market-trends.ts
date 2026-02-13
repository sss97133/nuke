/**
 * Market Trends Resource
 */

import type Nuke from '../index';
import type { MarketTrendsResponse, MarketTrendsParams, RequestOptions } from '../types';

export class MarketTrends {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Get price trends by make/model/year range/period
   *
   * @example
   * ```typescript
   * const trends = await nuke.marketTrends.get({
   *   make: 'Porsche',
   *   model: '911',
   *   period: '1y',
   * });
   * console.log(trends.summary.trend_direction);
   * for (const p of trends.periods) {
   *   console.log(p.period_start, p.avg_price, p.sale_count);
   * }
   * ```
   */
  async get(
    params: MarketTrendsParams,
    options?: RequestOptions
  ): Promise<MarketTrendsResponse> {
    const queryParams = new URLSearchParams();

    queryParams.set('make', params.make);
    if (params.model) queryParams.set('model', params.model);
    if (params.year_from) queryParams.set('year_from', String(params.year_from));
    if (params.year_to) queryParams.set('year_to', String(params.year_to));
    if (params.period) queryParams.set('period', params.period);

    const response = await this.client.request<{ data: MarketTrendsResponse }>(
      'GET',
      `api-v1-market-trends?${queryParams.toString()}`,
      undefined,
      options
    );
    return response.data;
  }
}
