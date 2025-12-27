import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * SYNC ACTIVE AUCTIONS - Batch Sync All Active Auction Listings
 * 
 * Efficiently syncs all active external auction listings to keep bid counts
 * and current bids up-to-date. Processes listings in batches by platform.
 * 
 * Rate limiting: Only syncs listings that haven't been synced in the last 15 minutes
 * to avoid overwhelming external sites.
 */

interface SyncResult {
  platform: string;
  total_active: number;
  synced: number;
  skipped_recent: number;
  failed: number;
  errors: string[];
}

const SYNC_COOLDOWN_MINUTES = 15; // Don't sync same listing more than once per 15 minutes
const BATCH_SIZE = 20; // Process this many listings per platform per run

Deno.serve(async (req: Request) => {
  try {
    const { batch_size = BATCH_SIZE, platforms } = await req.json().catch(() => ({}));
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get all active listings that need syncing
    // Only sync if:
    // 1. listing_status = 'active'
    // 2. sync_enabled = true
    // 3. last_synced_at is NULL or older than cooldown period
    const cooldownThreshold = new Date();
    cooldownThreshold.setMinutes(cooldownThreshold.getMinutes() - SYNC_COOLDOWN_MINUTES);

    // Get listings that need syncing - try RPC function first, fallback to direct query
    let listings: any[];
    let queryError: any = null;
    
    try {
      const rpcResult = await supabase.rpc('get_listings_needing_sync', {
        cooldown_threshold: cooldownThreshold.toISOString(),
        batch_limit: batch_size
      });
      listings = rpcResult.data || [];
      queryError = rpcResult.error;
    } catch (e) {
      // Fallback: use direct query if RPC doesn't exist yet
      let query = supabase
        .from('external_listings')
        .select('id, platform, listing_url')
        .eq('listing_status', 'active')
        .eq('sync_enabled', true)
        .or(`last_synced_at.is.null,last_synced_at.lt.${cooldownThreshold.toISOString()}`)
        .order('last_synced_at', { ascending: true, nullsFirst: true })
        .limit(batch_size);
      
      // Filter by platforms if specified
      if (platforms && Array.isArray(platforms) && platforms.length > 0) {
        query = query.in('platform', platforms);
      }
      
      const result = await query;
      listings = result.data || [];
      queryError = result.error;
    }

    if (queryError) {
      throw new Error(`Query error: ${queryError.message}`);
    }

    if (!listings || listings.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No active listings need syncing',
        results: {}
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Group listings by platform
    const listingsByPlatform = new Map<string, typeof listings>();
    for (const listing of listings) {
      if (!listingsByPlatform.has(listing.platform)) {
        listingsByPlatform.set(listing.platform, []);
      }
      listingsByPlatform.get(listing.platform)!.push(listing);
    }

    const results: Record<string, SyncResult> = {};

    // Sync each platform's listings
    for (const [platform, platformListings] of listingsByPlatform.entries()) {
      const result: SyncResult = {
        platform,
        total_active: platformListings.length,
        synced: 0,
        skipped_recent: 0,
        failed: 0,
        errors: []
      };

      // Determine which sync function to call based on platform
      let syncFunctionName: string | null = null;
      
      // Map platform to sync function
      // Database uses 'cars_and_bids' but sync function checks for 'carsandbids'
      // So we need to handle both
      const platformSyncMap: Record<string, string> = {
        'bat': 'sync-bat-listing',
        'bring_a_trailer': 'sync-bat-listing',
        'bringatrailer': 'sync-bat-listing',
        'cars_and_bids': 'sync-cars-and-bids-listing', // DB format
        'carsandbids': 'sync-cars-and-bids-listing',   // Sync function format
        'carsandbids_com': 'sync-cars-and-bids-listing',
        // Note: monitor-sbxcars-listings exists but works differently (batch processing)
        // monitor-pcarmarket-auction also exists but works differently
        // These would need to be integrated separately
      };
      
      syncFunctionName = platformSyncMap[platform] || null;
      
      if (!syncFunctionName) {
        // For platforms without direct sync functions, log and skip
        result.errors.push(`No sync function available for platform: ${platform}. Available: ${Object.keys(platformSyncMap).join(', ')}`);
        results[platform] = result;
        continue;
      }

      // Sync each listing
      for (const listing of platformListings) {
        try {
          // Call the appropriate sync function
          const syncUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${syncFunctionName}`;
          const syncResponse = await fetch(syncUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              externalListingId: listing.id
            })
          });

          if (!syncResponse.ok) {
            const errorText = await syncResponse.text();
            result.failed++;
            result.errors.push(`Listing ${listing.id}: ${errorText.substring(0, 100)}`);
          } else {
            result.synced++;
            // Update last_synced_at (the sync function should do this, but ensure it)
            await supabase
              .from('external_listings')
              .update({ last_synced_at: new Date().toISOString() })
              .eq('id', listing.id);
          }

          // Small delay between syncs to avoid rate limiting external sites
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error: any) {
          result.failed++;
          result.errors.push(`Listing ${listing.id}: ${error.message}`);
        }
      }

      results[platform] = result;
    }

    // Summary statistics
    const totalSynced = Object.values(results).reduce((sum, r) => sum + r.synced, 0);
    const totalFailed = Object.values(results).reduce((sum, r) => sum + r.failed, 0);

    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${totalSynced} listings, ${totalFailed} failed`,
      results,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Sync error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

