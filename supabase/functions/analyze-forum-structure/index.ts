/**
 * ANALYZE-FORUM-STRUCTURE
 *
 * Uses Claude to analyze forum HTML and identify:
 * 1. Build thread indicators (keywords in titles)
 * 2. Vehicle identification patterns
 * 3. Image hosting patterns
 * 4. Post quality signals
 * 5. Custom selectors for unusual forum structures
 *
 * This supplements the programmatic detection in inspect-forum
 * with AI-powered analysis for edge cases and custom platforms.
 *
 * Usage:
 *   POST /functions/v1/analyze-forum-structure
 *   { "forum_id": "uuid" } or { "html": "...", "url": "..." }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface AnalysisResult {
  platform_analysis: {
    confirmed_platform: string;
    confidence: number;
    custom_indicators: string[];
  };
  build_thread_patterns: {
    title_keywords: string[];
    section_patterns: string[];
    url_patterns: string[];
  };
  vehicle_identification: {
    title_format: string;
    common_makes: string[];
    year_position: 'start' | 'middle' | 'end' | 'varies';
  };
  image_patterns: {
    hosting_services: string[];
    inline_image_selector: string;
    attachment_selector: string;
    thumbnail_to_full_pattern?: string;
  };
  post_quality_signals: {
    high_quality_indicators: string[];
    low_quality_indicators: string[];
    spam_patterns: string[];
  };
  custom_selectors: {
    thread_list?: {
      container?: string;
      thread_row?: string;
      title?: string;
      author?: string;
    };
    post?: {
      container?: string;
      content?: string;
      author?: string;
      date?: string;
      images?: string;
    };
  };
  recommendations: string[];
}

async function analyzeWithClaude(
  html: string,
  url: string,
  existingDomMap: any
): Promise<AnalysisResult> {
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // Truncate HTML to fit in context (keep important parts)
  const maxHtmlLength = 50000;
  let truncatedHtml = html;
  if (html.length > maxHtmlLength) {
    // Keep head and first portion of body
    const headMatch = html.match(/<head[^>]*>[\s\S]*?<\/head>/i);
    const head = headMatch?.[0] || '';
    const bodyStart = html.indexOf('<body');
    const bodyContent = html.slice(bodyStart, bodyStart + maxHtmlLength - head.length);
    truncatedHtml = head + bodyContent + '\n<!-- TRUNCATED -->';
  }

  const systemPrompt = `You are an expert at analyzing forum software structures. Your task is to analyze HTML from automotive enthusiast forums and identify patterns for extracting build threads (project car documentation threads).

You understand various forum platforms (vBulletin, XenForo, phpBB, Discourse, Invision, SMF, MyBB) and can identify custom or modified installations.

Focus on:
1. Build thread identification - what makes a thread a "build journal" vs regular discussion
2. Vehicle identification in titles - how year/make/model are formatted
3. Image hosting - where images come from, how to get full resolution
4. Quality signals - what indicates a valuable, detailed build thread

Be specific and actionable. Provide CSS selectors when possible.`;

  const userPrompt = `Analyze this forum HTML and provide structured extraction guidance.

URL: ${url}

Existing detection results:
${JSON.stringify(existingDomMap, null, 2)}

HTML (may be truncated):
\`\`\`html
${truncatedHtml}
\`\`\`

Analyze and return a JSON object with this exact structure:
{
  "platform_analysis": {
    "confirmed_platform": "vbulletin|xenforo|phpbb|discourse|invision|smf|mybb|custom",
    "confidence": 0.0-1.0,
    "custom_indicators": ["specific things that identified this platform"]
  },
  "build_thread_patterns": {
    "title_keywords": ["words that indicate build threads, e.g., 'build', 'project', 'restoration'"],
    "section_patterns": ["URL or name patterns for build sections"],
    "url_patterns": ["regex patterns for build thread URLs"]
  },
  "vehicle_identification": {
    "title_format": "describe how titles are formatted, e.g., 'YEAR MAKE MODEL - Description'",
    "common_makes": ["makes commonly discussed on this forum"],
    "year_position": "start|middle|end|varies"
  },
  "image_patterns": {
    "hosting_services": ["photobucket", "imgur", "forum_attachments", etc."],
    "inline_image_selector": "CSS selector for images in posts",
    "attachment_selector": "CSS selector for attachments",
    "thumbnail_to_full_pattern": "pattern to convert thumbnail to full URL if applicable"
  },
  "post_quality_signals": {
    "high_quality_indicators": ["things that indicate valuable content"],
    "low_quality_indicators": ["things that indicate low-value content"],
    "spam_patterns": ["patterns that indicate spam posts"]
  },
  "custom_selectors": {
    "thread_list": {
      "container": "if default doesn't work, suggest better selector",
      "thread_row": "selector for thread rows",
      "title": "selector for thread title",
      "author": "selector for thread author"
    },
    "post": {
      "container": "selector for post container",
      "content": "selector for post content",
      "author": "selector for post author",
      "date": "selector for post date",
      "images": "selector for images"
    }
  },
  "recommendations": ["specific advice for extracting from this forum"]
}

Return ONLY valid JSON, no markdown formatting or explanation.`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      system: systemPrompt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const content = result.content?.[0]?.text || '';

  // Parse JSON from response
  try {
    // Try to extract JSON if wrapped in code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;
    return JSON.parse(jsonStr.trim());
  } catch (parseError) {
    console.error('[analyze-forum-structure] Failed to parse Claude response:', content);
    throw new Error('Failed to parse analysis result as JSON');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
    const serviceRoleKey = (
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY') ??
      ''
    ).trim();

    if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
    if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { forum_id, html: providedHtml, url: providedUrl, save = true } = await req.json();

    let html: string;
    let url: string;
    let forumRecord: any = null;
    let existingDomMap: any = {};

    if (forum_id) {
      // Fetch forum record
      const { data: forum, error: forumError } = await supabase
        .from('forum_sources')
        .select('*')
        .eq('id', forum_id)
        .single();

      if (forumError) throw new Error(`Forum not found: ${forumError.message}`);
      forumRecord = forum;
      url = forum.base_url;
      existingDomMap = forum.dom_map || {};

      // Try to get latest snapshot
      const { data: snapshot } = await supabase
        .from('forum_page_snapshots')
        .select('html')
        .eq('forum_source_id', forum_id)
        .eq('page_type', 'homepage')
        .eq('success', true)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .single();

      if (snapshot?.html) {
        html = snapshot.html;
      } else {
        // Fetch fresh HTML
        const response = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(30000),
        });
        html = await response.text();
      }
    } else if (providedHtml && providedUrl) {
      html = providedHtml;
      url = providedUrl;
    } else {
      throw new Error('Must provide either forum_id or both html and url');
    }

    console.log(`[analyze-forum-structure] Analyzing: ${url} (${html.length} chars)`);

    // Run AI analysis
    const analysis = await analyzeWithClaude(html, url, existingDomMap);
    console.log(`[analyze-forum-structure] Analysis complete`);

    // Merge AI analysis with existing DOM map if saving
    if (save && forumRecord?.id) {
      const mergedDomMap = {
        ...existingDomMap,
        ai_analysis: analysis,
        // Override selectors if AI found better ones
        ...(analysis.custom_selectors?.thread_list && {
          thread_list_selectors: {
            ...existingDomMap.thread_list_selectors,
            ...analysis.custom_selectors.thread_list,
          },
        }),
        ...(analysis.custom_selectors?.post && {
          post_selectors: {
            ...existingDomMap.post_selectors,
            ...analysis.custom_selectors.post,
          },
        }),
      };

      // Build extraction config
      const extractionConfig = {
        build_thread_patterns: analysis.build_thread_patterns,
        vehicle_identification: analysis.vehicle_identification,
        image_patterns: analysis.image_patterns,
        post_quality_signals: analysis.post_quality_signals,
        recommendations: analysis.recommendations,
        analyzed_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from('forum_sources')
        .update({
          dom_map: mergedDomMap,
          extraction_config: extractionConfig,
          platform_type: analysis.platform_analysis.confirmed_platform,
          inspection_status:
            forumRecord.inspection_status === 'inspected' ? 'mapped' : forumRecord.inspection_status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', forumRecord.id);

      if (updateError) {
        console.error('[analyze-forum-structure] Failed to update forum_sources:', updateError);
      } else {
        console.log(`[analyze-forum-structure] Updated forum ${forumRecord.id}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        forum_id: forumRecord?.id,
        url,
        analysis,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const e: any = error;
    console.error('[analyze-forum-structure] Error:', e.message || e);

    return new Response(
      JSON.stringify({
        success: false,
        error: e.message || String(e),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
