/**
 * Nuke TypeScript SDK
 *
 * Official SDK for the Nuke Vehicle Data API.
 * Follows Stripe/Plaid patterns for developer familiarity.
 *
 * @example
 * ```typescript
 * import Nuke from '@nuke/sdk';
 *
 * const nuke = new Nuke('nk_live_...');
 *
 * // Create a vehicle
 * const vehicle = await nuke.vehicles.create({
 *   year: 1970,
 *   make: 'Porsche',
 *   model: '911S',
 *   vin: 'WP0AA0918LS123456',
 * });
 *
 * // Add an observation
 * await nuke.observations.create({
 *   vehicle_id: vehicle.id,
 *   source_type: 'manual',
 *   observation_kind: 'mileage_reading',
 *   data: { mileage: 45000 },
 * });
 * ```
 */

// Re-export types
export * from './types';
export * from './errors';

import { NukeConfig, RequestOptions } from './types';
import { Vehicles } from './resources/vehicles';
import { Observations } from './resources/observations';
import { Webhooks } from './resources/webhooks';
import { Batch } from './resources/batch';
import { NukeError, NukeAPIError, NukeAuthenticationError, NukeRateLimitError } from './errors';

const DEFAULT_BASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1';
const DEFAULT_TIMEOUT = 30000;
const SDK_VERSION = '1.0.0';

export default class Nuke {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  // Resource namespaces
  public vehicles: Vehicles;
  public observations: Observations;
  public webhooks: Webhooks;
  public batch: Batch;

  constructor(apiKey: string, config?: Partial<NukeConfig>) {
    if (!apiKey) {
      throw new NukeError('API key is required. Get one at https://nuke.com/settings/api-keys');
    }

    this.apiKey = apiKey;
    this.baseUrl = config?.baseUrl || DEFAULT_BASE_URL;
    this.timeout = config?.timeout || DEFAULT_TIMEOUT;

    // Initialize resource namespaces
    this.vehicles = new Vehicles(this);
    this.observations = new Observations(this);
    this.webhooks = new Webhooks(this);
    this.batch = new Batch(this);
  }

  /**
   * Make an authenticated request to the Nuke API.
   * @internal
   */
  async request<T>(
    method: string,
    endpoint: string,
    body?: any,
    options?: RequestOptions
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'User-Agent': `nuke-sdk-typescript/${SDK_VERSION}`,
    };

    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        this.handleErrorResponse(response.status, data);
      }

      return data as T;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new NukeError('Request timeout');
      }

      if (error instanceof NukeError) {
        throw error;
      }

      throw new NukeError(`Network error: ${error.message}`);
    }
  }

  private handleErrorResponse(status: number, data: any): never {
    const message = data.error || data.message || 'Unknown error';

    switch (status) {
      case 401:
        throw new NukeAuthenticationError(message);
      case 429:
        throw new NukeRateLimitError(message, data.retry_after);
      case 400:
      case 404:
      case 422:
        throw new NukeAPIError(message, status, data);
      default:
        throw new NukeAPIError(message, status, data);
    }
  }
}

// Named export for ESM
export { Nuke };
