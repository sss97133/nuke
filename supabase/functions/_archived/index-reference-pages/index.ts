/**
 * INDEX REFERENCE PAGES
 * 
 * Analyzes reference library images and tags them with topics
 * (VIN decode, model ID, engine specs, etc.)
 * 
 * Call this to process all unindexed pages
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const { limit = 10 } = await req.json();

    console.log(`📖 Indexing reference pages (limit: ${limit})`);

    // Get unindexed brochure images
    const { data: docs, error } = await supabase
      .from('library_documents')
      .select('*')
      .eq('document_type', 'brochure')
      .not('file_url', 'is', null)
      .is('metadata->indexed_topics', null)
      .limit(limit);

    if (error) throw error;
    if (!docs || docs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No unindexed pages found', indexed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${docs.length} pages to index`);

    let indexed = 0;

    for (const doc of docs) {
      console.log(`\nAnalyzing: ${doc.title || doc.id}`);

      try {
        // Use GPT-4 Vision to detect topics
        const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Analyze this automotive reference page. What topics does it cover? Return ONLY a JSON array of relevant topics from this list:
["vin_decode", "model_identification", "engine_specs", "transmission", "axle_ratios", "paint_codes", "rpo_codes", "dimensions", "weights", "electrical", "wiring", "maintenance", "torque_specs", "specifications", "options", "color_options", "body_styles", "trim_levels"]

Example: ["vin_decode", "model_identification"]

Return ONLY topics that are CLEARLY visible on this page. If no topics match, return empty array [].`
                },
                {
                  type: 'image_url',
                  image_url: { url: doc.file_url }
                }
              ]
            }],
            max_tokens: 100
          })
        });

        if (!visionResponse.ok) {
          console.error(`  API error: ${visionResponse.statusText}`);
          continue;
        }

        const visionResult = await visionResponse.json();
        const content = visionResult.choices[0].message.content;

        // Extract array from response
        const arrayMatch = content.match(/\[[\s\S]*?\]/);
        let topics: string[] = [];

        if (arrayMatch) {
          topics = JSON.parse(arrayMatch[0]);
        }

        console.log(`  Topics: ${topics.length > 0 ? topics.join(', ') : 'none detected'}`);

        // Update document with indexed topics
        const { error: updateError } = await supabase
          .from('library_documents')
          .update({
            metadata: {
              ...(doc.metadata || {}),
              indexed_topics: topics,
              indexed_at: new Date().toISOString()
            }
          })
          .eq('id', doc.id);

        if (updateError) {
          console.error(`  Failed to update:`, updateError.message);
        } else {
          indexed++;
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 500));

      } catch (err: any) {
        console.error(`  Error processing page:`, err.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_found: docs.length,
        indexed: indexed,
        message: `Indexed ${indexed}/${docs.length} pages`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});



