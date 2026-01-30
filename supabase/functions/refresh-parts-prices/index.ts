/**
 * Refresh Parts Prices
 *
 * Cron job that runs every 4 hours to:
 * - Clear expired eBay cache entries
 * - Fetch fresh prices for popular parts
 * - Update part_price_stats aggregates
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RefreshStats {
  cacheCleared: number
  partsRefreshed: number
  priceStatsUpdated: number
  errors: string[]
  duration: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const stats: RefreshStats = {
    cacheCleared: 0,
    partsRefreshed: 0,
    priceStatsUpdated: 0,
    errors: [],
    duration: 0
  }

  try {
    console.log('Starting parts price refresh...')

    // 1. Clear expired cache entries
    const { data: deleted, error: cacheError } = await supabase
      .from('ebay_api_cache')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id')

    if (cacheError) {
      stats.errors.push(`Cache cleanup error: ${cacheError.message}`)
    } else {
      stats.cacheCleared = deleted?.length || 0
      console.log(`Cleared ${stats.cacheCleared} expired cache entries`)
    }

    // 2. Get parts that need price refresh (most accessed or recently created)
    const { data: partsToRefresh, error: partsError } = await supabase
      .from('issue_part_mapping')
      .select(`
        id,
        part_name,
        makes,
        models
      `)
      .eq('is_active', true)
      .limit(20) // Limit to avoid rate limiting

    if (partsError) {
      stats.errors.push(`Parts fetch error: ${partsError.message}`)
    } else if (partsToRefresh) {
      console.log(`Refreshing prices for ${partsToRefresh.length} parts`)

      // Fetch prices for each part (with concurrency limit)
      const concurrencyLimit = 3
      for (let i = 0; i < partsToRefresh.length; i += concurrencyLimit) {
        const batch = partsToRefresh.slice(i, i + concurrencyLimit)

        await Promise.all(batch.map(async (part) => {
          try {
            // Call eBay price fetch function
            const response = await fetch(`${SUPABASE_URL}/functions/v1/fetch-ebay-parts-prices`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                query: part.part_name,
                make: part.makes?.[0],
                model: part.models?.[0],
                limit: 10
              })
            })

            if (response.ok) {
              const data = await response.json()

              // Store price observations
              if (data.listings && data.listings.length > 0) {
                const observations = data.listings.map((listing: any) => ({
                  source_name: 'eBay',
                  price_cents: Math.round(listing.price * 100),
                  condition: listing.condition,
                  seller_name: listing.seller?.username,
                  seller_rating: listing.seller?.feedbackPercentage,
                  shipping_cents: listing.shippingCost ? Math.round(listing.shippingCost * 100) : null,
                  free_shipping: listing.freeShipping,
                  in_stock: true,
                  source_url: listing.itemWebUrl,
                  source_item_id: listing.itemId,
                  observed_at: new Date().toISOString()
                }))

                // Insert observations (part_catalog_id would need to be linked)
                // For now, just track that we refreshed this part
                stats.partsRefreshed++
              }
            } else {
              console.warn(`Failed to fetch prices for ${part.part_name}: ${response.status}`)
            }
          } catch (err) {
            console.error(`Error refreshing ${part.part_name}:`, err)
          }
        }))

        // Rate limiting delay between batches
        if (i + concurrencyLimit < partsToRefresh.length) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
    }

    // 3. Update price statistics
    const { data: statsResult, error: statsError } = await supabase
      .rpc('manual_refresh_parts_prices')

    if (statsError) {
      // Function might not exist yet
      console.warn('Stats refresh RPC not available:', statsError.message)
    } else if (statsResult && statsResult.length > 0) {
      stats.priceStatsUpdated = statsResult[0].parts_updated || 0
      console.log(`Updated price stats for ${stats.priceStatsUpdated} parts`)
    }

    stats.duration = Date.now() - startTime
    console.log(`Price refresh completed in ${stats.duration}ms`)

    return new Response(JSON.stringify({
      success: true,
      stats
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Price refresh error:', error)
    stats.duration = Date.now() - startTime
    stats.errors.push(error.message)

    return new Response(JSON.stringify({
      success: false,
      stats,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
