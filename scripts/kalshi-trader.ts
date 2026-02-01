#!/usr/bin/env npx tsx
/**
 * Autonomous Kalshi Trader
 *
 * Runs for specified duration, making informed trades.
 * Uses Claude's analysis to find edge.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

// Config
const DURATION_HOURS = 3;
const CHECK_INTERVAL_MS = 60000; // Check every minute
const MAX_POSITION_SIZE = 0.25; // Max 25% of balance per position
const MIN_EDGE = 0.10; // Minimum 10% edge to take position

// ============ KALSHI API ============

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

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Kalshi ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

// ============ TRADING LOGIC ============

interface Position {
  ticker: string;
  side: 'yes' | 'no';
  contracts: number;
  entry_price: number;
  thesis: string;
}

interface TradeDecision {
  action: 'buy' | 'sell' | 'hold';
  ticker?: string;
  side?: 'yes' | 'no';
  contracts?: number;
  price?: number;
  thesis?: string;
  confidence?: number;
}

const positions: Position[] = [];
const tradeLog: { time: string; action: string; details: any }[] = [];

function log(action: string, details: any = {}) {
  const entry = { time: new Date().toISOString(), action, details };
  tradeLog.push(entry);
  console.log(`[${entry.time.slice(11, 19)}] ${action}`, details.ticker ? `(${details.ticker})` : '');
}

async function getBalance(): Promise<number> {
  const { balance } = await kalshi('GET', '/portfolio/balance');
  return balance; // in cents
}

async function findOpportunities(): Promise<TradeDecision[]> {
  const decisions: TradeDecision[] = [];

  // Get markets I have opinions on
  const targetMarkets = [
    { ticker: 'KXOAIANTH-40-OAI', myProb: 0.55, thesis: 'OpenAI IPO restructuring signals stronger than market prices' },
    { ticker: 'KXSPACEXMARS-30', myProb: 0.45, thesis: 'SpaceX Starship progress underestimated, 2028 window viable' },
    { ticker: 'CHINAUSGDP-30', myProb: 0.15, thesis: 'China demographic + real estate crisis makes overtake unlikely' },
  ];

  for (const target of targetMarkets) {
    try {
      const { market } = await kalshi('GET', `/markets/${target.ticker}`);

      if (!market || market.status !== 'open') continue;

      // Get best prices
      const { orderbook } = await kalshi('GET', `/markets/${target.ticker}/orderbook`);

      // Find best ask for YES (cheapest YES we can buy)
      // In Kalshi, if NO bid is at X, we can buy YES at 100-X
      const noBids = orderbook.no || [];
      const yesBids = orderbook.yes || [];

      // Best NO bid = we can sell NO at that price = buy YES at 100-price
      const bestNoBid = noBids.length > 0 ? Math.max(...noBids.map((b: number[]) => b[0])) : 0;
      const yesAsk = bestNoBid > 0 ? 100 - bestNoBid : (market.yes_ask || 100);

      // Best YES bid = we can sell YES at that price
      const bestYesBid = yesBids.length > 0 ? Math.max(...yesBids.map((b: number[]) => b[0])) : 0;

      const marketYesProb = yesAsk / 100;
      const edge = target.myProb - marketYesProb;

      if (edge > MIN_EDGE) {
        // We think YES is underpriced
        decisions.push({
          action: 'buy',
          ticker: target.ticker,
          side: 'yes',
          price: yesAsk,
          thesis: target.thesis,
          confidence: Math.min(0.9, 0.5 + edge),
        });
      } else if (edge < -MIN_EDGE) {
        // We think NO is underpriced (YES is overpriced)
        const noAsk = bestYesBid > 0 ? 100 - bestYesBid : (market.no_ask || 100);
        decisions.push({
          action: 'buy',
          ticker: target.ticker,
          side: 'no',
          price: noAsk,
          thesis: `Inverse: ${target.thesis}`,
          confidence: Math.min(0.9, 0.5 - edge),
        });
      }
    } catch (e: any) {
      console.log(`  Error checking ${target.ticker}: ${e.message}`);
    }
  }

  return decisions;
}

async function executeDecision(decision: TradeDecision, balance: number): Promise<boolean> {
  if (decision.action !== 'buy' || !decision.ticker || !decision.side || !decision.price) {
    return false;
  }

  // Position sizing: max 25% of balance, or $5 minimum
  const maxSpend = Math.max(500, Math.floor(balance * MAX_POSITION_SIZE));
  const contracts = Math.floor(maxSpend / decision.price);

  if (contracts < 1) {
    log('SKIP', { reason: 'Insufficient funds for 1 contract', ticker: decision.ticker });
    return false;
  }

  // Check if we already have this position
  const existing = positions.find(p => p.ticker === decision.ticker);
  if (existing) {
    log('SKIP', { reason: 'Already have position', ticker: decision.ticker });
    return false;
  }

  try {
    log('PLACING ORDER', {
      ticker: decision.ticker,
      side: decision.side,
      contracts,
      price: decision.price,
      thesis: decision.thesis,
    });

    const order = await kalshi('POST', '/portfolio/orders', {
      ticker: decision.ticker,
      action: 'buy',
      side: decision.side,
      type: 'limit',
      count: contracts,
      [decision.side === 'yes' ? 'yes_price' : 'no_price']: decision.price,
    });

    log('ORDER PLACED', { order_id: order.order?.order_id, status: order.order?.status });

    // Track position
    positions.push({
      ticker: decision.ticker,
      side: decision.side,
      contracts,
      entry_price: decision.price,
      thesis: decision.thesis || '',
    });

    return true;
  } catch (e: any) {
    log('ORDER FAILED', { ticker: decision.ticker, error: e.message });
    return false;
  }
}

async function checkPositions() {
  // Check status of our positions
  const { event_positions } = await kalshi('GET', '/portfolio/positions');

  for (const pos of positions) {
    const current = event_positions?.find((p: any) => p.ticker === pos.ticker);
    if (current) {
      const pnl = (current.realized_pnl || 0) / 100;
      if (pnl !== 0) {
        log('POSITION UPDATE', {
          ticker: pos.ticker,
          position: current.position,
          pnl: `$${pnl.toFixed(2)}`,
        });
      }
    }
  }
}

async function runTradingLoop() {
  console.log('='.repeat(60));
  console.log('AUTONOMOUS KALSHI TRADER');
  console.log(`Duration: ${DURATION_HOURS} hours`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  console.log();

  const startTime = Date.now();
  const endTime = startTime + DURATION_HOURS * 60 * 60 * 1000;

  // Initial balance
  let balance = await getBalance();
  log('STARTING', { balance: `$${(balance / 100).toFixed(2)}` });

  let iteration = 0;
  while (Date.now() < endTime) {
    iteration++;
    console.log(`\n--- Iteration ${iteration} (${Math.round((endTime - Date.now()) / 60000)} min remaining) ---`);

    try {
      // Get current balance
      balance = await getBalance();
      console.log(`Balance: $${(balance / 100).toFixed(2)}`);

      // Check existing positions
      await checkPositions();

      // Find new opportunities
      console.log('Scanning for opportunities...');
      const opportunities = await findOpportunities();

      if (opportunities.length > 0) {
        console.log(`Found ${opportunities.length} potential trades:`);
        for (const opp of opportunities) {
          console.log(`  - ${opp.ticker}: ${opp.side?.toUpperCase()} @ ${opp.price}¢ (${opp.thesis?.slice(0, 50)}...)`);
        }

        // Execute best opportunity (highest confidence)
        const best = opportunities.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
        await executeDecision(best, balance);
      } else {
        console.log('No opportunities meeting edge threshold');
      }

    } catch (e: any) {
      log('ERROR', { message: e.message });
    }

    // Wait before next check
    console.log(`\nWaiting ${CHECK_INTERVAL_MS / 1000}s...`);
    await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('SESSION COMPLETE');
  console.log('='.repeat(60));

  const finalBalance = await getBalance();
  const startBalance = 3000; // We know it started at $30

  console.log(`\nStarting balance: $${(startBalance / 100).toFixed(2)}`);
  console.log(`Final balance: $${(finalBalance / 100).toFixed(2)}`);
  console.log(`P&L: $${((finalBalance - startBalance) / 100).toFixed(2)}`);

  console.log(`\nPositions taken: ${positions.length}`);
  for (const pos of positions) {
    console.log(`  - ${pos.ticker}: ${pos.contracts}x ${pos.side.toUpperCase()} @ ${pos.entry_price}¢`);
    console.log(`    Thesis: ${pos.thesis}`);
  }

  console.log(`\nTrade log: ${tradeLog.length} entries`);

  // Save log
  fs.writeFileSync(
    `logs/kalshi-trading-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ positions, tradeLog, finalBalance, startBalance }, null, 2)
  );
}

runTradingLoop().catch(console.error);
