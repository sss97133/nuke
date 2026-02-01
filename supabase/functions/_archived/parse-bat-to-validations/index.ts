import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STORAGE_BUCKET = 'vehicle-data';

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

    // Extract images - improved extraction with multiple methods
    const images: string[] = [];
    
    // Method 1: Extract from data-gallery-items JSON (best method)
    const galleryMatch = html.match(/data-gallery-items=["']([^"']+)["']/i);
    if (galleryMatch) {
      try {
        const galleryJson = JSON.parse(galleryMatch[1].replace(/&quot;/g, '"'));
        if (Array.isArray(galleryJson)) {
          for (const item of galleryJson) {
            const url = item?.large?.url || item?.small?.url || item?.url;
            if (url && url.includes('bringatrailer.com') && !images.includes(url)) {
              // Remove query params and size constraints for full-res
              const cleanUrl = url.split('?')[0];
              images.push(cleanUrl);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to parse gallery JSON:', e);
      }
    }
    
    // Method 2: Extract from img tags with better filtering
    if (images.length === 0) {
      const imgTagPattern = /<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
      let match;
      while ((match = imgTagPattern.exec(html)) !== null && images.length < 50) {
        const url = match[1];
        // Filter for actual vehicle images
        if (url.includes('wp-content/uploads') && 
            url.includes('bringatrailer.com') && 
            !url.includes('logo') && 
            !url.includes('icon') &&
            !url.includes('avatar') &&
            !url.includes('gravatar') &&
            !url.match(/-(\d+)x\d+\./) && // Skip thumbnails like -150x150
            !images.includes(url)) {
          // Remove query params for full resolution
          const cleanUrl = url.split('?')[0];
          images.push(cleanUrl);
        }
      }
    }
    
    // Method 3: Fallback - simple pattern matching
    if (images.length === 0) {
      const fallbackPattern = /https:\/\/[^"']*bringatrailer\.com[^"']*wp-content[^"']*uploads[^"']*\.(?:jpg|jpeg|png|webp)/gi;
      let match;
      while ((match = fallbackPattern.exec(html)) !== null && images.length < 50) {
        const url = match[0];
        if (!url.includes('logo') && 
            !url.includes('icon') &&
            !url.includes('avatar') &&
            !images.includes(url)) {
          const cleanUrl = url.split('?')[0];
          images.push(cleanUrl);
        }
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

    // Download and save images from BaT with proper ghost user attribution
    let savedImages = 0;
    
    // Create/get ghost user for BaT photographer (unknown photographer)
    const photographerFingerprint = `BaT-Photographer-${batUrl}`;
    let ghostUserId: string | null = null;
    
    // Check if ghost user exists
    const { data: existingGhost } = await supabase
      .from('ghost_users')
      .select('id')
      .eq('device_fingerprint', photographerFingerprint)
      .maybeSingle();
    
    if (existingGhost?.id) {
      ghostUserId = existingGhost.id;
    } else {
      // Create new ghost user for BaT photographer
      const { data: newGhost, error: ghostError } = await supabase
        .from('ghost_users')
        .insert({
          device_fingerprint: photographerFingerprint,
          camera_make: 'Unknown',
          camera_model: 'BaT Listing',
          display_name: `BaT Photographer (Lot #${lotNumber})`,
          total_contributions: 0
        })
        .select('id')
        .single();
      
      if (!ghostError && newGhost?.id) {
        ghostUserId = newGhost.id;
      }
    }
    
    const takenAt = salePrice ? (new Date().toISOString()) : null; // Use sale date if available
    
    for (const imageUrl of images.slice(0, 20)) {  // Limit to 20 best images
      try {
        // Download image
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) {
          console.error(`Failed to download image: ${imgResponse.statusText}`);
          continue;
        }
        
        const imgBlob = await imgResponse.arrayBuffer();
        
        // Generate filename
        const filename = `bat_${lotNumber}_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const storagePath = `vehicles/${vehicleId}/images/bat_listing/${filename}`;

        // Upload to Supabase storage
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
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
          .from(STORAGE_BUCKET)
          .getPublicUrl(storagePath);

        // Create vehicle_images entry with ghost user as photographer
        // Use ghost user (photographer), fallback to userId if ghost creation failed
        const { data: imageData, error: imageError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicleId,
            image_url: publicUrl,
            user_id: ghostUserId || userId, // Photographer (ghost user), fallback to importer
            source: 'bat_listing',
            category: 'exterior',
            taken_at: takenAt,
            exif_data: {
              source_url: imageUrl,
              bat_listing_url: batUrl,
              bat_lot_number: lotNumber,
              imported_by_user_id: userId,
              imported_at: new Date().toISOString(),
              attribution_note: 'Photographer unknown - images from BaT listing. Original photographer can claim with proof.',
              claimable: true,
              device_fingerprint: photographerFingerprint
            }
          })
          .select('id')
          .single();

        if (!imageError && imageData?.id && ghostUserId) {
          // Create device attribution linking image to ghost user
          await supabase
            .from('device_attributions')
            .insert({
              image_id: imageData.id,
              device_fingerprint: photographerFingerprint,
              ghost_user_id: ghostUserId,
              uploaded_by_user_id: userId, // Who ran the import
              attribution_source: 'bat_listing_unknown_photographer',
              confidence_score: 50 // Low confidence - we don't know who took it
            });
          
          savedImages++;
        } else if (!imageError && imageData) {
          // Image inserted but ghost user attribution failed - still count as success
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

  } catch (error: any) {
    console.error('Error parsing BaT listing:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

