/**
 * CARS & BIDS PAGE INSPECTOR
 * 
 * Uses LLM to comprehensively analyze Cars & Bids page structure and identify
 * extraction potential - what data is available and how to extract it.
 * 
 * Similar to BaT inspection, but focused on Cars & Bids structure:
 * - 100+ images in gallery
 * - Comments and bids (often intermingled)
 * - Structured sections (Doug's Take, Highlights, Equipment, etc.)
 * - __NEXT_DATA__ JSON structure
 */

export interface CarsAndBidsInspectionResult {
  strategy: {
    extraction_strategy: 'parse_next_data' | 'dom_selector' | 'firecrawl_extract' | 'hybrid';
    data_format: 'next_data_json' | 'html_text' | 'javascript_variable' | 'api_endpoint';
    next_data_path?: string; // Path to data in __NEXT_DATA__ if available
    requires_javascript: boolean;
  };
  image_extraction: {
    method: 'next_data_gallery' | 'dom_selector' | 'data_attributes' | 'api_call';
    location: string; // Where images are located
    expected_count: number; // Rough estimate
    gallery_selector?: string;
    next_data_path?: string;
    upgrade_thumbnails: boolean; // Whether to upgrade thumbnails to full-res
    cdn_pattern?: string; // Pattern for CDN URLs
  };
  comment_extraction: {
    method: 'next_data_comments' | 'dom_selector' | 'api_pagination' | 'scroll_load';
    location: string;
    container_selector?: string;
    pagination_method?: 'infinite_scroll' | 'page_numbers' | 'load_more' | 'all_loaded';
    requires_javascript: boolean;
    estimated_count?: number;
  };
  bid_extraction: {
    method: 'next_data_bids' | 'comment_parsing' | 'bid_history_table' | 'api_endpoint';
    location: string;
    relationship_to_comments: 'separate' | 'in_comments' | 'mixed';
    bid_history_selector?: string;
    next_data_path?: string;
  };
  structured_sections: {
    dougs_take?: { location: string; method: string };
    highlights?: { location: string; method: string };
    equipment?: { location: string; method: string };
    specifications?: { location: string; method: string };
    ownership_history?: { location: string; method: string };
  };
  metadata_extraction: {
    auction_status: string; // 'active' | 'ended' | 'reserve_met' etc.
    current_bid?: string;
    reserve_met?: string;
    auction_end_date?: string;
    bid_count?: string;
    comment_count?: string;
  };
  extraction_map: Record<string, string>; // Field -> location mapping
}

/**
 * Inspect Cars & Bids page structure to understand extraction potential
 */
