import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackfillRequest {
  organization_id: string;
  instagram_handle: string;
  instagram_account_id?: string;
  limit?: number; // Max posts to fetch (null = all)
  batch_size?: number; // Posts per API call
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const request: BackfillRequest = await req.json();
    const { organization_id, instagram_handle, instagram_account_id, limit, batch_size = 25 } = request;

    if (!organization_id || !instagram_handle) {
      throw new Error('organization_id and instagram_handle are required');
    }

    console.log(`[backfill-instagram-content] Starting backfill for ${instagram_handle} (org: ${organization_id})`);

    const accessToken = Deno.env.get('INSTAGRAM_ACCESS_TOKEN');
    if (!accessToken) {
      throw new Error('Instagram access token not configured');
    }

    let igAccountId = instagram_account_id;
    if (!igAccountId) {
      // Try to get from external_identities
      const { data: identity } = await supabase
        .from('external_identities')
        .select('metadata')
        .eq('platform', 'instagram')
        .eq('handle', instagram_handle.toLowerCase())
        .maybeSingle();

      igAccountId = identity?.metadata?.instagram_account_id;
    }

    if (!igAccountId) {
      throw new Error('Instagram account ID required');
    }

    // Fetch all posts with pagination
    let allPosts: any[] = [];
    let nextCursor: string | null = null;
    let totalFetched = 0;
    const maxPosts = limit || Infinity;

    do {
      const fields = 'id,media_type,media_url,permalink,caption,timestamp,thumbnail_url,children{id,media_url}';
      let url = `https://graph.instagram.com/${igAccountId}/media?fields=${fields}&limit=${batch_size}&access_token=${accessToken}`;
      
      if (nextCursor) {
        url += `&after=${nextCursor}`;
      }

      console.log(`[backfill-instagram-content] Fetching batch (cursor: ${nextCursor || 'initial'})`);

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Instagram API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const posts = data.data || [];

      allPosts.push(...posts);
      totalFetched += posts.length;
      nextCursor = data.paging?.cursors?.after || null;

      console.log(`[backfill-instagram-content] Fetched ${posts.length} posts (total: ${totalFetched})`);

      // Check if we've hit the limit
      if (limit && totalFetched >= limit) {
        allPosts = allPosts.slice(0, limit);
        break;
      }

      // Rate limiting: wait 1 second between batches
      if (nextCursor) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } while (nextCursor && totalFetched < maxPosts);

    console.log(`[backfill-instagram-content] Total posts to process: ${allPosts.length}`);

    // Process posts in batches using sync-instagram-organization
    const batchResults = {
      processed: 0,
      created: 0,
      updated: 0,
      errors: [] as string[]
    };

    // Process in smaller batches to avoid timeouts
    const processBatchSize = 10;
    for (let i = 0; i < allPosts.length; i += processBatchSize) {
      const batch = allPosts.slice(i, i + processBatchSize);
      
      // Call sync function for this batch
      // Note: We'll process directly here instead of calling sync function
      // to avoid nested function calls and better error handling
      
      for (const post of batch) {
        try {
          // Reuse logic from sync-instagram-organization
          // For now, call the sync function with a limit
          const syncResponse = await supabase.functions.invoke('sync-instagram-organization', {
            body: {
              organization_id: organization_id,
              instagram_handle: instagram_handle,
              instagram_account_id: igAccountId,
              limit: 1, // Process one at a time to avoid rate limits
              since: post.timestamp // Only fetch this specific post
            }
          });

          if (syncResponse.error) {
            throw syncResponse.error;
          }

          const syncData = await syncResponse.data;
          if (syncData?.results) {
            batchResults.processed += syncData.results.processed || 0;
            batchResults.created += syncData.results.created || 0;
            batchResults.updated += syncData.results.updated || 0;
            batchResults.errors.push(...(syncData.results.errors || []));
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error: any) {
          console.error(`[backfill-instagram-content] Error processing post ${post.id}:`, error);
          batchResults.errors.push(`Post ${post.id}: ${error.message}`);
        }
      }

      console.log(`[backfill-instagram-content] Processed batch ${Math.floor(i / processBatchSize) + 1}/${Math.ceil(allPosts.length / processBatchSize)}`);
    }

    console.log(`[backfill-instagram-content] Backfill complete: ${batchResults.processed} processed, ${batchResults.created} created, ${batchResults.updated} updated`);

    return new Response(
      JSON.stringify({
        success: true,
        total_posts_fetched: allPosts.length,
        results: batchResults
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[backfill-instagram-content] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

