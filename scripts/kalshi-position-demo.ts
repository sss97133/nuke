#!/usr/bin/env npx tsx
/**
 * Kalshi Position Control Demo
 * Shows: browse markets, place bet, track position, close position
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

const privateKey = fs.readFileSync(path.join(process.cwd(), 'priv/kalshi/private_key.pem'), 'utf-8');
const keyId = process.env.KALSHI_API_KEY_ID!;

async function kalshi<T = any>(method: string, endpoint: string, body?: object): Promise<T> {
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

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Kalshi ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  console.log('=== KALSHI POSITION CONTROL DEMO ===\n');

  // 1. Check current balance
  console.log('1. Current Balance:');
  const balance = await kalshi('GET', '/portfolio/balance');
  console.log(`   $${(balance.balance / 100).toFixed(2)} available\n`);

  // 2. Find an interesting market with liquidity
  console.log('2. Finding markets with liquidity...');
  const { events } = await kalshi('GET', '/events?status=open&limit=50');

  // Filter for events that might have actual trading
  const interestingCategories = ['Economics', 'Politics', 'Financials', 'Companies'];
  const filtered = events.filter((e: any) => interestingCategories.includes(e.category));

  console.log(`   Found ${filtered.length} events in target categories:`);
  filtered.slice(0, 5).forEach((e: any) => {
    console.log(`   - [${e.category}] ${e.title.slice(0, 60)}`);
  });

  // 3. Get markets for a specific event
  if (filtered.length > 0) {
    const targetEvent = filtered[0];
    console.log(`\n3. Markets for "${targetEvent.title.slice(0, 50)}...":`);

    const { markets } = await kalshi('GET', `/markets?event_ticker=${targetEvent.event_ticker}`);
    markets.slice(0, 5).forEach((m: any) => {
      const yesPrice = m.yes_bid || m.last_price || '—';
      const noPrice = m.no_bid || (100 - (m.last_price || 0)) || '—';
      console.log(`   ${m.ticker}: YES@${yesPrice}¢ / NO@${noPrice}¢ (vol: ${m.volume})`);
    });

    // 4. Check orderbook for best market
    if (markets.length > 0) {
      const market = markets[0];
      console.log(`\n4. Orderbook for ${market.ticker}:`);
      const { orderbook } = await kalshi('GET', `/markets/${market.ticker}/orderbook`);
      console.log('   YES bids:', orderbook.yes?.slice(0, 3) || 'none');
      console.log('   NO bids:', orderbook.no?.slice(0, 3) || 'none');
    }
  }

  // 5. Show current positions
  console.log('\n5. Current Positions:');
  const { event_positions } = await kalshi('GET', '/portfolio/positions');
  if (event_positions?.length > 0) {
    event_positions.forEach((p: any) => {
      console.log(`   ${p.ticker}: ${p.position} contracts, exposure: $${(p.market_exposure / 100).toFixed(2)}`);
    });
  } else {
    console.log('   No open positions');
  }

  // 6. Show recent fills (trade history)
  console.log('\n6. Recent Trade History:');
  const { fills } = await kalshi('GET', '/portfolio/fills?limit=5');
  if (fills?.length > 0) {
    fills.forEach((f: any) => {
      console.log(`   ${f.created_time}: ${f.action} ${f.count}x ${f.side} @ ${f.yes_price}¢ on ${f.ticker}`);
    });
  } else {
    console.log('   No trade history yet');
  }

  console.log('\n=== DEMO COMPLETE ===');
  console.log('\nTo place a bet, use:');
  console.log('  kalshi.placeOrder({ ticker, action: "buy", side: "yes", type: "limit", count: 1, yes_price: 50 })');
}

main().catch(console.error);
