/**
 * Nuke TypeScript SDK
 *
 * Official SDK for the Nuke Vehicle Data API.
 * Follows Stripe/Plaid patterns for developer familiarity.
 *
 * @example
 * ```typescript
 * import Nuke from '@nuke1/sdk';
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
 *   source_id: 'manual-source-uuid',
 *   kind: 'mileage_reading',
 *   structured_data: { mileage: 45000 },
 * });
 * ```
 */

// Re-export types
export * from './types';
export * from './errors';
export type {
  VisionClassifyResult,
  VisionAnalyzeResult,
  VisionBatchResult,
  VisionBatchItem,
  VisionBatchItemResult,
  VisionClassifyParams,
  VisionAnalyzeParams,
  VisionHealthResult,
} from './resources/vision';
export type { Signal } from './resources/signal';
export type {
  Analysis,
  AnalysisSignal,
  AnalysisReport,
  AnalysisHealth,
  AnalysisHistoryEntry,
  AnalysisHistoryResponse,
} from './resources/analysis';

import { NukeConfig, RequestOptions } from './types';
import { Vehicles } from './resources/vehicles';
import { Observations } from './resources/observations';
import { Webhooks } from './resources/webhooks';
import { Batch } from './resources/batch';
import { Valuations } from './resources/valuations';
import { Listings } from './resources/listings';
import { Comps } from './resources/comps';
import { VinLookup } from './resources/vin-lookup';
import { VehicleHistory } from './resources/vehicle-history';
import { VehicleAuction } from './resources/vehicle-auction';
import { MarketTrends } from './resources/market-trends';
import { Search } from './resources/search';
import { Vision } from './resources/vision';
import { Signal } from './resources/signal';
import { Analysis } from './resources/analysis';
import { NukeError, NukeAPIError, NukeAuthenticationError, NukeRateLimitError } from './errors';

const DEFAULT_BASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1';
const DEFAULT_TIMEOUT = 30000;
const SDK_VERSION = '2.0.0';

export default class Nuke {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  // Resource namespaces
  public vehicles: Vehicles;
  public observations: Observations;
  public webhooks: Webhooks;
  public batch: Batch;
  public valuations: Valuations;
  public listings: Listings;
  public comps: Comps;
  public vinLookup: VinLookup;
  public vehicleHistory: VehicleHistory;
  public vehicleAuction: VehicleAuction;
  public marketTrends: MarketTrends;
  public search: Search;
  public vision: Vision;
  public signal: Signal;
  public analysis: Analysis;

  constructor(apiKey: string, config?: Partial<NukeConfig>) {
    if (!apiKey) {
      throw new NukeError('API key is required. Get one at https://nuke.ag/settings/api-keys');
    }

    this.apiKey = apiKey;
    this.baseUrl = config?.baseUrl || DEFAULT_BASE_URL;
    this.timeout = config?.timeout || DEFAULT_TIMEOUT;

    // Initialize resource namespaces
    this.vehicles = new Vehicles(this);
    this.observations = new Observations(this);
    this.webhooks = new Webhooks(this);
    this.batch = new Batch(this);
    this.valuations = new Valuations(this);
    this.listings = new Listings(this);
    this.comps = new Comps(this);
    this.vinLookup = new VinLookup(this);
    this.vehicleHistory = new VehicleHistory(this);
    this.vehicleAuction = new VehicleAuction(this);
    this.marketTrends = new MarketTrends(this);
    this.search = new Search(this);
    this.vision = new Vision(this);
    this.signal = new Signal(this);
    this.analysis = new Analysis(this);
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

    // API keys (nk_live_*, nk_test_*) use X-API-Key header.
    // Service role keys and JWTs use Authorization: Bearer header.
    const isApiKey = this.apiKey.startsWith('nk_live_') || this.apiKey.startsWith('nk_test_');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': `nuke-sdk-typescript/${SDK_VERSION}`,
      ...(isApiKey
        ? { 'X-API-Key': this.apiKey }
        : { 'Authorization': `Bearer ${this.apiKey}` }),
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
