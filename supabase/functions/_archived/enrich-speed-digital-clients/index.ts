/**
 * ENRICH SPEED DIGITAL CLIENTS
 * 
 * Scrapes each Speed Digital client's website to extract:
 * - Description
 * - Specializations (what they specialize in)
 * - Services offered
 * - Contact info (phone, address, email)
 * - Logo
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { organization_id, batch_size = 3 } = body; // Reduced batch size to avoid timeouts

    console.log('🔍 ENRICHING SPEED DIGITAL CLIENTS');
    console.log('='.repeat(70));

    // Get Speed Digital clients - either specific one or batch
    let query = supabase
      .from('businesses')
      .select('id, business_name, website, description, specializations, services_offered')
      .eq('metadata->>speed_digital_client', 'true');
    
    if (organization_id) {
      query = query.eq('id', organization_id);
    } else {
      query = query.limit(batch_size);
    }
    
    const { data: clients, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch clients: ${fetchError.message}`);
    }

    if (!clients || clients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No Speed Digital clients found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Processing ${clients.length} clients...\n`);

    const results = {
      processed: 0,
      enriched: 0,
      errors: [] as string[],
    };

    for (const client of clients) {
      if (!client.website) {
        console.log(`⏭️  Skipping ${client.business_name} (no website)`);
        continue;
      }

      try {
        console.log(`🔍 Enriching ${client.business_name}...`);
        console.log(`   URL: ${client.website}`);

        // Use Firecrawl for reliable scraping (avoids DNS issues)
        const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
        let html = '';
        let markdown = '';

        if (firecrawlKey) {
          try {
            console.log(`   Using Firecrawl to fetch ${client.website}...`);
            const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${firecrawlKey}`,
              },
              body: JSON.stringify({
                url: client.website,
                formats: ['html', 'markdown'],
              }),
            });

            if (!firecrawlResponse.ok) {
              throw new Error(`Firecrawl HTTP ${firecrawlResponse.status}`);
            }

            const firecrawlData = await firecrawlResponse.json();
            html = firecrawlData.data?.html || '';
            markdown = firecrawlData.data?.markdown || '';
          } catch (firecrawlError: any) {
            console.log(`   ⚠️  Firecrawl failed: ${firecrawlError.message}, trying direct fetch...`);
            // Fallback to direct fetch
            const response = await fetch(client.website, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
            });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            html = await response.text();
          }
        } else {
          // Direct fetch fallback
          const response = await fetch(client.website, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          html = await response.text();
        }
        const doc = new DOMParser().parseFromString(html, 'text/html');

        if (!doc) {
          throw new Error('Failed to parse HTML');
        }

        const updates: any = {};

        // Extract description - try multiple sources
        if (!client.description) {
          const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content');
          const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
          const title = doc.querySelector('title')?.textContent?.trim();
          
          // Try to find description in common locations
          const descSelectors = [
            'meta[name="description"]',
            'meta[property="og:description"]',
            '.description',
            '.about p',
            '.intro p',
            'h1 + p',
            'header + p',
            'main p:first-of-type',
          ];
          
          let description: string | null = null;
          
          // Try meta tags first
          if (metaDesc && metaDesc.length > 20 && !metaDesc.includes('HugeDomains')) {
            description = metaDesc;
          } else if (ogDesc && ogDesc.length > 20 && !ogDesc.includes('HugeDomains')) {
            description = ogDesc;
          } else {
            // Try selectors
            for (const selector of descSelectors) {
              const el = doc.querySelector(selector);
              if (el) {
                const text = el.textContent?.trim() || '';
                if (text.length > 20 && text.length < 500 && !text.includes('HugeDomains')) {
                  description = text;
                  break;
                }
              }
            }
          }
          
          // Fallback: use title if it's descriptive
          if (!description && title && title.length > 20 && !title.includes('HugeDomains')) {
            description = title;
          }
          
          if (description) {
            updates.description = description;
          }
        }

        // Extract specializations from page content
        const bodyText = doc.body?.textContent?.toLowerCase() || '';
        const titleText = doc.querySelector('title')?.textContent?.toLowerCase() || '';
        const h1Text = doc.querySelector('h1')?.textContent?.toLowerCase() || '';
        const allText = `${titleText} ${h1Text} ${bodyText}`;
        
        const specializations: string[] = [];
        
        // Common collector car specializations with more keywords
        const specializationKeywords: Record<string, string[]> = {
          'Porsche': ['porsche', '911', 'cayman', 'boxster', 'carrera', 'gt', '959', '356'],
          'Ferrari': ['ferrari', 'f40', 'f50', 'enzo', 'testarossa', '308', '328'],
          'Lamborghini': ['lamborghini', 'countach', 'diablo', 'murcielago', 'aventador'],
          'Muscle Cars': ['muscle car', 'camaro', 'mustang', 'challenger', 'charger', 'cuda', 'gto', 'chevelle'],
          'Classic Trucks': ['classic truck', 'c10', 'k10', 'squarebody', 'blazer', 'suburban', 'pickup'],
          'Restoration': ['restoration', 'restore', 'restored', 'restoring', 'restorer'],
          'Auction House': ['auction', 'auctions', 'bidding', 'auctioneer', 'auction house'],
          'Exotics': ['exotic', 'supercar', 'hypercar', 'exotic car'],
          'Vintage': ['vintage', 'antique', 'classic car', 'classic', 'collector car'],
          'Racing': ['racing', 'race car', 'track', 'race', 'motorsports'],
          'BMW': ['bmw', 'm3', 'm5', '2002', 'e30', 'e36'],
          'Mercedes-Benz': ['mercedes', 'benz', 'amg', 'sl', 'gullwing'],
        };

        for (const [specialization, keywords] of Object.entries(specializationKeywords)) {
          if (keywords.some(keyword => allText.includes(keyword))) {
            specializations.push(specialization);
          }
        }

        // Check business name and URL for hints
        const nameLower = client.business_name.toLowerCase();
        const urlLower = client.website.toLowerCase();
        
        if (nameLower.includes('porsche') || urlLower.includes('porsche')) {
          specializations.push('Porsche');
        }
        if (nameLower.includes('auction') || urlLower.includes('auction')) {
          specializations.push('Auction House');
        }
        if (nameLower.includes('classic') || urlLower.includes('classic')) {
          specializations.push('Vintage');
        }
        if (nameLower.includes('exotic') || urlLower.includes('exotic')) {
          specializations.push('Exotics');
        }
        if (nameLower.includes('motor') || urlLower.includes('motor')) {
          specializations.push('Racing');
        }
        
        // Canepa-specific: known for Porsche and restoration
        if (nameLower.includes('canepa')) {
          specializations.push('Porsche', 'Restoration', 'Vintage');
        }

        if (specializations.length > 0 && (!client.specializations || client.specializations.length === 0)) {
          updates.specializations = [...new Set(specializations)]; // Dedupe
        }

        // Extract services from navigation, content, and page structure
        const services: string[] = [];
        const navLinks = doc.querySelectorAll('nav a, .menu a, .navigation a, header a, .header a');
        
        navLinks.forEach((link) => {
          const text = link.textContent?.toLowerCase().trim() || '';
          const href = link.getAttribute('href')?.toLowerCase() || '';
          
          // Common service patterns
          if ((text.includes('inventory') || text.includes('vehicles') || text.includes('cars for sale') || href.includes('inventory') || href.includes('vehicles')) && !services.includes('Sales')) {
            services.push('Sales');
          }
          if ((text.includes('service') || href.includes('service')) && !services.includes('Service')) {
            services.push('Service');
          }
          if ((text.includes('consignment') || href.includes('consignment')) && !services.includes('Consignment')) {
            services.push('Consignment');
          }
          if ((text.includes('restoration') || href.includes('restoration')) && !services.includes('Restoration')) {
            services.push('Restoration');
          }
          if ((text.includes('storage') || href.includes('storage')) && !services.includes('Storage')) {
            services.push('Storage');
          }
          if ((text.includes('parts') || href.includes('parts')) && !services.includes('Parts')) {
            services.push('Parts');
          }
          if ((text.includes('auction') || href.includes('auction')) && !services.includes('Auctions')) {
            services.push('Auctions');
          }
        });

        // Check body text and title for services
        if (allText.includes('consignment') && !services.includes('Consignment')) {
          services.push('Consignment');
        }
        if (allText.includes('restoration') && !services.includes('Restoration')) {
          services.push('Restoration');
        }
        if (allText.includes('storage') && !services.includes('Storage')) {
          services.push('Storage');
        }
        if (allText.includes('detailing') && !services.includes('Detailing')) {
          services.push('Detailing');
        }
        if (allText.includes('custom build') && !services.includes('Custom Build')) {
          services.push('Custom Build');
        }
        if (allText.includes('for sale') && !services.includes('Sales')) {
          services.push('Sales');
        }

        // Default services for dealerships (if nothing found)
        if (services.length === 0) {
          services.push('Sales');
        }

        if (services.length > 0 && (!client.services_offered || client.services_offered.length === 0)) {
          updates.services_offered = [...new Set(services)]; // Dedupe
        }

        // Extract phone
        const phonePattern = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/;
        const phoneMatch = html.match(phonePattern);
        if (phoneMatch) {
          const phone = phoneMatch[0].replace(/\s+/g, '-');
          updates.phone = phone;
        }

        // Extract logo
        const logoSelectors = [
          'img[alt*="logo" i]',
          'img[class*="logo" i]',
          '.logo img',
          '#logo img',
          'meta[property="og:image"]',
        ];

        for (const selector of logoSelectors) {
          const el = doc.querySelector(selector);
          if (el) {
            let logoUrl: string | null = null;
            if (el.tagName === 'META') {
              logoUrl = el.getAttribute('content');
            } else {
              logoUrl = (el as any).getAttribute('src') || (el as any).getAttribute('data-src');
            }
            if (logoUrl) {
              if (logoUrl.startsWith('//')) {
                logoUrl = `https:${logoUrl}`;
              } else if (logoUrl.startsWith('/')) {
                const baseUrl = new URL(client.website);
                logoUrl = `${baseUrl.origin}${logoUrl}`;
              }
              updates.logo_url = logoUrl;
              break;
            }
          }
        }

        // Update organization
        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          
          const { error: updateError } = await supabase
            .from('businesses')
            .update(updates)
            .eq('id', client.id);

          if (updateError) {
            throw new Error(`Update failed: ${updateError.message}`);
          }

          results.enriched++;
          console.log(`   ✅ Enriched with: ${Object.keys(updates).join(', ')}`);
          if (updates.specializations) {
            console.log(`      Specializations: ${updates.specializations.join(', ')}`);
          }
          if (updates.services_offered) {
            console.log(`      Services: ${updates.services_offered.join(', ')}`);
          }
        } else {
          console.log(`   ℹ️  No new data to add`);
        }

        results.processed++;

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error: any) {
        results.errors.push(`${client.business_name}: ${error.message}`);
        console.log(`   ❌ Error: ${error.message}`);
        results.processed++;
      }

      console.log('');
    }

    console.log('='.repeat(70));
    console.log('📊 RESULTS:');
    console.log(`   Processed: ${results.processed}`);
    console.log(`   Enriched: ${results.enriched}`);
    console.log(`   Errors: ${results.errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        results,
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

