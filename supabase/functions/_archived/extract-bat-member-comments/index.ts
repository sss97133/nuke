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

// Helper functions to analyze comment text - moved before serve() so they're available everywhere
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
  const modelPatterns = [
    /\b(Mustang|Corvette|Camaro|Charger|Challenger|911|Carrera|Boxster|Cayman|M3|M4|M5|SL|E-Class|C-Class)\b/gi,
    /\b(\d{4})\s+([A-Z][a-z]+)\b/g
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

function analyzeUsernameParts(username: string): string[] {
  const parts = username.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (parts.length === 1) {
    const word = parts[0];
    const commonPrefixes = ['mr', 'ms', 'dr', 'prof', 'the', 'my', 'our'];
    for (const prefix of commonPrefixes) {
      if (word.startsWith(prefix) && word.length > prefix.length) {
        return [prefix, word.slice(prefix.length)];
      }
    }
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

    // FIRST: Check if we already have comments for this user in bat_comments table
    // These come from individual auction extractions and are more reliable
    const { data: existingComments } = await supabase
      .from('bat_comments')
      .select('*')
      .eq('bat_username', member_username)
      .order('comment_timestamp', { ascending: false })
      .limit(max_comments);

    if (existingComments && existingComments.length > 20) {
      console.log(`Found ${existingComments.length} existing comments in bat_comments table`);
      
      // Analyze the existing comments for identity traits
      const allCommentText = existingComments.map((c: any) => c.comment_text || '').join(' ');
      const identityTraits = {
        username_parts: analyzeUsernameParts(member_username),
        mentioned_makes: extractMakes(allCommentText),
        mentioned_models: extractModels(allCommentText),
        avg_comment_length: existingComments.reduce((sum: number, c: any) => sum + (c.comment_text?.length || 0), 0) / existingComments.length,
        comment_count: existingComments.length,
        technical_terms: extractTechnicalTerms(allCommentText),
        era_focus: extractEraFocus(allCommentText),
        member_since: null,
        total_comments: existingComments.length,
        total_listings: 0
      };
      
      // Update external identity
      const { data: identity } = await supabase
        .from('external_identities')
        .select('id')
        .eq('platform', 'bat')
        .eq('handle', member_username)
        .maybeSingle();

      if (identity?.id) {
        await supabase
          .from('external_identities')
          .update({
            metadata: {
              comment_analysis: identityTraits,
              comments_scraped_at: new Date().toISOString(),
              comments_scraped_count: existingComments.length,
              source: 'bat_comments_table'
            }
          })
          .eq('id', identity.id);
      }
      
      return new Response(JSON.stringify({
        success: true,
        member_username,
        comments_count: existingComments.length,
        identity_traits: identityTraits,
        source: 'bat_comments_table',
        message: 'Comments loaded from existing auction extractions'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // If no existing comments, scrape the member page
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      throw new Error('FIRECRAWL_API_KEY not configured');
    }

    console.log(`Only ${existingComments?.length || 0} existing comments found, scraping member page...`);

    // Create a basic identity from username even if scraping fails
    const usernameIdentity = {
      username_parts: analyzeUsernameParts(member_username),
      mentioned_makes: [],
      mentioned_models: [],
      avg_comment_length: 0,
      comment_count: 0,
      technical_terms: [],
      era_focus: [],
      member_since: null as string | null,
      total_comments: 0,
      total_listings: 0
    };

    // SIMPLE SCRAPE: Just get basic member stats from the page
    // Full comment extraction requires scraping individual auctions where user commented
    // This is due to BaT's lazy loading which exceeds Edge Function timeout limits
    console.log('Performing simple scrape for member stats...');
    
    let html = '';
    let doc: any = null;
    
    // Simple scrape - just wait for initial page load, get stats
    let fcResp;
    try {
      fcResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: memberUrl,
          formats: ['html'],
          onlyMainContent: false,
          waitFor: 5000, // Wait for JS to render
          timeout: 30000 // 30 seconds max - keep it fast
        })
      });
      console.log('Firecrawl fetch completed, status:', fcResp.status);
    } catch (e: any) {
      console.error('Firecrawl fetch threw error:', e.message);
      fcResp = null;
    }
    
    // If simple scrape worked, extract member stats
    if (fcResp && fcResp.ok) {
      try {
        const fcData = await fcResp.json();
        if (fcData.success && fcData.data?.html) {
          html = fcData.data.html;
          console.log(`Got HTML, length: ${html.length}`);
          
          // Extract member stats from HTML
          const memberSinceMatch = html.match(/Member since (\w+ \d{4})/i);
          usernameIdentity.member_since = memberSinceMatch ? memberSinceMatch[1] : null;
          
          // BaT uses ">Comments <span class="hide-mobile-inline">(314)</span>" format
          // Match "Comments" followed by span with count
          let commentsMatch = html.match(/>Comments\s*<span[^>]*>\((\d+)\)/i);
          if (!commentsMatch) commentsMatch = html.match(/Comments\s*\((\d+)\)/i);
          if (!commentsMatch) commentsMatch = html.match(/All\s+Comment[s]?\s*\((\d+)\)/i);
          usernameIdentity.total_comments = commentsMatch ? parseInt(commentsMatch[1]) : 0;
          
          // Same pattern for listings
          let listingsMatch = html.match(/>Listings?\s*<span[^>]*>\((\d+)\)/i);
          if (!listingsMatch) listingsMatch = html.match(/Listings?\s*\((\d+)\)/i);
          usernameIdentity.total_listings = listingsMatch ? parseInt(listingsMatch[1]) : 0;
          
          console.log(`Extracted stats: member_since=${usernameIdentity.member_since}, comments=${usernameIdentity.total_comments}, listings=${usernameIdentity.total_listings}`);
          
          // Debug: search for the word "Comment" in HTML
          const commentMentions = (html.match(/Comment[^<]{0,30}/gi) || []).slice(0, 5);
          console.log(`Comment mentions in HTML: ${JSON.stringify(commentMentions)}`);
          
          // Try to extract a few visible comments from initial HTML
          doc = new DOMParser().parseFromString(html, 'text/html');
        }
      } catch (e: any) {
        console.warn(`Failed to parse Firecrawl response: ${e.message}`);
      }
    }

    // Use data extracted from simple scrape
    const memberSince = usernameIdentity.member_since;
    const commentsCount = usernameIdentity.total_comments;
    const listingsCount = usernameIdentity.total_listings;

    // CHAIN REACTION: Extract auction URLs where member commented
    // Then queue those auctions for FULL vehicle extraction (not just comments)
    // This gets us: full vehicle data + all comments from those auctions (including member's full comments)
    const auctionUrls: Set<string> = new Set();
    
    if (doc) {
      const listingLinks = doc.querySelectorAll('a[href*="/listing/"]');
      console.log(`Found ${listingLinks.length} listing links in initial HTML`);
      
      // Extract all unique auction URLs
      for (const link of Array.from(listingLinks) as any[]) {
        const href = link?.getAttribute('href');
        if (href && href.includes('/listing/')) {
          // Normalize URL (make absolute if relative, remove anchor fragments)
          let fullUrl = href.startsWith('http') ? href : `https://bringatrailer.com${href}`;
          // Remove anchor fragments (e.g., #comment-123) since we're extracting full vehicle
          const anchorIndex = fullUrl.indexOf('#');
          if (anchorIndex > -1) {
            fullUrl = fullUrl.substring(0, anchorIndex);
          }
          auctionUrls.add(fullUrl);
        }
      }
      console.log(`Found ${auctionUrls.size} unique auction URLs from member profile`);
    }
    
    // For each auction URL, check if vehicle exists and queue for extraction
    let vehiclesQueued = 0;
    const newAuctionUrls: string[] = [];
    
    for (const auctionUrl of Array.from(auctionUrls).slice(0, 50)) { // Limit to first 50
      try {
        // Check if vehicle already exists for this URL
        // Check both bat_auction_url and discovery_url
        const { data: existingByBat } = await supabase
          .from('vehicles')
          .select('id, bat_auction_url, discovery_url')
          .eq('bat_auction_url', auctionUrl)
          .maybeSingle();
        
        const { data: existingByDiscovery } = !existingByBat
          ? await supabase
              .from('vehicles')
              .select('id, bat_auction_url, discovery_url')
              .eq('discovery_url', auctionUrl)
              .maybeSingle()
          : { data: null };
        
        const existingVehicle = existingByBat || existingByDiscovery;
        
        if (existingVehicle?.id) {
          // Vehicle exists - queue for full re-extraction (to get all comments)
          const { error: queueError } = await supabase
            .from('bat_extraction_queue')
            .upsert({
              vehicle_id: existingVehicle.id,
              bat_url: auctionUrl,
              status: 'pending',
              priority: 50, // Medium priority for member comment discovery
              attempts: 0
            }, {
              onConflict: 'vehicle_id',
              ignoreDuplicates: false
            });
          
          if (!queueError) {
            vehiclesQueued++;
            console.log(`✅ Queued existing vehicle ${existingVehicle.id} for extraction`);
          } else if (!queueError.message.includes('duplicate')) {
            console.warn(`Failed to queue vehicle ${existingVehicle.id}: ${queueError.message}`);
          }
        } else {
          // Vehicle doesn't exist yet - these need to be discovered first
          newAuctionUrls.push(auctionUrl);
        }
      } catch (e: any) {
        console.warn(`Error checking/queueing ${auctionUrl}: ${e.message}`);
      }
    }
    
    console.log(`Queued ${vehiclesQueued} existing vehicles. ${newAuctionUrls.length} new auctions need discovery.`);

    // Merge existing comments from bat_comments table for identity analysis
    // These come from already-extracted auctions and have full comment text
    const { data: existingCommentsForAnalysis } = await supabase
      .from('bat_comments')
      .select('comment_text')
      .eq('bat_username', member_username)
      .order('comment_timestamp', { ascending: false })
      .limit(100);
    
    const allCommentTexts = existingCommentsForAnalysis?.map((c: any) => c.comment_text || '').filter(Boolean) || [];
    const allCommentText = allCommentTexts.join(' ');

    // Analyze comments to extract user identity traits
    const identityTraits = {
      // Analyze username
      username_parts: analyzeUsernameParts(member_username),
      
      // Extract interests from comments (common car makes/models mentioned)
      mentioned_makes: extractMakes(allCommentText),
      mentioned_models: extractModels(allCommentText),
      
      // Comment style analysis
      avg_comment_length: allCommentTexts.length > 0 
        ? allCommentTexts.reduce((sum, text) => sum + text.length, 0) / allCommentTexts.length 
        : 0,
      comment_count: allCommentTexts.length,
      
      // Extract expertise indicators
      technical_terms: extractTechnicalTerms(allCommentText),
      era_focus: extractEraFocus(allCommentText),
      
      // Member stats
      member_since: memberSince,
      total_comments: commentsCount,
      total_listings: listingsCount
    };

    // Store or update external identity with scraped data
    const { data: existingIdentity } = await supabase
      .from('external_identities')
      .select('id, metadata')
      .eq('platform', 'bat')
      .eq('handle', member_username)
      .maybeSingle();

    const metadataToSave = {
      member_since: memberSince,
      comments_count: commentsCount,
      listings_count: listingsCount,
      comment_analysis: identityTraits,
      scraped_at: new Date().toISOString(),
      existing_comments_count: allCommentTexts.length,
      vehicles_queued: vehiclesQueued,
      new_auctions_discovered: newAuctionUrls.length
    };

    if (existingIdentity?.id) {
      await supabase
        .from('external_identities')
        .update({ metadata: metadataToSave })
        .eq('id', existingIdentity.id);
    } else {
      await supabase
        .from('external_identities')
        .insert({
          platform: 'bat',
          handle: member_username,
          metadata: metadataToSave
        });
    }

    return new Response(JSON.stringify({
      success: true,
      member_username,
      member_since: memberSince,
      total_comments: commentsCount,
      total_listings: listingsCount,
      identity_traits: identityTraits,
      chain_reaction: {
        vehicles_queued: vehiclesQueued,
        new_auctions_discovered: newAuctionUrls.length,
        auction_urls: newAuctionUrls.slice(0, 20), // First 20 new URLs
        message: vehiclesQueued > 0 
          ? `✅ Queued ${vehiclesQueued} existing vehicles for full extraction. This will extract complete vehicle data + all comments (including ${member_username}'s full comments).`
          : newAuctionUrls.length > 0
          ? `Found ${newAuctionUrls.length} new auctions. These need vehicle discovery first before extraction.`
          : `No auction URLs found from member profile.`
      },
      existing_comments_count: allCommentTexts.length,
      message: vehiclesQueued > 0
        ? `Chain reaction triggered: ${vehiclesQueued} vehicles queued for full extraction. Full comments will be extracted as part of vehicle extraction.`
        : `Member profile analyzed. ${newAuctionUrls.length} new auctions discovered. ${allCommentTexts.length} existing comments found in database.`,
      debug: {
        html_length: html.length,
        firecrawl_success: html.length > 0,
        auction_urls_found: auctionUrls.size
      }
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
