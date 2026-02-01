/**
 * Discover Articles About Organizations
 * 
 * Finds articles, blog posts, press releases, and news about organizations
 * Extracts images and creates timeline events for provenance
 * 
 * Similar to how we build provenance around vehicles, this builds org provenance
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

interface ArticleDiscovery {
  url: string;
  title: string;
  description?: string;
  publishedDate?: string;
  images: string[];
  relevanceScore: number;
}

/**
 * Extract images from HTML (similar to vehicle scraping)
 */
function extractArticleImages(html: string, baseUrl: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  
  const addImage = (url: string | null) => {
    if (!url) return;
    try {
      const fullUrl = url.startsWith('http') ? url : new URL(url, baseUrl).toString();
      if (seen.has(fullUrl)) return;
      
      // Filter out icons, logos, avatars, tiny images
      const lower = fullUrl.toLowerCase();
      if (lower.includes('icon') || lower.includes('logo') || lower.includes('avatar') || 
          lower.includes('favicon') || lower.includes('16x16') || lower.includes('32x32')) {
        return;
      }
      
      // Only include actual image files
      if (lower.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)) {
        images.push(fullUrl);
        seen.add(fullUrl);
      }
    } catch {
      // Invalid URL, skip
    }
  };
  
  // OG/Twitter meta images (usually high quality)
  const ogMatch = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) addImage(ogMatch[1]);
  
  const twitterMatch = html.match(/name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  if (twitterMatch) addImage(twitterMatch[1]);
  
  // JSON-LD structured data
  const jsonLdBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdBlocks) {
    try {
      const inner = block.replace(/^[\s\S]*?>/i, '').replace(/<\/script>\s*$/i, '');
      const json = JSON.parse(inner.trim());
      const candidates = Array.isArray(json) ? json : [json];
      for (const obj of candidates) {
        const img = obj?.image || obj?.primaryImageOfPage?.url;
        if (typeof img === 'string') addImage(img);
        else if (Array.isArray(img)) img.forEach((x: any) => typeof x === 'string' && addImage(x));
      }
    } catch {
      // Skip invalid JSON
    }
  }
  
  // Standard img tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    addImage(match[1]);
  }
  
  // Data attributes (lazy loading)
  const dataSrcPatterns = [
    /<[^>]+data-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-lazy-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-original=["']([^"']+)["'][^>]*>/gi,
  ];
  for (const pattern of dataSrcPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      addImage(match[1]);
    }
  }
  
  // Limit to top 20 images (prioritize quality over quantity)
  return images.slice(0, 20);
}

/**
 * Extract article metadata from HTML
 */
function extractArticleMetadata(html: string): { title?: string; description?: string; publishedDate?: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) || 
                     html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const title = titleMatch?.[1]?.trim();
  
  const descMatch = html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                    html.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const description = descMatch?.[1]?.trim();
  
  // Try to find published date
  const datePatterns = [
    /property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /published["']?\s*[:=]\s*["']([^"']+)["']/i,
  ];
  let publishedDate: string | undefined;
  for (const pattern of datePatterns) {
    const match = html.match(pattern);
    if (match) {
      publishedDate = match[1];
      break;
    }
  }
  
  return { title, description, publishedDate };
}

/**
 * Discover articles about an organization
 */
async function discoverArticles(
  organizationName: string,
  website?: string,
  maxResults: number = 10
): Promise<ArticleDiscovery[]> {
  const articles: ArticleDiscovery[] = [];
  
  // Search strategies:
  // 1. Check organization's own blog/news section
  // 2. Search for "[org name] history" / "[org name] story" / "[org name] founded"
  // 3. Check known article URLs if provided
  
  if (website) {
    // Try to find blog/news sections on their site
    const blogPaths = ['/blog/', '/news/', '/press/', '/articles/', '/about/', '/history/'];
    for (const path of blogPaths) {
      try {
        const url = new URL(path, website).toString();
        const response = await fetch(url, { 
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000)
        });
        if (response.ok) {
          const html = await response.text();
          // Extract article links from the page
          const articleLinks = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [];
          for (const link of articleLinks.slice(0, 5)) {
            const hrefMatch = link.match(/href=["']([^"']+)["']/i);
            if (hrefMatch) {
              const href = hrefMatch[1];
              const fullUrl = href.startsWith('http') ? href : new URL(href, website).toString();
              articles.push({
                url: fullUrl,
                title: '',
                images: [],
                relevanceScore: 0.8
              });
            }
          }
        }
      } catch {
        // Skip failed URLs
      }
    }
  }
  
  return articles.slice(0, maxResults);
}

