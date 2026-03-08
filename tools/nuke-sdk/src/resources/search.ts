/**
 * Search Resource
 */

import type Nuke from '../index';
import type { SearchResponse, SearchParams, RequestOptions } from '../types';

export class Search {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Search across all entities (vehicles, organizations, users, tags)
   *
   * @example
   * ```typescript
   * const results = await nuke.search.query({ q: 'porsche 911 turbo', limit: 10 });
   * console.log(results.pagination.total_count, results.search_time_ms);
   * for (const r of results.data) {
   *   console.log(r.year, r.make, r.model, r.sale_price);
   * }
   * ```
   */
  async query(
    params: SearchParams,
    options?: RequestOptions
  ): Promise<SearchResponse> {
    const queryParams = new URLSearchParams();

    queryParams.set('q', params.q);
    if (params.make) queryParams.set('make', params.make);
    if (params.model) queryParams.set('model', params.model);
    if (params.year_from) queryParams.set('year_from', String(params.year_from));
    if (params.year_to) queryParams.set('year_to', String(params.year_to));
    if (params.has_vin !== undefined) queryParams.set('has_vin', String(params.has_vin));
    if (params.sort) queryParams.set('sort', params.sort);
    if (params.limit) queryParams.set('limit', String(params.limit));
    if (params.page) queryParams.set('page', String(params.page));

    return this.client.request<SearchResponse>(
      'GET',
      `api-v1-search?${queryParams.toString()}`,
      undefined,
      options
    );
  }
}
