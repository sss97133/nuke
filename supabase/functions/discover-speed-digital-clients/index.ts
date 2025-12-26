/**
 * DISCOVER SPEED DIGITAL CLIENTS
 * 
 * Scrapes Speed Digital's /work page to extract all client names
 * Resolves client names to actual website URLs
 * Creates organizations and links them to Speed Digital
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClientInfo {
  name: string;
  css_class: string;
  website_url: string | null;
  resolved: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔍 DISCOVERING SPEED DIGITAL CLIENTS');
    console.log('='.repeat(70));

    // Step 1: Scrape Speed Digital work page
    console.log('📋 Step 1: Scraping Speed Digital /work page...');
    const workPageUrl = 'https://www.speeddigital.com/work';
    
    const response = await fetch(workPageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch work page: ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    if (!doc) {
      throw new Error('Failed to parse HTML');
    }

    // Step 2: Extract all client names from CSS classes
    console.log('🔍 Step 2: Extracting client names from CSS classes...');
    const clientNames = new Set<string>();

    // Find all elements with sd-work-item class
    const workItems = doc.querySelectorAll('.sd-work-item');
    workItems.forEach((item) => {
      // Extract class names like "broadarrow-work-item", "canepa-work-item", etc.
      const classList = item.className.split(' ');
      classList.forEach((className) => {
        if (className.includes('-work-item') && !className.startsWith('sd-')) {
          const clientName = className.replace('-work-item', '');
          if (clientName && clientName.length > 0) {
            clientNames.add(clientName);
          }
        }
      });
    });

    // Also check for any links in the work grid
    const workLinks = doc.querySelectorAll('.sd-work-item a, .flex-wrap-row a');
    workLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && href !== '/contact') {
        // Try to extract client name from href or surrounding context
        const parent = link.closest('.sd-work-item');
        if (parent) {
          const classes = parent.className.split(' ');
          classes.forEach((className) => {
            if (className.includes('-work-item') && !className.startsWith('sd-')) {
              const clientName = className.replace('-work-item', '');
              if (clientName) clientNames.add(clientName);
            }
          });
        }
      }
    });

    console.log(`   ✅ Found ${clientNames.size} unique client names\n`);

    // Step 3: Resolve client names to website URLs
    console.log('🌐 Step 3: Resolving client names to website URLs...');
    const clients: ClientInfo[] = [];
    const knownMappings: Record<string, string> = {
      'broadarrow': 'https://www.broadarrowgroup.com',
      'pbc': 'https://www.pbcclassics.com',
      'rkm-v2': 'https://www.rkmauctions.com',
      'streetside': 'https://www.streetsideclassics.com',
      'vanguard': 'https://www.vanguardmotorsales.com',
      'hillbank': 'https://www.hillbankmotorsports.com',
      'roadscholars': 'https://www.roadscholars.com',
      'fusion': 'https://www.fusionmotors.com',
      'toprank': 'https://www.toprankimports.com',
      'gaudin': 'https://www.gaudinporsche.com',
      'driversource': 'https://www.driversource.com',
      'canepa': 'https://www.canepa.com',
      'gaa': 'https://www.gaaclassiccars.com',
      'bullet': 'https://www.bulletcars.com',
      'volo': 'https://www.volocars.com',
      'fastlane': 'https://www.fastlanecars.com',
      'avantgarde': 'https://www.avantgardemotors.com',
      'motoexotica': 'https://www.motoexotica.com',
      'boardwalk': 'https://www.boardwalkporsche.com',
      'worldwide': 'https://www.worldwideauctioneers.com',
    };

    for (const clientName of clientNames) {
      let websiteUrl: string | null = null;
      let resolved = false;

      // Check known mappings first
      if (knownMappings[clientName]) {
        websiteUrl = knownMappings[clientName];
        resolved = true;
      } else {
        // Try common patterns
        const patterns = [
          `https://www.${clientName}.com`,
          `https://www.${clientName}classics.com`,
          `https://www.${clientName}motors.com`,
          `https://www.${clientName}motorsports.com`,
          `https://www.${clientName}auctions.com`,
          `https://www.${clientName}group.com`,
          `https://${clientName}.com`,
        ];

        // Try to verify URL exists (quick check)
        for (const pattern of patterns) {
          try {
            const testResponse = await fetch(pattern, {
              method: 'HEAD',
              headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            if (testResponse.ok || testResponse.status === 403 || testResponse.status === 405) {
              websiteUrl = pattern;
              resolved = true;
              break;
            }
          } catch {
            // Continue to next pattern
          }
        }
      }

      clients.push({
        name: clientName,
        css_class: `${clientName}-work-item`,
        website_url: websiteUrl,
        resolved: resolved,
      });

      if (resolved) {
        console.log(`   ✅ ${clientName} → ${websiteUrl}`);
      } else {
        console.log(`   ⚠️  ${clientName} → (unresolved)`);
      }
    }

    console.log(`\n   ✅ Resolved ${clients.filter(c => c.resolved).length}/${clients.length} clients\n`);

    // Step 4: Create or get Speed Digital organization
    console.log('🏢 Step 4: Creating Speed Digital organization...');
    let speedDigitalOrgId: string | null = null;

    const { data: existingSD } = await supabase
      .from('businesses')
      .select('id')
      .eq('website', 'https://www.speeddigital.com')
      .or('website.eq.https://speeddigital.com')
      .maybeSingle();

    if (existingSD) {
      speedDigitalOrgId = existingSD.id;
      console.log(`   ✅ Speed Digital org exists: ${speedDigitalOrgId}`);
    } else {
      const { data: newSD, error: sdError } = await supabase
        .from('businesses')
        .insert({
          business_name: 'Speed Digital',
          business_type: 'other', // Will need to add 'digital_service' type
          website: 'https://www.speeddigital.com',
          description: 'Leader in collector car websites and management systems. Provides technology for over 200 top automotive brands.',
          metadata: {
            client_count: clients.length,
            services: ['website_design', 'cms', 'inventory_management'],
            discovered_from: 'speeddigital.com/work',
            discovered_at: new Date().toISOString(),
          },
        })
        .select('id')
        .single();

      if (sdError) {
        console.error('   ❌ Error creating Speed Digital org:', sdError);
      } else {
        speedDigitalOrgId = newSD.id;
        console.log(`   ✅ Created Speed Digital org: ${speedDigitalOrgId}`);
      }
    }

    // Step 5: Create client organizations and link them
    console.log('\n🏢 Step 5: Creating client organizations...');
    const results = {
      created: 0,
      existing: 0,
      linked: 0,
      errors: [] as string[],
    };

    for (const client of clients) {
      if (!client.website_url) {
        console.log(`   ⏭️  Skipping ${client.name} (no URL)`);
        continue;
      }

      try {
        // Check if org already exists
        const domain = new URL(client.website_url).hostname.replace(/^www\./, '');
        const { data: existing } = await supabase
          .from('businesses')
          .select('id, business_name')
          .or(`website.eq.${client.website_url},website.eq.https://${domain},website.eq.https://www.${domain}`)
          .maybeSingle();

        let clientOrgId: string | null = null;

        if (existing) {
          clientOrgId = existing.id;
          results.existing++;
          console.log(`   ✅ ${client.name} exists: ${existing.business_name}`);
        } else {
          // Create new org
          const { data: newOrg, error: createError } = await supabase
            .from('businesses')
            .insert({
              business_name: client.name.charAt(0).toUpperCase() + client.name.slice(1).replace(/-/g, ' '),
              business_type: 'dealership', // Default, can be updated later
              website: client.website_url,
              metadata: {
                speed_digital_client: true,
                speed_digital_css_class: client.css_class,
                discovered_from: 'speeddigital.com/work',
                discovered_at: new Date().toISOString(),
              },
            })
            .select('id')
            .single();

          if (createError) {
            results.errors.push(`${client.name}: ${createError.message}`);
            console.log(`   ❌ Error creating ${client.name}: ${createError.message}`);
            continue;
          }

          clientOrgId = newOrg.id;
          results.created++;
          console.log(`   ✅ Created ${client.name}: ${clientOrgId}`);
        }

        // Link to Speed Digital (if we have both orgs)
        // Store relationship in metadata for now (can create table later)
        if (speedDigitalOrgId && clientOrgId) {
          // Update client org metadata to link to Speed Digital
          await supabase
            .from('businesses')
            .update({
              metadata: {
                speed_digital_client: true,
                speed_digital_css_class: client.css_class,
                speed_digital_service_provider_id: speedDigitalOrgId,
                discovered_from: 'speeddigital.com/work',
                discovered_at: new Date().toISOString(),
              },
            })
            .eq('id', clientOrgId);

          results.linked++;
        }
      } catch (error: any) {
        results.errors.push(`${client.name}: ${error.message}`);
        console.log(`   ❌ Error processing ${client.name}: ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 RESULTS:');
    console.log(`   Created: ${results.created}`);
    console.log(`   Existing: ${results.existing}`);
    console.log(`   Linked: ${results.linked}`);
    console.log(`   Errors: ${results.errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        speed_digital_org_id: speedDigitalOrgId,
        clients_discovered: clients.length,
        clients_resolved: clients.filter(c => c.resolved).length,
        results: {
          created: results.created,
          existing: results.existing,
          linked: results.linked,
          errors: results.errors,
        },
        clients: clients.map(c => ({
          name: c.name,
          website_url: c.website_url,
          resolved: c.resolved,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

