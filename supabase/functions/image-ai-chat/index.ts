/**
 * Image AI Chat Edge Function
 * Handles image-specific AI questions and can trigger analyses or update fields
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      image_id,
      image_url,
      vehicle_id,
      vehicle_ymm,
      question,
      image_metadata,
      conversation_history
    } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get OpenAI API key
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Build context for AI
    const context = {
      image_id,
      image_url,
      vehicle_id,
      vehicle_ymm,
      existing_metadata: image_metadata,
      conversation_history: conversation_history || []
    };

    // Call OpenAI with image
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert vehicle image analyst. Answer questions about the image, suggest analyses, and help fill in missing database fields. 

When you identify missing information that can be accurately determined from the image, you can suggest field updates. Only suggest updates if you're confident (>80% confidence).

Available actions:
- field_update: Update a database field (e.g., angle, category, caption)
- analysis_triggered: Trigger a specific analysis type
- question_answered: Answer a question about the image

Respond in JSON format:
{
  "response": "Your answer to the user",
  "actions": [
    {
      "type": "field_update",
      "field": "angle",
      "value": "front_3quarter",
      "confidence": 0.95
    }
  ],
  "confidence": 0.9
}`
          },
          ...(conversation_history || []),
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Context: ${JSON.stringify(context)}\n\nQuestion: ${question}`
              },
              {
                type: 'image_url',
                image_url: { url: image_url }
              }
            ]
          }
        ],
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content || 'I could not process your request.';

    // Parse JSON response if possible
    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch {
      parsedResponse = {
        response: aiResponse,
        actions: [],
        confidence: 0.5
      };
    }

    // Execute actions if any
    const executedActions = [];
    
    if (parsedResponse.actions) {
      for (const action of parsedResponse.actions) {
        if (action.type === 'field_update' && action.field && action.value && action.confidence > 0.8) {
          // Update field in database
          const updates: any = {};
          updates[action.field] = action.value;
          
          await supabase
            .from('vehicle_images')
            .update(updates)
            .eq('id', image_id);
          
          executedActions.push(action);
        } else if (action.type === 'analysis_triggered') {
          // Queue analysis
          await supabase.rpc('queue_analysis', {
            p_vehicle_id: vehicle_id,
            p_analysis_type: action.analysis_type || 'expert_valuation',
            p_priority: 3,
            p_triggered_by: 'ai_chat'
          });
          
          executedActions.push(action);
        }
      }
    }

    return new Response(
      JSON.stringify({
        response: parsedResponse.response || aiResponse,
        actions: executedActions,
        confidence: parsedResponse.confidence || 0.5
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

