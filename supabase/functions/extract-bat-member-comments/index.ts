/**
 * EXTRACT BaT MEMBER COMMENTS
 * Scrapes all comments from a BaT member profile page
 * Used to build user identity for avatar generation and profile enrichment
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { member_username, max_comments = 100 } = await req.json();
    if (!member_username) {
      return new Response(JSON.stringify({ success: false, error: 'member_username required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const memberUrl = `https://bringatrailer.com/member/${member_username}/`;
    console.log(`Extracting comments from BaT member: ${memberUrl}`);

    // Use Firecrawl to get JavaScript-rendered page (BaT member pages are JS-heavy)
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      throw new Error('FIRECRAWL_API_KEY not configured');
    }

    const fcResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: memberUrl,
        formats: ['html'],
        onlyMainContent: false,
        waitFor: 5000,
        actions: [
          { type: 'wait', milliseconds: 2000 },
          { type: 'scroll', direction: 'down', pixels: 2000 },
          { type: 'wait', milliseconds: 3000 }
        ]
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!fcResp.ok) {
      throw new Error(`Firecrawl API error ${fcResp.status}`);
    }

    const fcData = await fcResp.json();
    if (!fcData.success || !fcData.data?.html) {
      throw new Error('Firecrawl returned no HTML content');
    }

    const html = fcData.data.html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) throw new Error('Failed to parse HTML');

    // Extract member profile info
    const memberSinceMatch = html.match(/Member since (\w+ \d{4})/i);
    const memberSince = memberSinceMatch ? memberSinceMatch[1] : null;

    const commentsCountMatch = html.match(/Comments\s*\((\d+)\)/i);
    const commentsCount = commentsCountMatch ? parseInt(commentsCountMatch[1]) : 0;

    const listingsCountMatch = html.match(/Listings\s*\((\d+)\)/i);
    const listingsCount = listingsCountMatch ? parseInt(listingsCountMatch[1]) : 0;

    // Extract all comments from the member page
    // BaT member pages show comments in a list format
    const comments: Array<{
      vehicle_title: string;
      vehicle_url: string;
      comment_text: string;
      posted_at: string;
      likes?: number;
    }> = [];

    // Look for comment entries - BaT uses various structures
    const commentSections = doc.querySelectorAll('article, .comment-item, [class*="comment"]');
    
    for (const section of commentSections) {
      // Try to extract vehicle link and title
      const vehicleLink = section.querySelector('a[href*="/listing/"]');
      const vehicleUrl = vehicleLink?.getAttribute('href') || null;
      const vehicleTitle = vehicleLink?.textContent?.trim() || null;

      // Extract comment text
      const commentText = section.textContent?.trim() || '';
      
      // Extract date
      const dateMatch = section.textContent?.match(/(\w+ \d{1,2} at \d{1,2}:\d{2} (AM|PM))/i);
      const postedAt = dateMatch ? dateMatch[1] : null;

      if (commentText && vehicleUrl) {
        comments.push({
          vehicle_title: vehicleTitle || 'Unknown Vehicle',
          vehicle_url: vehicleUrl,
          comment_text: commentText,
          posted_at: postedAt || new Date().toISOString()
        });
      }
    }

    // If no comments found via DOM, try regex extraction
    if (comments.length === 0) {
      // Look for comment patterns in HTML
      const commentPattern = /<a[^>]*href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?(\w+ \d{1,2} at \d{1,2}:\d{2} (AM|PM))[\s\S]*?([^<]+(?:<[^>]+>[^<]+<\/[^>]+>)*[^<]+)/gi;
      let match;
      while ((match = commentPattern.exec(html)) !== null && comments.length < max_comments) {
        comments.push({
          vehicle_title: match[2].trim(),
          vehicle_url: match[1],
          comment_text: match[5].trim().substring(0, 500),
          posted_at: match[3]
        });
      }
    }

    // Analyze username for meaningful parts
    function analyzeUsernameParts(username: string): string[] {
      const parts = username.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      if (parts.length === 1) {
        const word = parts[0];
        // Try common prefixes
        const commonPrefixes = ['mr', 'ms', 'dr', 'prof', 'the', 'my', 'our'];
        for (const prefix of commonPrefixes) {
          if (word.startsWith(prefix) && word.length > prefix.length) {
            return [prefix, word.slice(prefix.length)];
          }
        }
        // Try 2-3 char prefix
        if (word.length > 4) {
          for (let i = 2; i <= 3; i++) {
            const prefix = word.slice(0, i);
            const suffix = word.slice(i);
            if (suffix.length >= 2) {
              return [prefix, suffix];
            }
          }
        }
      }
      return parts;
    }

    // Analyze comments to extract user identity traits
    const allCommentText = comments.map(c => c.comment_text).join(' ');
    const identityTraits = {
      // Analyze username
      username_parts: analyzeUsernameParts(member_username),
      
      // Extract interests from comments (common car makes/models mentioned)
      mentioned_makes: extractMakes(allCommentText),
      mentioned_models: extractModels(allCommentText),
      
      // Comment style analysis
      avg_comment_length: comments.length > 0 
        ? comments.reduce((sum, c) => sum + c.comment_text.length, 0) / comments.length 
        : 0,
      comment_count: comments.length,
      
      // Extract expertise indicators
      technical_terms: extractTechnicalTerms(allCommentText),
      era_focus: extractEraFocus(allCommentText),
      
      // Member stats
      member_since: memberSince,
      total_comments: commentsCount,
      total_listings: listingsCount
    };

    // Store comments in database (link to external_identities)
    const { data: identity } = await supabase
      .from('external_identities')
      .select('id')
      .eq('platform', 'bat')
      .eq('handle', member_username)
      .maybeSingle();

    if (identity?.id) {
      // Update identity metadata with comment analysis
      const existingMetadata = identity.metadata || {};
      await supabase
        .from('external_identities')
        .update({
          metadata: {
            ...existingMetadata,
            member_since: memberSince,
            comments_count: commentsCount,
            listings_count: listingsCount,
            comment_analysis: identityTraits,
            comments_scraped_at: new Date().toISOString(),
            comments_scraped_count: comments.length
          }
        })
        .eq('id', identity.id);
    }

    return new Response(JSON.stringify({
      success: true,
      member_username,
      member_since: memberSince,
      comments_count: comments.length,
      total_comments: commentsCount,
      total_listings: listingsCount,
      identity_traits: identityTraits,
      comments: comments.slice(0, max_comments)
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (e: any) {
    console.error('Error extracting member comments:', e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper functions to analyze comment text
function extractMakes(text: string): string[] {
  const makes = ['Ford', 'Chevrolet', 'Chevy', 'BMW', 'Mercedes', 'Porsche', 'Ferrari', 'Lamborghini', 
                 'Audi', 'Toyota', 'Honda', 'Dodge', 'GMC', 'Cadillac', 'Lincoln', 'Buick', 'Oldsmobile',
                 'Pontiac', 'Jaguar', 'Bentley', 'Rolls-Royce', 'Aston Martin', 'McLaren', 'Lotus'];
  const found: string[] = [];
  for (const make of makes) {
    if (text.toLowerCase().includes(make.toLowerCase())) {
      found.push(make);
    }
  }
  return [...new Set(found)];
}

function extractModels(text: string): string[] {
  // Common model patterns
  const modelPatterns = [
    /\b(Mustang|Corvette|Camaro|Charger|Challenger|911|Carrera|Boxster|Cayman|M3|M4|M5|SL|E-Class|C-Class)\b/gi,
    /\b(\d{4})\s+([A-Z][a-z]+)\b/g // Year + Model
  ];
  const found: string[] = [];
  for (const pattern of modelPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      found.push(match[0]);
    }
  }
  return [...new Set(found)].slice(0, 10);
}

function extractTechnicalTerms(text: string): string[] {
  const terms = ['VIN', 'mileage', 'restoration', 'original', 'matching numbers', 'patina', 
                 'survivor', 'barn find', 'frame-off', 'concours', 'NOS', 'original paint'];
  const found: string[] = [];
  for (const term of terms) {
    if (text.toLowerCase().includes(term.toLowerCase())) {
      found.push(term);
    }
  }
  return found;
}

function extractEraFocus(text: string): string[] {
  const eras: string[] = [];
  // Look for decade mentions
  const decadeMatch = text.match(/\b(19\d{2}|20\d{2})\b/g);
  if (decadeMatch) {
    const decades = decadeMatch.map(y => {
      const year = parseInt(y);
      if (year < 1950) return 'pre-1950';
      if (year < 1960) return '1950s';
      if (year < 1970) return '1960s';
      if (year < 1980) return '1970s';
      if (year < 1990) return '1980s';
      if (year < 2000) return '1990s';
      if (year < 2010) return '2000s';
      if (year < 2020) return '2010s';
      return '2020s';
    });
    eras.push(...decades);
  }
  return [...new Set(eras)];
}

