import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractOrgRequest {
  seller_name: string;
  seller_url?: string; // Classic.com seller profile URL
  external_website?: string; // Direct external website URL (e.g., 2002ad.com)
  platform: string; // 'classic_com', 'bat', etc.
  vehicle_id?: string; // Optional: vehicle that led us to this seller
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { seller_name, seller_url, external_website, platform, vehicle_id }: ExtractOrgRequest = await req.json();

    if (!seller_name) {
      throw new Error('seller_name is required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`🔍 Extracting organization for seller: ${seller_name}`);

    // Step 1: Get external website URL if not provided
    let orgWebsite = external_website;
    
    if (!orgWebsite && seller_url) {
      // Try to extract external website from seller profile page
      try {
        const response = await fetch(seller_url);
        const html = await response.text();
        
        // Look for external website links in seller profile
        const websitePatterns = [
          /href=["'](https?:\/\/[^"']+\.com[^"']*)["']/gi,
          /Website[:\s]*<a[^>]+href=["'](https?:\/\/[^"']+)["']/i,
          /Visit[:\s]*<a[^>]+href=["'](https?:\/\/[^"']+)["']/i,
        ];
        
        for (const pattern of websitePatterns) {
          const match = html.match(pattern);
          if (match && match[1]) {
            const url = match[1].replace(/['"]/g, '');
            // Filter out social media and common platforms
            if (!url.includes('facebook.com') && !url.includes('instagram.com') && 
                !url.includes('twitter.com') && !url.includes('youtube.com') &&
                !url.includes('classic.com') && !url.includes('bringatrailer.com')) {
              orgWebsite = url;
              break;
            }
          }
        }
      } catch (e) {
        console.warn('Failed to extract website from seller profile:', e);
      }
    }

    if (!orgWebsite) {
      return new Response(
        JSON.stringify({ error: 'Could not determine external website URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🌐 Found external website: ${orgWebsite}`);

    // Step 2: Find or create organization
    let organizationId: string | null = null;

    // Try to find existing org by website
    const { data: existingOrg } = await supabase
      .from('businesses')
      .select('id, business_name, website')
      .or(`website.eq.${orgWebsite},website.eq.${orgWebsite.replace(/\/$/, '')},website.eq.${orgWebsite}/`)
      .maybeSingle();

    if (existingOrg) {
      organizationId = existingOrg.id;
      console.log(`✅ Found existing organization: ${existingOrg.business_name}`);
    } else {
      // Create new organization
      const { data: newOrg, error: createError } = await supabase
        .from('businesses')
        .insert({
          business_name: seller_name,
          website: orgWebsite,
          business_type: 'dealer', // Default, can be updated later
          source: platform,
          metadata: {
            discovered_from: seller_url,
            platform: platform,
            discovered_at: new Date().toISOString(),
          }
        })
        .select('id')
        .single();

      if (createError) {
        throw new Error(`Failed to create organization: ${createError.message}`);
      }

      organizationId = newOrg.id;
      console.log(`✅ Created new organization: ${seller_name}`);
      
      // Auto-merge duplicates after creation
      try {
        await supabase.functions.invoke('auto-merge-duplicate-orgs', {
          body: { organizationId: newOrg.id }
        });
      } catch (mergeError) {
        console.warn('⚠️ Auto-merge check failed (non-critical):', mergeError);
      }
    }

    // Step 3: Create external identity link for the seller
    if (seller_url) {
      const { error: identityError } = await supabase
        .from('external_identities')
        .upsert({
          platform: platform,
          handle: seller_name,
          profile_url: seller_url,
          display_name: seller_name,
          metadata: {
            organization_id: organizationId,
            external_website: orgWebsite,
          }
        }, {
          onConflict: 'platform,handle'
        });

      if (identityError) {
        console.warn('Failed to create external identity (non-fatal):', identityError);
      }
    }

    // Step 4: Link vehicle to organization if provided
    if (vehicle_id && organizationId) {
      const { error: linkError } = await supabase
        .from('organization_vehicles')
        .upsert({
          organization_id: organizationId,
          vehicle_id: vehicle_id,
          relationship_type: 'seller',
          status: 'active',
          auto_tagged: true,
          metadata: {
            discovered_from: seller_url,
            platform: platform,
          }
        }, {
          onConflict: 'organization_id,vehicle_id,relationship_type'
        });

      if (linkError) {
        console.warn('Failed to link vehicle to organization (non-fatal):', linkError);
      } else {
        console.log(`✅ Linked vehicle ${vehicle_id} to organization ${organizationId}`);
      }
    }

    // Step 5: Trigger organization site scraping (async, fire and forget)
    // This will extract vehicle data from the organization's website
    supabase.functions.invoke('scrape-organization-site', {
      body: {
        organization_id: organizationId,
        website: orgWebsite,
      }
    }).catch(err => {
      console.warn('Failed to trigger organization site scraping (non-fatal):', err);
    });

    return new Response(
      JSON.stringify({
        success: true,
        organization_id: organizationId,
        website: orgWebsite,
        seller_name: seller_name,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error extracting organization:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

