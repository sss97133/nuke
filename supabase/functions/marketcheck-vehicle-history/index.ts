import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MarketCheckHistoryResponse {
  vin: string
  price_history?: Array<{
    date: string
    price: number
    source: string
    listing_type: string
    mileage?: number
    location?: string
  }>
  ownership_history?: Array<{
    date: string
    owner_type: string
    location: string
    duration_days: number
  }>
  market_exposure?: {
    total_days_listed: number
    listing_count: number
    average_days_per_listing: number
    first_listed_date: string
    last_listed_date: string
  }
  regional_data?: Array<{
    region: string
    average_price: number
    listing_count: number
    days_on_market: number
  }>
  confidence_score: number
  last_updated: string
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { vin, vehicle_id } = await req.json()

    if (!vin) {
      return new Response(
        JSON.stringify({ error: 'VIN is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Get MarketCheck API credentials from Supabase secrets
    const marketCheckApiKey = Deno.env.get('MARKETCHECK_API_KEY')
    const marketCheckApiSecret = Deno.env.get('MARKETCHECK_API_SECRET')

    if (!marketCheckApiKey || !marketCheckApiSecret) {
      return new Response(
        JSON.stringify({ error: 'MarketCheck API credentials not configured' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Call MarketCheck Vehicle History API
    const historyUrl = `https://api.marketcheck.com/v2/history/car/${vin}`
    
    const historyResponse = await fetch(historyUrl, {
      method: 'GET',
      headers: {
        'X-Api-Key': marketCheckApiKey,
        'X-Api-Secret': marketCheckApiSecret,
        'Content-Type': 'application/json'
      }
    })

    if (!historyResponse.ok) {
      if (historyResponse.status === 404) {
        return new Response(
          JSON.stringify({ 
            error: 'Vehicle history not found for this VIN',
            vin: vin,
            available: false
          }),
          { 
            status: 404, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }
      
      throw new Error(`MarketCheck API error: ${historyResponse.status} ${historyResponse.statusText}`)
    }

    const historyData = await historyResponse.json()

    // Process and validate the response
    const processedHistory: MarketCheckHistoryResponse = {
      vin: vin,
      price_history: historyData.price_history || [],
      ownership_history: historyData.ownership_history || [],
      market_exposure: historyData.market_exposure || {
        total_days_listed: 0,
        listing_count: 0,
        average_days_per_listing: 0,
        first_listed_date: null,
        last_listed_date: null
      },
      regional_data: historyData.regional_data || [],
      confidence_score: calculateConfidenceScore(historyData),
      last_updated: new Date().toISOString()
    }

    // If vehicle_id is provided, store the history data in the database
    if (vehicle_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const supabase = createClient(supabaseUrl, supabaseKey)

      // Store in vehicle_price_history table
      if (processedHistory.price_history && processedHistory.price_history.length > 0) {
        const priceHistoryRecords = processedHistory.price_history.map(entry => ({
          vehicle_id: vehicle_id,
          price_type: 'asking',
          value: entry.price,
          source: `marketcheck_${entry.source}`,
          as_of: entry.date,
          confidence: Math.min(processedHistory.confidence_score, 90),
          created_at: new Date().toISOString()
        }))

        const { error: priceHistoryError } = await supabase
          .from('vehicle_price_history')
          .upsert(priceHistoryRecords, {
            onConflict: 'vehicle_id,source,as_of'
          })

        if (priceHistoryError) {
          console.error('Error storing price history:', priceHistoryError)
        }
      }

      // Store comprehensive history data in market_data table
      const { error: marketDataError } = await supabase
        .from('market_data')
        .upsert({
          vehicle_id: vehicle_id,
          source: 'marketcheck_history',
          data_type: 'historical_sale',
          confidence_score: processedHistory.confidence_score,
          raw_data: processedHistory,
          last_verified: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'vehicle_id,source'
        })

      if (marketDataError) {
        console.error('Error storing market data:', marketDataError)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: processedHistory,
        available: true,
        summary: {
          price_points: processedHistory.price_history?.length || 0,
          ownership_changes: processedHistory.ownership_history?.length || 0,
          total_market_days: processedHistory.market_exposure?.total_days_listed || 0,
          confidence: processedHistory.confidence_score
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('MarketCheck vehicle history error:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch vehicle history',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

function calculateConfidenceScore(historyData: any): number {
  let confidence = 60 // Base confidence

  // Increase confidence based on data richness
  if (historyData.price_history && historyData.price_history.length > 0) {
    confidence += 20
    
    // Bonus for multiple price points
    if (historyData.price_history.length > 3) {
      confidence += 10
    }
  }

  if (historyData.ownership_history && historyData.ownership_history.length > 0) {
    confidence += 15
  }

  if (historyData.market_exposure && historyData.market_exposure.total_days_listed > 0) {
    confidence += 10
  }

  if (historyData.regional_data && historyData.regional_data.length > 0) {
    confidence += 5
  }

  return Math.min(95, confidence)
}