/**
 * ANALYZE AUCTION COMMENTS
 * AI analysis of comment sentiment, authenticity, and influence
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

    const { auction_event_id, comment_id } = await req.json()
    
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) throw new Error('GEMINI_API_KEY required')

    // Get comments to analyze
    let comments
    if (comment_id) {
      const { data } = await supabase
        .from('auction_comments')
        .select('*')
        .eq('id', comment_id)
      comments = data || []
    } else if (auction_event_id) {
      const { data } = await supabase
        .from('auction_comments')
        .select('*')
        .eq('auction_event_id', auction_event_id)
        .is('sentiment', null) // Only unanalyzed
        .limit(50)
      comments = data || []
    } else {
      throw new Error('Need auction_event_id or comment_id')
    }

    console.log(`Analyzing ${comments.length} comments`)

    let analyzed = 0
    for (const comment of comments) {
      try {
        const analysis = await analyzeComment(comment, geminiKey)
        
        await supabase
          .from('auction_comments')
          .update({
            sentiment: analysis.sentiment,
            sentiment_score: analysis.sentiment_score,
            authenticity_score: analysis.authenticity_score,
            expertise_score: analysis.expertise_score,
            key_claims: analysis.key_claims,
            expertise_indicators: analysis.expertise_indicators,
            analyzed_at: new Date().toISOString()
          })
          .eq('id', comment.id)
        
        analyzed++
      } catch (e) {
        console.error(`Failed to analyze comment ${comment.id}:`, e)
      }
      
      // Rate limit
      await new Promise(r => setTimeout(r, 500))
    }

    return new Response(JSON.stringify({
      success: true,
      analyzed_count: analyzed
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

async function analyzeComment(comment: any, apiKey: string) {
  const prompt = `Analyze this auction comment scientifically:

Comment: "${comment.comment_text}"
Author: ${comment.author_username} (${comment.author_total_likes} total likes)
Type: ${comment.comment_type}
Posted: ${comment.hours_until_close}h before auction close
Is Seller: ${comment.is_seller}

Extract:
{
  "sentiment": "bullish|bearish|neutral|skeptical|excited",
  "sentiment_score": -100 to +100,
  "authenticity_score": 0-100 (100=definitely human, 0=likely bot/shill),
  "expertise_score": 0-100 (technical knowledge evident),
  "expertise_indicators": ["mentions_specific_part", "knows_market_pricing", "restoration_experience"],
  "key_claims": ["factual statements that can be verified"],
  "influence_potential": 0-100 (will this comment affect bidding?),
  "reasoning": "brief explanation"
}

Be scientific and evidence-based.`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json", temperature: 0.3 }
    })
  })

  if (!response.ok) throw new Error(`Gemini error: ${response.status}`)

  const data = await response.json()
  const text = data.candidates[0].content.parts[0].text
  return JSON.parse(text)
}

