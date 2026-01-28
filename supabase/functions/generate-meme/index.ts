/**
 * Generate Meme
 *
 * Uses Grok (X.AI) to generate viral meme content:
 * 1. Analyzes current viral meme formats
 * 2. Generates meme text in trending formats
 * 3. Creates meme images using Grok's image generation
 *
 * Requires XAI_API_KEY in Supabase secrets.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const XAI_API_BASE = 'https://api.x.ai/v1';

interface MemeRequest {
  vehicle?: {
    year: number;
    make: string;
    model: string;
    details?: string;
  };
  style?: 'classic' | 'modern' | 'absurd' | 'flex' | 'relatable';
  include_image?: boolean;
  topic?: string;
}

interface MemeResult {
  posts: Array<{
    text: string;
    format: string;
    virality_score: number;
  }>;
  images?: Array<{
    url: string;
    prompt: string;
  }>;
  trends_used: string[];
}

const CONTENT_GUIDE = `You write authentic car captions. Short. Confident. Not cringe.

GOOD - what real car people post:
- "she ready"
- "finally"
- "LS swapped"
- "440 on tap"
- "Sunday"
- "winter project"
- "first start"
- "built not bought"

BAD - never do these:
- "POV:" anything
- "Nobody: ... Me:"
- "Unpopular opinion:"
- "This hits different"
- "Main character"
- "Not me [doing thing] 💀😭"
- Long explanations
- Multiple emojis
- Hashtags

Keep it under 50 characters. Let the photo do the work.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const XAI_API_KEY = Deno.env.get('XAI_API_KEY');
    if (!XAI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: 'XAI_API_KEY not configured',
          setup: 'Add your X.AI API key: supabase secrets set XAI_API_KEY=your_key'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: MemeRequest = await req.json();
    const { vehicle, style = 'flex', include_image = true, topic } = body;

    // Build prompt for authentic content
    let prompt = `Generate 3 short, authentic captions for a car photo on X.

${CONTENT_GUIDE}

`;

    if (vehicle) {
      prompt += `Car: ${vehicle.year} ${vehicle.make} ${vehicle.model}
${vehicle.details ? `Details: ${vehicle.details}` : ''}
`;
    } else if (topic) {
      prompt += `Topic: ${topic}
`;
    }

    prompt += `
Requirements:
- Each caption UNDER 50 characters. Shorter is better.
- Sound like texting a friend
- No meme formats, no cringe
- Confident and minimal

Return JSON only:
{
  "posts": [
    {"text": "short caption", "format": "minimal", "virality_score": 1-10}
  ],
  "trends_used": ["authentic"]
}`;

    // Generate meme text using Grok
    const textResponse = await fetch(`${XAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-4',
        messages: [
          {
            role: 'system',
            content: 'You write authentic car captions. Short, confident, not cringe. No meme formats. Under 50 characters. Return only valid JSON.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9
      })
    });

    if (!textResponse.ok) {
      const errorText = await textResponse.text();
      throw new Error(`Grok API error: ${errorText}`);
    }

    const textData = await textResponse.json();
    const responseText = textData.choices?.[0]?.message?.content || '';

    let result: MemeResult;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON in response');
      }
    } catch {
      // Fallback with simple posts
      result = {
        posts: [
          { text: `${vehicle?.year} ${vehicle?.make} ${vehicle?.model} - she ready`, format: 'simple flex', virality_score: 7 },
          { text: `POV: You finally got the keys`, format: 'POV', virality_score: 8 },
          { text: `They don't make 'em like this anymore`, format: 'nostalgia', virality_score: 7 }
        ],
        trends_used: ['simple flex', 'POV', 'nostalgia']
      };
    }

    // Generate meme image if requested
    if (include_image && vehicle) {
      try {
        const imagePrompt = `Create a stylized, meme-worthy photo of a ${vehicle.year} ${vehicle.make} ${vehicle.model}.
Style: Dramatic lighting, cinematic, slightly exaggerated proportions.
Vibe: Cool, aspirational, scroll-stopping.
Include subtle visual elements that work for car culture memes.
No text overlays.`;

        const imageResponse = await fetch(`${XAI_API_BASE}/images/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${XAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'grok-2-image-1212',
            prompt: imagePrompt,
            n: 1,
            response_format: 'url'
          })
        });

        if (imageResponse.ok) {
          const imageData = await imageResponse.json();
          if (imageData.data?.[0]?.url) {
            result.images = [{
              url: imageData.data[0].url,
              prompt: imagePrompt
            }];
          }
        } else {
          console.log('[generate-meme] Image generation skipped:', await imageResponse.text());
        }
      } catch (imgErr: any) {
        console.log('[generate-meme] Image generation failed:', imgErr.message);
      }
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[generate-meme] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
