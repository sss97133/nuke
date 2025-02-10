
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AlgorithmPreferences {
  content_weights: {
    technical: number;
    market: number;
    social: number;
    educational: number;
    project: number;
    inventory: number;
    service: number;
  };
  professional_interests: string[];
  technical_level_preference: number;
  market_alert_threshold: number;
  geographic_radius_km: number;
  preferred_categories: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { user_id } = await req.json()
    
    if (!user_id) {
      throw new Error('User ID is required')
    }

    console.log('Calculating feed relevance for user:', user_id)

    // Get user's algorithm preferences
    const { data: preferences, error: preferencesError } = await supabaseClient
      .from('algorithm_preferences')
      .select('*')
      .eq('user_id', user_id)
      .single()

    if (preferencesError) {
      throw preferencesError
    }

    const userPrefs = preferences as AlgorithmPreferences

    // Get user's engagement metrics with interaction weights
    const { data: engagements, error: engagementsError } = await supabaseClient
      .from('engagement_metrics')
      .select('feed_item_id, interaction_type, view_duration_seconds')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (engagementsError) {
      throw engagementsError
    }

    // Calculate engagement scores with weighted interactions
    const engagementScores = new Map<string, number>()
    engagements.forEach((engagement) => {
      const currentScore = engagementScores.get(engagement.feed_item_id) || 0
      let interactionWeight = 1.0

      // Weight different types of interactions
      switch (engagement.interaction_type) {
        case 'click':
          interactionWeight = 2.0
          break
        case 'view':
          interactionWeight = 1.0
          break
        case 'view_complete':
          // Longer views get higher weights
          interactionWeight = Math.min(3.0, 1.0 + (engagement.view_duration_seconds || 0) / 60)
          break
        default:
          interactionWeight = 1.0
      }

      engagementScores.set(
        engagement.feed_item_id,
        currentScore + interactionWeight
      )
    })

    // Update feed items with new relevance scores
    const { data: feedItems, error: feedItemsError } = await supabaseClient
      .from('feed_items')
      .select('*')
      .is('expiration_time', null)
      .order('created_at', { ascending: false })
      .limit(50)

    if (feedItemsError) {
      throw feedItemsError
    }

    // Calculate new relevance scores
    const updates = feedItems.map((item) => {
      const baseScore = item.relevance_score || 1.0
      const engagementScore = engagementScores.get(item.id) || 1.0
      const contentTypeWeight = userPrefs.content_weights[item.item_type as keyof typeof userPrefs.content_weights] || 1.0
      const technicalLevelMatch = Math.max(0, 1 - Math.abs(userPrefs.technical_level_preference - (item.technical_level || 1)) / 5)
      
      // Calculate time decay (items older than 24 hours start losing relevance)
      const ageInHours = (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60)
      const timeDecay = Math.max(0.5, 1 - (ageInHours > 24 ? (ageInHours - 24) / 72 : 0))

      // Calculate geographic relevance if location data exists
      let geoRelevance = 1.0
      if (item.geographic_relevance && userPrefs.geographic_radius_km) {
        const distance = calculateDistance(item.geographic_relevance)
        geoRelevance = distance <= userPrefs.geographic_radius_km ? 1.0 : 
                       distance <= userPrefs.geographic_radius_km * 2 ? 0.7 : 0.3
      }

      // Combine all factors
      const newRelevanceScore = 
        baseScore * 
        engagementScore * 
        contentTypeWeight * 
        technicalLevelMatch * 
        timeDecay * 
        geoRelevance

      return supabaseClient
        .from('feed_items')
        .update({ relevance_score: newRelevanceScore })
        .eq('id', item.id)
    })

    // Execute all updates
    await Promise.all(updates)

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error calculating feed relevance:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

// Helper function to calculate distance (placeholder - implement actual distance calculation)
function calculateDistance(geoData: any): number {
  // Implement actual distance calculation based on your geographic data structure
  return 0
}
