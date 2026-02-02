/**
 * Webhooks Resource
 */

import type Nuke from '../index';
import type {
  WebhookEndpoint,
  WebhookEndpointWithSecret,
  WebhookEndpointCreateParams,
  WebhookEndpointUpdateParams,
  WebhookDelivery,
  WebhookPayload,
  RequestOptions,
} from '../types';
import { NukeError } from '../errors';

// For Node.js crypto support
let cryptoModule: typeof import('crypto') | null = null;
try {
  // @ts-ignore - Dynamic import for Node.js
  cryptoModule = require('crypto');
} catch {
  // Browser environment - will use Web Crypto API
}

export class Webhooks {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Create a new webhook endpoint
   *
   * @example
   * ```typescript
   * const endpoint = await nuke.webhooks.create({
   *   url: 'https://your-server.com/webhooks',
   *   events: ['vehicle.created', 'vehicle.updated'],
   *   description: 'Production webhook handler',
   * });
   *
   * // Save the secret! It won't be shown again.
   * console.log('Webhook secret:', endpoint.secret);
   * ```
   */
  async create(
    params: WebhookEndpointCreateParams,
    options?: RequestOptions
  ): Promise<WebhookEndpointWithSecret> {
    const response = await this.client.request<{ data: WebhookEndpointWithSecret }>(
      'POST',
      'webhooks-manage',
      params,
      options
    );
    return response.data;
  }

  /**
   * Retrieve a webhook endpoint by ID
   *
   * @example
   * ```typescript
   * const endpoint = await nuke.webhooks.retrieve('uuid-here');
   * ```
   */
  async retrieve(
    id: string,
    options?: RequestOptions
  ): Promise<WebhookEndpoint & { recent_deliveries: WebhookDelivery[] }> {
    const response = await this.client.request<{
      data: WebhookEndpoint & { recent_deliveries: WebhookDelivery[] };
    }>('GET', `webhooks-manage/${id}`, undefined, options);
    return response.data;
  }

  /**
   * Update a webhook endpoint
   *
   * @example
   * ```typescript
   * const updated = await nuke.webhooks.update('uuid-here', {
   *   is_active: false,
   * });
   * ```
   */
  async update(
    id: string,
    params: WebhookEndpointUpdateParams,
    options?: RequestOptions
  ): Promise<WebhookEndpoint> {
    const response = await this.client.request<{ data: WebhookEndpoint }>(
      'PATCH',
      `webhooks-manage/${id}`,
      params,
      options
    );
    return response.data;
  }

  /**
   * Delete a webhook endpoint
   *
   * @example
   * ```typescript
   * await nuke.webhooks.del('uuid-here');
   * ```
   */
  async del(id: string, options?: RequestOptions): Promise<void> {
    await this.client.request<{ message: string }>(
      'DELETE',
      `webhooks-manage/${id}`,
      undefined,
      options
    );
  }

  /**
   * List all webhook endpoints
   *
   * @example
   * ```typescript
   * const { data: endpoints } = await nuke.webhooks.list();
   * ```
   */
  async list(options?: RequestOptions): Promise<{ data: WebhookEndpoint[] }> {
    return this.client.request<{ data: WebhookEndpoint[] }>(
      'GET',
      'webhooks-manage',
      undefined,
      options
    );
  }

  /**
   * Rotate the webhook secret
   *
   * This invalidates the current secret. Save the new one!
   *
   * @example
   * ```typescript
   * const result = await nuke.webhooks.rotateSecret('uuid-here');
   * console.log('New secret:', result.secret);
   * ```
   */
  async rotateSecret(
    id: string,
    options?: RequestOptions
  ): Promise<WebhookEndpointWithSecret> {
    const response = await this.client.request<{ data: WebhookEndpointWithSecret }>(
      'POST',
      `webhooks-manage/${id}/rotate-secret`,
      {},
      options
    );
    return response.data;
  }

