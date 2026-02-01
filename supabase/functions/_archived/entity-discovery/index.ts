import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DiscoveredProfile {
  platform: string;
  url: string;
  exists: boolean;
  data?: any;
}

interface DiscoveredEntity {
  username: string;
  display_name?: string;
  profiles: DiscoveredProfile[];
  location?: string;
  website?: string;
  email?: string;
  phone?: string;
  description?: string;
  inventory?: any[];
  specialties?: string[];
}

// Check if URL exists (returns 200/redirect)
async function urlExists(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; nzero-bot/1.0)'
      }
    });
    
    clearTimeout(timeout);
    return res.ok || res.status === 302 || res.status === 301;
  } catch {
    return false;
  }
}

// Fetch page content
async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; nzero-bot/1.0)'
      }
    });
    
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Extract BaT profile data
async function scrapeBatProfile(username: string): Promise<any> {
  const url = `https://bringatrailer.com/member/${username}/`;
  const html = await fetchPage(url);
  if (!html) return null;
  
  const data: any = {
    url,
    username,
    listings: [],
    comments_count: 0,
    member_since: null,
    location: null
  };
  
  // Extract member since date
  const sinceMatch = html.match(/Member since (\w+ \d{4})/i);
  if (sinceMatch) data.member_since = sinceMatch[1];
  
  // Extract location
  const locMatch = html.match(/<strong>Location:<\/strong>\s*<br\s*\/?>\s*([^<]+)/i) ||
                   html.match(/Location[^:]*:\s*([A-Z]{2},\s*United States)/i);
  if (locMatch) data.location = locMatch[1].trim();
  
  // Extract follower count
  const followerMatch = html.match(/(\d+)\s*<\/span>\s*$/m) || 
                        html.match(/<span[^>]*>(\d+)<\/span>/);
  
  // Extract listing count from "Listings (X)"
  const listingsMatch = html.match(/Listings\s*\((\d+)\)/i);
  if (listingsMatch) data.listings_count = parseInt(listingsMatch[1]);
  
  // Extract comments count
  const commentsMatch = html.match(/Comments\s*\((\d+)\)/i);
  if (commentsMatch) data.comments_count = parseInt(commentsMatch[1]);
  
  // Extract listings - look for listing cards
  const listingRegex = /<a[^>]*href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/gi;
  let match;
  while ((match = listingRegex.exec(html)) !== null) {
    data.listings.push({
      url: match[1],
      title: match[2].trim()
    });
  }
  
  return data;
}

// Extract website data
async function scrapeWebsite(url: string): Promise<any> {
  const html = await fetchPage(url);
  if (!html) return null;
  
  const data: any = { url };
  
  // Extract phone numbers
  const phoneMatch = html.match(/(?:\+1[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}/);
  if (phoneMatch) data.phone = phoneMatch[0];
  
  // Extract email
  const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) data.email = emailMatch[0];
  
  // Extract social links
  data.social_links = {};
  
  const instaMatch = html.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (instaMatch) data.social_links.instagram = `https://instagram.com/${instaMatch[1]}`;
  
  const twitterMatch = html.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/i);
  if (twitterMatch) data.social_links.twitter = `https://twitter.com/${twitterMatch[1]}`;
  
  const fbMatch = html.match(/facebook\.com\/([a-zA-Z0-9.]+)/i);
  if (fbMatch) data.social_links.facebook = `https://facebook.com/${fbMatch[1]}`;
  
  const ytMatch = html.match(/youtube\.com\/(?:channel|c|@)\/([a-zA-Z0-9_-]+)/i);
  if (ytMatch) data.social_links.youtube = `https://youtube.com/${ytMatch[1]}`;
  
  // Extract description from meta tags
  const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i) ||
                    html.match(/<meta[^>]*content="([^"]+)"[^>]*name="description"/i);
  if (descMatch) data.description = descMatch[1];
  
  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) data.title = titleMatch[1].trim();
  
  // Look for location indicators
  const locationPatterns = [
    /based in ([^<.]+)/i,
    /located in ([^<.]+)/i,
    /([A-Za-z]+,\s*[A-Z]{2})\s*(?:\d{5})?/
  ];
  for (const pattern of locationPatterns) {
    const locMatch = html.match(pattern);
    if (locMatch) {
      data.location = locMatch[1].trim();
      break;
    }
  }
  
  return data;
}

