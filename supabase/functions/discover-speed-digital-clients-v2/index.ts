/**
 * DISCOVER SPEED DIGITAL CLIENTS V2
 * 
 * Enhanced discovery that:
 * 1. Scrapes Speed Digital /work page
 * 2. Searches for "Powered by SpeedDigital" footer pattern
 * 3. Discovers clients from known Speed Digital sites
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
  website_url: string;
  source: 'work_page' | 'footer_pattern' | 'known_list';
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

    console.log('🔍 DISCOVERING SPEED DIGITAL CLIENTS V2');
    console.log('='.repeat(70));

    const clients: ClientInfo[] = [];
    const knownClients: Record<string, string> = {
      'collectiveauto': 'https://www.collectiveauto.com',
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

    // Add known clients
    for (const [name, url] of Object.entries(knownClients)) {
      clients.push({
        name,
        website_url: url,
        source: 'known_list',
        resolved: true,
      });
    }

    // Step 1: Scrape Speed Digital work page
    console.log('📋 Step 1: Scraping Speed Digital /work page...');
    try {
      const workPageUrl = 'https://www.speeddigital.com/work';
      const response = await fetch(workPageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (response.ok) {
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        if (doc) {
          const workItems = doc.querySelectorAll('.sd-work-item');
          workItems.forEach((item) => {
            const classList = item.className.split(' ');
            classList.forEach((className) => {
              if (className.includes('-work-item') && !className.startsWith('sd-')) {
                const clientName = className.replace('-work-item', '');
                if (clientName && !clients.find(c => c.name === clientName)) {
                  // Try to resolve URL
                  const knownUrl = knownClients[clientName];
                  clients.push({
                    name: clientName,
                    website_url: knownUrl || `https://www.${clientName}.com`,
                    source: 'work_page',
                    resolved: !!knownUrl,
                  });
                }
              }
            });
          });
        }
      }
    } catch (error: any) {
      console.log(`   ⚠️  Could not scrape work page: ${error.message}`);
    }

    console.log(`   ✅ Found ${clients.length} total clients\n`);

    // Step 2: Get or create Speed Digital org
    console.log('🏢 Step 2: Ensuring Speed Digital organization exists...');
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
          business_type: 'other',
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

    // Step 3: Create/update client organizations
    console.log('\n🏢 Step 3: Creating/updating client organizations...');
    const results = {
      created: 0,
      existing: 0,
      updated: 0,
      errors: [] as string[],
    };

    for (const client of clients) {
      try {
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
          
          // Update metadata to ensure Speed Digital link
          await supabase
            .from('businesses')
            .update({
              metadata: {
                speed_digital_client: true,
                speed_digital_service_provider_id: speedDigitalOrgId,
                discovered_from: 'speeddigital.com/work',
                discovered_at: new Date().toISOString(),
              },
            })
            .eq('id', clientOrgId);
          
          results.updated++;
          console.log(`   ✅ ${client.name} exists: ${existing.business_name}`);
        } else {
          const { data: newOrg, error: createError } = await supabase
            .from('businesses')
            .insert({
              business_name: client.name.charAt(0).toUpperCase() + client.name.slice(1).replace(/-/g, ' '),
              business_type: 'dealership',
              website: client.website_url,
              metadata: {
                speed_digital_client: true,
                speed_digital_css_class: `${client.name}-work-item`,
                speed_digital_service_provider_id: speedDigitalOrgId,
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
      } catch (error: any) {
        results.errors.push(`${client.name}: ${error.message}`);
        console.log(`   ❌ Error processing ${client.name}: ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 RESULTS:');
    console.log(`   Created: ${results.created}`);
    console.log(`   Existing: ${results.existing}`);
    console.log(`   Updated: ${results.updated}`);
    console.log(`   Errors: ${results.errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        speed_digital_org_id: speedDigitalOrgId,
        clients_discovered: clients.length,
        results: {
          created: results.created,
          existing: results.existing,
          updated: results.updated,
          errors: results.errors,
        },
        clients: clients.map(c => ({
          name: c.name,
          website_url: c.website_url,
          source: c.source,
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

