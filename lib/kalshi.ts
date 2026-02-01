/**
 * Kalshi API Client
 *
 * Usage:
 *   import { kalshi } from './lib/kalshi';
 *   const balance = await kalshi.getBalance();
 *   const markets = await kalshi.getMarkets({ status: 'open', limit: 10 });
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

// ============ Types ============

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  status: 'open' | 'closed' | 'settled';
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  volume_24h: number;
  open_interest: number;
  close_time: string;
  expiration_time: string;
  result?: 'yes' | 'no' | null;
}

export interface KalshiEvent {
  event_ticker: string;
  title: string;
  category: string;
  sub_title: string;
  mutually_exclusive: boolean;
  markets?: KalshiMarket[];
}

export interface KalshiPosition {
  ticker: string;
  event_ticker: string;
  event_exposure: number;
  market_exposure: number;
  position: number;
  resting_orders_count: number;
  total_traded: number;
  realized_pnl: number;
}

export interface KalshiBalance {
  balance: number;       // Available balance in cents
  portfolio_value: number;
  updated_ts: number;
}

export interface KalshiOrderbook {
  yes: [number, number][] | null; // [price, quantity]
  no: [number, number][] | null;
  yes_dollars: [number, number][] | null;
  no_dollars: [number, number][] | null;
}

export interface KalshiOrderRequest {
  ticker: string;
  action: 'buy' | 'sell';
  side: 'yes' | 'no';
  type: 'market' | 'limit';
  count: number;          // Number of contracts
  yes_price?: number;     // For limit orders, price in cents (1-99)
  no_price?: number;
  expiration_ts?: number; // Unix timestamp for order expiry
  client_order_id?: string;
}

export interface KalshiOrder {
  order_id: string;
  client_order_id?: string;
  ticker: string;
  status: 'resting' | 'canceled' | 'executed' | 'pending';
  action: 'buy' | 'sell';
  side: 'yes' | 'no';
  type: 'market' | 'limit';
  count: number;
  remaining_count: number;
  yes_price: number;
  no_price: number;
  created_time: string;
  expiration_time?: string;
}

export interface KalshiFill {
  trade_id: string;
  ticker: string;
  order_id: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  count: number;
  yes_price: number;
  no_price: number;
  created_time: string;
}

// ============ Auth & Request ============

function signRequest(privateKey: string, timestamp: number, method: string, reqPath: string): string {
  const message = `${timestamp}${method.toUpperCase()}${reqPath}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  sign.end();
  return sign.sign({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }, 'base64');
}

let _privateKey: string | null = null;

function getPrivateKey(): string {
  if (!_privateKey) {
    const keyPath = process.env.KALSHI_PRIVATE_KEY_PATH || path.join(process.cwd(), 'priv/kalshi/private_key.pem');
    _privateKey = fs.readFileSync(keyPath, 'utf-8');
  }
  return _privateKey;
}

async function request<T = unknown>(
  method: string,
  endpoint: string,
  body?: object,
  authenticated = true
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authenticated) {
    const keyId = process.env.KALSHI_API_KEY_ID;
    if (!keyId) throw new Error('KALSHI_API_KEY_ID not set');

    const privateKey = getPrivateKey();
    const timestamp = Date.now();
    const pathOnly = endpoint.split('?')[0];
    const signature = signRequest(privateKey, timestamp, method, `/trade-api/v2${pathOnly}`);

    headers['KALSHI-ACCESS-KEY'] = keyId;
    headers['KALSHI-ACCESS-TIMESTAMP'] = timestamp.toString();
    headers['KALSHI-ACCESS-SIGNATURE'] = signature;
  }

  const response = await fetch(`${KALSHI_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kalshi API error (${response.status}): ${error}`);
  }

  return response.json();
}

// ============ API Methods ============

export const kalshi = {
  // Portfolio (authenticated)
  getBalance: () => request<KalshiBalance>('GET', '/portfolio/balance'),

  getPositions: () => request<{ event_positions: KalshiPosition[] }>('GET', '/portfolio/positions')
    .then(r => r.event_positions),

  // Orders (authenticated)
  placeOrder: (order: KalshiOrderRequest) =>
    request<{ order: KalshiOrder }>('POST', '/portfolio/orders', order)
      .then(r => r.order),

  cancelOrder: (orderId: string) =>
    request<{ order: KalshiOrder }>('DELETE', `/portfolio/orders/${orderId}`)
      .then(r => r.order),

  getOrders: (params?: { ticker?: string; status?: 'resting' | 'canceled' | 'executed' }) => {
    const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<{ orders: KalshiOrder[] }>('GET', `/portfolio/orders${query}`)
      .then(r => r.orders);
  },

  getFills: (params?: { ticker?: string; limit?: number }) => {
    const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<{ fills: KalshiFill[] }>('GET', `/portfolio/fills${query}`)
      .then(r => r.fills);
  },

  // Markets (public, but we use auth anyway for consistency)
  getMarkets: (params?: {
    status?: 'open' | 'closed' | 'settled';
    series_ticker?: string;
    event_ticker?: string;
    limit?: number;
    cursor?: string;
  }) => {
    const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<{ markets: KalshiMarket[]; cursor?: string }>('GET', `/markets${query}`, undefined, false);
  },

  getMarket: (ticker: string) =>
    request<{ market: KalshiMarket }>('GET', `/markets/${ticker}`, undefined, false)
      .then(r => r.market),

  getOrderbook: (ticker: string) =>
    request<{ orderbook: KalshiOrderbook }>('GET', `/markets/${ticker}/orderbook`, undefined, false)
      .then(r => r.orderbook),

  // Events
  getEvents: (params?: {
    status?: 'open' | 'closed' | 'settled';
    series_ticker?: string;
    with_nested_markets?: boolean;
    limit?: number;
  }) => {
    const query = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
    ).toString() : '';
    return request<{ events: KalshiEvent[]; cursor?: string }>('GET', `/events${query}`, undefined, false);
  },

  getEvent: (ticker: string) =>
    request<{ event: KalshiEvent }>('GET', `/events/${ticker}`, undefined, false)
      .then(r => r.event),

  // Convenience: buy YES on a market
  buyYes: (ticker: string, contracts: number, maxPrice?: number) =>
    kalshi.placeOrder({
      ticker,
      action: 'buy',
      side: 'yes',
      type: maxPrice ? 'limit' : 'market',
      count: contracts,
      yes_price: maxPrice,
    }),

  // Convenience: buy NO on a market
  buyNo: (ticker: string, contracts: number, maxPrice?: number) =>
    kalshi.placeOrder({
      ticker,
      action: 'buy',
      side: 'no',
      type: maxPrice ? 'limit' : 'market',
      count: contracts,
      no_price: maxPrice,
    }),
};

export default kalshi;
