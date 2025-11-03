import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Parse BaT listing and create GRANULAR data validations for each field
 * Fill in the blanks - BaT is one validation source competing with others
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { batUrl, vehicleId, organizationId, userId } = await req.json();

    if (!batUrl || !vehicleId) {
      return new Response(
        JSON.stringify({ error: 'batUrl and vehicleId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Parsing BaT listing for granular validations: ${batUrl}`);
    
    const response = await fetch(batUrl);
    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const title = titleMatch ? titleMatch[1].trim() : '';
    
    // Parse year/make/model/trim from title
    const vehicleMatch = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
    const year = vehicleMatch ? parseInt(vehicleMatch[1]) : null;
    const make = vehicleMatch ? vehicleMatch[2] : null;
    const modelAndTrim = vehicleMatch ? vehicleMatch[3] : '';
    const modelParts = modelAndTrim.split(' ');
    const model = modelParts.slice(0, 2).join(' ');
    const trim = modelParts.length > 2 ? modelParts.slice(2).join(' ') : null;

    // Extract VIN
    const vinMatch = html.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch ? vinMatch[1] : null;

    // Extract mileage
    const mileageMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi)/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;

    // Extract engine
    const engineMatch = html.match(/(\d+(?:\.\d+)?[Ll](?:iter)?|[\d.]+ci)\s+(?:V\d+|inline-\d+|[A-Z]\d+)/i);
    const engine = engineMatch ? engineMatch[0] : null;

    // Extract transmission
    const transMatch = html.match(/(\d+-speed|automatic|manual|CVT)/i);
    const transmission = transMatch ? transMatch[1] : null;

    // Extract color
    const colorMatch = html.match(/(?:finished|refinished|painted)\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
    const color = colorMatch ? colorMatch[1] : null;

    // Extract sale price
    const priceMatch = html.match(/Sold for.*?USD \$([\\d,]+)/);
    const salePrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

    // Extract high bid (if reserve not met)
    const highBidMatch = html.match(/Bid to.*?USD \$([\\d,]+)/);
    const highBid = highBidMatch ? parseInt(highBidMatch[1].replace(/,/g, '')) : null;

    // Extract lot number
    const lotMatch = html.match(/Lot.*?#(\d+)/);
    const lotNumber = lotMatch ? lotMatch[1] : '';

    // Extract images
    const imageMatches = html.matchAll(/https:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*/gi);
    const images: string[] = [];
    for (const match of imageMatches) {
      const url = match[0];
      if (url.includes('bringatrailer.com') && 
          !url.includes('logo') && 
          !url.includes('icon') &&
          !url.includes('/wp-content/themes/') &&
          images.length < 50) {  // Limit to 50 images
        images.push(url);
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Create GRANULAR validations for each extracted field
    const validations = [];

    if (year) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'year',
        field_value: year.toString(),
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 100,
        source_url: batUrl,
        notes: `Year extracted from BaT listing #${lotNumber}`
      });
    }

    if (make) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'make',
        field_value: make,
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 100,
        source_url: batUrl,
        notes: `Make extracted from BaT listing #${lotNumber}`
      });
    }

    if (model) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'model',
        field_value: model,
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 100,
        source_url: batUrl,
        notes: `Model extracted from BaT listing #${lotNumber}`
      });
    }

    if (trim) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'trim',
        field_value: trim,
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 95,
        source_url: batUrl,
        notes: `Trim extracted from BaT listing #${lotNumber}`
      });
    }

    if (vin) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'vin',
        field_value: vin,
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 100,
        source_url: batUrl,
        notes: `VIN extracted from BaT listing #${lotNumber}`
      });
    }

    if (mileage) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'mileage',
        field_value: mileage.toString(),
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 90,
        source_url: batUrl,
        notes: `Mileage extracted from BaT listing #${lotNumber}`
      });
    }

    if (engine) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'engine',
        field_value: engine,
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 95,
        source_url: batUrl,
        notes: `Engine specs extracted from BaT listing #${lotNumber}`
      });
    }

    if (transmission) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'transmission',
        field_value: transmission,
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 95,
        source_url: batUrl,
        notes: `Transmission extracted from BaT listing #${lotNumber}`
      });
    }

    if (color) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'color',
        field_value: color,
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 90,
        source_url: batUrl,
        notes: `Color extracted from BaT listing #${lotNumber}`
      });
    }

    if (salePrice) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'sale_price',
        field_value: salePrice.toString(),
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 100,
        source_url: batUrl,
        notes: `Sale price from BaT listing #${lotNumber} - publicly verified auction result`
      });
    }

    if (highBid) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'high_bid_reserve_not_met',
        field_value: highBid.toString(),
        validation_source: 'bat_listing',
        validated_by: userId,
        confidence_score: 100,
        source_url: batUrl,
        notes: `High bid from BaT listing #${lotNumber} - reserve not met, vehicle still available`
      });
    }

    // Insert all validations
    const { error: validationError } = await supabase
      .from('data_validations')
      .insert(validations);

    if (validationError) {
      console.error('Error inserting validations:', validationError);
    }

    // Download and save images from BaT
    let savedImages = 0;
    for (const imageUrl of images.slice(0, 20)) {  // Limit to 20 best images
      try {
        // Download image
        const imgResponse = await fetch(imageUrl);
        const imgBlob = await imgResponse.arrayBuffer();
        
        // Generate filename
        const filename = `bat_${lotNumber}_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const storagePath = `${vehicleId}/${filename}`;

        // Upload to Supabase storage
        const { error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(storagePath, imgBlob, {
            contentType: 'image/jpeg',
            cacheControl: '3600'
          });

        if (uploadError) {
          console.error(`Failed to upload image: ${uploadError.message}`);
          continue;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(storagePath);

        // Create vehicle_images entry
        // user_id = NULL (photographer unknown, awaiting claim)
        // source = 'bat_listing'
        const { error: imageError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicleId,
            image_url: publicUrl,
            user_id: null,  // Unknown photographer - can be claimed later
            source: 'bat_listing',
            category: 'exterior',
            imported_by: userId,
            metadata: {
              original_bat_url: imageUrl,
              bat_lot_number: lotNumber,
              bat_listing_url: batUrl,
              photographer_unknown: true,
              claimable: true
            }
          });

        if (!imageError) {
          savedImages++;
        }
      } catch (imgError) {
        console.error(`Error processing image ${imageUrl}:`, imgError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicleId,
        validationsCreated: validations.length,
        imagesSaved: savedImages,
        extractedData: {
          year,
          make,
          model,
          trim,
          vin,
          mileage,
          engine,
          transmission,
          color,
          salePrice: salePrice || highBid,
          reserveNotMet: !!highBid && !salePrice
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error parsing BaT listing:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

