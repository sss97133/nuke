/**
 * Curate for X
 *
 * AI-powered content optimization for maximum X engagement.
 * Transforms raw content into scroll-stopping posts.
 *
 * Best practices baked in:
 * - Hook-first writing (stop the scroll)
 * - Optimal formatting (whitespace, line breaks)
 * - Strategic hashtags (1-2, relevant)
 * - Image selection from set
 * - Thread splitting for long content
 * - Engagement prompts (CTAs)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CurationRequest {
  content: string;              // Raw content to transform
  content_type?: string;        // 'build_update', 'insight', 'announcement', 'story'
  context?: {
    vehicle?: {
      year: number;
      make: string;
      model: string;
      mods?: string[];
    };
    images?: string[];          // URLs to choose from
    tone?: string;              // 'enthusiast', 'professional', 'casual', 'technical'
    audience?: string;          // 'car_community', 'general', 'technical'
  };
  max_length?: number;          // Override 280 default
  include_hashtags?: boolean;
  include_cta?: boolean;        // Call to action
  thread_if_needed?: boolean;   // Split into thread if too long
}

interface CurationResult {
  curated_text: string;
  thread?: string[];            // If content was split
  selected_image?: string;      // Best image from set
  hook_score: number;           // 1-10 attention-grabbing rating
  format_score: number;         // 1-10 readability rating
  hashtags: string[];
  cta?: string;
  reasoning: string;            // Why these choices
  estimated_engagement: 'low' | 'medium' | 'high' | 'viral';
}

const SYSTEM_PROMPT = `You are an expert social media content strategist specializing in X (Twitter). Your job is to transform raw content into highly engaging posts that stop the scroll.

## CORE PRINCIPLES

### The Hook (First Line)
The first line is EVERYTHING. It must:
- Create curiosity or tension
- Make a bold claim
- Ask a provocative question
- Use pattern interrupts
- Be under 10 words ideally

Bad: "Just finished working on my car today"
Good: "440 horsepower in a $2,000 truck."

### Formatting Rules
- Short paragraphs (1-2 sentences max)
- Use line breaks liberally
- Create visual rhythm
- Make it scannable
- End with punch

### Engagement Drivers
- Specificity beats vague ("440hp" not "lots of power")
- Numbers perform well
- Before/after narratives
- Behind-the-scenes authenticity
- Controversy (mild) sparks engagement
- Questions invite replies

### What NOT to Do
- No "Just wanted to share..."
- No excessive hashtags (2 max)
- No walls of text
- No corporate speak
- No begging for engagement

### Hashtags
- Only 1-2, highly relevant
- Place at end or weave naturally
- Community-specific tags perform best
- Skip if content is strong enough alone

### Call to Action
- Questions > demands
- "What would you do?" style
- Invite opinions/debate
- Don't be desperate

## OUTPUT FORMAT

Return a JSON object with:
{
  "curated_text": "The optimized post",
  "thread": ["Tweet 1", "Tweet 2"] // If splitting needed, null otherwise
  "selected_image": "url" // Best image from provided set, null if none
  "hook_score": 8, // 1-10
  "format_score": 9, // 1-10
  "hashtags": ["tag1", "tag2"],
  "cta": "What mods would you add?", // If requested
  "reasoning": "Brief explanation of choices",
  "estimated_engagement": "high" // low/medium/high/viral
}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: CurationRequest = await req.json();
    const {
      content,
      content_type = 'general',
      context = {},
      max_length = 280,
      include_hashtags = true,
      include_cta = true,
      thread_if_needed = true
    } = body;

    if (!content) {
      return new Response(
        JSON.stringify({ error: 'content is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const anthropic = new Anthropic();

    // Build the prompt
    let userPrompt = `Transform this content into an engaging X post:

---
${content}
---

`;

    if (context.vehicle) {
      userPrompt += `
Vehicle context:
- ${context.vehicle.year} ${context.vehicle.make} ${context.vehicle.model}
${context.vehicle.mods ? `- Mods: ${context.vehicle.mods.join(', ')}` : ''}

`;
    }

    if (context.images && context.images.length > 0) {
      userPrompt += `
Available images (pick the best one for engagement):
${context.images.map((url, i) => `${i + 1}. ${url}`).join('\n')}

`;
    }

    userPrompt += `
Settings:
- Content type: ${content_type}
- Tone: ${context.tone || 'enthusiast'}
- Target audience: ${context.audience || 'car_community'}
- Max length: ${max_length} characters
- Include hashtags: ${include_hashtags}
- Include CTA: ${include_cta}
- Split into thread if needed: ${thread_if_needed}

Return ONLY valid JSON, no markdown or explanation outside the JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    // Extract text from response
    const responseText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Parse JSON from response
    let result: CurationResult;
    try {
      // Try to extract JSON if wrapped in markdown
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseText);
      throw new Error('AI returned invalid JSON');
    }

    // Validate result
    if (!result.curated_text) {
      throw new Error('AI did not return curated_text');
    }

    // Ensure we're within length (AI sometimes goes over)
    if (result.curated_text.length > max_length && !result.thread) {
      // Truncate intelligently
      const truncated = result.curated_text.substring(0, max_length - 3);
      const lastNewline = truncated.lastIndexOf('\n');
      const lastPeriod = truncated.lastIndexOf('. ');
      const breakPoint = Math.max(lastNewline, lastPeriod);

      if (breakPoint > max_length * 0.7) {
        result.curated_text = truncated.substring(0, breakPoint + 1).trim();
      } else {
        result.curated_text = truncated.trim() + '...';
      }
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[curate-for-x] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
