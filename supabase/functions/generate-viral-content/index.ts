/**
 * Generate Viral Content
 *
 * Creates engagement-optimized content using:
 * - Trend awareness (what's hot right now)
 * - Cultural references (memes, celebrities, moments)
 * - AI image generation for eye-catching visuals
 * - Viral format templates
 *
 * The Sydney Sweeney in a Blazer approach - clever wordplay,
 * cultural crossover, unexpected combinations.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ViralRequest {
  topic: string;                    // What to make viral
  vehicle?: {                       // Optional vehicle context
    year: number;
    make: string;
    model: string;
    details?: string;
  };
  style?: 'meme' | 'hot_take' | 'story' | 'flex' | 'educational' | 'controversial';
  include_image_prompt?: boolean;   // Generate DALL-E/Midjourney prompt
  cultural_references?: boolean;    // Include pop culture ties
  trends_to_leverage?: string[];    // Specific trends to tap into
}

interface ViralResult {
  posts: Array<{
    text: string;
    hook_type: string;
    virality_score: number;
    best_time_to_post: string;
    expected_engagement: string;
  }>;
  image_prompts?: Array<{
    prompt: string;
    style: string;
    aspect_ratio: string;
    description: string;
  }>;
  hashtags: string[];
  cultural_angles: string[];
  reasoning: string;
}

const VIRAL_SYSTEM_PROMPT = `You are a viral content strategist who understands internet culture deeply. Your job is to transform topics into highly shareable, engagement-driving content.

## VIRAL FORMULAS THAT WORK

### The Hook Types (pick the best for context)
1. **Flex Hook**: "I bought X for $Y. Here's what happened."
2. **Hot Take**: Bold opinion that sparks debate
3. **Story Arc**: "3 years ago I..." transformation narrative
4. **Shock Value**: Unexpected fact or contrast
5. **Relatability**: "POV: You're..." format
6. **FOMO**: "Most people don't know..." exclusivity
7. **Controversy**: Mild takes that get engagement without being offensive

### Cultural Crossover Magic
The Sydney Sweeney in a Blazer approach:
- Take trending cultural moment
- Connect it unexpectedly to your niche
- Wordplay and double meanings
- Celebrity + your topic = attention

Examples:
- "Sydney Sweeney would look great in a Blazer" (actress + K5 Blazer)
- "Taylor Swift touring in an LS-swapped Squarebody era"
- "Beyoncé's Cowboy Carter energy but it's a 454 big block"

### Meme Formats to Use
- "Nobody: ... Me: [doing car stuff]"
- "POV: [relatable car person moment]"
- "[Thing] hits different when [car context]"
- "Not me [doing extreme car thing]"
- "The feminine urge to [car thing]"
- "He's a 10 but [car flaw/feature]"

### What Makes Content VIRAL
1. Emotion (awe, humor, outrage, nostalgia)
2. Identity (people share what represents them)
3. Practical value (useful info)
4. Social currency (makes sharer look good)
5. Triggers (ties to common experiences)
6. Stories (narrative arc)

### Image Generation Prompts
When creating image prompts:
- Be specific about style (cinematic, editorial, meme format)
- Include lighting and mood
- Reference popular aesthetics
- Think "would I stop scrolling for this?"

## OUTPUT FORMAT

Return JSON:
{
  "posts": [
    {
      "text": "The viral post text",
      "hook_type": "flex|hot_take|story|etc",
      "virality_score": 8.5, // 1-10
      "best_time_to_post": "5-7pm weekday",
      "expected_engagement": "high/viral potential"
    }
  ],
  "image_prompts": [
    {
      "prompt": "DALL-E/Midjourney prompt",
      "style": "cinematic|editorial|meme|etc",
      "aspect_ratio": "16:9|1:1|9:16",
      "description": "What this image shows"
    }
  ],
  "hashtags": ["relevant", "trending", "niche"],
  "cultural_angles": ["what trends/references used"],
  "reasoning": "why these will perform"
}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: ViralRequest = await req.json();
    const {
      topic,
      vehicle,
      style = 'flex',
      include_image_prompt = true,
      cultural_references = true,
      trends_to_leverage = []
    } = body;

    if (!topic) {
      return new Response(
        JSON.stringify({ error: 'topic is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const anthropic = new Anthropic();

    let prompt = `Create viral X content about: "${topic}"

`;

    if (vehicle) {
      prompt += `Vehicle context:
- ${vehicle.year} ${vehicle.make} ${vehicle.model}
${vehicle.details ? `- Details: ${vehicle.details}` : ''}

`;
    }

    prompt += `Content style: ${style}
Include AI image prompts: ${include_image_prompt}
Use cultural references: ${cultural_references}
`;

    if (trends_to_leverage.length > 0) {
      prompt += `Trends to tap into: ${trends_to_leverage.join(', ')}
`;
    }

    prompt += `
Generate 3 different viral post options, each with a different hook type.
${include_image_prompt ? 'Include 2 AI image generation prompts that would make scroll-stopping visuals.' : ''}

Think like a content creator who understands both car culture AND internet culture.
Be clever, be bold, be memorable.

Return ONLY valid JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: VIRAL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    let result: ViralResult;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found');
      }
    } catch {
      throw new Error('Failed to parse viral content');
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[generate-viral-content] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
