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
  sellerType?: string; // 'dealer' | 'private_party' | 'unknown' (best-effort)
  buyer: string;
  lotNumber: string;
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    // Normalize path for BaT listings to end with a trailing slash
    if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    // Fallback: best-effort strip fragments/query
    return String(raw).split('#')[0].split('?')[0];
  }
}

function coalesceString(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function extractSellerTypeFromHtml(html: string): string | undefined {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // BaT essentials sometimes include "Seller: Dealer" / "Seller: Private Party"
  const m =
    text.match(/\bSeller\s*:\s*(Dealer|Private\s*Party|Individual|Dealer\/Broker|Broker)\b/i) ||
    text.match(/\bSeller\s+Type\s*:\s*(Dealer|Private\s*Party|Individual|Dealer\/Broker|Broker)\b/i);
  if (!m) return undefined;
  const v = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
  if (v.includes('dealer') || v.includes('broker')) return 'dealer';
  if (v.includes('private') || v.includes('individual')) return 'private_party';
  return 'unknown';
}

function extractSellerUsernameFromHtml(html: string): string | null {
  // Common patterns:
  // - "Sold by username"
  // - "Sold by <a href=\"/member/username/\">..."
  const m1 = html.match(/Sold by\s+([A-Za-z0-9_]+)/i);
  if (m1?.[1]) return m1[1];
  const m2 = html.match(/Sold by[\s\S]{0,250}?\/member\/([^\/"'?]+)\//i);
  if (m2?.[1]) {
    try {
      return decodeURIComponent(m2[1]);
    } catch {
      return m2[1];
    }
  }
  return null;
}

function extractBuyerUsernameFromHtml(html: string): string | null {
  // Best-effort; buyer is less consistently linked.
  const m1 = html.match(/to\s+([A-Za-z0-9_]+)\s+for/i);
  if (m1?.[1]) return m1[1];
  const m2 = html.match(/to[\s\S]{0,250}?\/member\/([^\/"'?]+)\//i);
  if (m2?.[1]) {
    try {
      return decodeURIComponent(m2[1]);
    } catch {
      return m2[1];
    }
  }
  return null;
}

async function findLocalPartnerBusinessIdByBatUsername(
  supabase: any,
  batUsername: string | null,
): Promise<string | null> {
  const u = typeof batUsername === 'string' ? batUsername.trim() : '';
  if (!u) return null;

  // Local Partners indexer stores:
  // businesses.metadata.bat_local_partners.bat_username
  // Use a JSON-path filter; PostgREST supports this syntax.
  const { data, error } = await supabase
    .from('businesses')
    .select('id')
    .eq('metadata->bat_local_partners->>bat_username', u)
    .limit(1);

  if (!error && Array.isArray(data) && data[0]?.id) return data[0].id;

  // Best-effort fallback: case-insensitive match
  const { data: dataIlike, error: errorIlike } = await supabase
    .from('businesses')
    .select('id')
    .ilike('metadata->bat_local_partners->>bat_username', u)
    .limit(1);

  if (!errorIlike && Array.isArray(dataIlike) && dataIlike[0]?.id) return dataIlike[0].id;
  return null;
}

async function upsertBatUser(
  supabase: any,
  username: string | null,
): Promise<{ id: string | null; username: string | null; profile_url: string | null }> {
  const u = username ? username.trim() : '';
  if (!u) return { id: null, username: null, profile_url: null };
  const profileUrl = `https://bringatrailer.com/member/${encodeURIComponent(u)}/`;

  // `bat_users.bat_username` is UNIQUE (see migrations). This creates a stable UUID identity
  // that can later be linked to a real N-Zero user via `n_zero_user_id` (claim flow).
  const { data, error } = await supabase
    .from('bat_users')
    .upsert(
      {
        bat_username: u,
        bat_profile_url: profileUrl,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'bat_username' },
    )
    .select('id, bat_username, bat_profile_url')
    .single();

  if (error) {
    console.log('bat_users upsert failed (non-fatal):', error.message);
    return { id: null, username: u, profile_url: profileUrl };
  }

  return { id: data?.id || null, username: data?.bat_username || u, profile_url: data?.bat_profile_url || profileUrl };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    // Backwards/compat: accept {listingUrl}, {batUrl}, {bat_url}, {url}
    const batUrlRaw = coalesceString(payload?.listingUrl, payload?.batUrl, payload?.bat_url, payload?.url);
    // Optional: when provided, this is the SELLER business id to link the listing to (public.businesses.id).
    // For safety we don't auto-link unless the listing indicates a dealer OR the caller explicitly forces linking.
    const organizationId = coalesceString(payload?.organizationId, payload?.organization_id);
    const forceDealerLink = payload?.forceDealerLink === true;
    // Safety: fuzzy match is a major contamination source; default off.
    const allowFuzzyMatch = payload?.allowFuzzyMatch === true;
    const imageBatchSize = Math.max(10, Math.min(100, Number(payload?.imageBatchSize || 50)));

    if (!batUrlRaw) {
      return new Response(
        JSON.stringify({ error: 'batUrl (or url) required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const batUrl = normalizeUrl(batUrlRaw);
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
    const seller = extractSellerUsernameFromHtml(html);
    const buyer = extractBuyerUsernameFromHtml(html);
    const sellerType = extractSellerTypeFromHtml(html);

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
      sellerType,
      buyer,
      lotNumber
    };

    console.log('Parsed listing:', JSON.stringify(listing));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Create stable claimable identities for seller/buyer as BaT users (UUIDs in bat_users)
    const [sellerUser, buyerUser] = await Promise.all([
      upsertBatUser(supabase, seller || null),
      upsertBatUser(supabase, buyer || null),
    ]);

    // Determine whether we can/should link this listing to a seller organization (public.businesses).
    // 1) If caller provided organizationId, treat it as the intended seller business id.
    // 2) Else, if seller matches a Local Partner BaT username, auto-link to that org.
    let sellerOrganizationId: string | null = organizationId;
    let sellerOrgDiscoveredViaLocalPartners = false;
    if (!sellerOrganizationId && sellerUser?.username) {
      sellerOrganizationId = await findLocalPartnerBusinessIdByBatUsername(supabase, sellerUser.username);
      sellerOrgDiscoveredViaLocalPartners = !!sellerOrganizationId;
    }

    const shouldLinkSellerOrg =
      !!sellerOrganizationId && (sellerType === 'dealer' || forceDealerLink || sellerOrgDiscoveredViaLocalPartners);

    let vehicleId: string | null = null;
    let createdVehicle = false;
    
    // First: idempotent match by BaT URL (best signal when VIN is absent/unreliable).
    {
      const { data: existingByBatUrl, error: byBatErr } = await supabase
        .from('vehicles')
        .select('id')
        .eq('bat_auction_url', batUrl)
        .maybeSingle();
      if (byBatErr) {
        console.log('BaT URL match query failed (continuing):', byBatErr.message);
      } else if (existingByBatUrl?.id) {
        vehicleId = existingByBatUrl.id;
        console.log(`Found existing vehicle by bat_auction_url: ${vehicleId}`);
      }
    }

    // Fallback: match by discovery_url or listing_url (some older imports only set those)
    if (!vehicleId) {
      const { data: existingByDiscoveryUrl, error: discErr } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', batUrl)
        .maybeSingle();
      if (!discErr && existingByDiscoveryUrl?.id) {
        vehicleId = existingByDiscoveryUrl.id;
        console.log(`Found existing vehicle by discovery_url: ${vehicleId}`);
      }
    }
    if (!vehicleId) {
      const { data: existingByListingUrl, error: listErr } = await supabase
        .from('vehicles')
        .select('id')
        .eq('listing_url', batUrl)
        .maybeSingle();
      if (!listErr && existingByListingUrl?.id) {
        vehicleId = existingByListingUrl.id;
        console.log(`Found existing vehicle by listing_url: ${vehicleId}`);
      }
    }

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

    if (!vehicleId && allowFuzzyMatch) {
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
        bat_auction_url: batUrl,
        listing_url: batUrl,
        discovery_url: batUrl,
        // Keep the human-readable seller (legacy fields)
        bat_seller: seller || null,
        // Store the claimable BaT identity IDs in origin_metadata (no schema change required)
        origin_metadata: {
          source: 'bat_import',
          bat_url: batUrl,
          bat_seller_username: sellerUser.username,
          bat_seller_user_id: sellerUser.id,
          bat_seller_profile_url: sellerUser.profile_url,
          bat_buyer_username: buyerUser.username,
          bat_buyer_user_id: buyerUser.id,
          bat_buyer_profile_url: buyerUser.profile_url,
          bat_seller_type: sellerType || null,
          seller_business_id: sellerOrganizationId,
          seller_business_linked: shouldLinkSellerOrg,
          imported_at: new Date().toISOString(),
        }
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

      // Optional seller org update when we are confident this listing belongs to a seller business.
      if (sellerOrganizationId && shouldLinkSellerOrg) {
        await supabase
          .from('organization_vehicles')
          .update({
            sale_price: salePrice,
            sale_date: saleDate,
            listing_status: 'sold'
          })
          .eq('vehicle_id', vehicleId)
          .eq('organization_id', sellerOrganizationId);
      }

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
          imported_by: null,
          listing_url: batUrl,
          discovery_url: batUrl,
          profile_origin: 'bat_import',
          discovery_source: 'bat_import',
          bat_seller: seller || null,
          origin_metadata: {
            source: 'bat_import',
            bat_url: batUrl,
            bat_seller_username: sellerUser.username,
            bat_seller_user_id: sellerUser.id,
            bat_seller_profile_url: sellerUser.profile_url,
            bat_buyer_username: buyerUser.username,
            bat_buyer_user_id: buyerUser.id,
            bat_buyer_profile_url: buyerUser.profile_url,
            bat_seller_type: sellerType || null,
            seller_business_id: sellerOrganizationId,
            seller_business_linked: shouldLinkSellerOrg,
            imported_at: new Date().toISOString(),
          }
        })
        .select()
        .single();

      if (vehicleError) {
        throw vehicleError;
      }

      vehicleId = newVehicle.id;
      createdVehicle = true;

      // Only link seller org when we are confident this listing belongs to a seller business.
      if (sellerOrganizationId && shouldLinkSellerOrg) {
        await supabase
          .from('organization_vehicles')
          .insert({
            organization_id: sellerOrganizationId,
            vehicle_id: vehicleId,
            relationship_type: 'sold_by',
            listing_status: 'sold',
            sale_price: salePrice,
            sale_date: saleDate
          });
      }

      console.log(`Created new vehicle: ${vehicleId}`);
    }

    // Write/refresh bat_listings (if table exists in this project).
    // This keeps auction identity separate from vehicles and lets comments/bids later attach cleanly.
    try {
      await supabase
        .from('bat_listings')
        .upsert(
          {
            vehicle_id: vehicleId,
            organization_id: shouldLinkSellerOrg ? sellerOrganizationId : null,
            bat_listing_url: batUrl,
            bat_lot_number: lotNumber || null,
            bat_listing_title: title || null,
            sale_date: saleDate || null,
            sale_price: salePrice || null,
            seller_username: sellerUser.username,
            buyer_username: buyerUser.username,
            seller_bat_user_id: sellerUser.id,
            buyer_bat_user_id: buyerUser.id,
            listing_status: salePrice > 0 ? 'sold' : 'ended',
            last_updated_at: new Date().toISOString(),
            raw_data: {
              source: 'bat_import',
              bat_url: batUrl,
              seller_type: sellerType || null,
              seller_business_id: sellerOrganizationId,
              seller_business_linked: shouldLinkSellerOrg,
              seller_org_discovered_via: sellerOrgDiscoveredViaLocalPartners ? 'bat_local_partners' : null,
            },
          },
          { onConflict: 'bat_listing_url' },
        );
    } catch (e: any) {
      console.log('bat_listings upsert failed (non-fatal):', e?.message || String(e));
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

    // Create timeline event for the sale with the actual sale date (deduped by bat_url + event_date).
    try {
      const { data: existingSaleEvent } = await supabase
        .from('timeline_events')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('event_type', 'sale')
        .eq('event_date', saleDate)
        .contains('metadata', { bat_url: batUrl })
        .limit(1);

      if (!existingSaleEvent || existingSaleEvent.length === 0) {
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
      } else {
        console.log('Sale timeline event already exists for this bat_url + event_date; skipping insert');
      }
    } catch (e: any) {
      console.log('Timeline sale event insert failed (non-fatal):', e?.message || String(e));
    }
    
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

    // Import ALL BaT listing images by scraping URLs then calling backfill-images in batches.
    const imageImport = {
      found: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      batches: 0,
      batch_size: imageBatchSize
    };
    try {
      const { data: simpleData, error: simpleError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: batUrl }
      });
      const images: string[] = (simpleData?.success && Array.isArray(simpleData?.data?.images)) ? simpleData.data.images : [];
      imageImport.found = images.length;

      if (simpleError) {
        console.log('simple-scraper failed (non-fatal):', simpleError.message);
      } else if (images.length > 0) {
        for (let start = 0; start < images.length; start += imageBatchSize) {
          const slice = images.slice(start, start + imageBatchSize);
          imageImport.batches++;
          const { data: backfillData, error: backfillError } = await supabase.functions.invoke('backfill-images', {
            body: {
              vehicle_id: vehicleId,
              image_urls: slice,
              source: 'bat_import',
              run_analysis: false,
              listed_date: saleDate,
              max_images: slice.length
            }
          });
          if (backfillError) {
            console.log(`backfill-images batch failed (non-fatal):`, backfillError.message);
            imageImport.failed += slice.length;
            continue;
          }
          imageImport.uploaded += Number(backfillData?.uploaded || 0);
          imageImport.skipped += Number(backfillData?.skipped || 0);
          imageImport.failed += Number(backfillData?.failed || 0);
        }
      } else {
        console.log('No images found by simple-scraper');
      }
    } catch (e: any) {
      console.log('Image import failed (non-fatal):', e?.message || String(e));
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicleId,
        vehicle: listing,
        action: createdVehicle ? 'created' : 'updated',
        seller_identity: {
          bat_username: sellerUser.username,
          bat_user_id: sellerUser.id,
          bat_profile_url: sellerUser.profile_url,
          seller_type: sellerType || null,
          seller_business_id: sellerOrganizationId,
          seller_business_linked: shouldLinkSellerOrg
        },
        buyer_identity: {
          bat_username: buyerUser.username,
          bat_user_id: buyerUser.id,
          bat_profile_url: buyerUser.profile_url
        },
        images: imageImport
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
