/**
 * Loads and filters vehicle images from multiple sources (RPC cache, DB, origin metadata,
 * external listings, storage fallback). Sets vehicleImages and leadImageUrl state.
 *
 * Extracted from VehicleProfile.tsx to reduce file size.
 * This function has side effects (state setters, supabase calls) but no React hooks.
 */
import {
  normalizeUrl,
  filterIconNoise,
  filterProfileImages,
  isSupabaseHostedImageUrl,
  resolveDbImageUrl,
  isOrganizationLogo,
  isImportedStoragePath,
  isMismatchedVehicleImage,
  scoreMoneyShot,
  getOriginImages,
  isValidForPrimary,
  cleanImageUrl,
} from './imageFilterUtils';

export interface LoadVehicleImagesParams {
  vehicle: any;
  session: any;
  leadImageUrl: string | null;
  supabase: any;
  setVehicleImages: (images: string[]) => void;
  setLeadImageUrl: (url: string) => void;
}

export async function loadVehicleImagesImpl({
  vehicle,
  session,
  leadImageUrl,
  supabase,
  setVehicleImages,
  setLeadImageUrl,
}: LoadVehicleImagesParams): Promise<void> {
  if (!vehicle) return;

  const { images: originImages, declaredCount } = getOriginImages(vehicle);
  let images: string[] = [];

  // Load images from database first
  try {
    const { data: imageRecords, error } = await supabase
      .from('vehicle_images')
      // Keep payload lean to reduce DB load/timeouts; we only need URLs + ordering fields here.
      .select('id, vehicle_id, image_url, thumbnail_url, medium_url, variants, is_primary, is_document, position, created_at, storage_path')
      .eq('vehicle_id', vehicle.id)
      // Legacy rows may have is_document = NULL; treat that as "not a document"
      .not('is_document', 'is', true) // Filter out documents - they belong in a separate section
      // Quarantine/duplicate rows should never appear in standard galleries
      .or('is_duplicate.is.null,is_duplicate.eq.false')
      // Hide AI-detected mismatched/unrelated images (wrong vehicle or not a vehicle photo)
      .not('image_vehicle_match_status', 'in', '("mismatch","unrelated")')
      .order('is_primary', { ascending: false })
        // IMPORTANT: NULL positions should sort LAST (older backfills didn't set position).
        .order('position', { ascending: true, nullsFirst: false })
        // For un-positioned rows, show in chronological insert order (stable, matches source list order better than DESC).
        .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Error loading vehicle images from database:', error);
    } else if (imageRecords && imageRecords.length > 0) {
      const origin = String((vehicle as any)?.profile_origin || '');
      const discoveryUrl = String((vehicle as any)?.discovery_url || '');
      const isClassicScrape = origin === 'url_scraper' && discoveryUrl.includes('classic.com/veh/');
      const isBat = origin === 'bat_import' || discoveryUrl.includes('bringatrailer.com/listing/');

      // NOTE: isMismatchedVehicleImage check REMOVED for DB-sourced images.
      // The vehicle_id FK from the DB query is the source of truth. Images may be stored
      // under a different vehicle's storage directory (e.g. after reassignment/merge) and
      // the URL-path UUID check was incorrectly filtering ALL images for those vehicles.

      const primaryRow = imageRecords.find((r: any) => r?.is_primary === true) || null;
      const primaryCandidate = primaryRow ? (resolveDbImageUrl(primaryRow) || null) : null;
      // Exclude import_queue images and organization logos from primary selection
      const primaryIsImportQueue = primaryRow && isImportedStoragePath(primaryRow?.storage_path);
      const primaryIsOrgLogo = primaryCandidate && isOrganizationLogo(primaryCandidate);
      const primaryOk = primaryCandidate && !primaryIsImportQueue && !primaryIsOrgLogo && filterProfileImages([primaryCandidate], vehicle, { skipMismatchCheck: true }).length > 0;

      // Build fallback pool, excluding import_queue images and organization logos
      const fallbackPool = imageRecords
        .filter((r: any) => {
          // Exclude import_queue images
          if (isImportedStoragePath(r?.storage_path)) return false;
          // Exclude organization/dealer logos
          const url = resolveDbImageUrl(r) || r?.image_url;
          if (url && isOrganizationLogo(url)) return false;
          return true;
        })
        .map((r: any) => resolveDbImageUrl(r))
        .filter(Boolean) as string[];

      // Prioritize Supabase-hosted images (no external API calls needed)
      // Filter originImages to only include Supabase-hosted URLs (exclude external URLs that may be blocked/expired)
      const supabaseHostedOriginImages = originImages.filter((url: string) => isSupabaseHostedImageUrl(url));
      const externalOriginImages = originImages.filter((url: string) => !isSupabaseHostedImageUrl(url));

      // Always prioritize DB images (Supabase-hosted) first, then Supabase-hosted origin images, then external as last resort
      const poolForFiltering = [
        ...fallbackPool, // DB images first (always Supabase-hosted, no API calls)
        ...supabaseHostedOriginImages, // Supabase-hosted origin images (no API calls)
        // External origin images only as last resort (may fail, but better than nothing)
        ...(fallbackPool.length === 0 && supabaseHostedOriginImages.length === 0 ? externalOriginImages : [])
      ];
      const filteredPool = filterProfileImages(poolForFiltering, vehicle, { skipMismatchCheck: true });

      // Score all filtered images and pick the best "money shot" (scoreMoneyShot imported from imageFilterUtils)
      const scoredImages = filteredPool.map((url, idx) => {
        const record = imageRecords.find((r: any) => {
          const recordUrl = resolveDbImageUrl(r) || r?.image_url;
          return recordUrl === url;
        });
        return {
          url,
          score: scoreMoneyShot(url, record),
          position: record?.position ?? idx,
          isPrimary: record?.is_primary ?? false
        };
      });

      // Sort by score (highest first), but prioritize primary if it has a good score
      scoredImages.sort((a, b) => {
        // If one is primary and has decent score, prefer it
        if (a.isPrimary && a.score >= 50 && (!b.isPrimary || b.score < a.score)) return -1;
        if (b.isPrimary && b.score >= 50 && (!a.isPrimary || a.score < b.score)) return 1;
        // Otherwise sort by score
        return b.score - a.score;
      });

      const bestMoneyShot = scoredImages.length > 0 ? scoredImages[0].url : null;
      const firstFiltered = filteredPool.find((u) => isSupabaseHostedImageUrl(u)) || filteredPool[0] || null;

      // Use primary if it's good, otherwise use best money shot, otherwise fallback
      const lead = (primaryOk && primaryCandidate) ? primaryCandidate :
                   (bestMoneyShot) ? bestMoneyShot :
                   firstFiltered;
      if (lead) setLeadImageUrl(lead as any);

      // Auto-set primary if none exists OR if existing primary is filtered out OR if better money shot exists.
      // Only attempt when authenticated; otherwise just render using filtered lead.
      const hasPrimary = !!primaryRow;
      const primaryScore = primaryOk && primaryCandidate ? scoreMoneyShot(primaryCandidate, primaryRow) : 0;
      const bestMoneyShotScore = bestMoneyShot ? scoreMoneyShot(bestMoneyShot, imageRecords.find((r: any) => {
        const recordUrl = resolveDbImageUrl(r) || r?.image_url;
        return recordUrl === bestMoneyShot;
      })) : 0;

      // Heal primary if: missing, filtered out, OR if a significantly better money shot exists
      const shouldHealPrimary = (!hasPrimary && imageRecords[0]) ||
                                (hasPrimary && !primaryOk) ||
                                (hasPrimary && primaryOk && bestMoneyShotScore > primaryScore + 20); // 20 point threshold
      if (shouldHealPrimary && session?.user?.id) {
        // Find the best money shot from available images using scoring (isValidForPrimary imported from imageFilterUtils)
        const scoredDbRows = imageRecords
          .filter((r: any) => isValidForPrimary(r, vehicle))
          .map((r: any) => {
            const url = resolveDbImageUrl(r, true) || r?.image_url;
            return {
              record: r,
              url,
              score: scoreMoneyShot(url, r),
              isSupabase: r?.storage_path || isSupabaseHostedImageUrl(r?.image_url)
            };
          })
          .sort((a, b) => {
            // Prefer Supabase-hosted if scores are close (within 10 points)
            if (Math.abs(a.score - b.score) <= 10) {
              if (a.isSupabase && !b.isSupabase) return -1;
              if (b.isSupabase && !a.isSupabase) return 1;
            }
            return b.score - a.score;
          });

        const bestDbRow = scoredDbRows.length > 0 ? scoredDbRows[0].record : null;

        if (bestDbRow?.id) {
          try {
            // Clear any existing primary first (best-effort)
            await supabase
              .from('vehicle_images')
              .update({ is_primary: false } as any)
              .eq('vehicle_id', vehicle.id)
              .eq('is_primary', true);
            await supabase
              .from('vehicle_images')
              .update({ is_primary: true } as any)
              .eq('id', bestDbRow.id);
          } catch {
            // non-blocking
          }
        }
      }

      // Load all images using public URLs (fast) and de-dupe (storage/variants can create repeats)
      const displayableImageRecords = (imageRecords || []).filter((r: any) => {
        const u = String(r?.image_url || '').toLowerCase();
        const p = String(r?.storage_path || '').toLowerCase();
        // Never show quarantined/foreign import images in a vehicle's gallery.
        // These are not guaranteed to belong to the subject vehicle and have caused cross-contamination.
        if (u.includes('import_queue') || p.includes('import_queue')) return false;
        if (u.includes('organization-logos/') || p.includes('organization-logos/')) return false;
        if (u.includes('organization_logos/') || p.includes('organization_logos/')) return false;
        return true;
      });

      const raw = Array.from(new Set(displayableImageRecords.map((r: any) => normalizeUrl(r?.image_url)).filter(Boolean)));

      // Identify noisy patterns from origin_metadata (logos, icons, small UI elements)
      const originNoiseHashes = new Set<string>();
      originImages.forEach((origUrl: string) => {
        const normalized = normalizeUrl(origUrl).toLowerCase();
        // Check for SVG files, small square images with width/height params, logos
        if (normalized.includes('.svg') ||
            normalized.includes('logo') ||
            normalized.includes('icon') ||
            /width=\d+.*height=\d+/.test(normalized)) {
          // Extract a hash/fingerprint from the URL to match stored images
          // For framerusercontent.com URLs, the hash is in the filename
          const hashMatch = normalized.match(/([a-f0-9]{32,})/i);
          if (hashMatch) {
            originNoiseHashes.add(hashMatch[1]);
          }
          // Also check for small dimension indicators
          const wMatch = normalized.match(/width=(\d+)/i);
          const hMatch = normalized.match(/height=(\d+)/i);
          if (wMatch && hMatch) {
            const w = parseInt(wMatch[1], 10);
            const h = parseInt(hMatch[1], 10);
            // If it's a small or very wide/short image (likely a header/logo), mark as noise
            if (w <= 600 || h <= 200 || (w > h * 3)) {
              originNoiseHashes.add(`${w}x${h}`);
            }
          }
        }
      });

      // Filter stored images that came from noisy origin URLs
      // Check storage paths for hash matches
      const preFiltered = raw.filter((url: string) => {
        // Skip filtering if no noise detected
        if (originNoiseHashes.size === 0) return true;

        // Check if the storage path contains a hash that matches a noisy origin
        const urlLower = url.toLowerCase();
        for (const noiseHash of originNoiseHashes) {
          if (urlLower.includes(noiseHash.toLowerCase())) {
            return false; // Filter out this image
          }
        }
        return true;
      });

      images = filterProfileImages(preFiltered.length > 0 ? preFiltered : raw, vehicle, { skipMismatchCheck: true });

      // If this is a Classic.com scraped vehicle, prefer Supabase-hosted origin_metadata gallery over contaminated imports.
      // Keep any non-imported images (e.g., manual uploads) in front.
      // Only use Supabase-hosted origin images to avoid external API calls
      const classicSupabaseHostedOriginImages = originImages.filter((url: string) => isSupabaseHostedImageUrl(url));
      if (isClassicScrape && classicSupabaseHostedOriginImages.length > 0) {
        const manual = (imageRecords || [])
          .filter((r: any) => r?.image_url && !isImportedStoragePath(r?.storage_path))
          .map((r: any) => normalizeUrl(r?.image_url))
          .filter(Boolean) as string[];

        const merged = Array.from(new Set([...manual, ...classicSupabaseHostedOriginImages]));
        const mergedFiltered = filterProfileImages(merged, vehicle, { skipMismatchCheck: true });

        // If DB images look significantly larger than the source gallery, assume contamination and override display set.
        const dbCount = images.length;
        const sourceCount = declaredCount ?? classicSupabaseHostedOriginImages.length;
        const looksContaminated = dbCount > sourceCount + 10;

        if (looksContaminated && mergedFiltered.length > 0) {
          images = mergedFiltered;
        }
      }

      // For BaT vehicles, prefer Supabase-hosted origin_metadata images (certified source) only when
      // the DB set is small or empty. Do NOT replace a large DB gallery (e.g. 1000 images) with
      // just the listing set (~50) — that was causing "pollution" / missing data.
      const batSupabaseHostedOriginImages = originImages.filter((url: string) => isSupabaseHostedImageUrl(url));
      if (isBat && batSupabaseHostedOriginImages.length > 0) {
        // Get user-uploaded images (those with user_id and not from import_queue)
        const userUploaded = (imageRecords || [])
          .filter((r: any) => {
            return r?.user_id && !isImportedStoragePath(r?.storage_path);
          })
          .map((r: any) => resolveDbImageUrl(r))
          .filter(Boolean) as string[];

        const combined = Array.from(new Set([...batSupabaseHostedOriginImages, ...userUploaded]));
        const batFiltered = filterProfileImages(combined, vehicle, { skipMismatchCheck: true });

        // Only use the smaller BaT subset when we wouldn't be throwing away a much larger gallery.
        // If DB already has many more images than the listing set, keep the full DB set.
        const dbCount = images.length;
        const batCount = batFiltered.length;
        const keepFullGallery = dbCount > 0 && dbCount > batCount * 1.5;

        if (batFiltered.length > 0 && !keepFullGallery) {
          images = batFiltered;
          const originLead = batFiltered.find((u) =>
            batSupabaseHostedOriginImages.some(orig => normalizeUrl(orig) === normalizeUrl(u))
          ) || batFiltered.find((u) => isSupabaseHostedImageUrl(u)) || batFiltered[0] || null;
          if (originLead) setLeadImageUrl(originLead);
        }
      }

      // Fallback: If all DB images were filtered out (e.g., all were import_queue), try URLs from vehicle_events for ALL platforms
      if (images.length === 0) {
        try {
          const { data: externalListing } = await supabase
            .from('vehicle_events')
            .select('metadata, source_url, source_platform')
            .eq('vehicle_id', vehicle.id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Guard: only use event images if the event's source_url matches this vehicle's
          // known URLs. Cross-linked events (677 found in audit) cause wrong images to appear.
          const eventSourceUrl = externalListing?.source_url || '';
          const vehicleUrls = [vehicle.bat_auction_url, vehicle.discovery_url, vehicle.listing_url, vehicle.rennlist_url].filter(Boolean).map((u: string) => u.toLowerCase());
          const eventBelongsToVehicle = !eventSourceUrl || vehicleUrls.length === 0 || vehicleUrls.some((u: string) => u === eventSourceUrl.toLowerCase());

          if (externalListing?.metadata && eventBelongsToVehicle) {
            const metadata = externalListing.metadata as any;
            const platform = externalListing.source_platform || 'unknown';
            const metadataImages = metadata.images || metadata.image_urls || [];
            if (Array.isArray(metadataImages) && metadataImages.length > 0) {
              // cleanImageUrl imported from imageFilterUtils
              const cleaned = metadataImages
                .map(cleanImageUrl)
                .filter((url: string) => {
                  const s = url.toLowerCase();
                  // Filter out flags and banners
                  if (s.includes('flag') || s.includes('banner')) return false;
                  // Filter out UI icons (social, navigation) but NOT business logos
                  if (s.includes('icon') && (s.includes('social-') || s.includes('nav-') || s.includes('/assets/'))) return false;
                  // Filter out generic site chrome logos, but preserve business logos
                  if (s.includes('logo') && (s.includes('/assets/') || s.includes('/themes/') || s.includes('/header'))) return false;
                  // Filter out SVGs that are UI elements
                  if (s.endsWith('.svg') && (s.includes('social-') || s.includes('/assets/') || s.includes('/icons/'))) return false;
                  // Platform-specific: only include actual vehicle images
                  if (platform === 'bat') {
                    return s.includes('bringatrailer.com/wp-content/uploads/');
                  } else if (platform === 'carsandbids') {
                    // Cars & Bids: filter out video thumbnails, UI elements, and small thumbnails
                    if (!s.includes('media.carsandbids.com')) return false;
                    // Exclude video thumbnails/freeze frames
                    if (s.includes('/video') || s.includes('video') || s.includes('thumbnail') || s.includes('thumb')) return false;
                    // Exclude UI elements
                    if (s.includes('/icon') || s.includes('/logo') || s.includes('/button') || s.includes('/ui/') || s.includes('/assets/') || s.includes('/static/')) return false;
                    // Exclude small thumbnails
                    if (s.match(/-\d+x\d+\.(jpg|jpeg|png|webp)$/) || s.includes('-thumb') || s.includes('-small')) return false;
                    return true;
                  } else if (platform === 'mecum') {
                    return s.includes('images.mecum.com');
                  } else if (platform === 'barrettjackson') {
                    return s.includes('barrett-jackson.com') || s.includes('barrettjackson.com');
                  }
                  // Default: accept any valid image URL
                  return s.startsWith('http') && (s.includes('.jpg') || s.includes('.jpeg') || s.includes('.png') || s.includes('.webp'));
                });

              if (cleaned.length > 0) {
                const filtered = filterProfileImages(cleaned, vehicle);
                if (filtered.length > 0) {
                  images = filtered;
                  const lead = filtered.find((u) => isSupabaseHostedImageUrl(u)) || filtered[0] || null;
                  if (lead) setLeadImageUrl(lead);
                }
              }
            }
          }
        } catch (err) {
          console.warn('Error loading URLs from vehicle_events (fallback):', err);
        }
      }

      // Final fallback: If still no images, use only Supabase-hosted originImages (skip external URLs)
      const supabaseOriginImages = originImages.filter((url: string) => isSupabaseHostedImageUrl(url));
      if (images.length === 0 && supabaseOriginImages.length > 0) {
        images = filterProfileImages(supabaseOriginImages, vehicle);
        // Also set lead image from originImages if current lead is invalid or missing
        if (!lead || String(lead || '').toLowerCase().includes('import_queue')) {
          const originLead = images.find((u) => isSupabaseHostedImageUrl(u)) || images[0] || null;
          if (originLead) setLeadImageUrl(originLead);
        }
      }

      setVehicleImages(images);

      // If we filtered out a noisy lead image, ensure we still have a hero.
      // Also check that lead doesn't contain import_queue in the URL path
      if (images.length > 0) {
        const leadStr = String(lead || '').toLowerCase();
        const leadIsImportQueue = leadStr.includes('import_queue');
        const leadStillOk = lead && !leadIsImportQueue && filterProfileImages([String(lead)], vehicle, { skipMismatchCheck: true }).length > 0;
        if (!leadStillOk) setLeadImageUrl(images[0]);
      }

      // Signed URL generation disabled due to storage configuration issues
      // Would generate 400 errors: createSignedUrl calls failing
      // Using direct public URLs instead which work fine
    } else {
      // No DB rows: try Supabase-hosted origin_metadata images first (skip external URLs that require API calls)
      try {
        const supabaseOriginImages = originImages.filter((url: string) => isSupabaseHostedImageUrl(url));
        if (supabaseOriginImages.length > 0) {
          images = supabaseOriginImages;
          setVehicleImages(images);
          if (!leadImageUrl && images[0]) {
            setLeadImageUrl(images[0]);
          }
        }
      } catch {
        // ignore
      }

      // If still no images, try BaT URLs from vehicle_events metadata
      if (images.length === 0) {
        try {
          const { data: externalListing } = await supabase
            .from('vehicle_events')
            .select('metadata, source_url')
            .eq('vehicle_id', vehicle.id)
            .eq('source_platform', 'bat')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Guard: verify event belongs to this vehicle (cross-linked events cause wrong images)
          const batEventUrl = externalListing?.source_url || '';
          const vehicleBatUrls = [vehicle.bat_auction_url, vehicle.discovery_url].filter(Boolean).map((u: string) => u.toLowerCase());
          const batEventOwned = !batEventUrl || vehicleBatUrls.length === 0 || vehicleBatUrls.some((u: string) => u === batEventUrl.toLowerCase());

          if (externalListing?.metadata && batEventOwned) {
            const metadata = externalListing.metadata as any;
            // Check for image URLs in metadata (from extract-premium-auction)
            const metadataImages = metadata.images || metadata.image_urls || [];
            if (Array.isArray(metadataImages) && metadataImages.length > 0) {
              // cleanImageUrl imported from imageFilterUtils (handles BaT URL cleaning)
              const cleaned = metadataImages
                .map(cleanImageUrl)
                .filter((url: string) => {
                  const s = url.toLowerCase();
                  // Filter out flags and banners (but preserve business/auction logos if needed)
                  if (s.includes('flag') || s.includes('banner')) return false;
                  // Filter out UI icons (social, navigation) but NOT business logos
                  if (s.includes('icon') && (s.includes('social-') || s.includes('nav-') || s.includes('/assets/'))) return false;
                  // Filter out generic site chrome logos, but preserve business logos
                  if (s.includes('logo') && (s.includes('/assets/') || s.includes('/themes/') || s.includes('/header'))) return false;
                  // Filter out SVGs that are UI elements (but business logos are handled separately)
                  if (s.endsWith('.svg') && (s.includes('social-') || s.includes('/assets/') || s.includes('/icons/'))) return false;
                  // Only include actual vehicle images from BaT uploads
                  return s.includes('bringatrailer.com/wp-content/uploads/');
                });

              if (cleaned.length > 0) {
                const filtered = filterProfileImages(cleaned, vehicle);
                if (filtered.length > 0) {
                  images = filtered;
                  setVehicleImages(images);
                  if (!leadImageUrl && images[0]) {
                    setLeadImageUrl(images[0]);
                  }
                  return; // Skip storage fallback
                }
              }
            }
          }
        } catch (err) {
          console.warn('Error loading BaT URLs from vehicle_events:', err);
        }
      }

      // If still no images, attempt storage fallback (canonical + legacy) to avoid empty hero/gallery
      if (images.length === 0) {
        try {
          const bucketCanonical = supabase.storage.from('vehicle-data');
          const bucketLegacy = supabase.storage.from('vehicle-images');
          const gathered: string[] = [];

          const listPath = async (bucketRef: ReturnType<typeof supabase.storage.from>, path: string) => {
            const { data: files, error: listErr } = await bucketRef.list(path, { limit: 1000 });
            if (listErr || !files) return;
            for (const f of files) {
              if (!f?.name) continue;
              const name = String(f.name);
              const lower = name.toLowerCase();

              // Skip directories and non-image files
              if (!/\.(jpg|jpeg|png|webp|gif)$/.test(lower)) continue;

              const full = path ? `${path}/${name}` : name;

              // Do not pollute hero/gallery with ownership verification documents
              if (full.includes('/ownership/')) continue;

                // Use public URLs for both buckets to avoid 400 errors
                const { data: pub } = bucketRef.getPublicUrl(full);
                if (pub?.publicUrl) gathered.push(pub.publicUrl);
            }
          };

          // Canonical path
          await listPath(bucketCanonical, `vehicles/${vehicle.id}`);
          const { data: eventDirsB } = await bucketCanonical.list(`vehicles/${vehicle.id}/events`, { limit: 1000 });
          if (eventDirsB && eventDirsB.length > 0) {
            for (const dir of eventDirsB) {
              if (dir.name) await listPath(bucketCanonical, `vehicles/${vehicle.id}/events/${dir.name}`);
            }
          }

          // Legacy path (read-only)
          await listPath(bucketLegacy, `${vehicle.id}`);
          const { data: eventDirsA } = await bucketLegacy.list(`${vehicle.id}/events`, { limit: 1000 });
          if (eventDirsA && eventDirsA.length > 0) {
            for (const dir of eventDirsA) {
              if (dir.name) await listPath(bucketLegacy, `${vehicle.id}/events/${dir.name}`);
            }
          }

          images = filterIconNoise(Array.from(new Set(gathered)));
          if (images.length > 0 && !leadImageUrl) setLeadImageUrl(images[0]);
        } catch (e) {
          console.warn('Storage fallback for hero/gallery failed:', e);
        }
      }
    }
  } catch (error) {
    console.error('Error querying vehicle images:', error);
  }

  // Also include primary image if available (support both legacy camelCase and canonical snake_case fields).
  const primaryUrl =
    (vehicle as any)?.primary_image_url ||
    (vehicle as any)?.primaryImageUrl ||
    (vehicle as any)?.image_url ||
    null;
  const primaryUrlLower = typeof primaryUrl === 'string' ? primaryUrl.toLowerCase() : '';
  const primaryLooksWrong =
    primaryUrlLower.includes('import_queue') ||
    primaryUrlLower.includes('organization-logos/') ||
    primaryUrlLower.includes('organization_logos/');
  const primaryOk = primaryUrl && typeof primaryUrl === 'string' && !primaryLooksWrong && filterProfileImages([primaryUrl], vehicle, { skipMismatchCheck: true }).length > 0;
  if (primaryOk && typeof primaryUrl === 'string' && !images.includes(primaryUrl)) {
    images = [primaryUrl, ...images];
    // Fallback for lead image - ensure it's set from primary
    if (!leadImageUrl) setLeadImageUrl(primaryUrl);
  }

  // Ensure leadImageUrl is always set if we have images but no lead yet
  if (!leadImageUrl && images.length > 0) {
    setLeadImageUrl(images[0]);
  }

  setVehicleImages(images);
}
