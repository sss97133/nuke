/**
 * Check what pages remain to be crawled for 2002AD
 * This will fetch the site and discover all pages
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BASE_URL = 'https://2002ad.com';

// Key pages that should be scraped
const KEY_PAGES = [
  '/pages/about.cfm',
  '/pages/restoration.cfm',
  '/pages/gallery.cfm',
  '/pages/carsforsale.cfm',
  '/pages/brochures.cfm',
  '/pages/service.cfm',
  '/pages/articles.cfm',
  '/pages/links.cfm',
  '/pages/contact.cfm',
  '/pages/form.cfm',
  '/',
  '/index.cfm',
];

function discoverLinks(html, baseUrl) {
  const links = new Set();
  const linkPattern = /href=["']([^"']+)["']/gi;
  let match;
  
  while ((match = linkPattern.exec(html)) !== null) {
    let url = match[1];
    // Convert relative URLs to absolute
    if (url.startsWith('/')) {
      url = `${baseUrl}${url}`;
    } else if (url.startsWith('http')) {
      // Only include same domain
      if (url.includes(baseUrl.replace('https://', '').replace('http://', ''))) {
        links.add(url);
      }
    } else if (!url.includes('://') && !url.startsWith('#')) {
      // Relative URL
      url = `${baseUrl}/${url}`;
      links.add(url);
    }
  }
  
  return Array.from(links).filter(link => 
    link.includes(baseUrl) && 
    !link.includes('#') &&
    !link.includes('mailto:') &&
    !link.includes('javascript:')
  );
}

async function checkPages() {
  console.log('🔍 Checking 2002AD site pages...\n');
  
  const discoveredPages = new Set();
  const visitedPages = new Set();
  
  // Start with key pages
  const toVisit = [...KEY_PAGES.map(p => `${BASE_URL}${p}`)];
  
  console.log(`📋 Key pages to check: ${KEY_PAGES.length}`);
  console.log(`   ${KEY_PAGES.join('\n   ')}\n`);
  
  // Fetch homepage first to discover links
  try {
    const response = await fetch(BASE_URL);
    if (response.ok) {
      const html = await response.text();
      const links = discoverLinks(html, BASE_URL);
      links.forEach(link => {
        if (!visitedPages.has(link)) {
          discoveredPages.add(link);
        }
      });
      visitedPages.add(BASE_URL);
      console.log(`✅ Homepage: Found ${links.length} links`);
    }
  } catch (e) {
    console.warn('Failed to fetch homepage:', e);
  }
  
  // Check which key pages exist
  console.log(`\n🔍 Checking key pages...`);
  const existingPages = [];
  const missingPages = [];
  
  for (const page of KEY_PAGES) {
    const url = `${BASE_URL}${page}`;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        existingPages.push(page);
        console.log(`   ✅ ${page}`);
      } else {
        missingPages.push(page);
        console.log(`   ❌ ${page} (${response.status})`);
      }
    } catch (e) {
      missingPages.push(page);
      console.log(`   ❌ ${page} (error)`);
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Key pages existing: ${existingPages.length}/${KEY_PAGES.length}`);
  console.log(`   Key pages missing: ${missingPages.length}`);
  console.log(`   Discovered pages: ${discoveredPages.size}`);
  
  // Check what we've already extracted
  const { data: org } = await supabase
    .from('businesses')
    .select('metadata')
    .eq('id', '1970291b-081c-4550-94e1-633d194a2a99')
    .single();
  
  if (org?.metadata) {
    console.log(`\n📦 Previous Extraction:`);
    console.log(`   Pages discovered: ${org.metadata.pages_discovered || 0}`);
    console.log(`   Pages crawled: ${org.metadata.pages_crawled || 0}`);
    console.log(`   Vehicles found: ${org.metadata.vehicles_found || 0}`);
    console.log(`   Images found: ${org.metadata.gallery_images_found || 0}`);
  }
  
  // Check what source URLs we have
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('origin_metadata')
    .not('origin_metadata', 'is', null)
    .limit(100);
  
  if (vehicles) {
    const sourceUrls = new Set();
    vehicles.forEach(v => {
      if (v.origin_metadata?.source_url) {
        sourceUrls.add(v.origin_metadata.source_url);
      }
    });
    
    console.log(`\n🚗 Vehicles by source URL:`);
    Array.from(sourceUrls).forEach(url => {
      const count = vehicles.filter(v => v.origin_metadata?.source_url === url).length;
      console.log(`   ${url}: ${count} vehicles`);
    });
  }
  
  console.log(`\n💡 Recommendation:`);
  console.log(`   Run follow-up extraction to crawl remaining ${discoveredPages.size} discovered pages`);
  console.log(`   Use: node scripts/scrape-org-site.js <org_id> ${BASE_URL}`);
}

checkPages().catch(console.error);

