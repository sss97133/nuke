#!/usr/bin/env npx tsx
/**
 * Test Kalshi API authentication
 * Run: dotenvx run -- npx tsx scripts/test-kalshi-auth.ts
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

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

async function kalshiRequest<T = unknown>(
  method: string,
  endpoint: string,
  body?: object
): Promise<T> {
  const keyId = process.env.KALSHI_API_KEY_ID;
  const privateKeyPath = path.join(process.cwd(), 'priv/kalshi/private_key.pem');

  if (!keyId) throw new Error('KALSHI_API_KEY_ID not set');

  const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
  const timestamp = Date.now();
  const pathOnly = endpoint.split('?')[0];
  const signature = signRequest(privateKey, timestamp, method, `/trade-api/v2${pathOnly}`);

  const response = await fetch(`${KALSHI_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'KALSHI-ACCESS-KEY': keyId,
      'KALSHI-ACCESS-TIMESTAMP': timestamp.toString(),
      'KALSHI-ACCESS-SIGNATURE': signature,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kalshi API error (${response.status}): ${error}`);
  }

  return response.json();
}

async function main() {
  console.log('Testing Kalshi API authentication...\n');

  try {
    // Test 1: Get balance (requires auth)
    console.log('1. Getting portfolio balance...');
    const balance = await kalshiRequest<{ balance: number }>('GET', '/portfolio/balance');
    console.log('   Balance:', balance, '\n');

    // Test 2: Get positions
    console.log('2. Getting positions...');
    const positions = await kalshiRequest<{ event_positions: unknown[] }>('GET', '/portfolio/positions');
    console.log('   Positions:', positions.event_positions?.length || 0, 'active\n');

    // Test 3: Get open orders
    console.log('3. Getting open orders...');
    const orders = await kalshiRequest<{ orders: unknown[] }>('GET', '/portfolio/orders?status=resting');
    console.log('   Open orders:', orders.orders?.length || 0, '\n');

    console.log('✓ Kalshi authentication working!');
  } catch (error) {
    console.error('\n✗ Authentication failed:', error);
    process.exit(1);
  }
}

main();
