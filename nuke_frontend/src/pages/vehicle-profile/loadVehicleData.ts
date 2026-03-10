/**
 * Loads vehicle data from Supabase (RPC first, fallback to direct query).
 * Also derives auction pulse, loads comment telemetry, and triggers BaT sync.
 *
 * Extracted from VehicleProfile.tsx to reduce file size.
 * This function has side effects (state setters, supabase calls, navigation) but no React hooks.
 */
import { buildAuctionPulseFromExternalListings } from './buildAuctionPulse';
import { isMismatchedVehicleImage } from './imageFilterUtils';

// ----- Hero Image Auto-Selection -----

export interface HeroImageMeta {
  camera?: string;
  location?: string;
  date?: string;
}

export interface HeroImageResult {
  url: string;
  meta: HeroImageMeta;
}

/**
 * Select the best hero image for a vehicle based on zone, quality, and confidence scores.
 *
 * Priority:
 *  1. Front-facing exterior zones with completed AI processing, scored by
 *     (photo_quality_score * 2) + (zone_confidence * 3)
 *  2. Fallback: highest photo_quality_score from any zone
 *  3. Fallback: existing primary_image_url from the vehicle record
 *
 * Returns the best image URL (large > medium > image_url) and metadata
 * extracted from exif_data and taken_at.
 */
export async function selectBestHeroImage(
  vehicleId: string,
  supabase: any,
  primaryImageUrl?: string | null,
): Promise<HeroImageResult | null> {
  try {
    // Attempt 1: front-facing exterior zones with completed AI processing
    const { data: frontImages, error: frontErr } = await supabase
      .from('vehicle_images')
      .select('image_url, medium_url, large_url, photo_quality_score, zone_confidence, vehicle_zone, exif_data, taken_at')
      .eq('vehicle_id', vehicleId)
      .eq('ai_processing_status', 'completed')
      .in('vehicle_zone', ['ext_front', 'ext_front_driver', 'ext_front_passenger'])
      .order('photo_quality_score', { ascending: false })
      .limit(20);

    if (!frontErr && frontImages && frontImages.length > 0) {
      // Score: (photo_quality_score * 2) + (zone_confidence * 3), highest wins
      const scored = frontImages.map((img: any) => ({
        ...img,
        _score: ((img.photo_quality_score || 0) * 2) + ((img.zone_confidence || 0) * 3),
      }));
      scored.sort((a: any, b: any) => b._score - a._score);
      return buildHeroResult(scored[0]);
    }

    // Attempt 2: any zone, highest photo_quality_score
    const { data: anyImages, error: anyErr } = await supabase
      .from('vehicle_images')
      .select('image_url, medium_url, large_url, photo_quality_score, zone_confidence, vehicle_zone, exif_data, taken_at')
      .eq('vehicle_id', vehicleId)
      .not('photo_quality_score', 'is', null)
      .order('photo_quality_score', { ascending: false })
      .limit(1);

    if (!anyErr && anyImages && anyImages.length > 0) {
      return buildHeroResult(anyImages[0]);
    }

    // Attempt 3: fall back to primary_image_url
    if (primaryImageUrl) {
      return { url: primaryImageUrl, meta: {} };
    }

    return null;
  } catch (err) {
    console.warn('[selectBestHeroImage] error:', err);
    // Non-fatal — fall back to primary
    if (primaryImageUrl) {
      return { url: primaryImageUrl, meta: {} };
    }
    return null;
  }
}

