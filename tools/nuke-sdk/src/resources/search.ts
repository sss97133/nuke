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
   * console.log(results.total_count, results.query_type);
   * for (const r of results.data) {
   *   console.log(r.type, r.title, r.relevance_score);
   * }
   * ```
   */
  async query(
    params: SearchParams,
    options?: RequestOptions
  ): Promise<SearchResponse> {
    const queryParams = new URLSearchParams();

    queryParams.set('q', params.q);
    if (params.types) queryParams.set('types', params.types.join(','));
    if (params.limit) queryParams.set('limit', String(params.limit));

    return this.client.request<SearchResponse>(
      'GET',
      `api-v1-search?${queryParams.toString()}`,
      undefined,
      options
    );
  }
}
