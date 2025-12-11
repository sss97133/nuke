import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    
    const response = await fetch(batUrl);
    const html = await response.text();

    // Parse title - extract year/make/model
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const title = titleMatch ? titleMatch[1].trim() : '';
    
    const vehicleMatch = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
    const year = vehicleMatch ? parseInt(vehicleMatch[1]) : 0;
    const make = vehicleMatch ? vehicleMatch[2] : '';
    const modelAndTrim = vehicleMatch ? vehicleMatch[3] : '';
    
    const modelParts = modelAndTrim.split(' ');
    const model = modelParts.slice(0, 2).join(' ');
    const trim = modelParts.length > 2 ? modelParts.slice(2).join(' ') : undefined;

    // Extract sale price
    const priceText = html.match(/Sold for.*?USD \$([\\d,]+)/);
    const salePrice = priceText ? parseInt(priceText[1].replace(/,/g, '')) : 0;

    // Extract sale date
    const dateText = html.match(/on (\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const saleDate = dateText ? new Date(dateText[1]).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // Extract description
    const descMatch = html.match(/<p>([^<]{100,500})<\/p>/);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract seller/buyer
    const sellerMatch = html.match(/Sold by\s+([A-Za-z0-9_]+)/i);
    const buyerMatch = html.match(/to\s+([A-Za-z0-9_]+)\s+for/i);
    const seller = sellerMatch ? sellerMatch[1] : 'VivaLasVegasAutos';
    const buyer = buyerMatch ? buyerMatch[1] : '';

    // Extract lot number
    const lotMatch = html.match(/Lot.*?#(\d+)/);
    const lotNumber = lotMatch ? lotMatch[1] : '';

    // Extract VIN - BaT uses both "VIN:" and "Chassis:" labels
    const vinMatch = html.match(/(?:VIN|Chassis)[:\s]+([A-HJ-NPR-Z0-9]{17})/i) ||
                     html.match(/<li>Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{17})<\/a><\/li>/i);
    const vin = vinMatch ? vinMatch[1].toUpperCase() : undefined;

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
      lotNumber
    };

    console.log('Parsed listing:', JSON.stringify(listing));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let vehicleId: string | null = null;
    
    if (vin) {
      const { data: existingVehicle } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', vin)
        .single();
      
      if (existingVehicle) {
        vehicleId = existingVehicle.id;
        console.log(`Found existing vehicle by VIN: ${vehicleId}`);
      }
    }

    if (!vehicleId) {
      const { data: fuzzyMatches } = await supabase
        .from('vehicles')
        .select('id, vin, year, make, model')
        .eq('year', year)
        .ilike('make', `%${make}%`)
        .ilike('model', `%${model.split(' ')[0]}%`)
        .limit(1);
      
      if (fuzzyMatches && fuzzyMatches.length > 0) {
        vehicleId = fuzzyMatches[0].id;
        console.log(`Fuzzy matched to existing vehicle: ${vehicleId}`);
      }
    }

    if (vehicleId) {
      const updateData: any = {
        sale_price: salePrice,
        sale_date: saleDate,
        trim: trim || undefined,
        description: description,
        auction_outcome: salePrice > 0 ? 'sold' : 'reserve_not_met',
        bat_auction_url: batUrl
      };
      
      // Update VIN if we found one and vehicle doesn't have one
      if (vin) {
        const { data: currentVehicle } = await supabase
          .from('vehicles')
          .select('vin')
          .eq('id', vehicleId)
          .single();
        
        // Only update VIN if vehicle doesn't have one, or if it matches (to avoid conflicts)
        if (!currentVehicle?.vin || currentVehicle.vin === vin) {
          updateData.vin = vin;
        }
      }
      
      await supabase
        .from('vehicles')
        .update(updateData)
        .eq('id', vehicleId);

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
          auction_outcome: salePrice > 0 ? 'sold' : 'reserve_not_met',
          bat_auction_url: batUrl,
          imported_by: null
        })
        .select()
        .single();

      if (vehicleError) {
        throw vehicleError;
      }

      vehicleId = newVehicle.id;

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
        field_name: 'year',
        field_value: year.toString(),
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `Year verified from BaT listing #${lotNumber}`
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

    // Create timeline event for the sale with the actual sale date (not upload date)
    await supabase
      .from('timeline_events')
      .insert({
        vehicle_id: vehicleId,
        event_type: 'sale',
        event_date: saleDate, // Use actual BaT sale date
        title: `Sold on Bring a Trailer for $${salePrice.toLocaleString()}`,
        description: `${year} ${make} ${model} sold on BaT auction #${lotNumber}. Seller: ${seller}${buyer ? `, Buyer: ${buyer}` : ''}`,
        cost_amount: salePrice,
        metadata: {
          source: 'bat_import',
          bat_url: batUrl,
          lot_number: lotNumber,
          seller,
          buyer
        },
        user_id: null // System-generated event
      });
    
    // Call comprehensive extraction to get full auction data and create timeline events
    try {
      const { data: comprehensiveData, error: comprehensiveError } = await supabase.functions.invoke('comprehensive-bat-extraction', {
        body: { batUrl, vehicleId }
      });
      
      if (!comprehensiveError && comprehensiveData?.success) {
        console.log('Comprehensive extraction completed:', {
          vin: comprehensiveData.data.vin,
          auction_dates: {
            start: comprehensiveData.data.auction_start_date,
            end: comprehensiveData.data.auction_end_date,
            sale: comprehensiveData.data.sale_date
          },
          metrics: {
            bids: comprehensiveData.data.bid_count,
            views: comprehensiveData.data.view_count
          }
        });
      }
    } catch (err) {
      console.log('Comprehensive extraction not available, using basic extraction only');
    }

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
