/**
 * Inspect C&B HTML structure to understand __NEXT_DATA__ format
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== Inspecting C&B HTML from listing_page_snapshots ===\n');

  // Get the most recent C&B snapshot
  const { data: snapshot, error } = await supabase
    .from('listing_page_snapshots')
    .select('listing_url, html, created_at')
    .eq('platform', 'carsandbids')
    .eq('success', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !snapshot) {
    console.log('No C&B snapshots found:', error?.message);
    return;
  }

  console.log('Found snapshot for:', snapshot.listing_url);
  console.log('Created at:', snapshot.created_at);
  console.log('HTML length:', snapshot.html?.length || 0, 'chars\n');

  const html = snapshot.html || '';

  // Look for __NEXT_DATA__
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    console.log('No __NEXT_DATA__ found in HTML');

    // Check for other script patterns
    console.log('\nLooking for other data patterns...');
    const windowData = html.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});/i);
    if (windowData) {
      console.log('Found window.__NEXT_DATA__ assignment');
      try {
        const data = JSON.parse(windowData[1]);
        console.log('Keys:', Object.keys(data));
      } catch (e) {
        console.log('Failed to parse:', e);
      }
    }

    // Check for any script with data
    const allScripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
    console.log('\nTotal scripts found:', allScripts?.length || 0);

    // Look for auction data patterns
    const auctionPattern = html.match(/"auction":\s*\{[^}]+/i);
    if (auctionPattern) {
      console.log('Found auction pattern:', auctionPattern[0].substring(0, 200));
    }

    return;
  }

  console.log('Found __NEXT_DATA__ script tag');

  try {
    const data = JSON.parse(match[1]);
    console.log('\nTop-level keys:', Object.keys(data));
    console.log('props keys:', Object.keys(data.props || {}));
    console.log('pageProps keys:', Object.keys(data.props?.pageProps || {}));

    // Check for auction data in various locations
    const pageProps = data.props?.pageProps || {};

    if (pageProps.auction) {
      console.log('\nFound pageProps.auction with keys:', Object.keys(pageProps.auction));
      const auction = pageProps.auction;
      console.log('  VIN:', auction.vin || 'NOT FOUND');
      console.log('  mileage:', auction.mileage || 'NOT FOUND');
      console.log('  title:', auction.title || 'NOT FOUND');
    } else if (pageProps.data?.auction) {
      console.log('\nFound pageProps.data.auction');
    } else {
      console.log('\nNo auction in standard paths. PageProps structure:');
      for (const [key, value] of Object.entries(pageProps)) {
        const valueType = typeof value;
        const valuePreview = valueType === 'object'
          ? (Array.isArray(value) ? `Array(${(value as any[]).length})` : `Object(${Object.keys(value as object).length} keys)`)
          : String(value).substring(0, 50);
        console.log(`  ${key}: ${valueType} = ${valuePreview}`);
      }
    }
  } catch (e) {
    console.log('Failed to parse __NEXT_DATA__:', e);
    console.log('Raw content (first 500 chars):', match[1].substring(0, 500));
  }
}

main().catch(console.error);
