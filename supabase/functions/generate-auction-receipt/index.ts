/**
 * GENERATE AUCTION RECEIPT
 * Creates comprehensive AI-generated auction summary
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const { auction_event_id } = await req.json()
    if (!auction_event_id) throw new Error('Missing auction_event_id')

    console.log(`Generating receipt for auction: ${auction_event_id}`)

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) throw new Error('GEMINI_API_KEY required')

    // Get auction data
    const { data: auction } = await supabase
      .from('auction_events')
      .select('*')
      .eq('id', auction_event_id)
      .single()

    // Get all comments
    const { data: comments } = await supabase
      .from('auction_comments')
      .select('*')
      .eq('auction_event_id', auction_event_id)
      .order('posted_at')

    // Get vehicle data
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model, trim')
      .eq('id', auction.vehicle_id)
      .single()

    console.log(`Analyzing ${comments?.length || 0} comments`)

    // Generate comprehensive summary with Gemini
    const receipt = await generateReceipt(auction, comments || [], vehicle, geminiKey)

    // Store receipt
    await supabase
      .from('auction_events')
      .update({
        receipt_data: receipt,
        ai_summary: receipt.ai_summary,
        sentiment_arc: receipt.sentiment_arc,
        key_moments: receipt.key_moments,
        top_contributors: receipt.top_contributors
      })
      .eq('id', auction_event_id)

    console.log('Receipt generated and stored')

    return new Response(JSON.stringify({
      success: true,
      receipt
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

async function generateReceipt(auction: any, comments: any[], vehicle: any, apiKey: string) {
  // Build comment thread for AI
  const commentThread = comments.map((c, i) => 
    `[${i+1}] ${c.posted_at} | ${c.author_username}${c.is_seller ? ' (SELLER)' : ''}: ${c.comment_text}`
  ).join('\n')

  const prompt = `Generate a comprehensive auction intelligence report:

VEHICLE: ${vehicle.year} ${vehicle.make} ${vehicle.model}
OUTCOME: ${auction.outcome}
HIGH BID: $${auction.high_bid}
RESERVE: ${auction.reserve_price || 'Not disclosed'}
TOTAL COMMENTS: ${comments.length}
AUCTION DURATION: ${auction.auction_duration_hours || 7} days

COMMENT THREAD:
${commentThread.substring(0, 50000)}

Analyze and return JSON:
{
  "ai_summary": "3-4 paragraph professional summary explaining what happened and why",
  
  "sentiment_arc": {
    "opening": "Sentiment at auction start",
    "peak": "Highest excitement point",
    "close": "Final sentiment",
    "verdict": "One sentence conclusion"
  },
  
  "key_moments": [
    {
      "time": "Nov 18 2:41 PM",
      "event": "Seller posted cold start video",
      "impact": "+$5k in next 3 bids",
      "sentiment_shift": +15
    }
  ],
  
  "top_contributors": [
    {
      "username": "ExpertName",
      "expertise_level": "expert",
      "comment_count": 8,
      "influence": "High - technical insights valued by bidders"
    }
  ],
  
  "concerns_raised": [
    {"concern": "Frame rust", "raised_by": "Username", "impact": "Bidding stalled"}
  ],
  
  "positive_highlights": [
    {"highlight": "Original paint", "mentioned_by": 3}
  ],
  
  "market_analysis": {
    "price_vs_market": "19% above typical",
    "engagement_quality": "High - many expert comments",
    "seller_transparency": "Excellent - answered all questions",
    "authenticity": "No shill bidding detected"
  },
  
  "why_outcome": "Reserve not met because [specific reasoning based on comments]",
  
  "recommendations": {
    "for_seller": "Lower reserve to $42k, address rust concerns",
    "for_buyers": "Fair market value is $38k-$42k given condition",
    "optimal_timing": "Relist in spring for 15% premium"
  }
}

Be thorough, scientific, and evidence-based.`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { 
        response_mime_type: "application/json", 
        temperature: 0.4,
        topP: 0.95
      }
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini error: ${response.status} - ${err}`)
  }

  const data = await response.json()
  const text = data.candidates[0].content.parts[0].text
  return JSON.parse(text)
}

