#!/usr/bin/env node
/**
 * Phase 1: Supplier Enrichment
 *
 * Enriches FB-sourced stub organizations with real website, contact info, etc.
 *
 * For each stub org:
 * 1. Get their FB profile URL from fb_saved_items
 * 2. Google search for their real website
 * 3. Call create-org-from-url with the real website to pull phone, email, address
 * 4. Update enrichment_status to 'enriched'
 *
 * Usage:
 *   dotenvx run -- node scripts/enrich-fb-orgs.mjs [--dry-run] [--limit N] [--org-id UUID]
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;
const orgIdIdx = args.indexOf('--org-id');
const SINGLE_ORG = orgIdIdx >= 0 ? args[orgIdIdx + 1] : null;

// ── Helpers ──

async function supabaseQuery(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
    },
    body: JSON.stringify({ query: sql }),
  });
  return res.json();
}

async function supabaseSQL(sql) {
  const base = SUPABASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/functions/v1/execute-raw-sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    // Fallback: use PostgREST RPC if edge function doesn't exist
    const pgRes = await fetch(`${base}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ sql_text: sql }),
    });
    if (!pgRes.ok) {
      throw new Error(`SQL failed: ${await pgRes.text()}`);
    }
    return pgRes.json();
  }
  return res.json();
}

async function enrichFromWebsite(website) {
  // Scrape the website directly with Firecrawl and extract business info
  if (!FIRECRAWL_KEY) return null;

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      },
      body: JSON.stringify({
        url: website,
        formats: ['markdown'],
        waitFor: 3000,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const md = data?.data?.markdown || '';
    const meta = data?.data?.metadata || {};

    const extracted = {};

    // Extract from Firecrawl metadata
    if (meta.title) extracted.description = meta.title;
    if (meta.ogDescription) extracted.description = meta.ogDescription;
    if (meta.ogImage) extracted.logo_url = meta.ogImage;

    // Extract phone from page content
    const phoneMatch = md.match(/(?:phone|call|tel)[:\s]*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/i)
      || md.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/);
    if (phoneMatch) extracted.phone = phoneMatch[0].replace(/^(?:phone|call|tel)[:\s]*/i, '').trim();

    // Extract email
    const emailMatch = md.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch && !emailMatch[0].includes('example.com') && !emailMatch[0].includes('sentry'))
      extracted.email = emailMatch[0];

    // Extract address patterns
    const addressMatch = md.match(/\d+\s+[A-Za-z\s]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Ln|Lane|Ct|Court|Hwy|Highway)[.,]?\s*(?:Suite|Ste|Unit|#)?\s*\d*[.,]?\s*[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5}/i);
    if (addressMatch) extracted.address = addressMatch[0].trim();

    // Try to extract city/state from address or page
    const cityStateMatch = md.match(/([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5})/);
    if (cityStateMatch) {
      extracted.city = cityStateMatch[1].trim();
      extracted.state = cityStateMatch[2];
      extracted.zip_code = cityStateMatch[3];
    }

    return extracted;
  } catch (err) {
    console.log(`    ⚠ Website scrape error: ${err.message}`);
    return null;
  }
}

