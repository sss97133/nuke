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
      // Use service role for DB writes (fallback to legacy env var names)
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const { auction_event_id, comment_id } = await req.json().catch(() => ({} as any))
    
    const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('OPENAI_KEY') ?? ''
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
    if (!openaiKey && !anthropicKey) {
      // Don't fail ingestion if AI isn't configured.
      return new Response(JSON.stringify({
        success: true,
        analyzed_count: 0,
        skipped: true,
        reason: 'Missing OPENAI_API_KEY or ANTHROPIC_API_KEY'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

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
      // Called without identifiers. No-op.
      return new Response(JSON.stringify({
        success: true,
        analyzed_count: 0,
        skipped: true,
        reason: 'Need auction_event_id or comment_id'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`Analyzing ${comments.length} comments`)

    let analyzed = 0
    for (const comment of comments) {
      try {
        const analysis = await analyzeComment(comment, { openaiKey, anthropicKey })
        
        await supabase
          .from('auction_comments')
          .update({
            sentiment: analysis.sentiment,
            sentiment_score: analysis.sentiment_score,
            authenticity_score: analysis.authenticity_score,
            expertise_score: analysis.expertise_score,
            key_claims: analysis.key_claims,
            expertise_indicators: analysis.expertise_indicators,
            influence_score: analysis.influence_potential ?? null,
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

type AnalysisResult = {
  sentiment: string | null;
  sentiment_score: number | null;
  authenticity_score: number | null;
  expertise_score: number | null;
  expertise_indicators: string[] | null;
  key_claims: string[] | null;
  influence_potential?: number | null;
};

async function analyzeComment(comment: any, keys: { openaiKey: string, anthropicKey: string }): Promise<AnalysisResult> {
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

Return ONLY valid JSON with these keys.`;

  // Prefer OpenAI (cheapest widely available model), fall back to Anthropic.
  if (keys.openaiKey) {
    return await analyzeWithOpenAI(prompt, keys.openaiKey);
  }
  if (keys.anthropicKey) {
    return await analyzeWithAnthropic(prompt, keys.anthropicKey);
  }
  return {
    sentiment: null,
    sentiment_score: null,
    authenticity_score: null,
    expertise_score: null,
    expertise_indicators: null,
    key_claims: null,
    influence_potential: null,
  };
}

async function analyzeWithOpenAI(prompt: string, apiKey: string): Promise<AnalysisResult> {
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a precise JSON generator. Return only valid JSON. No markdown.' },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`OpenAI error: ${resp.status} ${t.slice(0, 200)}`)
  }
  const data = await resp.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI returned empty content')
  return JSON.parse(String(text))
}

async function analyzeWithAnthropic(prompt: string, apiKey: string): Promise<AnalysisResult> {
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-3-5-haiku-latest'
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Anthropic error: ${resp.status} ${t.slice(0, 200)}`)
  }
  const data = await resp.json()
  const text = data?.content?.[0]?.text
  if (!text) throw new Error('Anthropic returned empty content')
  return JSON.parse(String(text))
}