export async function inspectCarsAndBidsPage(
  html: string,
  listingUrl: string,
  openaiKey?: string
): Promise<CarsAndBidsInspectionResult> {
  const htmlSnippet = html.substring(0, 100000); // Large sample for Cars & Bids (can have 100+ images)
  
  // Check for __NEXT_DATA__ first (most reliable for Next.js apps)
  const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  const nextDataSnippet = nextDataMatch ? nextDataMatch[1].substring(0, 50000) : null;
  
  const prompt = `You are a Cars & Bids page structure analyst. Analyze this Cars & Bids auction page to identify ALL available data and how to extract it.

Cars & Bids listings typically have:
- 100+ high-resolution images in a gallery
- Comments from users (often 20-100+ comments)
- Bids (bid history, current bid, reserve status)
- Structured sections: "Doug's Take", Highlights, Equipment list, Specifications, Ownership History
- Auction metadata: current bid, reserve met, auction end date, bid count, comment count

LISTING URL: ${listingUrl}

HTML SAMPLE (first 100k chars):
${htmlSnippet.substring(0, 50000)}
${htmlSnippet.length > 50000 ? '\n...(truncated for length)...' : ''}

__NEXT_DATA__ SAMPLE (if found):
${nextDataSnippet ? nextDataSnippet.substring(0, 30000) : 'Not found in HTML'}

YOUR TASK:
1. Identify where images are located (should find 50-150+ images typically)
2. Identify where comments are located and how they're loaded
3. Identify where bids are located and their relationship to comments
4. Identify structured sections (Doug's Take, Highlights, Equipment, etc.)
5. Identify auction metadata (current bid, reserve status, end date, counts)

Return comprehensive JSON:
{
  "strategy": {
    "extraction_strategy": "parse_next_data | dom_selector | firecrawl_extract | hybrid",
    "data_format": "next_data_json | html_text | javascript_variable | api_endpoint",
    "next_data_path": "props.pageProps.auction if __NEXT_DATA__ contains auction data",
    "requires_javascript": true/false
  },
  "image_extraction": {
    "method": "next_data_gallery | dom_selector | data_attributes | api_call",
    "location": "Where images are found (__NEXT_DATA__ path, CSS selector, etc.)",
    "expected_count": 100,
    "gallery_selector": "CSS selector if DOM-based",
    "next_data_path": "props.pageProps.auction.images if in __NEXT_DATA__",
    "upgrade_thumbnails": true,
    "cdn_pattern": "cdn-cgi/image/width=X,height=Y pattern to clean"
  },
  "comment_extraction": {
    "method": "next_data_comments | dom_selector | api_pagination | scroll_load",
    "location": "Where comments are found",
    "container_selector": "CSS selector for comments container",
    "pagination_method": "infinite_scroll | page_numbers | load_more | all_loaded",
    "requires_javascript": true/false,
    "estimated_count": 50
  },
  "bid_extraction": {
    "method": "next_data_bids | comment_parsing | bid_history_table | api_endpoint",
    "location": "Where bids are found",
    "relationship_to_comments": "separate | in_comments | mixed",
    "bid_history_selector": "CSS selector if DOM-based",
    "next_data_path": "props.pageProps.auction.bids if in __NEXT_DATA__"
  },
  "structured_sections": {
    "dougs_take": {
      "location": "Where Doug's Take section is",
      "method": "parse_next_data | dom_selector | regex"
    },
    "highlights": {
      "location": "Where highlights list is",
      "method": "parse_next_data | dom_selector | regex"
    },
    "equipment": {
      "location": "Where equipment list is",
      "method": "parse_next_data | dom_selector | regex"
    },
    "specifications": {
      "location": "Where specs table is",
      "method": "parse_next_data | dom_selector | regex"
    }
  },
  "metadata_extraction": {
    "auction_status": "How to determine if auction is active/ended",
    "current_bid": "Where current bid amount is",
    "reserve_met": "Where reserve status is",
    "auction_end_date": "Where end date is",
    "bid_count": "Where bid count is",
    "comment_count": "Where comment count is"
  },
  "extraction_map": {
    "mileage": "Where mileage is found",
    "color": "Where color is found",
    "transmission": "Where transmission is found",
    "engine_size": "Where engine is found",
    "vin": "Where VIN is found",
    "location": "Where location is found",
    "seller": "Where seller username is found",
    "buyer": "Where buyer/winning bidder is found"
  }
}

CRITICAL FOR CARS & BIDS:
- Images are often in __NEXT_DATA__ at props.pageProps.auction.images
- Comments may be in __NEXT_DATA__ or require JavaScript rendering
- Bids may be mixed with comments or separate
- CDN URLs need cleaning: /cdn-cgi/image/width=80,height=80 -> /cdn-cgi/image/ (full-res)
- Expected 100+ images, not just 10-20

Return ONLY valid JSON.`;

  try {
    const apiKey = openaiKey || Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      console.warn('⚠️ No OpenAI API key found for inspection');
      return getDefaultInspectionResult();
    }

    console.log('🔍 Inspecting Cars & Bids page structure with LLM...');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 3000,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`LLM inspection failed: ${response.status} - ${errorText.substring(0, 200)}`);
      return getDefaultInspectionResult();
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) {
      console.warn('⚠️ LLM returned empty content');
      return getDefaultInspectionResult();
    }

    try {
      const result = JSON.parse(content);
      console.log(`✅ Cars & Bids inspection complete. Strategy: ${result.strategy?.extraction_strategy || 'unknown'}`);
      console.log(`📊 Expected images: ${result.image_extraction?.expected_count || 'unknown'}`);
      console.log(`💬 Expected comments: ${result.comment_extraction?.estimated_count || 'unknown'}`);
      
      return result as CarsAndBidsInspectionResult;
    } catch (parseError) {
      console.warn(`⚠️ Failed to parse LLM inspection response:`, parseError);
      console.warn(`Raw response:`, content.substring(0, 500));
      return getDefaultInspectionResult();
    }
  } catch (error: any) {
    console.warn(`LLM inspection error: ${error?.message}`);
    return getDefaultInspectionResult();
  }
}

/**
 * Default inspection result when LLM fails
 */
function getDefaultInspectionResult(): CarsAndBidsInspectionResult {
  return {
    strategy: {
      extraction_strategy: 'hybrid',
      data_format: 'next_data_json',
      requires_javascript: true,
    },
    image_extraction: {
      method: 'next_data_gallery',
      location: '__NEXT_DATA__ -> props.pageProps.auction.images',
      expected_count: 100,
      upgrade_thumbnails: true,
      cdn_pattern: 'cdn-cgi/image/width=X,height=Y',
    },
    comment_extraction: {
      method: 'dom_selector',
      location: 'Comments section',
      requires_javascript: true,
      pagination_method: 'infinite_scroll',
    },
    bid_extraction: {
      method: 'comment_parsing',
      location: 'Bids mixed with comments',
      relationship_to_comments: 'mixed',
    },
    structured_sections: {},
    metadata_extraction: {
      auction_status: 'Look for "Active" or "Ended" text',
    },
    extraction_map: {},
  };
}