  /**
   * Verify a webhook signature
   *
   * Use this in your webhook handler to verify the request is from Nuke.
   *
   * @example
   * ```typescript
   * // Express.js example
   * app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
   *   const signature = req.headers['nuke-signature'];
   *   const payload = req.body.toString();
   *
   *   try {
   *     const event = Nuke.webhooks.constructEvent(payload, signature, webhookSecret);
   *
   *     switch (event.type) {
   *       case 'vehicle.created':
   *         console.log('New vehicle:', event.data);
   *         break;
   *     }
   *
   *     res.json({ received: true });
   *   } catch (err) {
   *     console.error('Webhook verification failed:', err.message);
   *     res.status(400).send(`Webhook Error: ${err.message}`);
   *   }
   * });
   * ```
   */
  static constructEvent<T = any>(
    payload: string | Buffer,
    signature: string,
    secret: string,
    tolerance: number = 300 // 5 minutes
  ): WebhookPayload<T> {
    const payloadString = typeof payload === 'string' ? payload : payload.toString('utf8');

    // Parse signature header: "t=1234567890,v1=signature"
    const parts = signature.split(',');
    let timestamp: number | null = null;
    let sig: string | null = null;

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') {
        timestamp = parseInt(value, 10);
      } else if (key === 'v1') {
        sig = value;
      }
    }

    if (!timestamp || !sig) {
      throw new NukeError('Invalid signature format');
    }

    // Check timestamp tolerance
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      throw new NukeError(`Webhook timestamp too old. Difference: ${Math.abs(now - timestamp)}s`);
    }

    // Verify signature
    const expectedSignature = this.computeSignature(timestamp, payloadString, secret);

    if (!this.secureCompare(sig, expectedSignature)) {
      throw new NukeError('Webhook signature verification failed');
    }

    // Parse and return payload
    try {
      return JSON.parse(payloadString);
    } catch {
      throw new NukeError('Failed to parse webhook payload');
    }
  }

  /**
   * Compute the expected signature for a webhook payload
   */
  private static computeSignature(timestamp: number, payload: string, secret: string): string {
    // Remove whsec_ prefix if present
    const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const signedPayload = `${timestamp}.${payload}`;

    if (cryptoModule) {
      // Node.js
      const hmac = cryptoModule.createHmac('sha256', rawSecret);
      hmac.update(signedPayload);
      return hmac.digest('hex');
    } else if (typeof crypto !== 'undefined' && crypto.subtle) {
      // This is sync, so we can't use Web Crypto directly
      // In browser, users should use the async version
      throw new NukeError(
        'Synchronous signature verification not supported in browser. ' +
          'Use Webhooks.constructEventAsync() instead.'
      );
    }

    throw new NukeError('No crypto implementation available');
  }

  /**
   * Async version of constructEvent for browser environments
   */
  static async constructEventAsync<T = any>(
    payload: string | Buffer,
    signature: string,
    secret: string,
    tolerance: number = 300
  ): Promise<WebhookPayload<T>> {
    const payloadString = typeof payload === 'string' ? payload : payload.toString('utf8');

    // Parse signature
    const parts = signature.split(',');
    let timestamp: number | null = null;
    let sig: string | null = null;

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = parseInt(value, 10);
      else if (key === 'v1') sig = value;
    }

    if (!timestamp || !sig) {
      throw new NukeError('Invalid signature format');
    }

    // Check timestamp
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      throw new NukeError('Webhook timestamp too old');
    }

    // Compute signature using Web Crypto
    const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const signedPayload = `${timestamp}.${payloadString}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(rawSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(signedPayload)
    );

    const expectedSig = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (!this.secureCompare(sig, expectedSig)) {
      throw new NukeError('Webhook signature verification failed');
    }

    return JSON.parse(payloadString);
  }

  /**
   * Timing-safe string comparison to prevent timing attacks
   */
  private static secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    if (cryptoModule?.timingSafeEqual) {
      return cryptoModule.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    }

    // Fallback for browser
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
