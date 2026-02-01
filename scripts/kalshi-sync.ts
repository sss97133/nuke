#!/usr/bin/env npx tsx
/**
 * Kalshi Position Sync
 *
 * Syncs positions and fills from Kalshi API to Supabase.
 * Run as cron job or on-demand.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/kalshi-sync.ts
 *   dotenvx run -- npx tsx scripts/kalshi-sync.ts --user <user_id>
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

// ============ Kalshi Client ============

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

async function kalshiRequest<T = any>(
  keyId: string,
  privateKey: string,
  method: string,
  endpoint: string
): Promise<T> {
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
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kalshi ${response.status}: ${error}`);
  }

  return response.json();
}

// ============ Supabase Client ============

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ============ Sync Functions ============

interface SyncResult {
  positions_synced: number;
  fills_synced: number;
  errors: string[];
}

async function syncPositions(
  userId: string,
  keyId: string,
  privateKey: string
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  try {
    // Get positions from Kalshi
    const { event_positions } = await kalshiRequest<{ event_positions: any[] }>(
      keyId,
      privateKey,
      'GET',
      '/portfolio/positions'
    );

    if (!event_positions?.length) {
      console.log(`  No positions for user ${userId}`);
      return { synced: 0, errors: [] };
    }

    // Get market details for each position
    for (const pos of event_positions) {
      try {
        // Fetch market metadata
        let marketTitle = pos.ticker;
        let eventTitle = '';
        let category = '';
        let closeTime = null;

        try {
          const { market } = await kalshiRequest<{ market: any }>(
            keyId,
            privateKey,
            'GET',
            `/markets/${pos.ticker}`
          );
          marketTitle = market.title;
          closeTime = market.close_time;

          // Get event details
          if (market.event_ticker) {
            const { event } = await kalshiRequest<{ event: any }>(
              keyId,
              privateKey,
              'GET',
              `/events/${market.event_ticker}`
            );
            eventTitle = event.title;
            category = event.category;
          }
        } catch (e) {
          // Market lookup failed, continue with basic data
        }

        // Upsert position
        const { error } = await supabase
          .from('kalshi_positions')
          .upsert({
            user_id: userId,
            ticker: pos.ticker,
            event_ticker: pos.event_ticker,
            position: pos.position,
            market_exposure: pos.market_exposure,
            resting_orders_count: pos.resting_orders_count || 0,
            total_traded: pos.total_traded || 0,
            realized_pnl: pos.realized_pnl || 0,
            market_title: marketTitle,
            event_title: eventTitle,
            category: category,
            close_time: closeTime,
            synced_at: new Date().toISOString(),
            // Mark as closed if position is 0
            closed_at: pos.position === 0 ? new Date().toISOString() : null,
          }, {
            onConflict: 'user_id,ticker',
          });

        if (error) {
          errors.push(`Position ${pos.ticker}: ${error.message}`);
        } else {
          synced++;
        }
      } catch (e: any) {
        errors.push(`Position ${pos.ticker}: ${e.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`Positions fetch: ${e.message}`);
  }

  return { synced, errors };
}

async function syncFills(
  userId: string,
  keyId: string,
  privateKey: string,
  since?: string
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  try {
    // Get fills from Kalshi (paginated)
    let cursor: string | undefined;
    let allFills: any[] = [];

    do {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) params.set('cursor', cursor);
      if (since) params.set('min_ts', since);

      const response = await kalshiRequest<{ fills: any[]; cursor?: string }>(
        keyId,
        privateKey,
        'GET',
        `/portfolio/fills?${params.toString()}`
      );

      allFills = allFills.concat(response.fills || []);
      cursor = response.cursor;
    } while (cursor);

    if (!allFills.length) {
      console.log(`  No new fills for user ${userId}`);
      return { synced: 0, errors: [] };
    }

    // Insert fills (ignore duplicates via trade_id unique constraint)
    for (const fill of allFills) {
      const costCents = fill.count * (fill.side === 'yes' ? fill.yes_price : fill.no_price);

      const { error } = await supabase
        .from('kalshi_fills')
        .upsert({
          user_id: userId,
          trade_id: fill.trade_id,
          order_id: fill.order_id,
          ticker: fill.ticker,
          action: fill.action,
          side: fill.side,
          count: fill.count,
          yes_price: fill.yes_price,
          no_price: fill.no_price,
          cost_cents: costCents,
          executed_at: fill.created_time,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: 'trade_id',
          ignoreDuplicates: true,
        });

      if (error && !error.message.includes('duplicate')) {
        errors.push(`Fill ${fill.trade_id}: ${error.message}`);
      } else if (!error) {
        synced++;
      }
    }
  } catch (e: any) {
    errors.push(`Fills fetch: ${e.message}`);
  }

  return { synced, errors };
}

async function updateBettingProfile(userId: string): Promise<void> {
  // Recalculate user betting profile from fills
  const { data: fills } = await supabase
    .from('kalshi_fills')
    .select('*')
    .eq('user_id', userId);

  if (!fills?.length) return;

  // Calculate stats
  const totalBets = fills.length;
  const totalWagered = fills.reduce((sum, f) => sum + (f.cost_cents || 0), 0);

  // Get category preferences from positions
  const { data: positions } = await supabase
    .from('kalshi_positions')
    .select('category')
    .eq('user_id', userId);

  const categories = [...new Set(positions?.map(p => p.category).filter(Boolean) || [])];

  // Calculate avg position size
  const avgPositionSize = Math.round(totalWagered / totalBets);

  // Upsert profile
  await supabase
    .from('user_betting_profiles')
    .upsert({
      user_id: userId,
      total_bets: totalBets,
      total_wagered_cents: totalWagered,
      preferred_categories: categories,
      avg_position_size_cents: avgPositionSize,
      first_bet_at: fills[fills.length - 1]?.executed_at,
      last_bet_at: fills[0]?.executed_at,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    });
}

// ============ Main ============

async function main() {
  const args = process.argv.slice(2);
  const userIdArg = args.indexOf('--user');
  const specificUserId = userIdArg !== -1 ? args[userIdArg + 1] : null;

  console.log('=== KALSHI SYNC ===\n');

  // For now, use the single API key from env
  // In production, each user would have their own connected Kalshi account
  const keyId = process.env.KALSHI_API_KEY_ID!;
  const privateKey = fs.readFileSync(
    path.join(process.cwd(), 'priv/kalshi/private_key.pem'),
    'utf-8'
  );

  // Demo: sync for a test user (in production, iterate over kalshi_accounts)
  const testUserId = specificUserId || 'demo-user-id';

  console.log(`Syncing for user: ${testUserId}`);

  // Sync positions
  console.log('\n1. Syncing positions...');
  const posResult = await syncPositions(testUserId, keyId, privateKey);
  console.log(`   Synced: ${posResult.synced} positions`);
  if (posResult.errors.length) {
    console.log(`   Errors: ${posResult.errors.join(', ')}`);
  }

  // Sync fills
  console.log('\n2. Syncing fills...');
  const fillResult = await syncFills(testUserId, keyId, privateKey);
  console.log(`   Synced: ${fillResult.synced} fills`);
  if (fillResult.errors.length) {
    console.log(`   Errors: ${fillResult.errors.join(', ')}`);
  }

  // Update betting profile
  console.log('\n3. Updating betting profile...');
  await updateBettingProfile(testUserId);
  console.log('   Done');

  console.log('\n=== SYNC COMPLETE ===');
}

main().catch(console.error);
