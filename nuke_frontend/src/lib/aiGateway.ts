/**
 * Vercel AI Gateway Configuration
 * Provides caching, load balancing, and analytics for AI API calls
 */

import { supabase } from './supabase';

export interface AIGatewayConfig {
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  endpoint: string;
  headers: Record<string, string>;
}

export class VercelAIGateway {
  private baseUrl = 'https://gateway.ai.vercel.app/v1';
  private gatewayId: string;
  private apiKey: string;
  private enabled: boolean;

  constructor() {
    // Get configuration from environment
    this.gatewayId = import.meta.env.VITE_VERCEL_AI_GATEWAY_ID || '';
    this.apiKey = import.meta.env.VITE_VERCEL_AI_GATEWAY_KEY || '';
    // Disabled by default unless explicitly enabled AND configured.
    this.enabled = import.meta.env.VITE_VERCEL_AI_GATEWAY_ENABLED === 'true' && !!this.gatewayId && !!this.apiKey;
  }

  /**
   * Get AI Gateway configuration for a provider/model
   */
  async getGatewayConfig(provider: string, model: string): Promise<AIGatewayConfig | null> {
    if (!this.enabled || !this.gatewayId || !this.apiKey) {
      console.warn('AI Gateway not configured, falling back to direct API calls');
      return null;
    }

    try {
      const config: AIGatewayConfig = {
        provider: provider as any,
        model,
        endpoint: this.getGatewayEndpoint(provider),
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Gateway-ID': this.gatewayId,
          'X-Provider': provider,
          'X-Model': model
        }
      };

      return config;
    } catch (error) {
      console.error('Failed to get AI Gateway config:', error);
      return null;
    }
  }

  /**
   * Make AI request through Vercel AI Gateway
   */
  async makeRequest(
    provider: string,
    model: string,
    payload: any,
    options?: {
      cache?: boolean;
      cacheTTL?: number;
      fallback?: boolean;
      userId?: string;
    }
  ): Promise<any> {
    const config = await this.getGatewayConfig(provider, model);

    if (!config) {
      // Fallback to direct Edge Function call
      return this.makeFallbackRequest(provider, model, payload, options);
    }

    try {
      const requestBody = {
        ...payload,
        model: config.model
      };

      // Add caching headers if enabled
      const headers = { ...config.headers };
      if (options?.cache) {
        headers['Cache-Control'] = `max-age=${options.cacheTTL || 3600}`;
      }

      // Add user context for analytics
      if (options?.userId) {
        headers['X-User-ID'] = options.userId;
      }

      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        if (options?.fallback) {
          console.warn('AI Gateway failed, falling back to direct call');
          return this.makeFallbackRequest(provider, model, payload, options);
        }
        let bodyText = '';
        try {
          bodyText = await response.text();
        } catch {
          // ignore
        }
        const detail = bodyText ? ` — ${bodyText.slice(0, 500)}` : '';
        throw new Error(`AI Gateway request failed: ${response.status} ${response.statusText}${detail}`);
      }

      const result = await response.json();

      // Add metadata for tracking
      result._aiGateway = {
        provider,
        model,
        cached: response.headers.get('X-Cache') === 'HIT',
        gatewayId: this.gatewayId
      };

      return result;
    } catch (error: any) {
      if (options?.fallback) {
        console.warn('AI Gateway error, falling back:', error);
        return this.makeFallbackRequest(provider, model, payload, options);
      }
      throw error;
    }
  }

  /**
   * Fallback to direct Edge Function call
   */
  private async makeFallbackRequest(
    provider: string,
    model: string,
    payload: any,
    options?: any
  ): Promise<any> {
    // Route to appropriate Edge Function based on payload shape.
    // - openai-proxy expects OpenAI/Anthropic-style chat payloads (messages, etc.)
    // - extract-and-route-data expects our internal ingestion payloads ({ input, inputType, ... })
    const looksLikeIngestionPayload =
      !!payload &&
      typeof payload === 'object' &&
      'inputType' in payload &&
      'input' in payload;

    // Default
    let functionName = looksLikeIngestionPayload ? 'extract-and-route-data' : 'openai-proxy';

    switch (provider) {
      case 'anthropic':
        functionName = looksLikeIngestionPayload ? 'extract-and-route-data' : 'openai-proxy';
        break;
      case 'google':
        functionName = looksLikeIngestionPayload ? 'extract-and-route-data' : 'openai-proxy';
        break;
      case 'openai':
      default:
        functionName = looksLikeIngestionPayload ? 'extract-and-route-data' : 'openai-proxy';
        break;
    }

    const { data, error } = await supabase.functions.invoke(functionName, {
      body: {
        ...(looksLikeIngestionPayload ? payload : { provider, model, ...payload }),
        userId: options?.userId
      }
    });

    if (error) {
      const status = (error as any)?.context?.status ?? (error as any)?.status;
      const msg = (error as any)?.message || String(error);
      const body = (error as any)?.context?.body;
      const detail = body ? ` — ${String(body).slice(0, 500)}` : '';
      throw new Error(`Edge Function ${functionName} failed${status ? ` (${status})` : ''}: ${msg}${detail}`);
    }
    return data;
  }

  /**
   * Get the appropriate gateway endpoint for a provider
   */
  private getGatewayEndpoint(provider: string): string {
    switch (provider) {
      case 'openai':
        return `${this.baseUrl}/${this.gatewayId}/openai/chat/completions`;
      case 'anthropic':
        return `${this.baseUrl}/${this.gatewayId}/anthropic/messages`;
      case 'google':
        return `${this.baseUrl}/${this.gatewayId}/google-ai-studio/v1beta/models`;
      default:
        return `${this.baseUrl}/${this.gatewayId}/openai/chat/completions`;
    }
  }

  /**
   * Get usage analytics from AI Gateway
   */
  async getUsageAnalytics(timeframe: '1h' | '24h' | '7d' | '30d' = '24h'): Promise<any> {
    if (!this.gatewayId || !this.apiKey) {
      return null;
    }

    try {
      const response = await fetch(`https://api.vercel.com/v1/ai-gateway/${this.gatewayId}/analytics?timeframe=${timeframe}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        }
      });

      if (!response.ok) {
        throw new Error(`Analytics request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get AI Gateway analytics:', error);
      return null;
    }
  }

  /**
   * Configure caching rules for different request types
   */
  getCachingConfig(requestType: string): { cache: boolean; cacheTTL: number } {
    const cachingRules: Record<string, { cache: boolean; cacheTTL: number }> = {
      'vehicle-analysis': { cache: true, cacheTTL: 3600 }, // 1 hour
      'image-analysis': { cache: true, cacheTTL: 7200 }, // 2 hours
      'receipt-extraction': { cache: true, cacheTTL: 3600 }, // 1 hour
      'vin-decode': { cache: true, cacheTTL: 86400 }, // 24 hours
      'listing-parse': { cache: true, cacheTTL: 1800 }, // 30 minutes
      'general-chat': { cache: false, cacheTTL: 0 }, // No caching
      'real-time': { cache: false, cacheTTL: 0 } // No caching
    };

    return cachingRules[requestType] || { cache: false, cacheTTL: 0 };
  }
}

export const aiGateway = new VercelAIGateway();