/**
 * Vehicles Resource
 */

import type Nuke from '../index';
import type {
  Vehicle,
  VehicleCreateParams,
  VehicleUpdateParams,
  VehicleListParams,
  PaginatedResponse,
  RequestOptions,
} from '../types';

export class Vehicles {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Create a new vehicle
   *
   * @example
   * ```typescript
   * const vehicle = await nuke.vehicles.create({
   *   year: 1970,
   *   make: 'Porsche',
   *   model: '911S',
   *   vin: 'WP0AA0918LS123456',
   * });
   * ```
   */
  async create(
    params: VehicleCreateParams,
    options?: RequestOptions
  ): Promise<Vehicle> {
    const response = await this.client.request<{ data: Vehicle }>(
      'POST',
      'api-v1-vehicles',
      params,
      options
    );
    return response.data;
  }

  /**
   * Retrieve a vehicle by ID
   *
   * @example
   * ```typescript
   * const vehicle = await nuke.vehicles.retrieve('uuid-here');
   * ```
   */
  async retrieve(id: string, options?: RequestOptions): Promise<Vehicle> {
    const response = await this.client.request<{ data: Vehicle }>(
      'GET',
      `api-v1-vehicles/${id}`,
      undefined,
      options
    );
    return response.data;
  }

  /**
   * Update a vehicle
   *
   * @example
   * ```typescript
   * const updated = await nuke.vehicles.update('uuid-here', {
   *   mileage: 50000,
   * });
   * ```
   */
  async update(
    id: string,
    params: VehicleUpdateParams,
    options?: RequestOptions
  ): Promise<Vehicle> {
    const response = await this.client.request<{ data: Vehicle }>(
      'PATCH',
      `api-v1-vehicles/${id}`,
      params,
      options
    );
    return response.data;
  }

  /**
   * Archive (soft delete) a vehicle
   *
   * @example
   * ```typescript
   * await nuke.vehicles.del('uuid-here');
   * ```
   */
  async del(id: string, options?: RequestOptions): Promise<void> {
    await this.client.request<{ message: string }>(
      'DELETE',
      `api-v1-vehicles/${id}`,
      undefined,
      options
    );
  }

  /**
   * List vehicles with pagination
   *
   * @example
   * ```typescript
   * // List your own vehicles
   * const { data, pagination } = await nuke.vehicles.list({ mine: true });
   *
   * // Paginate through results
   * const page2 = await nuke.vehicles.list({ page: 2, limit: 50 });
   * ```
   */
  async list(
    params?: VehicleListParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<Vehicle>> {
    const queryParams = new URLSearchParams();

    if (params?.page) queryParams.set('page', String(params.page));
    if (params?.limit) queryParams.set('limit', String(params.limit));
    if (params?.mine) queryParams.set('mine', 'true');

    const query = queryParams.toString();
    const endpoint = query ? `api-v1-vehicles?${query}` : 'api-v1-vehicles';

    return this.client.request<PaginatedResponse<Vehicle>>(
      'GET',
      endpoint,
      undefined,
      options
    );
  }

  /**
   * Iterate through all vehicles using async iteration
   *
   * @example
   * ```typescript
   * for await (const vehicle of nuke.vehicles.listAll({ mine: true })) {
   *   console.log(vehicle.year, vehicle.make, vehicle.model);
   * }
   * ```
   */
  async *listAll(
    params?: Omit<VehicleListParams, 'page'>
  ): AsyncGenerator<Vehicle> {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.list({ ...params, page });

      for (const vehicle of response.data) {
        yield vehicle;
      }

      hasMore = page < response.pagination.pages;
      page++;
    }
  }
}