// Main discovery function
async function discoverEntity(username: string): Promise<DiscoveredEntity> {
  const normalized = username.toLowerCase().trim().replace(/\s+/g, '');
  const entity: DiscoveredEntity = {
    username: normalized,
    profiles: []
  };
  
  console.log(`[Entity Discovery] Starting discovery for: ${normalized}`);
  
  // 1. Check common URL patterns in parallel
  const urlPatterns = [
    { platform: 'bat', url: `https://bringatrailer.com/member/${normalized}/` },
    { platform: 'carsandbids', url: `https://carsandbids.com/user/${normalized}` },
    { platform: 'instagram', url: `https://www.instagram.com/${normalized}/` },
    { platform: 'twitter', url: `https://twitter.com/${normalized}` },
    { platform: 'facebook', url: `https://www.facebook.com/${normalized}` },
    { platform: 'website', url: `https://www.${normalized}.com` },
    { platform: 'website_alt', url: `https://${normalized}.com` },
  ];
  
  // Check all URLs in parallel
  const checks = await Promise.all(
    urlPatterns.map(async (p) => ({
      ...p,
      exists: await urlExists(p.url)
    }))
  );
  
  entity.profiles = checks.filter(c => c.exists);
  console.log(`[Entity Discovery] Found ${entity.profiles.length} profiles`);
  
  // 2. Deep scrape found profiles
  for (const profile of entity.profiles) {
    if (profile.platform === 'bat') {
      console.log('[Entity Discovery] Scraping BaT profile...');
      const batData = await scrapeBatProfile(normalized);
      if (batData) {
        profile.data = batData;
        entity.location = entity.location || batData.location;
        entity.inventory = batData.listings;
      }
    }
    
    if (profile.platform === 'website' || profile.platform === 'website_alt') {
      console.log('[Entity Discovery] Scraping website...');
      const siteData = await scrapeWebsite(profile.url);
      if (siteData) {
        profile.data = siteData;
        entity.website = profile.url;
        entity.email = entity.email || siteData.email;
        entity.phone = entity.phone || siteData.phone;
        entity.description = entity.description || siteData.description;
        entity.location = entity.location || siteData.location;
        
        // Merge discovered social links
        if (siteData.social_links) {
          for (const [platform, url] of Object.entries(siteData.social_links)) {
            if (!entity.profiles.find(p => p.platform === platform)) {
              entity.profiles.push({
                platform,
                url: url as string,
                exists: true
              });
            }
          }
        }
      }
    }
  }
  
  return entity;
}

// Save entity to organizations table
async function saveEntity(
  supabase: any, 
  entity: DiscoveredEntity,
  sourceVehicleId?: string
): Promise<any> {
  const socialLinks: any = {};
  for (const profile of entity.profiles) {
    socialLinks[profile.platform] = profile.url;
    if (profile.platform === 'bat' && profile.data) {
      socialLinks.bat_username = entity.username;
      socialLinks.bat_member_since = profile.data.member_since;
      socialLinks.bat_listings_count = profile.data.listings_count;
      socialLinks.bat_comments_count = profile.data.comments_count;
    }
  }
  
  // Parse location into city/state
  let city = null;
  let state = null;
  if (entity.location) {
    const locParts = entity.location.split(',').map(s => s.trim());
    if (locParts.length >= 2) {
      city = locParts[0];
      state = locParts[1].replace('United States', '').trim();
    }
  }
  
  const orgData = {
    name: entity.display_name || entity.username,
    slug: entity.username,
    type: 'dealer',
    description: entity.description,
    city,
    state,
    country: 'USA',
    phone: entity.phone,
    email: entity.email,
    website: entity.website,
    social_links: socialLinks,
    inventory_url: socialLinks.bat || entity.website,
    source_url: socialLinks.bat || entity.website,
    discovered_via: 'entity_discovery',
    is_verified: false,
    is_active: true
  };
  
  const { data, error } = await supabase
    .from('organizations')
    .upsert(orgData, { onConflict: 'slug' })
    .select()
    .single();
  
  if (error) {
    console.error('[Entity Discovery] Failed to save org:', error);
    throw error;
  }
  
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    const { username, source_vehicle_id, save_to_db } = await req.json();
    
    if (!username) {
      return new Response(
        JSON.stringify({ error: 'Missing username parameter' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    // Discover entity
    const entity = await discoverEntity(username);
    
    let savedOrg = null;
    if (save_to_db) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      
      savedOrg = await saveEntity(supabase, entity, source_vehicle_id);
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        entity,
        saved_organization: savedOrg
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[Entity Discovery] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