/**
 * Process a single article URL
 */
async function processArticle(
  url: string,
  organizationId: string,
  organizationName: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    // Use Firecrawl if available, otherwise direct fetch
    let html: string;
    if (FIRECRAWL_API_KEY) {
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
        },
        body: JSON.stringify({ url, formats: ['html'] })
      });
      
      if (!firecrawlResponse.ok) {
        throw new Error(`Firecrawl failed: ${firecrawlResponse.statusText}`);
      }
      
      const firecrawlData = await firecrawlResponse.json();
      html = firecrawlData.data?.markdown || firecrawlData.data?.html || '';
    } else {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = await response.text();
    }
    
    if (!html) {
      throw new Error('No HTML content');
    }
    
    // Extract metadata and images
    const metadata = extractArticleMetadata(html);
    const images = extractArticleImages(html, url);
    
    if (images.length === 0) {
      return { success: false, error: 'No images found in article' };
    }
    
    // Parse published date
    let eventDate: string;
    if (metadata.publishedDate) {
      try {
        const date = new Date(metadata.publishedDate);
        eventDate = date.toISOString().split('T')[0];
      } catch {
        eventDate = new Date().toISOString().split('T')[0];
      }
    } else {
      eventDate = new Date().toISOString().split('T')[0];
    }
    
    // Create timeline event
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    
    // Check if event already exists (dedupe by URL)
    const { data: existing } = await supabase
      .from('business_timeline_events')
      .select('id')
      .eq('business_id', organizationId)
      .eq('metadata->>source_url', url)
      .maybeSingle();
    
    if (existing) {
      return { success: true, eventId: existing.id };
    }
    
    // Get system user or use service role (for automated events)
    // For automated discovery, we'll use a system user ID or null
    const systemUserId = '00000000-0000-0000-0000-000000000000';
    
    // Create new event
    const { data: event, error } = await supabase
      .from('business_timeline_events')
      .insert({
        business_id: organizationId,
        created_by: systemUserId,
        event_type: 'milestone_reached',
        event_category: 'recognition',
        title: metadata.title || `Article: ${organizationName}`,
        description: metadata.description || `Article about ${organizationName}`,
        event_date: eventDate,
        image_urls: images,
        documentation_urls: [url],
        metadata: {
          source_url: url,
          source_type: 'article',
          image_count: images.length,
          auto_discovered: true
        },
        verification_status: 'unverified'
      })
      .select('id')
      .single();
    
    if (error) throw error;
    
    return { success: true, eventId: event.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  
  try {
    const { organizationId, articleUrl, discover = false } = await req.json();
    
    if (!organizationId) {
      return new Response(JSON.stringify({ error: 'organizationId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    
    // Get organization info
    const { data: org, error: orgError } = await supabase
      .from('businesses')
      .select('id, business_name, website')
      .eq('id', organizationId)
      .single();
    
    if (orgError || !org) {
      return new Response(JSON.stringify({ error: 'Organization not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (articleUrl) {
      // Process specific article
      const result = await processArticle(articleUrl, organizationId, org.business_name);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (discover) {
      // Auto-discover articles
      const articles = await discoverArticles(org.business_name, org.website);
      const results = [];
      
      for (const article of articles) {
        const result = await processArticle(article.url, organizationId, org.business_name);
        results.push({ url: article.url, ...result });
      }
      
      return new Response(JSON.stringify({ discovered: articles.length, results }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ error: 'Either articleUrl or discover=true required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