/** Extract the best URL and metadata from a vehicle_images row. */
function buildHeroResult(row: any): HeroImageResult {
  const url = row.large_url || row.medium_url || row.image_url || '';
  const meta: HeroImageMeta = {};

  // Camera model from EXIF
  if (row.exif_data) {
    const exif = typeof row.exif_data === 'string' ? JSON.parse(row.exif_data) : row.exif_data;
    const cam = exif?.Model || exif?.model || exif?.camera_model || exif?.CameraModel;
    if (cam) meta.camera = String(cam);

    // GPS city/state
    const city = exif?.City || exif?.city || exif?.GPSCity;
    const state = exif?.State || exif?.state || exif?.Province || exif?.province || exif?.GPSState;
    const parts: string[] = [];
    if (city) parts.push(String(city));
    if (state) parts.push(String(state));
    if (parts.length > 0) meta.location = parts.join(', ');
  }

  // Taken date
  if (row.taken_at) {
    try {
      const d = new Date(row.taken_at);
      if (!isNaN(d.getTime())) {
        meta.date = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch {
      // ignore
    }
  }

  return { url, meta };
}

export interface LoadVehicleParams {
  vehicleId: string | undefined;
  session: any;
  leadImageUrl: string | null;
  supabase: any;
  navigate: (path: string) => void;
  ranBatSyncRef: React.MutableRefObject<string | null>;
  setLoading: (v: boolean) => void;
  setVehicle: (v: any) => void;
  setIsPublic: (v: boolean) => void;
  setLeadImageUrl: (url: string) => void;
  setVehicleImages: (images: string[]) => void;
  setTimelineEvents: (events: any[]) => void;
  setAuctionPulse: (pulse: any) => void;
}

export async function loadVehicleImpl({
  vehicleId,
  session,
  leadImageUrl,
  supabase,
  navigate,
  ranBatSyncRef,
  setLoading,
  setVehicle,
  setIsPublic,
  setLeadImageUrl,
  setVehicleImages,
  setTimelineEvents,
  setAuctionPulse,
}: LoadVehicleParams): Promise<void> {
  try {
    setLoading(true);
    // Prevent cross-vehicle cache bleed when navigating between profiles.
    // We only trust RPC caches when they explicitly match the current vehicle.
    (window as any).__vehicleProfileRpcData = null;

    // Accept both UUID format (with hyphens) and VIN format (17 chars alphanumeric)
    const isUUID = vehicleId && vehicleId.length >= 20 && vehicleId.includes('-');
    const isVIN = vehicleId && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vehicleId);

    if (!vehicleId || (!isUUID && !isVIN)) {
      console.error('Invalid vehicleId format:', vehicleId);
      navigate('/vehicles');
      return;
    }

    // OPTIMIZED: Try RPC first for fast loading, fallback to direct query if RPC fails
    let rpcData = null;
    let rpcError = null;

    // Only try RPC if vehicleId is a UUID (RPC expects UUID, not VIN)
    if (isUUID) {
      // Wrap RPC in a timeout so a hung connection never leaves the page in an infinite
      // "Loading vehicle..." state. 2.5 s fires before the anon DB statement_timeout (3 s),
      // ensuring the client falls back to the fast direct query before the server errors out.
      const rpcTimeoutMs = 2500;
      const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error('get_vehicle_profile_data timed out') }), rpcTimeoutMs)
      );
      const rpcResult = await Promise.race([
        supabase.rpc('get_vehicle_profile_data', { p_vehicle_id: vehicleId }),
        timeoutPromise,
      ]);
      rpcData = rpcResult.data;
      rpcError = rpcResult.error;
      if (rpcError?.message?.includes('timed out') || rpcError?.message?.includes('statement timeout') || rpcError?.message?.includes('canceling')) {
        console.warn('[VehicleProfile] RPC timed out / cancelled — falling back to direct query');
      }
    }

    let vehicleData;

    if (rpcError || !rpcData || !rpcData.vehicle) {
      console.warn('[VehicleProfile] RPC load failed, using fallback query:', rpcError?.message || 'RPC returned null');
      console.warn('[VehicleProfile] RPC error details:', rpcError);
      console.warn('[VehicleProfile] RPC data:', rpcData);

      // Fallback to direct query — use explicit columns (not select(*)) for speed
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('id,year,make,model,vin,primary_image_url,sale_price,status,is_public,sale_status,auction_outcome,auction_source,bat_auction_url,discovery_url,uploaded_by,user_id,owner_id,color,interior_color,mileage,fuel_type,transmission,engine_size,horsepower,drivetrain,body_style,doors,is_modified,modification_details,condition_rating,notes,created_at,updated_at,is_for_sale,is_draft,deleted_at,asking_price,current_value,purchase_price,msrp,completion_percentage,displacement,auction_end_date,bid_count,view_count,bat_sold_price,bat_sale_date,bat_listing_title,bat_location,bat_seller,sale_date,ownership_verified,ownership_verified_at,data_quality_score,platform_source,discovery_source')
          .eq('id', vehicleId)
          .single();


        if (error) {
          console.error('[VehicleProfile] Fallback query ERROR:', error);
          console.error('[VehicleProfile] Error details:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
          setVehicle(null);
          setLoading(false);
          return;
        }

        if (!data) {
          console.error('[VehicleProfile] Fallback query returned no data (null/undefined)');
          setVehicle(null);
          setLoading(false);
          return;
        }

        vehicleData = data;
      } catch (fallbackError) {
        console.error('[VehicleProfile] Fallback query exception:', fallbackError);
        setVehicle(null);
        setLoading(false);
        return;
      }
    } else {
      vehicleData = rpcData.vehicle;

      // Set additional data from RPC (optimization) - pass to children to avoid duplicate queries
      if (rpcData.images) {
        setVehicleImages(rpcData.images.map((img: any) => img.image_url));
      }
      if (rpcData.timeline_events) {
        setTimelineEvents(rpcData.timeline_events);
      }

      // Store RPC data for passing to children (eliminates duplicate queries)
      (window as any).__vehicleProfileRpcData = {
        vehicle_id: vehicleData.id,
        images: rpcData.images,
        timeline_events: rpcData.timeline_events,
        latest_valuation: rpcData.latest_valuation,
        price_signal: rpcData.price_signal,
        vehicle_events: rpcData.external_listings,
        external_listings: rpcData.external_listings, // backward compat alias
        comments: rpcData.comments
      };

    }

    // For non-authenticated users, only show public vehicles
    if (!session && !vehicleData.is_public) {
      navigate('/login');
      return;
    }

    // Set vehicle state
    const processedVehicle = { ...vehicleData, isPublic: vehicleData.is_public ?? vehicleData.isPublic };
    setVehicle(processedVehicle);
    setIsPublic(vehicleData.is_public ?? true);

    // Initialize leadImageUrl from primary_image_url if available
    const primaryImg = (vehicleData as any)?.primary_image_url || (vehicleData as any)?.primaryImageUrl || (vehicleData as any)?.image_url;
    const primaryImgLower = typeof primaryImg === 'string' ? primaryImg.toLowerCase() : '';
    const primaryImgLooksWrong =
      primaryImgLower.includes('import_queue') ||
      primaryImgLower.includes('organization-logos/') ||
      primaryImgLower.includes('organization_logos/');
    const primaryImgMismatch = isMismatchedVehicleImage(primaryImg, vehicleData.id);
    if (primaryImg && !leadImageUrl && !primaryImgLooksWrong && !primaryImgMismatch) {
      setLeadImageUrl(primaryImg);
    }

      // Derive auction pulse for header (prefer vehicle_events over stale vehicles.* fields)
    try {
      const rpcCache = (window as any).__vehicleProfileRpcData;
      const listings =
        rpcCache && rpcCache.vehicle_id === vehicleData.id ? (rpcCache.vehicle_events || rpcCache.external_listings) : null;
      let arr = Array.isArray(listings) ? listings : [];

      // If RPC didn't include listings (or returned empty due to env/RLS quirks), do a direct fetch.
      if (arr.length === 0) {
        try {
          const { data } = await supabase
            .from('vehicle_events')
            .select('id, source_platform, source_url, event_status, ended_at, current_price, bid_count, watcher_count, view_count, final_price, sold_at, metadata, updated_at')
            .eq('vehicle_id', vehicleData.id)
            .order('updated_at', { ascending: false })
            .limit(10);
          arr = Array.isArray(data) ? data : [];
        } catch {
          // ignore
        }
      }
      // Filter out stale active listings if vehicle is sold
      const vOutcome = String((vehicleData as any)?.auction_outcome || '').toLowerCase();
      const vSaleStatus = String((vehicleData as any)?.sale_status || '').toLowerCase();
      // IMPORTANT: sale_price alone is not a "sold" signal (it can be a high bid for RNM/no-sale auctions).
      const vehicleIsSold = vSaleStatus === 'sold' || vOutcome === 'sold';
      if (vehicleIsSold) {
        arr = arr.filter((r: any) => {
          const status = String(r.event_status || r.listing_status || '').toLowerCase();
          return status !== 'active' && status !== 'live';
        });
      }

      const best = buildAuctionPulseFromExternalListings(arr, vehicleData.id);

      // Fallback: if we can't access vehicle_events due to RLS, still treat BaT-discovered vehicles as "auction mode"
      // so we hide Claim/Set-price and show a link to the listing.
      const fallbackListingUrl =
        (vehicleData as any)?.bat_auction_url ||
        (String((vehicleData as any)?.discovery_url || '').includes('bringatrailer.com/listing/')
          ? String((vehicleData as any)?.discovery_url)
          : null);

      // Determine listing_status from vehicle data (fallback). DO NOT infer sold from sale_price alone.
      const inferredStatus = (() => {
        if (vOutcome === 'reserve_not_met' || vOutcome === 'no_sale') return vOutcome;
        if (vSaleStatus === 'sold' || vOutcome === 'sold') return 'sold';
        return vOutcome || 'unknown';
      })();

      const effective = best?.listing_url && best?.platform
        ? best
        : (fallbackListingUrl
            ? ({
                external_listing_id: null,
                platform: 'bat',
                listing_url: fallbackListingUrl,
                listing_status: inferredStatus,
                end_date: (vehicleData as any)?.auction_end_date || null,
                current_bid: typeof (vehicleData as any)?.current_bid === 'number' ? (vehicleData as any).current_bid : null,
                bid_count: typeof (vehicleData as any)?.bid_count === 'number' ? (vehicleData as any).bid_count : null,
                watcher_count: null,
                view_count: null,
                comment_count: null,
                final_price: (inferredStatus === 'sold' && typeof (vehicleData as any)?.sale_price === 'number') ? (vehicleData as any).sale_price : null,
                sold_at: inferredStatus === 'sold' ? ((vehicleData as any)?.sold_at || null) : null,
                updated_at: (vehicleData as any)?.updated_at || null,
              } as any)
            : null);

      if (effective?.listing_url && effective?.platform) {
        // CRITICAL: Only load comments/bids if vehicle actually came from this BAT listing
        // Don't load BAT comments for KSL vehicles
        const effectivePlatform = String((effective as any)?.platform || '').toLowerCase().replace(/[_\-\s]+/g, '');
        const effectiveUrl = String((effective as any)?.listing_url || '').toLowerCase();
        const isFromBat = effectivePlatform === 'bat' || effectivePlatform === 'bringatrailer' || effectiveUrl.includes('bringatrailer.com');
        const isFromKsl = effectiveUrl.includes('ksl.com') || effectivePlatform === 'ksl';
        const shouldLoadComments = isFromBat && !isFromKsl;

        // Lightweight comment telemetry (best-effort; table may not exist in some envs)
        // IMPORTANT: Separate bids from comments - don't combine them
        let bidCount: number | null = typeof (effective as any)?.bid_count === 'number' ? (effective as any).bid_count : null;
        let commentCount: number | null = null; // Only non-bid comments
        let lastBidAt: string | null = null;
        let lastCommentAt: string | null = null;

        try {
          // Only query comments if vehicle actually came from BAT
          const [
            bidCountResult,
            commentCountResult,
            lastBid,
            lastComment,
            lastSeller
          ] = await Promise.all([
            // Count only bids (where bid_amount is not null)
            (shouldLoadComments && bidCount === null)
              ? supabase
                  .from('auction_comments')
                  .select('id', { count: 'exact', head: true })
                  .eq('vehicle_id', vehicleData.id)
                  .eq('source_url', effective.listing_url) // CRITICAL: Only comments from this listing (using source_url field)
                  .not('bid_amount', 'is', null)
              : Promise.resolve({ count: bidCount || 0 } as any),
            // Count only non-bid comments (where bid_amount is null or comment_type != 'bid')
            shouldLoadComments
              ? supabase
                  .from('auction_comments')
                  .select('id', { count: 'exact', head: true })
                  .eq('vehicle_id', vehicleData.id)
                  .eq('source_url', effective.listing_url) // CRITICAL: Only comments from this listing (using source_url field)
                  .or('bid_amount.is.null,comment_type.neq.bid')
              : Promise.resolve({ count: 0 } as any),
            shouldLoadComments
              ? supabase
                  .from('auction_comments')
                  .select('posted_at, author_username')
                  .eq('vehicle_id', vehicleData.id)
                  .eq('source_url', effective.listing_url) // CRITICAL: Only comments from this listing (using source_url field)
                  .not('bid_amount', 'is', null)
                  .order('posted_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
              : Promise.resolve({ data: null } as any),
            shouldLoadComments
              ? supabase
                  .from('auction_comments')
                  .select('posted_at')
                  .eq('vehicle_id', vehicleData.id)
                  .eq('source_url', effective.listing_url) // CRITICAL: Only comments from this listing (using source_url field)
                  .or('bid_amount.is.null,comment_type.neq.bid')
                  .order('posted_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
              : Promise.resolve({ data: null } as any),
            shouldLoadComments
              ? supabase
                  .from('auction_comments')
                  .select('author_username')
                  .eq('vehicle_id', vehicleData.id)
                  .eq('source_url', effective.listing_url) // CRITICAL: Only comments from this listing (using source_url field)
                  .eq('is_seller', true)
                  .order('posted_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
              : Promise.resolve({ data: null } as any),
          ]);

          if (bidCount === null) bidCount = typeof (bidCountResult as any)?.count === 'number' ? (bidCountResult as any).count : null;
          commentCount = typeof (commentCountResult as any)?.count === 'number' ? (commentCountResult as any).count : null;
          lastBidAt = (lastBid as any)?.data?.posted_at || null;
          lastCommentAt = (lastComment as any)?.data?.posted_at || null;
          const winnerName = String((lastBid as any)?.data?.author_username || '').trim() || null;
          const sellerUsername = String((lastSeller as any)?.data?.author_username || '').trim() || null;
          (effective as any).winner_name = winnerName;
          (effective as any).seller_username = sellerUsername;
        } catch {
          // ignore telemetry failures
        }

        setAuctionPulse({
          external_listing_id: (effective as any).external_listing_id || null,
          platform: String((effective as any).platform),
          listing_url: String((effective as any).listing_url),
          listing_status: String((effective as any).listing_status || ''),
          end_date: (effective as any).end_date || null,
          current_bid: typeof (effective as any).current_bid === 'number' ? (effective as any).current_bid : null,
          bid_count: bidCount, // Use separated bid count
          watcher_count: typeof (effective as any).watcher_count === 'number' ? (effective as any).watcher_count : null,
          view_count: typeof (effective as any).view_count === 'number' ? (effective as any).view_count : null,
          comment_count: commentCount, // Only non-bid comments
          final_price: typeof (effective as any).final_price === 'number' ? (effective as any).final_price : null,
          sold_at: (effective as any).sold_at || null,
          last_bid_at: lastBidAt,
          last_comment_at: lastCommentAt,
          updated_at: (effective as any).updated_at || null,
          metadata: (effective as any).metadata ?? null,
          winner_name: (effective as any).winner_name ?? null,
          seller_username: (effective as any).seller_username ?? null,
        });

        // Best-effort: if this is a BaT listing and we don't yet have end_date/final_price,
        // trigger a server-side sync once per page load so the header can show a real countdown / sold price.
        try {
          const isBat = String((effective as any).platform || '').toLowerCase() === 'bat';
          const extId = (effective as any).external_listing_id ? String((effective as any).external_listing_id) : null;
          const needsSync =
            isBat &&
            !!extId &&
            (!((effective as any).end_date) || (typeof (effective as any).final_price !== 'number'));

          if (needsSync && ranBatSyncRef.current !== extId) {
            ranBatSyncRef.current = extId;
            supabase.functions
              .invoke('sync-bat-listing', { body: { externalListingId: extId } })
              .then(async () => {
                // Refresh latest listing rows and re-derive pulse.
                const { data } = await supabase
                  .from('vehicle_events')
                  .select('id, source_platform, source_url, event_status, ended_at, current_price, bid_count, watcher_count, view_count, final_price, sold_at, metadata, updated_at')
                  .eq('vehicle_id', vehicleData.id)
                  .order('updated_at', { ascending: false })
                  .limit(10);
                const merged = buildAuctionPulseFromExternalListings(Array.isArray(data) ? data : [], vehicleData.id);
                if (merged) {
                  setAuctionPulse((prev: any) => ({ ...(prev || {}), ...merged }));
                }
              })
              .catch(() => {});
          }
        } catch {
          // non-blocking
        }
      } else {
        setAuctionPulse(null);
      }
    } catch {
      setAuctionPulse(null);
    }

  } catch (error) {
    console.error('Error loading vehicle:', error);
    navigate('/vehicles');
  } finally {
    setLoading(false);
  }
}
