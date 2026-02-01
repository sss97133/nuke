#!/usr/bin/env npx tsx
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const privateKey = fs.readFileSync(path.join(process.cwd(), 'priv/kalshi/private_key.pem'), 'utf-8');
const keyId = process.env.KALSHI_API_KEY_ID!;

function signRequest(timestamp: number, method: string, reqPath: string): string {
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

async function kalshi<T = any>(method: string, endpoint: string, body?: object): Promise<T> {
  const timestamp = Date.now();
  const pathOnly = endpoint.split('?')[0];
  const signature = signRequest(timestamp, method, `/trade-api/v2${pathOnly}`);
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
  return response.json();
}

async function main() {
  // Balance
  const balance = await kalshi<any>('GET', '/portfolio/balance');
  console.log('=== CURRENT STATUS ===');
  console.log(`Available: $${(balance.balance / 100).toFixed(2)}`);
  console.log(`Portfolio value: $${(balance.portfolio_value / 100).toFixed(2)}`);
  console.log(`Total: $${((balance.balance + balance.portfolio_value) / 100).toFixed(2)}`);

  // Positions
  const { event_positions } = await kalshi<any>('GET', '/portfolio/positions');
  console.log('\n=== POSITIONS ===');
  if (event_positions?.length) {
    for (const p of event_positions) {
      console.log(`${p.ticker}: ${p.position} contracts`);
      console.log(`  Exposure: $${(p.market_exposure / 100).toFixed(2)}`);
      console.log(`  Realized P&L: $${(p.realized_pnl / 100).toFixed(2)}`);
    }
  } else {
    console.log('No open positions');
  }

  // Recent fills
  const { fills } = await kalshi<any>('GET', '/portfolio/fills?limit=5');
  console.log('\n=== RECENT TRADES ===');
  if (fills?.length) {
    for (const f of fills) {
      console.log(`${f.created_time.slice(0, 19)}: ${f.action} ${f.count}x ${f.side.toUpperCase()} @ ${f.yes_price}¢`);
      console.log(`  ${f.ticker}`);
    }
  }

  // Check other markets
  console.log('\n=== SCANNING FOR EDGE ===');

  const targets = [
    { ticker: 'KXSPACEXMARS-30', myProb: 0.42, name: 'SpaceX Mars by 2030' },
    { ticker: 'CHINAUSGDP-30', myProb: 0.18, name: 'China > US GDP by 2030' },
    { ticker: 'KXGDPUSMAX-28-5', myProb: 0.60, name: 'US GDP >5% any Q' },
    { ticker: 'KXOAIANTH-40-ANTH', myProb: 0.45, name: 'Anthropic IPO first' },
  ];

  for (const t of targets) {
    try {
      const { market } = await kalshi<any>('GET', `/markets/${t.ticker}`);
      if (!market) continue;

      const marketProb = (market.yes_ask || market.yes_bid || 50) / 100;
      const edge = t.myProb - marketProb;

      console.log(`\n${t.name}`);
      console.log(`  Market: ${(marketProb * 100).toFixed(0)}% | My view: ${(t.myProb * 100).toFixed(0)}%`);
      console.log(`  Edge: ${edge > 0 ? '+' : ''}${(edge * 100).toFixed(1)}%`);
      if (Math.abs(edge) > 0.08) {
        console.log(`  → TRADEABLE (${edge > 0 ? 'BUY YES' : 'BUY NO'})`);
      }
    } catch (e) {
      // Skip
    }
  }
}

main().catch(console.error);
