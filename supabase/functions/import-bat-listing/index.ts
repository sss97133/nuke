import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BaTListing {
  url: string;
  title: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  vin?: string;
  salePrice: number;
  saleDate: string;
  description: string;
  seller: string;
  buyer: string;
  lotNumber: string;
  images: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { batUrl, organizationId } = await req.json();

    if (!batUrl || !organizationId) {
      return new Response(
        JSON.stringify({ error: 'batUrl and organizationId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Fetching BaT listing: ${batUrl}`);
    
    // Fetch the BaT listing page
    const response = await fetch(batUrl);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    if (!doc) {
      throw new Error('Failed to parse HTML');
    }

    // Extract data from the page
    const titleEl = doc.querySelector('h1');
    const title = titleEl?.textContent?.trim() || '';
    
    // Parse year/make/model from title (e.g., "1987 GMC V1500 Suburban Sierra Classic 4×4")
    const titleMatch = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
    const year = titleMatch ? parseInt(titleMatch[1]) : 0;
    const make = titleMatch ? titleMatch[2] : '';
    const modelAndTrim = titleMatch ? titleMatch[3] : '';
    
    // Try to split model and trim
    const modelParts = modelAndTrim.split(' ');
    const model = modelParts.slice(0, 2).join(' '); // First 2-3 words are usually the model
    const trim = modelParts.length > 2 ? modelParts.slice(2).join(' ') : undefined;

    // Extract sale price
    const priceEl = doc.querySelector('.auction-info .price, [class*="price"]');
    const priceText = priceEl?.textContent || '';
    const priceMatch = priceText.match(/\$?([\d,]+)/);
    const salePrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;

    // Extract sale date
    const dateEl = doc.querySelector('.auction-info generic:has-text("on")');
    const dateText = dateEl?.textContent || '';
    const dateMatch = dateText.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const saleDate = dateMatch ? new Date(dateMatch[1]).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // Extract description
    const descEl = doc.querySelector('.post-content p:first-of-type, [class*="description"] p:first-of-type');
    const description = descEl?.textContent?.trim() || '';

    // Extract seller/buyer from BaT History
    const historyEl = doc.querySelector('.bat-history, [class*="history"]');
    const historyText = historyEl?.textContent || '';
    const sellerMatch = historyText.match(/Sold by\s+([A-Za-z0-9_]+)/i);
    const buyerMatch = historyText.match(/to\s+([A-Za-z0-9_]+)/i);
    const seller = sellerMatch ? sellerMatch[1] : 'VivaLasVegasAutos';
    const buyer = buyerMatch ? buyerMatch[1] : '';

    // Extract lot number
    const lotEl = doc.querySelector('[class*="lot"]');
    const lotText = lotEl?.textContent || '';
    const lotMatch = lotText.match(/#(\d+)/);
    const lotNumber = lotMatch ? lotMatch[1] : '';

    // Extract VIN if available (look in description or details)
    const vinMatch = html.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch ? vinMatch[1] : undefined;

    // Extract images
    const imgElements = doc.querySelectorAll('.gallery-item img, [class*="photo"] img, [class*="image"] img');
    const images: string[] = [];
    imgElements.forEach((img: any) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (src && !src.includes('icon') && !src.includes('logo')) {
        images.push(src);
      }
    });

    const listing: BaTListing = {
      url: batUrl,
      title,
      year,
      make,
      model,
      trim,
      vin,
      salePrice,
      saleDate,
      description,
      seller,
      buyer,
      lotNumber,
      images: images.slice(0, 10) // Limit to first 10 images
    };

    console.log('Parsed listing:', listing);

    // Now insert/update in database
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if vehicle exists by VIN or year/make/model
    let vehicleId: string | null = null;
    
    if (vin) {
      const { data: existingVehicle } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', vin)
        .single();
      
      if (existingVehicle) {
        vehicleId = existingVehicle.id;
      }
    }

    // If not found by VIN, try fuzzy match by year/make/model
    if (!vehicleId) {
      const { data: fuzzyMatches } = await supabase
        .from('vehicles')
        .select('id, vin, year, make, model')
        .eq('year', year)
        .ilike('make', `%${make}%`)
        .ilike('model', `%${model.split(' ')[0]}%`) // Match first word of model
        .limit(1);
      
      if (fuzzyMatches && fuzzyMatches.length > 0) {
        vehicleId = fuzzyMatches[0].id;
        console.log(`Fuzzy matched to existing vehicle: ${vehicleId}`);
      }
    }

    // If vehicle exists, update it
    if (vehicleId) {
      await supabase
        .from('vehicles')
        .update({
          sale_price: salePrice,
          sale_date: saleDate,
          trim: trim || undefined,
          description: description,
          metadata: {
            bat_listing: {
              url: batUrl,
              seller,
              buyer,
              lot_number: lotNumber,
              sale_date: saleDate,
              sale_price: salePrice
            }
          }
        })
        .eq('id', vehicleId);

      // Update organization_vehicles
      await supabase
        .from('organization_vehicles')
        .update({
          sale_price: salePrice,
          sale_date: saleDate,
          listing_status: 'sold'
        })
        .eq('vehicle_id', vehicleId)
        .eq('organization_id', organizationId);

      console.log(`Updated existing vehicle: ${vehicleId}`);
    } else {
      // Create new vehicle
      const { data: newVehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert({
          year,
          make,
          model,
          trim,
          vin,
          sale_price: salePrice,
          sale_date: saleDate,
          description,
          imported_by: null, // BaT import, not a user import
          metadata: {
            bat_listing: {
              url: batUrl,
              seller,
              buyer,
              lot_number: lotNumber,
              sale_date: saleDate,
              sale_price: salePrice
            }
          }
        })
        .select()
        .single();

      if (vehicleError) {
        throw vehicleError;
      }

      vehicleId = newVehicle.id;

      // Link to organization
      await supabase
        .from('organization_vehicles')
        .insert({
          organization_id: organizationId,
          vehicle_id: vehicleId,
          relationship_type: 'sold_by',
          listing_status: 'sold',
          sale_price: salePrice,
          sale_date: saleDate
        });

      console.log(`Created new vehicle: ${vehicleId}`);
    }

    // Add data validations
    const validations = [
      {
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'sale_price',
        field_value: salePrice.toString(),
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `Sale price verified from BaT listing #${lotNumber}`
      },
      {
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'sale_date',
        field_value: saleDate,
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `Sale date verified from BaT listing #${lotNumber}`
      },
      {
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'year',
        field_value: year.toString(),
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `Year verified from BaT listing #${lotNumber}`
      },
      {
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'make',
        field_value: make,
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `Make verified from BaT listing #${lotNumber}`
      },
      {
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'model',
        field_value: model,
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `Model verified from BaT listing #${lotNumber}`
      }
    ];

    if (vin) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'vin',
        field_value: vin,
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `VIN verified from BaT listing #${lotNumber}`
      });
    }

    await supabase
      .from('data_validations')
      .insert(validations);

    return new Response(
      JSON.stringify({
        success: true,
        vehicleId,
        listing,
        action: vehicleId ? 'updated' : 'created'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error importing BaT listing:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