async function googleSearchForWebsite(orgName) {
  // Use Google Custom Search or fallback to scraping
  // For now: construct a search URL and use Firecrawl to get Google results
  const query = encodeURIComponent(`"${orgName}" official website`);
  const searchUrl = `https://www.google.com/search?q=${query}&num=5`;

  if (!FIRECRAWL_KEY) {
    console.log(`    ⚠ No FIRECRAWL_API_KEY — skipping Google search for "${orgName}"`);
    return null;
  }

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ['markdown'],
        waitFor: 2000,
      }),
    });

    if (!res.ok) {
      console.log(`    ⚠ Firecrawl Google search failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const md = data?.data?.markdown || '';

    // Parse Google results for first non-facebook, non-google URL
    const urlPattern = /https?:\/\/[^\s\)>\]"']+/g;
    const urls = md.match(urlPattern) || [];

    for (const url of urls) {
      const lower = url.toLowerCase();
      if (lower.includes('facebook.com')) continue;
      if (lower.includes('google.com')) continue;
      if (lower.includes('youtube.com')) continue;
      if (lower.includes('instagram.com')) continue;
      if (lower.includes('tiktok.com')) continue;
      if (lower.includes('twitter.com')) continue;
      if (lower.includes('x.com')) continue;
      if (lower.includes('yelp.com')) continue;
      if (lower.includes('bbb.org')) continue;
      if (lower.includes('mapquest.com')) continue;
      if (lower.includes('yellowpages.com')) continue;
      if (lower.includes('apple.com/maps')) continue;
      if (lower.includes('zoominfo.com')) continue;
      if (lower.includes('hagerty.com')) continue;
      if (lower.includes('linkedin.com')) continue;
      if (lower.includes('wikipedia.org')) continue;
      if (lower.includes('crunchbase.com')) continue;
      if (lower.includes('indeed.com')) continue;
      if (lower.includes('glassdoor.com')) continue;
      if (lower.includes('globalnews.ca')) continue;
      if (lower.includes('comicbookmovie.com')) continue;
      if (lower.includes('reddit.com')) continue;
      if (lower.includes('pinterest.com')) continue;
      // Likely their actual website
      return url.split('?')[0].split('#')[0]; // Strip tracking params
    }
  } catch (err) {
    console.log(`    ⚠ Google search error: ${err.message}`);
  }
  return null;
}

async function tryExtractWebsiteFromFBPage(fbUrl) {
  if (!FIRECRAWL_KEY || !fbUrl) return null;

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      },
      body: JSON.stringify({
        url: fbUrl,
        formats: ['markdown'],
        waitFor: 3000,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const md = data?.data?.markdown || '';

    // Look for website link patterns on FB pages
    // FB pages often have "Website" or the URL in the about section
    const websitePatterns = [
      /(?:Website|Site|Web)\s*[:：]\s*(https?:\/\/[^\s\)>\]"']+)/i,
      /(?:Visit us|Visit our|Our website)\s*(?:at|:)?\s*(https?:\/\/[^\s\)>\]"']+)/i,
    ];

    for (const pattern of websitePatterns) {
      const match = md.match(pattern);
      if (match && match[1] && !match[1].includes('facebook.com')) {
        return match[1].split('?')[0].split('#')[0];
      }
    }

    // Also look for any non-social URL in the page
    const urlPattern = /https?:\/\/(?!(?:www\.)?(?:facebook|fb|instagram|youtube|google|twitter|x|tiktok)\.com)[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-z]{2,}(?:\/[^\s\)>\]"']*)?/g;
    const urls = md.match(urlPattern) || [];
    if (urls.length > 0) {
      return urls[0].split('?')[0].split('#')[0];
    }
  } catch (err) {
    console.log(`    ⚠ FB page scrape error: ${err.message}`);
  }
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ──

async function getStubOrgs() {
  const base = SUPABASE_URL.replace(/\/$/, '');
  // Get stubs (no website) AND partials (website but no contact info scraped yet)
  let url = `${base}/rest/v1/businesses?discovered_via=eq.facebook_saved_reels&enrichment_status=in.(stub,partial)&select=id,business_name,website,enrichment_status,metadata&order=business_name&limit=${LIMIT}`;

  if (SINGLE_ORG) {
    url = `${base}/rest/v1/businesses?id=eq.${SINGLE_ORG}&select=id,business_name,website,enrichment_status,metadata`;
  }

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
    },
  });
  return res.json();
}

async function getFBProfileUrl(orgId) {
  const base = SUPABASE_URL.replace(/\/$/, '');
  const url = `${base}/rest/v1/fb_saved_items?matched_organization_id=eq.${orgId}&select=creator_profile_url&limit=1`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
    },
  });
  const rows = await res.json();
  return rows?.[0]?.creator_profile_url || null;
}

async function updateOrg(orgId, updates) {
  const base = SUPABASE_URL.replace(/\/$/, '');
  const url = `${base}/rest/v1/businesses?id=eq.${orgId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(updates),
  });
  return res.ok;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  FB Supplier Enrichment Pipeline — Phase 1');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  MODE: DRY RUN (no writes)\n');

  const orgs = await getStubOrgs();
  console.log(`Found ${orgs.length} stub orgs to enrich\n`);

  const stats = { enriched: 0, website_found: 0, failed: 0, skipped: 0 };

  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    const progress = `[${i + 1}/${orgs.length}]`;
    console.log(`${progress} ${org.business_name} (${org.id})`);

    // Step 1: Get FB profile URL
    const fbUrl = await getFBProfileUrl(org.id);
    if (!fbUrl) {
      console.log('    ⚠ No FB profile URL — skipping');
      stats.skipped++;
      continue;
    }
    console.log(`    FB: ${fbUrl}`);

    // Step 2: Use existing website if already found, otherwise search
    let website = org.website || null;
    if (website) {
      console.log(`    ✓ Existing website: ${website}`);
    } else {
      console.log('    → Trying FB page scrape...');
      website = await tryExtractWebsiteFromFBPage(fbUrl);

      // Step 3: If no website from FB, try Google search
      if (!website) {
        console.log('    → Trying Google search...');
        website = await googleSearchForWebsite(org.business_name);
      }
    }

    if (website) {
      console.log(`    ✓ Website found: ${website}`);
      stats.website_found++;

      if (!DRY_RUN) {
        // Step 4: Scrape the website directly for contact info
        console.log('    → Scraping website for contact info...');
        const extracted = await enrichFromWebsite(website);

        const updateData = {
          website: website.replace(/\/$/, ''),
          enrichment_status: 'enriched',
          last_enriched_at: new Date().toISOString(),
        };

        if (extracted) {
          if (extracted.email) updateData.email = extracted.email;
          if (extracted.phone) updateData.phone = extracted.phone;
          if (extracted.address) updateData.address = extracted.address;
          if (extracted.city) updateData.city = extracted.city;
          if (extracted.state) updateData.state = extracted.state;
          if (extracted.zip_code) updateData.zip_code = extracted.zip_code;
          if (extracted.logo_url) updateData.logo_url = extracted.logo_url;
          if (extracted.description) updateData.description = extracted.description;
          const fields = Object.keys(extracted).filter(k => extracted[k]);
          console.log(`    ✓ Extracted: ${fields.join(', ') || 'website only'}`);
        } else {
          console.log('    ⚠ No contact info extracted (website saved)');
          updateData.enrichment_status = 'partial';
        }

        await updateOrg(org.id, updateData);
        // Store FB URL in metadata
        const metadata = org.metadata || {};
        metadata.fb_profile_url = fbUrl;
        await updateOrg(org.id, { metadata });
        console.log('    ✓ Enrichment complete');
        stats.enriched++;
      }
    } else {
      console.log('    ✗ No website found');
      if (!DRY_RUN) {
        // Store the FB URL in metadata at least
        const metadata = org.metadata || {};
        metadata.fb_profile_url = fbUrl;
        metadata.enrichment_attempted_at = new Date().toISOString();
        await updateOrg(org.id, {
          metadata,
          enrichment_status: 'partial',
        });
      }
      stats.failed++;
    }

    // Rate limit: 1 request/second to be gentle on Firecrawl
    await sleep(1500);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Results');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Enriched:      ${stats.enriched}`);
  console.log(`  Websites found: ${stats.website_found}`);
  console.log(`  No website:    ${stats.failed}`);
  console.log(`  Skipped:       ${stats.skipped}`);
  console.log(`  Total:         ${orgs.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
