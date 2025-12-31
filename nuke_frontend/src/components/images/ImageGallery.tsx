import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { ImageUploadService } from '../../services/imageUploadService';
import { globalUploadStatusService } from '../../services/globalUploadStatusService';
import { uploadQueueService } from '../../services/uploadQueueService';
import { sortImagesByPriority } from '../../services/imageDisplayPriority';
import ImageLightbox from '../image/ImageLightbox';
import { SensitiveImageOverlay } from './SensitiveImageOverlay';
import { ImageSetService } from '../../services/imageSetService';
import { OnboardingSlideshow } from '../onboarding/OnboardingSlideshow';

interface ImageGalleryProps {
  vehicleId: string;
  onImagesUpdated?: () => void;
  showUpload?: boolean;
  /**
   * Optional fallback URLs (e.g., scraped listing images) to prevent "empty" profiles
   * when `vehicle_images` has not been backfilled yet.
   */
  fallbackImageUrls?: string[];
  fallbackLabel?: string;
  /**
   * Optional source URL for fallback images (e.g. BaT listing URL) so imported rows
   * preserve provenance.
   */
  fallbackSourceUrl?: string;
  // NEW: Image Set features (optional - defaults maintain existing behavior)
  selectMode?: boolean;
  selectedImages?: Set<string>;
  onSelectionChange?: (selected: Set<string>) => void;
  showPriority?: boolean;
  showSetCount?: boolean;
  filteredSetId?: string | null;
  onAddToSetRequested?: (imageIds: string[]) => void;
}

interface ImageTag {
  id: string;
  x: number;
  y: number;
  text: string;
  type: string;
  isEditing?: boolean;
}

const TAG_TYPES = [
  { value: 'part', label: 'Part' },
  { value: 'damage', label: 'Damage' },
  { value: 'modification', label: 'Modification' },
  { value: 'tool', label: 'Tool' }
];

// Helper function to get optimal image URL based on variants
const getOptimalImageUrl = (image: any, size: 'thumbnail' | 'medium' | 'large' | 'full' = 'medium'): string => {
  // For 'full', prioritize variants.full if it exists (true original), otherwise use image_url
  if (size === 'full') {
    // Check if variants.full exists (this is the true original uploaded)
    if (image.variants && typeof image.variants === 'object' && image.variants.full) {
      return image.variants.full;
    }
    // If image_url contains variant paths, try to construct original
    if (image.image_url) {
      const url = image.image_url;
      // Check if URL is a variant path and try to construct original
      if (url.includes('/images/large/') || url.includes('/images/medium/') || url.includes('/images/thumbnail/')) {
        // Replace variant path with base images path to get original
        const originalUrl = url
          .replace('/images/large/', '/images/')
          .replace('/images/medium/', '/images/')
          .replace('/images/thumbnail/', '/images/');
        return originalUrl;
      }
      // If large_url exists and doesn't contain variant paths, it might be the original
      if (image.large_url && image.large_url !== image.image_url) {
        if (!image.large_url.includes('/large/') && !image.large_url.includes('/medium/') && !image.large_url.includes('/thumbnail/')) {
          return image.large_url;
        }
      }
    }
    // Fallback to image_url
    return image.image_url || '';
  }
  
  // First check if variants JSONB exists and has the requested size
  if (image.variants && typeof image.variants === 'object') {
    const variant = image.variants[size];
    if (variant) return variant;
    
    // Fallback order: try other sizes in order of preference
    if (size === 'thumbnail') {
      return image.variants.thumbnail || image.variants.medium || image.thumbnail_url || image.image_url;
    } else if (size === 'medium') {
      return image.variants.medium || image.variants.large || image.variants.thumbnail || image.medium_url || image.image_url;
    } else if (size === 'large') {
      return image.variants.large || image.variants.full || image.variants.medium || image.large_url || image.image_url;
    }
  }
  
  // Fallback to column-based URLs
  if (size === 'thumbnail') return image.thumbnail_url || image.image_url;
  if (size === 'medium') return image.medium_url || image.image_url;
  if (size === 'large') return image.large_url || image.image_url;
  return image.image_url;
};

const getImportedSourceDomain = (image: any): string | null => {
  try {
    const src = String(image?.exif_data?.source_url || image?.exif_data?.discovery_url || '').trim();
    if (!src || !src.startsWith('http')) return null;
    const u = new URL(src);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

// Detect image source from storage_path or other metadata
const getImageSource = (image: any): { type: string; label: string; color: string; logoUrl?: string } => {
  const storagePath = String(image?.storage_path || image?.image_url || '').toLowerCase();
  const imageUrl = String(image?.image_url || '').toLowerCase();
  const source = image?.source;
  
  // Check explicit source field first
  if (source === 'bat_import' || storagePath.includes('bat_import') || imageUrl.includes('bringatrailer.com')) {
    return { 
      type: 'bat', 
      label: 'BaT', 
      color: '#ef4444',
      logoUrl: 'https://bringatrailer.com/wp-content/themes/flavor/bat/images/bat-icon.png'
    };
  }
  if (source === 'organization_import' || storagePath.includes('organization_import') || storagePath.includes('collective')) {
    return { 
      type: 'org', 
      label: 'Dealer', 
      color: '#3b82f6',
      logoUrl: undefined // Will be set from organization data
    };
  }
  if (source === 'external_import' || storagePath.includes('external_import')) {
    return { type: 'external', label: 'External', color: '#8b5cf6' };
  }
  if (storagePath.includes('import_queue')) {
    return { type: 'queue', label: 'Queue', color: '#f59e0b' };
  }
  if (image?.is_external || image?.source === 'external_import') {
    return { type: 'external', label: 'External', color: '#8b5cf6' };
  }
  
  // Check if URL is from a known CDN
  if (imageUrl.includes('cdn.dealeraccelerate.com')) {
    return { 
      type: 'org', 
      label: 'Dealer', 
      color: '#3b82f6',
      logoUrl: 'https://www.collectiveauto.com/assets/collective/logo-83823e1f57b2700658375bf3477ed1c2.svg'
    };
  }
  
  // Default: user upload
  return { type: 'user', label: 'User', color: '#10b981' };
};

const parseBatUploadMonth = (url: string): string | null => {
  try {
    const m = url.match(/\/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
    if (!m?.[1] || !m?.[2]) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || y < 1990 || y > 2100 || mo < 1 || mo > 12) return null;
    const d = new Date(Date.UTC(y, mo - 1, 1, 0, 0, 0));
    return d.toISOString();
  } catch {
    return null;
  }
};

const getEffectiveImageDate = (image: any, auctionStartDate: string | null = null): { iso: string | null; label: string; isApproximate: boolean } => {
  const createdAt = typeof image?.created_at === 'string' ? image.created_at : null;
  const takenAt = typeof image?.taken_at === 'string' ? image.taken_at : null;
  const exif = image?.exif_data || {};
  const isImported = image?.source === 'external_import' || image?.source === 'bat_import' || image?.source === 'organization_import' || image?.is_external;

  const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
  const takenMs = takenAt ? new Date(takenAt).getTime() : NaN;
  const takenLooksSynthetic = Number.isFinite(createdMs) && Number.isFinite(takenMs) && Math.abs(createdMs - takenMs) < 60_000;

  if (takenAt && !isImported) return { iso: takenAt, label: '', isApproximate: false };

  if (isImported) {
    // For BaT images, use auction start date (day vehicle was listed) as the base date
    // All listing photos are from the auction start date (approximately)
    if (auctionStartDate && (image?.source === 'bat_import' || image?.source === 'external_import')) {
      return { iso: auctionStartDate, label: '', isApproximate: true };
    }
    
    const auctionStart = exif.auction_start_date || exif.listed_date || exif.start_date;
    const auctionEnd = exif.auction_end_date || exif.end_date;
    if (auctionStart) return { iso: String(auctionStart), label: ' (Auction)', isApproximate: true };
    if (auctionEnd) {
      // If we only have end date, approximate start as end - 7 days
      const end = new Date(auctionEnd);
      const start = new Date(end);
      start.setDate(start.getDate() - 7);
      return { iso: start.toISOString().split('T')[0], label: ' (Auction)', isApproximate: true };
    }

    const url = String(image?.image_url || image?.variants?.full || image?.variants?.large || '').trim();
    if (url.includes('bringatrailer.com/wp-content/uploads/')) {
      const derived = parseBatUploadMonth(url);
      if (derived) return { iso: derived, label: ' (BaT)', isApproximate: true };
    }

    if (takenAt && !takenLooksSynthetic) return { iso: takenAt, label: '', isApproximate: false };
    if (createdAt) return { iso: createdAt, label: ' (Uploaded)', isApproximate: false };
    return { iso: null, label: '', isApproximate: false };
  }

  if (takenAt) return { iso: takenAt, label: '', isApproximate: false };
  return { iso: createdAt, label: '', isApproximate: false };
};

const ImageGallery = ({ 
  vehicleId, 
  onImagesUpdated, 
  showUpload = true,
  fallbackImageUrls = [],
  fallbackLabel = 'Listing images',
  fallbackSourceUrl,
  // NEW: Optional image set props
  selectMode = false,
  selectedImages,
  onSelectionChange,
  showPriority = false,
  showSetCount = false,
  filteredSetId = null,
  onAddToSetRequested
}: ImageGalleryProps) => {
  const [allImages, setAllImages] = useState<any[]>([]);
  const [displayedImages, setDisplayedImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'masonry' | 'list'>('grid');
  // Default to newest-first to keep ordering stable across vehicles while AI sorting ramps up.
  const [sortBy, setSortBy] = useState<'quality' | 'date_desc' | 'date_asc'>('date_desc');
  const [showFilters, setShowFilters] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [imagesPerPage] = useState(25);
  // New sorting/grouping states
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [groupBySource, setGroupBySource] = useState(false);
  const [chronologicalMode, setChronologicalMode] = useState<'off' | 'asc' | 'desc'>('off'); // off, ascending, descending
  const [imagesPerRow, setImagesPerRow] = useState(3); // 1-16
  const [preserveAspectRatio, setPreserveAspectRatio] = useState(false); // Original image ratio
  const [auctionStartDate, setAuctionStartDate] = useState<string | null>(null); // For date calculations
  const [autoLoad, setAutoLoad] = useState(false);
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<{total: number, completed: number, uploading: boolean}>({total: 0, completed: 0, uploading: false});
  const [queueStats, setQueueStats] = useState<{pending: number, failed: number} | null>(null);
  const [imageCommentCounts, setImageCommentCounts] = useState<Record<string, number>>({});
  const [imageUploaderNames, setImageUploaderNames] = useState<Record<string, string>>({});
  const [imageTagTextsById, setImageTagTextsById] = useState<Record<string, string[]>>({});
  const [imageViewCounts, setImageViewCounts] = useState<Record<string, number>>({});
  const [uploaderOrgNames, setUploaderOrgNames] = useState<Record<string, string>>({});
  const [imageAttributions, setImageAttributions] = useState<Record<string, any>>({});
  const [showDropZone, setShowDropZone] = useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [importingFallback, setImportingFallback] = useState(false);
  // NOTE: Must be declared before any hooks/callbacks reference it (avoids TDZ crashes in production builds).
  const [session, setSession] = useState<any>(null);

  // Prevent "polluted" galleries when navigating between vehicles: clear stale images immediately,
  // then the fetch effect for the new `vehicleId` will repopulate.
  useEffect(() => {
    setAllImages([]);
    setDisplayedImages([]);
    setShowImages(false);
    setUsingFallback(false);
    setError(null);
    setLoading(true);
  }, [vehicleId]);

  // Vehicle meta (used to suppress "BaT homepage noise" images that were mistakenly attached to some vehicles)
  const [vehicleMeta, setVehicleMeta] = useState<any | null>(null);
  useEffect(() => {
    const loadImages = async () => {
      setLoading(true);
      try {
        // Load images from database
        const { data: images, error } = await supabase
          .from('vehicle_images')
          .select('*')
          .eq('vehicle_id', vehicleId)
          // Quarantine/duplicate rows should never appear in standard galleries
          .or('is_duplicate.is.null,is_duplicate.eq.false')
          .order('position', { ascending: true })
          .order('created_at', { ascending: true });

        if (error) throw error;
        setAllImages(images || []);
        setVehicleMeta(vehicleMeta || null);
      } catch {
        setVehicleMeta(null);
      }
    };
    loadImages();
  }, [vehicleId]);

  // Default BaT-only view for BaT-origin vehicles, with a user-toggle to show all sources
  const isBatVehicle = useMemo(() => {
    const origin = String(vehicleMeta?.profile_origin || '').toLowerCase();
    const discovery = String(vehicleMeta?.discovery_url || '').toLowerCase();
    return origin === 'bat_import' || discovery.includes('bringatrailer.com/listing/');
  }, [vehicleMeta]);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'bat' | 'user' | 'org' | 'external' | 'queue'>('all');
  useEffect(() => {
    // When we navigate to a BaT vehicle, default to BaT images only to avoid UI pollution.
    setSourceFilter(isBatVehicle ? 'bat' : 'all');
  }, [isBatVehicle]);
  const applySourceFilter = useCallback((rows: any[]) => {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    if (sourceFilter === 'all') return rows;
    return rows.filter((img: any) => getImageSource(img).type === sourceFilter);
  }, [sourceFilter]);

  // Load auction start date for BaT vehicles (for date calculations)
  useEffect(() => {
    (async () => {
      try {
        if (!vehicleId) { setAuctionStartDate(null); return; }
        // Check external_listings for auction start date
        const { data: listing } = await supabase
          .from('external_listings')
          .select('start_date, end_date')
          .eq('vehicle_id', vehicleId)
          .eq('platform', 'bat')
          .maybeSingle();
        
        if (listing?.start_date) {
          setAuctionStartDate(listing.start_date);
        } else if (listing?.end_date) {
          // Calculate start date as end_date - 7 days (typical BaT auction duration)
          const endDate = new Date(listing.end_date);
          const startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - 7);
          setAuctionStartDate(startDate.toISOString().split('T')[0]);
        } else {
          setAuctionStartDate(null);
        }
      } catch {
        setAuctionStartDate(null);
      }
    })();
  }, [vehicleId]);

  const buildBatImageNeedle = (v: any): string | null => {
    try {
      const discoveryUrl = String(v?.discovery_url || '');
      const origin = String(v?.profile_origin || '');
      const isBat = origin === 'bat_import' || discoveryUrl.includes('bringatrailer.com/listing/');
      if (!isBat) return null;
      const year = v?.year ? String(v.year) : '';
      const makeRaw = String(v?.make || '').trim().toLowerCase();
      const modelRaw = String(v?.model || '').trim().toLowerCase();
      if (!year || !makeRaw || !modelRaw) return null;
      const makeSlug = makeRaw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const modelSlug = modelRaw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!makeSlug || !modelSlug) return null;
      return `${year}_${makeSlug}_${modelSlug}`;
    } catch {
      return null;
    }
  };

  // Helper to detect icon/logo images
  const isIconOrLogo = (url: string): boolean => {
    const s = url.toLowerCase();
    // Filter SVGs that are UI elements, but preserve business/auction logos
    if (s.includes('.svg')) {
      // Allow business/auction/dealer logos
      if (s.includes('/businesses/') || s.includes('/organizations/') || 
          s.includes('/dealers/') || s.includes('/auctions/') ||
          s.includes('logo_url') || s.includes('business_logo')) {
        return false; // Keep these
      }
      // Filter UI chrome SVGs
      if (s.includes('social-') || s.includes('nav-') || s.includes('icon-') ||
          s.includes('/assets/') || s.includes('/icons/') || s.includes('/themes/')) {
        return true; // Filter these
      }
      return true; // Default: filter other SVGs
    }
    // Filter generic logo/icon paths that are site chrome, but preserve business logos
    if (s.includes('logo') || s.includes('icon')) {
      // Allow business/auction/dealer logos
      if (s.includes('/businesses/') || s.includes('/organizations/') || 
          s.includes('/dealers/') || s.includes('/auctions/') ||
          s.includes('logo_url') || s.includes('business_logo')) {
        return false; // Keep these
      }
      // Filter site chrome (navigation, header, footer, social icons)
      if (s.includes('/assets/') || s.includes('/themes/') || 
          s.includes('/header') || s.includes('/footer') || s.includes('/nav') ||
          s.includes('social-') || s.includes('nav-')) {
        return true; // Filter these
      }
      return true; // Default: filter other logo/icon paths
    }
    if (s.includes('badge') || s.includes('avatar')) return true;
    // Aggressively filter out ALL flag images (American flag, banners, etc.)
    if (/(?:^|\/|\-|_)(flag|flags|banner)(?:$|\/|\-|_|\.)/i.test(s) ||
        s.includes('stars-and-stripes') ||
        s.includes('stars_and_stripes') ||
        s.includes('american-flag') ||
        s.includes('american_flag') ||
        s.includes('us-flag') ||
        s.includes('us_flag') ||
        s.includes('usa-flag') ||
        s.includes('usa_flag') ||
        s.includes('flag-usa') ||
        s.includes('flag_usa') ||
        s.includes('united-states-flag') ||
        s.includes('united_states_flag') ||
        s.includes('old-glory') ||
        s.includes('old_glory') ||
        /(?:^|\/|\-|_)(flag|flags)(?:.*usa|.*us|.*american)/i.test(s) ||
        /(?:usa|us|american).*(?:flag|flags)/i.test(s)) {
      return true;
    }
    if (s.includes('framerusercontent.com')) {
      // Check for small square images or images with width/height params indicating UI elements
      if (/width=\d+.*height=\d+/.test(s)) {
        const wMatch = s.match(/width=(\d+)/i);
        const hMatch = s.match(/height=(\d+)/i);
        if (wMatch && hMatch) {
          const w = parseInt(wMatch[1], 10);
          const h = parseInt(hMatch[1], 10);
          // Filter small images or very wide banners (likely headers/logos)
          if (w <= 600 || h <= 200 || (w > h * 3)) return true;
        }
      }
    }
    return false;
  };

  const filterBatNoiseRows = (rows: any[], meta: any = vehicleMeta): any[] => {
    if (!rows || rows.length === 0) return rows;
    
    // Filter out icon/logo images first
    const withoutIcons = (rows || []).filter((img: any) => {
      const url = String(img?.image_url || '');
      return url && !isIconOrLogo(url);
    });
    
    // Never filter out non-BaT URLs (user uploads, Supabase storage, etc.)
    const nonBat = withoutIcons.filter((img: any) => {
      const url = String(img?.image_url || '');
      return url && !url.includes('bringatrailer.com/wp-content/uploads/');
    });
    
    const batRows = withoutIcons.filter((img: any) => {
      const url = String(img?.image_url || '');
      return url && url.includes('bringatrailer.com/wp-content/uploads/');
    });
    
    if (batRows.length === 0) return withoutIcons.length > 0 ? withoutIcons : rows;
    
    // First: Filter known BaT page noise
    const isKnownNoise = (url: string) => {
      const f = url.toLowerCase();
      return (
        f.includes('qotw') || f.includes('winner-template') || f.includes('weekly-weird') ||
        f.includes('mile-marker') || f.includes('podcast') || f.includes('merch') ||
        f.includes('dec-merch') || f.includes('podcast-graphic') ||
        f.includes('site-post-') || f.includes('thumbnail-template') ||
        f.includes('screenshot-') || f.includes('countries/') ||
        f.includes('themes/') || f.includes('assets/img/') ||
        /\/web-\d{3,}-/i.test(f) ||
        // Aggressively filter out ALL flag images (American flag, banners, etc.)
        /(?:^|\/|\-|_)(flag|flags|banner)(?:$|\/|\-|_|\.)/i.test(f) ||
        f.includes('stars-and-stripes') ||
        f.includes('stars_and_stripes') ||
        f.includes('american-flag') ||
        f.includes('american_flag') ||
        f.includes('us-flag') ||
        f.includes('us_flag') ||
        f.includes('usa-flag') ||
        f.includes('usa_flag') ||
        f.includes('flag-usa') ||
        f.includes('flag_usa') ||
        f.includes('united-states-flag') ||
        f.includes('united_states_flag') ||
        f.includes('old-glory') ||
        f.includes('old_glory') ||
        /(?:^|\/|\-|_)(flag|flags)(?:.*usa|.*us|.*american)/i.test(f) ||
        /(?:usa|us|american).*(?:flag|flags)/i.test(f)
      );
    };
    
    let filtered = batRows.filter((img: any) => {
      const url = String(img?.image_url || '');
      const isNoise = isKnownNoise(url);
      return !isNoise;
    });
    
    // Second: Try pattern matching by vehicle (year_make_model)
    const needle = buildBatImageNeedle(meta);
    if (needle && filtered.length > 0) {
      const patternMatched = filtered.filter((img: any) => {
        const url = String(img?.image_url || '').toLowerCase();
        return url.includes(needle.toLowerCase());
      });
      // Only use pattern matching if we get at least 3 matches
      if (patternMatched.length >= 3) {
        filtered = patternMatched;
      }
    }
    
    // Third: Date bucket clustering
    if (filtered.length > 0) {
      const bucketKey = (url: string) => {
        const m = url.match(/\/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
        return m ? `${m[1]}/${m[2]}` : '';
      };
      const bucketCounts = new Map<string, number>();
      for (const img of filtered) {
        const url = String(img?.image_url || '');
        const k = bucketKey(url);
        if (k) bucketCounts.set(k, (bucketCounts.get(k) || 0) + 1);
      }
      let bestBucket = '';
      let bestCount = 0;
      for (const [k, c] of bucketCounts.entries()) {
        if (c > bestCount) {
          bestBucket = k;
          bestCount = c;
        }
      }
      // If we have a clear dominant bucket (>=8 images and >=50% of total), use it
      if (bestBucket && bestCount >= 8 && bestCount >= Math.floor(filtered.length * 0.5)) {
        filtered = filtered.filter((img: any) => {
          const url = String(img?.image_url || '');
          return bucketKey(url) === bestBucket;
        });
      }
    }
    
    // Combine filtered BaT rows with non-BaT rows
    const result = [...nonBat, ...filtered];
    
    // Safety: if we filtered everything out, keep at least the non-BaT rows
    return result.length > 0 ? result : (nonBat.length > 0 ? nonBat : rows);
  };

  // When vehicle meta arrives, re-filter any already-loaded images so the UI doesn't briefly show
  // unrelated BaT homepage / other-lot images for bat_import vehicles.
  useEffect(() => {
    if (!vehicleMeta) return;
    if (!allImages || allImages.length === 0) return;
    const nextAll = filterBatNoiseRows(allImages);
    if (nextAll.length === allImages.length) return;
    setAllImages(nextAll);
    setDisplayedImages(sortRows(applySourceFilter(nextAll), sortBy)); // NO LIMIT - show filtered images
    // Do not toggle usingFallback here; we only filter the current view.
  }, [vehicleMeta, applySourceFilter]); // intentionally not depending on allImages to avoid loops

  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const normalizeFallbackUrls = (urls: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const u of urls || []) {
      const s = typeof u === 'string' ? u.trim() : '';
      if (!s) continue;
      if (!s.startsWith('http')) continue;
      // drop common low-res thumbs
      if (s.includes('94x63') || s.includes('thumbnail')) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out; // NO LIMIT - show ALL images from source
  };

  const importFallbackImages = useCallback(async () => {
    if (!session?.user?.id) return;
    if (!vehicleId) return;
    if (importingFallback) return;

    const fallback = normalizeFallbackUrls(fallbackImageUrls);
    if (fallback.length === 0) return;

    setImportingFallback(true);
    try {
      // Avoid duplicates: fetch existing urls for this vehicle
      const { data: existingRows, error: existingErr } = await supabase
        .from('vehicle_images')
        .select('image_url')
        .eq('vehicle_id', vehicleId)
        .not('is_document', 'is', true)
        .limit(5000);
      if (existingErr) throw existingErr;

      const existing = new Set<string>((existingRows || []).map((r: any) => String(r?.image_url || '')).filter(Boolean));
      const toInsert = fallback.filter((u) => !existing.has(u));

      if (toInsert.length === 0) {
        // Nothing new to import; just refresh
      } else {
        const nowIso = new Date().toISOString();
        const rows = toInsert.map((url, idx) => ({
          vehicle_id: vehicleId,
          user_id: session.user.id,
          image_url: url,
          thumbnail_url: url,
          medium_url: url,
          large_url: url,
          variants: { full: url, large: url, medium: url, thumbnail: url },
          is_primary: idx === 0 && existing.size === 0,
          position: existing.size + idx,
          caption: fallbackLabel,
          category: 'general',
          is_document: false,
          is_duplicate: false,
          taken_at: nowIso,
          is_external: true,
          source: 'bat_import',
          source_url: typeof fallbackSourceUrl === 'string' && fallbackSourceUrl.startsWith('http') ? fallbackSourceUrl : null,
          created_at: nowIso,
          updated_at: nowIso
        }));

        const { error: insertErr } = await supabase
          .from('vehicle_images')
          .insert(rows);
        if (insertErr) throw insertErr;
      }

      // Refresh DB-backed gallery view immediately
      const { data: refreshed, error: refreshErr } = await supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, medium_url, large_url, variants, is_primary, position, caption, created_at, taken_at, exif_data, user_id, is_sensitive, sensitive_type, is_document, document_category, ai_scan_metadata, ai_last_scanned, angle, category, storage_path, file_hash')
        .eq('vehicle_id', vehicleId)
        .not('is_document', 'is', true)
        .not('is_duplicate', 'is', true)
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (refreshErr) throw refreshErr;

      const images = filterBatNoiseRows(dedupeFetchedImages(refreshed || []));
      setUsingFallback(false);
      setAllImages(images);
      setDisplayedImages(sortRows(applySourceFilter(images), sortBy)); // NO LIMIT - show filtered images
      setShowImages(true);
      onImagesUpdated?.();
    } catch (err) {
      console.error('Failed to import listing images:', err);
      alert('Failed to import listing images. Please try again.');
    } finally {
      setImportingFallback(false);
    }
  }, [fallbackImageUrls, fallbackLabel, fallbackSourceUrl, importingFallback, onImagesUpdated, session?.user?.id, vehicleId]);
  
  // NEW: Image set related state
  const [imageSetCounts, setImageSetCounts] = useState<Record<string, number>>({});
  
  // NEW: Onboarding modal state
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  // Tagging state
  const [imageTags, setImageTags] = useState<ImageTag[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [selectedTagType, setSelectedTagType] = useState('part');
  const [tagText, setTagText] = useState('');
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [canCreateTags, setCanCreateTags] = useState(false);
  const [imageTagCounts, setImageTagCounts] = useState<Record<string, number>>({});
  
  // Tool inventory state
  const [userTools, setUserTools] = useState<any[]>([]);
  const [filteredTools, setFilteredTools] = useState<any[]>([]);
  const [showToolSearch, setShowToolSearch] = useState(false);
  const [toolSearchTerm, setToolSearchTerm] = useState('');

  // Define getSortedImages BEFORE loadMoreImages (which depends on it)
  const sortRows = (rows: any[], mode: 'quality' | 'date_desc' | 'date_asc') => {
    // If the backend has provided explicit ordering (position), always respect it.
    // This prevents any client-side “quality” heuristics from shuffling galleries.
    const hasAnyPosition = (rows || []).some(
      (r: any) => typeof r?.position === 'number' && Number.isFinite(r.position)
    );
    if (hasAnyPosition) {
      return [...(rows || [])].sort((a, b) => {
        if (a?.is_primary && !b?.is_primary) return -1;
        if (!a?.is_primary && b?.is_primary) return 1;

        const posA = (typeof a?.position === 'number' && Number.isFinite(a.position)) ? a.position : Number.POSITIVE_INFINITY;
        const posB = (typeof b?.position === 'number' && Number.isFinite(b.position)) ? b.position : Number.POSITIVE_INFINITY;
        if (posA !== posB) return posA - posB;

        const ca = typeof a?.created_at === 'string' ? new Date(a.created_at).getTime() : 0;
        const cb = typeof b?.created_at === 'string' ? new Date(b.created_at).getTime() : 0;
        if (ca !== cb) return ca - cb;

        return String(a?.id || '').localeCompare(String(b?.id || ''));
      });
    }

    if (mode === 'quality') {
      // Presentation sorting - best images first
      // Try AI-based sorting first, fallback to heuristics if no angle data
      try {
        const sorted = sortImagesByPriority(rows || []);
        if (sorted.length > 0) return sorted;
      } catch (e) {
        console.log('AI sorting unavailable, using heuristics');
      }

      // Fallback: Smart heuristics when no AI angle data exists
      return [...(rows || [])].sort((a, b) => {
        // Primary images always first
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;

        // If both rows have explicit positions, respect them to keep galleries stable.
        const posA = (typeof a.position === 'number' && Number.isFinite(a.position)) ? a.position : null;
        const posB = (typeof b.position === 'number' && Number.isFinite(b.position)) ? b.position : null;
        if (posA !== null && posB !== null && posA !== posB) return posA - posB;
        if (posA !== null && posB === null) return -1;
        if (posA === null && posB !== null) return 1;

        // Category-based priority (exterior > interior > engine > other)
        const catPriority: Record<string, number> = {
          exterior: 100,
          hero: 95,
          interior: 80,
          engine: 70,
          engine_bay: 70,
          undercarriage: 50,
          detail: 40,
          general: 30,
          work: 10,
          document: 5,
          receipt: -10
        };

        const catA = catPriority[String(a.category || 'general').toLowerCase()] || 20;
        const catB = catPriority[String(b.category || 'general').toLowerCase()] || 20;

        if (catA !== catB) return catB - catA;

        // Within same category, newer first
        const effA = getEffectiveImageDate(a, auctionStartDate);
        const effB = getEffectiveImageDate(b, auctionStartDate);
        const dateA = effA.iso ? new Date(effA.iso).getTime() : 0;
        const dateB = effB.iso ? new Date(effB.iso).getTime() : 0;

        if (dateA !== dateB) return dateB - dateA;

        // Stable fallback when dates are equal
        return (a.id || '').localeCompare(b.id || '');
      });
    }

    const dir = mode === 'date_desc' ? -1 : 1;
    return [...(rows || [])].sort((a, b) => {
      // Primary images always first regardless of date ordering (stable UX)
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;

      // If both rows have explicit positions, respect them to keep galleries stable.
      const posA = (typeof a.position === 'number' && Number.isFinite(a.position)) ? a.position : null;
      const posB = (typeof b.position === 'number' && Number.isFinite(b.position)) ? b.position : null;
      if (posA !== null && posB !== null && posA !== posB) return posA - posB;
      if (posA !== null && posB === null) return -1;
      if (posA === null && posB !== null) return 1;

      const effA = getEffectiveImageDate(a, auctionStartDate);
      const effB = getEffectiveImageDate(b, auctionStartDate);
      const dateA = effA.iso ? new Date(effA.iso).getTime() : 0;
      const dateB = effB.iso ? new Date(effB.iso).getTime() : 0;

      if (dateA !== dateB) return (dateA - dateB) * dir;
      return (a.id || '').localeCompare(b.id || '');
    });
  };

  const getSortedImages = () => {
    let sorted = sortRows(allImages, sortBy);
    
    // Apply grouping by source if enabled
    if (groupBySource) {
      const grouped = new Map<string, any[]>();
      for (const img of sorted) {
        const source = getImageSource(img);
        const key = source.type;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(img);
      }
      
      // Within each group, sort chronologically if enabled
      const dir = chronologicalMode === 'off' ? 0 : (chronologicalMode === 'asc' ? 1 : -1);
      if (dir !== 0) {
        for (const [sourceType, images] of grouped.entries()) {
          images.sort((a, b) => {
            const effA = getEffectiveImageDate(a, auctionStartDate);
            const effB = getEffectiveImageDate(b, auctionStartDate);
            const dateA = effA.iso ? new Date(effA.iso).getTime() : 0;
            const dateB = effB.iso ? new Date(effB.iso).getTime() : 0;
            if (dateA !== dateB) return (dateA - dateB) * dir;
            return (a.id || '').localeCompare(b.id || '');
          });
        }
      }
      
      // Sort groups by source priority, then flatten
      const sourcePriority: Record<string, number> = {
        user: 100,      // User uploads first
        queue: 80,      // Import queue
        org: 60,        // Organization imports
        bat: 40,        // BaT imports
        external: 20    // Other external
      };
      sorted = Array.from(grouped.entries())
        .sort((a, b) => {
          const priA = sourcePriority[a[0]] || 10;
          const priB = sourcePriority[b[0]] || 10;
          return priB - priA;
        })
        .flatMap(([_, images]) => images);
    }
    // Apply grouping by category if enabled (and not grouping by source)
    else if (groupByCategory) {
      const grouped = new Map<string, any[]>();
      for (const img of sorted) {
        const category = img.category || 'general';
        if (!grouped.has(category)) grouped.set(category, []);
        grouped.get(category)!.push(img);
      }
      
      // Within each group, sort chronologically if enabled
      const dir = chronologicalMode === 'off' ? 0 : (chronologicalMode === 'asc' ? 1 : -1);
      if (dir !== 0) {
        for (const [category, images] of grouped.entries()) {
          images.sort((a, b) => {
            const effA = getEffectiveImageDate(a, auctionStartDate);
            const effB = getEffectiveImageDate(b, auctionStartDate);
            const dateA = effA.iso ? new Date(effA.iso).getTime() : 0;
            const dateB = effB.iso ? new Date(effB.iso).getTime() : 0;
            if (dateA !== dateB) return (dateA - dateB) * dir;
            return (a.id || '').localeCompare(b.id || '');
          });
        }
      }
      
      // Sort groups by category priority, then flatten
      const catPriority: Record<string, number> = {
        hero: 95,
        interior: 80,
        engine: 70,
        engine_bay: 70,
        undercarriage: 50,
        detail: 40,
        general: 30,
        work: 10,
        document: 5,
        receipt: -10
      };
      sorted = Array.from(grouped.entries())
        .sort((a, b) => {
          const priA = catPriority[a[0].toLowerCase()] || 20;
          const priB = catPriority[b[0].toLowerCase()] || 20;
          return priB - priA;
        })
        .flatMap(([_, images]) => images);
    } else if (chronologicalMode !== 'off') {
      // If groups disabled but chronological enabled, sort all images chronologically
      const dir = chronologicalMode === 'asc' ? 1 : -1;
      sorted = [...sorted].sort((a, b) => {
        const effA = getEffectiveImageDate(a, auctionStartDate);
        const effB = getEffectiveImageDate(b, auctionStartDate);
        const dateA = effA.iso ? new Date(effA.iso).getTime() : 0;
        const dateB = effB.iso ? new Date(effB.iso).getTime() : 0;
        if (dateA !== dateB) return (dateA - dateB) * dir;
        return (a.id || '').localeCompare(b.id || '');
      });
    }
    
    return sorted;
  };

  const dedupeFetchedImages = (images: any[]): any[] => {
    // Defensive UI de-dupe: older rows may not have is_duplicate populated,
    // or multiple rows may point at the same underlying file/variant.
    
    // Extract hash from filename for better duplicate detection
    // e.g., external_import_60f9ebbff43d9892e42fd3c0e8d72eac3bc3900b.jpg -> 60f9ebbff43d9892e42fd3c0e8d72eac3bc3900b
    const extractHashFromUrl = (url: string | null | undefined): string | null => {
      if (!url) return null;
      try {
        const filename = url.split('/').pop() || '';
        // Match hash patterns in filenames: external_import_HASH, bat_import_HASH, etc.
        const hashMatch = filename.match(/(?:external_import_|bat_import_|organization_import_|import_queue_)([a-f0-9]{20,})/i);
        if (hashMatch && hashMatch[1]) {
          return hashMatch[1].toLowerCase();
        }
      } catch {
        // ignore
      }
      return null;
    };
    
    // Extract Mecum/Cloudinary image path for deduplication (strips transformations and versions)
    // e.g., images.mecum.com/image/upload/c_fill,f_auto,w_1920/v123456/auctions/FL26/1155407/123999.jpg
    //   -> auctions/FL26/1155407/123999.jpg
    const extractMecumPath = (url: string | null | undefined): string | null => {
      if (!url) return null;
      try {
        const lower = url.toLowerCase();
        if (!lower.includes('mecum.com') && !lower.includes('cloudinary')) return null;
        
        // Pattern: /image/upload/[transformations]/[version]/[path]
        // or: /image/upload/[version]/[path]
        const uploadMatch = url.match(/\/image\/upload\/(?:[^\/]+\/)*v+\d+\/(.+)/i);
        if (uploadMatch && uploadMatch[1]) {
          // Normalize: strip query params and return just the path
          return uploadMatch[1].split('?')[0].split('#')[0].toLowerCase();
        }
        
        // Fallback: extract path after /media/ or /auctions/
        const pathMatch = url.match(/\/(media|auctions)\/(.+)/i);
        if (pathMatch && pathMatch[2]) {
          return pathMatch[2].split('?')[0].split('#')[0].toLowerCase();
        }
      } catch {
        // ignore
      }
      return null;
    };
    
    // Check if URL is blank/placeholder
    const isBlankImage = (url: string | null | undefined): boolean => {
      if (!url) return true;
      const lower = url.toLowerCase();
      return lower.includes('placeholder') || 
             lower.includes('blank') || 
             lower.includes('no-image') ||
             lower.includes('default-') ||
             lower.length < 20;
    };
    
    const keyFor = (img: any): string => {
      // Priority 0: Mecum/Cloudinary path (strips transformations/resolutions)
      const mecumPath = extractMecumPath(img?.image_url);
      if (mecumPath) return `mecum:${mecumPath}`;
      
      // Priority 1: file_hash (most reliable)
      if (img?.file_hash) return `hash:${String(img.file_hash).toLowerCase()}`;
      
      // Priority 2: Extract hash from storage_path or image_url
      const hashFromPath = extractHashFromUrl(img?.storage_path);
      if (hashFromPath) return `path_hash:${hashFromPath}`;
      
      const hashFromUrl = extractHashFromUrl(img?.image_url);
      if (hashFromUrl) return `url_hash:${hashFromUrl}`;
      
      // Priority 3: storage_path (normalized)
      if (img?.storage_path) {
        const normalized = String(img.storage_path).toLowerCase().split('?')[0].split('#')[0];
        if (normalized) return `path:${normalized}`;
      }
      
      // Priority 4: variants
      if (img?.variants?.full) {
        const hash = extractHashFromUrl(img.variants.full);
        if (hash) return `variant_full_hash:${hash}`;
        return `variant_full:${String(img.variants.full).toLowerCase().split('?')[0]}`;
      }
      if (img?.variants?.large) {
        const hash = extractHashFromUrl(img.variants.large);
        if (hash) return `variant_large_hash:${hash}`;
        return `variant_large:${String(img.variants.large).toLowerCase().split('?')[0]}`;
      }
      
      // Priority 5: image URLs (normalized, extract hash if possible)
      const urls = [img?.image_url, img?.large_url, img?.medium_url, img?.thumbnail_url].filter(Boolean);
      for (const url of urls) {
        const hash = extractHashFromUrl(url);
        if (hash) return `url_hash:${hash}`;
        const normalized = String(url).toLowerCase().split('?')[0].split('#')[0];
        if (normalized && normalized.length > 20) return `url:${normalized}`;
      }
      
      // Fallback: use ID (but this won't catch duplicates with different IDs)
      return `id:${img?.id || ''}`;
    };

    const prioritized = [...(images || [])].sort((a: any, b: any) => {
      // Primary first, then newest
      if (a?.is_primary && !b?.is_primary) return -1;
      if (!a?.is_primary && b?.is_primary) return 1;
      const da = new Date(a?.taken_at || a?.created_at || 0).getTime();
      const db = new Date(b?.taken_at || b?.created_at || 0).getTime();
      if (da !== db) return db - da;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });

    const seen = new Set<string>();
    const out: any[] = [];
    let skippedNoKey = 0;
    let skippedDuplicate = 0;
    let skippedBlank = 0;
    for (const img of prioritized) {
      // Skip blank/placeholder images
      if (isBlankImage(img?.image_url)) {
        skippedBlank++;
        continue;
      }
      const k = keyFor(img);
      if (!k) {
        skippedNoKey++;
        continue;
      }
      if (seen.has(k)) {
        skippedDuplicate++;
        continue;
      }
      seen.add(k);
      out.push(img);
    }
    return out;
  };

  const dedupeById = (images: any[]): any[] => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const img of images || []) {
      const id = String(img?.id || '');
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(img);
    }
    return out;
  };

  // Define loadMoreImages BEFORE the useEffect that uses it
  const loadMoreImages = useCallback(() => {
    if (loadingMore || displayedImages.length >= allImages.length) return;
    
    if (!infiniteScrollEnabled) {
      // First click - enable infinite scroll
      setInfiniteScrollEnabled(true);
    }
    
    setLoadingMore(true);
    const sortedImages = getSortedImages();
    // Robust pagination: always append the next N images NOT already displayed.
    // This prevents duplicates when the sort order changes between calls.
    const alreadyShown = new Set(displayedImages.map((img: any) => String(img?.id || '')).filter(Boolean));
    const nextBatch: any[] = [];
    for (const img of sortedImages) {
      const id = String(img?.id || '');
      if (!id) continue;
      if (alreadyShown.has(id)) continue;
      nextBatch.push(img);
      if (nextBatch.length >= imagesPerPage) break;
    }

    setTimeout(() => {
      setDisplayedImages(prev => {
        const newImages = dedupeById([...prev, ...nextBatch]);
        // Load tag counts after state updates
        setTimeout(() => loadImageTagCounts(), 100);
        // Also load comment counts, uploader names, and tag texts for new batch
        setTimeout(() => {
          const ids = newImages.map(img => String(img.id || '')).filter((id) => isUuid(id));
          const uids = newImages.map(img => String(img.user_id || '')).filter((id) => isUuid(id));
          loadImageCommentCounts(ids);
          loadUploaderNames(uids);
          loadImageTagTexts(ids);
          loadImageViewCounts(ids);
          loadUploaderOrgNames(uids);
          loadImageAttributions(ids);
        }, 120);
        return newImages;
      });
      setLoadingMore(false);
    }, 300); // Small delay for smooth UX
  }, [loadingMore, displayedImages.length, allImages.length, infiniteScrollEnabled, sortBy, allImages, imagesPerPage]);

  // Infinite scroll observer
  useEffect(() => {
    if (!infiniteScrollEnabled || !sentinelRef.current || !showImages) return;
    if (displayedImages.length >= allImages.length) return; // All images already loaded
    
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting && !loadingMore && displayedImages.length < allImages.length) {
          loadMoreImages();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );
    
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [infiniteScrollEnabled, loadingMore, displayedImages.length, allImages.length, showImages, loadMoreImages]);

  // Check authentication and permissions
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);

      if (session?.user?.id) {
        // Any logged in user can create tags - you can adjust this logic as needed
        setCanCreateTags(true);
        // Load user's tool inventory
        loadUserTools(session.user.id);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setCanCreateTags(!!session?.user?.id);
      if (session?.user?.id) {
        loadUserTools(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);
  
  // Load user's tool inventory
  const loadUserTools = async (userId: string) => {
    try {
      // Simpler query without joins since tool_catalog FK doesn't exist
      const { data, error } = await supabase
        .from('user_tools')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error loading tools:', error);
        return;
      }
      
      console.log(`Loaded ${data?.length || 0} tools for user ${userId}`);
      setUserTools(data || []);
    } catch (err) {
      console.error('Failed to load tools:', err);
    }
  };
  
  // Filter tools based on search
  useEffect(() => {
    if (toolSearchTerm.trim() === '') {
      setFilteredTools(userTools.slice(0, 10)); // Show first 10 when no search
    } else {
      const searchLower = toolSearchTerm.toLowerCase();
      const filtered = userTools.filter(tool => {
        // Use direct fields from user_tools table
        const partNumber = tool.part_number?.toLowerCase() || '';
        const description = tool.description?.toLowerCase() || '';
        const brand = tool.brand?.toLowerCase() || '';
        const notes = tool.notes?.toLowerCase() || '';
        
        return partNumber.includes(searchLower) ||
               description.includes(searchLower) ||
               brand.includes(searchLower) ||
               notes.includes(searchLower);
      }).slice(0, 10); // Limit to 10 results
      
      setFilteredTools(filtered);
    }
  }, [toolSearchTerm, userTools]);
  
  // Show tool search when tag type is tool
  useEffect(() => {
    setShowToolSearch(selectedTagType === 'tool' && activeTagId !== null);
    if (selectedTagType === 'tool') {
      setToolSearchTerm(tagText);
    }
  }, [selectedTagType, activeTagId, tagText]);

  useEffect(() => {
    const fetchImages = async () => {
      try {
        setLoading(true);

        // Ensure we have vehicle meta before setting images so BaT imports don't briefly render wrong images.
        let meta = vehicleMeta;
        if (!meta) {
          const { data: vm, error: vmErr } = await supabase
            .from('vehicles')
            .select('id, year, make, model, profile_origin, discovery_url')
            .eq('id', vehicleId)
            .maybeSingle();
          if (!vmErr) {
            meta = vm || null;
            setVehicleMeta(meta);
          }
        }

        const { data: rawImages, error } = await supabase
          .from('vehicle_images')
          .select('id, image_url, thumbnail_url, medium_url, large_url, variants, is_primary, position, caption, created_at, taken_at, exif_data, user_id, is_sensitive, sensitive_type, is_document, document_category, ai_scan_metadata, ai_last_scanned, angle, category, storage_path, file_hash')
          .eq('vehicle_id', vehicleId)
          // Filter out documents (treat NULL as false for legacy rows)
          .not('is_document', 'is', true)
          // Hide duplicate rows by default (treat NULL as false for legacy rows)
          .not('is_duplicate', 'is', true)
          // Additional filtering: ensure we have valid image URLs
          .not('image_url', 'is', null)
          .order('is_primary', { ascending: false })
          .order('position', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true });

        if (error) throw error;
        const deduped = dedupeFetchedImages(rawImages || []);
        const images = filterBatNoiseRows(deduped, meta);

        // If DB is empty, show fallback URLs (scraped listing images) to avoid empty profiles.
        const fallback = normalizeFallbackUrls(fallbackImageUrls);
        if (images.length === 0 && fallback.length > 0) {
          const synthetic = fallback.map((url, idx) => ({
            id: `ext_${idx}`,
            image_url: url,
            created_at: new Date().toISOString(),
            taken_at: null,
            is_primary: idx === 0,
            caption: `${fallbackLabel}`,
            category: 'general',
            __external: true
          }));
          setUsingFallback(true);
          setAllImages(synthetic);
          setDisplayedImages(synthetic.slice(0, Math.min(50, synthetic.length)));
          setShowImages(true);
        } else {
          setUsingFallback(false);
          setAllImages(images);
          // Load an initial batch (50 or fewer) immediately using the SAME sort logic used for pagination.
          // This prevents "reordering" / "scrambled" galleries as you scroll.
          const sorted = sortRows(images, sortBy);
          setDisplayedImages(sorted.slice(0, Math.min(50, sorted.length)));
          setShowImages(true);
        }
        
        // Check for pending uploads in queue
        const stats = await uploadQueueService.getQueueStats(vehicleId);
        if (stats.pending > 0 || stats.failed > 0) {
          setQueueStats(stats);
        }
      } catch (err) {
        console.error('Error fetching vehicle images:', err);
        setError('Failed to load vehicle images. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchImages();
  }, [vehicleId, fallbackLabel, JSON.stringify((fallbackImageUrls || []).slice(0, 50))]);

  // Listen for image processing completion events to refresh gallery
  useEffect(() => {
    const handleImageProcessingComplete = async (event: CustomEvent) => {
      const { imageId, result, vehicleId: eventVehicleId } = event.detail;
      
      // Only refresh if this event is for our vehicle
      if (eventVehicleId && eventVehicleId !== vehicleId) return;
      
      console.log('Image processing complete, refreshing gallery:', imageId);
      
      // Wait a moment for database to update, then refresh
      // Try multiple times with increasing delays (analysis might take 5-10 seconds, SPID detection adds time)
      const refreshAttempts = [3000, 6000, 10000, 15000];
      
      refreshAttempts.forEach((delay, index) => {
        setTimeout(async () => {
          try {
            console.log(`Refresh attempt ${index + 1}/${refreshAttempts.length} after ${delay}ms...`);
            const { data: refreshedImages, error } = await supabase
              .from('vehicle_images')
              .select('id, image_url, thumbnail_url, medium_url, large_url, variants, is_primary, position, caption, created_at, taken_at, exif_data, user_id, is_sensitive, sensitive_type, is_document, document_category, ai_scan_metadata, ai_last_scanned, angle, category')
              .eq('vehicle_id', vehicleId)
              .not('is_document', 'is', true)
              .not('is_duplicate', 'is', true)
              .order('is_primary', { ascending: false })
              .order('position', { ascending: true, nullsFirst: false })
              .order('created_at', { ascending: true });
            
            if (!error && refreshedImages) {
              const refreshedDeduped = dedupeFetchedImages(refreshedImages || []);
              const refreshedFiltered = filterBatNoiseRows(refreshedDeduped);
              // Check if the specific image was updated
              const updatedImage = refreshedFiltered.find(img => img.id === imageId) || (refreshedImages || []).find((img: any) => img.id === imageId);
              if (updatedImage) {
                const hasNewAnalysis = updatedImage.ai_scan_metadata?.tier_1_analysis || 
                                      updatedImage.angle || 
                                      updatedImage.category;
                
                if (hasNewAnalysis || index === refreshAttempts.length - 1) {
                  // Analysis is complete or this is the last attempt
                  setAllImages(refreshedFiltered);
                  const sorted = getSortedImages();
                  setDisplayedImages(sorted.slice(0, Math.max(displayedImages.length, 50)));
                  onImagesUpdated?.();
                  console.log('✅ Gallery refreshed with updated analysis data', {
                    imageId,
                    hasTier1: !!updatedImage.ai_scan_metadata?.tier_1_analysis,
                    angle: updatedImage.angle,
                    category: updatedImage.category
                  });
                }
              }
            }
          } catch (err) {
            console.error('Error refreshing gallery:', err);
          }
        }, delay);
      });
    };
    
    const listener: EventListener = (evt) => {
      handleImageProcessingComplete(evt as unknown as CustomEvent).catch(() => null);
    };
    window.addEventListener('image_processing_complete', listener);
    
    return () => {
      window.removeEventListener('image_processing_complete', listener);
    };
  }, [vehicleId, displayedImages.length, onImagesUpdated]);

  // Re-sort displayed images when sort option or grouping changes
  useEffect(() => {
    if (showImages && displayedImages.length > 0) {
      const sortedImages = getSortedImages();
      setDisplayedImages(sortedImages.slice(0, displayedImages.length));
    }
  }, [sortBy, groupBySource, groupByCategory, chronologicalMode]);

  // Load tag counts when displayed images change
  useEffect(() => {
    if (displayedImages.length > 0) {
      loadImageTagCounts();
    }
  }, [displayedImages]);

  // NEW: Load set counts when enabled
  useEffect(() => {
    if (showSetCount && displayedImages.length > 0) {
      loadImageSetCounts();
    }
  }, [showSetCount, displayedImages]);

  const loadImageSetCounts = async () => {
    try {
      const imageIds = displayedImages.map(img => img.id);
      const counts = await ImageSetService.getImageSetCounts(imageIds);
      setImageSetCounts(counts);
    } catch (err) {
      console.error('Error loading set counts:', err);
    }
  };

  // NEW: Handle image selection
  const handleImageSelect = (imageId: string, event: React.MouseEvent) => {
    if (!selectMode || !onSelectionChange) return;
    
    event.stopPropagation();
    
    const newSelected = new Set(selectedImages || []);
    if (newSelected.has(imageId)) {
      newSelected.delete(imageId);
    } else {
      newSelected.add(imageId);
    }
    onSelectionChange(newSelected);
  };

  const handleUploadClick = () => {
    // Check if user is logged in
    if (!session?.user?.id) {
      setShowOnboardingModal(true);
      return;
    }
    
    // If logged in, trigger file input - check both possible IDs
    const inputId = allImages.length === 0 
      ? `image-upload-${vehicleId}` 
      : `gallery-upload-${vehicleId}`;
    document.getElementById(inputId)?.click();
  };

  const handleFileUpload = async (files: FileList) => {
    if (!files.length) return;

    // Validate user is logged in (double-check)
    if (!session?.user?.id) {
      setShowOnboardingModal(true);
      return;
    }

    const fileArray = Array.from(files);
    
    // Get existing images for deduplication check
    const { data: existingImages } = await supabase
      .from('vehicle_images')
      .select('file_name, file_size')
      .eq('vehicle_id', vehicleId);
    
    // Save files to persistent queue FIRST (with dedup check)
    const result = await uploadQueueService.addFiles(vehicleId, fileArray, existingImages || []);
    
    if (result.skipped > 0) {
      console.log(`Skipped ${result.skipped} duplicate files`);
      alert(`${result.skipped} files were skipped (already uploaded). ${result.added} new files added to queue.`);
    } else {
      console.log(`Saved ${result.added} files to upload queue`);
    }
    
    // Start upload from queue
    if (result.added > 0) {
      await uploadFromQueue();
    }
  };

  const uploadFromQueue = async () => {
    if (!session?.user?.id) return;
    
    // Get pending files from queue
    const pendingFiles = await uploadQueueService.getPendingFiles(vehicleId);
    if (pendingFiles.length === 0) {
      console.log('No pending files in queue');
      setQueueStats(null);
      return;
    }
    
    console.log(`Uploading ${pendingFiles.length} files from queue`);
    
    // Create global upload job for header status bar
    const jobId = globalUploadStatusService.createJob(vehicleId, pendingFiles.length);
    
    // Keep local progress for component-specific UI
    setUploadProgress({total: pendingFiles.length, completed: 0, uploading: true});

    const errors: string[] = [];
    const uploadedImageIds: string[] = [];

    try {
      for (let i = 0; i < pendingFiles.length; i++) {
        const queuedFile = pendingFiles[i];
        
        if (!queuedFile.file) {
          console.warn(`File object missing for ${queuedFile.name}, skipping`);
          await uploadQueueService.updateStatus(queuedFile.id, 'failed', { error: 'File object missing' });
          continue;
        }
        
        // Mark as uploading
        await uploadQueueService.updateStatus(queuedFile.id, 'uploading');
        
        // Use centralized upload service (handles EXIF, variants, timeline, AI)
        const result = await ImageUploadService.uploadImage(
          vehicleId,
          queuedFile.file,
          'general'
        );
        
        if (!result.success) {
          console.error('Upload failed:', result.error);
          errors.push(`${queuedFile.name}: ${result.error}`);
          await uploadQueueService.updateStatus(queuedFile.id, 'failed', { error: result.error });
        } else if (result.imageId) {
          // Track successful uploads for AI processing
          uploadedImageIds.push(result.imageId);
          await uploadQueueService.updateStatus(queuedFile.id, 'completed', { imageId: result.imageId });
        }

        // Update both local and global progress
        setUploadProgress(prev => ({...prev, completed: i + 1}));
        globalUploadStatusService.updateJobProgress(jobId, i + 1, errors.length, errors);
      }

      // Create AI processing job for successfully uploaded images
      if (uploadedImageIds.length > 0) {
        globalUploadStatusService.createProcessingJob(vehicleId, uploadedImageIds);
      }

      // Refresh images and notify parent
      const { data: refreshedImages } = await supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, medium_url, large_url, variants, is_primary, position, caption, created_at, taken_at, is_document, document_category')
        .eq('vehicle_id', vehicleId)
        // Filter out documents (treat NULL as false)
        .not('is_document', 'is', true)
        .not('is_duplicate', 'is', true)
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });

      const refreshedDeduped = dedupeFetchedImages(refreshedImages || []);
      const refreshedFiltered = filterBatNoiseRows(refreshedDeduped);
      setAllImages(refreshedFiltered);
      
      // Always show images after upload and refresh the display
      setShowImages(true);
      
      // Refresh displayed images with the new uploads
      const sortedImages = sortRows(refreshedFiltered || [], sortBy);
      
      setDisplayedImages(sortedImages.slice(0, Math.max(displayedImages.length, imagesPerPage)));
      
      onImagesUpdated?.();
      
      // Clear completed files from queue
      await uploadQueueService.clearCompleted(vehicleId);
      
      // Update queue stats
      const stats = await uploadQueueService.getQueueStats(vehicleId);
      setQueueStats(stats.pending > 0 || stats.failed > 0 ? stats : null);

    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploadProgress({total: 0, completed: 0, uploading: false});
    }
  };

  const openLightbox = (index: number) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);

    // Load tags for the current image
    const image = displayedImages[index];
    if (image?.id) {
      loadImageTags(image.id);
    }
  };

  const nextImage = () => {
    const newIndex = (currentImageIndex + 1) % displayedImages.length;
    setCurrentImageIndex(newIndex);

    // Load tags for the new image
    const image = displayedImages[newIndex];
    if (image?.id) {
      loadImageTags(image.id);
    }
  };

  const previousImage = () => {
    const newIndex = (currentImageIndex - 1 + displayedImages.length) % displayedImages.length;
    setCurrentImageIndex(newIndex);

    // Load tags for the new image
    const image = displayedImages[newIndex];
    if (image?.id) {
      loadImageTags(image.id);
    }
  };

  const getDisplayDate = (image: any) => {
    const eff = getEffectiveImageDate(image, auctionStartDate);
    if (!eff.iso) return 'No date';
    try {
      const date = new Date(eff.iso);
      if (isNaN(date.getTime())) return 'Invalid date';
      const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return formatted + (eff.label || '');
    } catch (e) {
      return 'Invalid date';
    }
  };

  const handleShowImages = () => {
    setShowImages(true);
    loadMoreImages();
  };

  const handleUnloadImages = () => {
    setShowImages(false);
    setDisplayedImages([]);
  };

  // Auto-load images progressively until all displayed
  useEffect(() => {
    if (!autoLoad || !showImages) return;
    if (loadingMore) return;
    if (displayedImages.length >= allImages.length) {
      setAutoLoad(false);
      return;
    }
    const t = setTimeout(() => loadMoreImages(), 120);
    return () => clearTimeout(t);
  }, [autoLoad, showImages, loadingMore, displayedImages.length, allImages.length]);

  // Load tag counts for all images (disabled - using new tagging system)
  const loadImageTagCounts = async () => {
    console.debug('Tag counts disabled in ImageGallery - use SimplePhotoTagger instead');
    setImageTagCounts({});
    return;
  };

  // Load a few tag texts per image for display (disabled - using new tagging system)
  const loadImageTagTexts = async (imageIds: string[]) => {
    console.debug('Tag texts disabled in ImageGallery - use SimplePhotoTagger instead');
    return;
  };

  // Load image comment counts in batch
  const loadImageCommentCounts = async (imageIds: string[]) => {
    const ids = Array.from(new Set(imageIds.filter(Boolean)));
    if (ids.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('vehicle_image_comments')
        .select('image_id')
        .in('image_id', ids);
      if (error) return;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        counts[row.image_id] = (counts[row.image_id] || 0) + 1;
      });
      setImageCommentCounts(prev => ({ ...prev, ...counts }));
    } catch (e) {
      // ignore
    }
  };

  // Load uploader names for a set of user IDs
  const loadUploaderNames = async (userIds: string[]) => {
    const ids = Array.from(new Set((userIds as string[]).filter(Boolean)));
    if (ids.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, email')
        .in('id', ids);
      if (error) return;
      const byId: Record<string, string> = {};
      (data || []).forEach((p: any) => {
        byId[p.id] = p.username || (p.email ? p.email.split('@')[0] : 'user');
      });
      setImageUploaderNames(prev => ({ ...prev, ...byId }));
    } catch (e) {
      // ignore
    }
  };

  // Load full attribution including ghost users, organizations, and location
  const loadImageAttributions = async (imageIds: string[]) => {
    const ids = Array.from(new Set(imageIds.filter(Boolean)));
    if (ids.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('vehicle_images')
        .select(`
          id,
          exif_data,
          uploaded_by,
          device_attributions (
            ghost_users (
              display_name,
              camera_make,
              camera_model
            )
          )
        `)
        .in('id', ids);

      if (error) throw error;

      const attributionMap: Record<string, any> = {};
      (data || []).forEach((img: any) => {
        const attr = img.device_attributions?.[0];
        const gps = img.exif_data?.gps;
        const location = gps ? `${gps.latitude?.toFixed(4)}, ${gps.longitude?.toFixed(4)}` : null;

        attributionMap[img.id] = {
          photographer: attr?.ghost_users?.display_name || 
                       (attr?.ghost_users ? `${attr.ghost_users.camera_make} ${attr.ghost_users.camera_model}`.trim() : null),
          location: location
        };
      });

      setImageAttributions(prev => ({ ...prev, ...attributionMap }));
    } catch (e) {
      console.error('Error loading attributions:', e);
    }
  };

  // Load view counts from user_activity (event_type='view', entity_type='image')
  const loadImageViewCounts = async (imageIds: string[]) => {
    const ids = Array.from(new Set(imageIds.filter(Boolean)));
    if (ids.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('user_activity')
        .select('entity_id')
        .eq('event_type', 'view')
        .eq('entity_type', 'image')
        .in('entity_id', ids);
      if (error) return;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        counts[row.entity_id] = (counts[row.entity_id] || 0) + 1;
      });
      setImageViewCounts(prev => ({ ...prev, ...counts }));
    } catch (e) {
      // ignore
    }
  };

  // Load uploader organization names (shop display_name) by owner_user_id
  const loadUploaderOrgNames = async (userIds: string[]) => {
    const ids = Array.from(new Set((userIds as string[]).filter(Boolean)));
    if (ids.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('shops')
        .select('owner_user_id, display_name')
        .in('owner_user_id', ids);
      if (error) return;
      const byId: Record<string, string> = {};
      (data || []).forEach((s: any) => {
        if (!byId[s.owner_user_id]) byId[s.owner_user_id] = s.display_name;
      });
      setUploaderOrgNames(prev => ({ ...prev, ...byId }));
    } catch (e) {
      // ignore
    }
  };

  // Helper: determine time-of-day label from timestamp
  const getTimeOfDayLabel = (dt?: string) => {
    if (!dt) return '';
    const d = new Date(dt);
    const h = d.getHours();
    if (h < 5) return 'night';
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    if (h < 20) return 'evening';
    return 'night';
  };

  // Helper: format camera text from EXIF which may be a string or an object { make, model }
  const getCameraText = (exif: any): string => {
    if (!exif || !exif.camera) return '';
    const cam = exif.camera;
    if (typeof cam === 'string') return cam;
    if (cam && (cam.make || cam.model)) {
      return [cam.make, cam.model].filter(Boolean).join(' ').trim();
    }
    return '';
  };

  // Helper: format location text from EXIF which may be a string or an object
  const getLocationText = (exif: any): string => {
    if (!exif || !exif.location) return '';
    const loc = exif.location;
    if (typeof loc === 'string') return loc;
    // Handle location object with latitude/longitude (coordinates only)
    if (loc.latitude && loc.longitude && !loc.city && !loc.state) {
      return `${loc.latitude.toFixed?.(4) || loc.latitude}, ${loc.longitude.toFixed?.(4) || loc.longitude}`;
    }
    // Handle location object with city/state/country
    const parts = [
      loc.city || loc.nearest_city || '',
      loc.state || loc.region || '',
      loc.country || ''
    ].filter(Boolean);
    const joined = parts.join(', ');
    return (joined || loc.zip || '').toString();
  };

  // Load tags for the current image (disabled - using new tagging system)
  const loadImageTags = async (imageId: string) => {
    console.debug('Image tags disabled in ImageGallery - use SimplePhotoTagger instead');
    setImageTags([]);
    return;
  };

  // Handle clicking on image to create tags
  const handleImageClick = (e: React.MouseEvent) => {
    if (!showTags || !canCreateTags) return;

    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const newTagId = `tag-${Date.now()}`;
    const newTag: ImageTag = {
      id: newTagId,
      x: x,
      y: y,
      text: '',
      type: selectedTagType,
      isEditing: true
    };

    setImageTags(prev => [...prev, newTag]);
    setActiveTagId(newTagId);
    setTagText('');
  };

  // Save a new tag to the database (disabled - using new tagging system)
  const saveTag = async (tagId: string) => {
    // Remove the temporary tag from UI
    setImageTags(prev => prev.filter(t => t.id !== tagId));
    setTagText('');
    setActiveTagId(null);
  };

  if (loading) {
    return <div className="text-center p-8">Loading vehicle images...</div>;
  }

  if (error) {
    return <div className="text-center p-8 text-red-500">{error}</div>;
  }

  // If no images, show upload UI (always visible to encourage uploads)
  if (allImages.length === 0) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <div style={{ 
          textAlign: 'center', 
          padding: 'var(--space-6)', 
          border: '2px dashed var(--border)',
          borderRadius: '0px',
          marginBottom: 'var(--space-3)'
        }}>
          <p className="text" style={{ marginBottom: 'var(--space-2)', fontWeight: 700, fontSize: '12pt' }}>
            No images yet
          </p>
          <p className="text-small text-muted" style={{ marginBottom: 'var(--space-3)' }}>
            Upload the first image to get started
          </p>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => {
              if (e.target.files) {
                handleFileUpload(e.target.files);
              }
            }}
            style={{ display: 'none' }}
            id={`image-upload-${vehicleId}`}
          />
          <button
            onClick={handleUploadClick}
            className="button button-primary"
            style={{ 
              cursor: 'pointer',
              fontSize: '9pt',
              padding: '10px 20px'
            }}
          >
            Upload Images
          </button>
          {normalizeFallbackUrls(fallbackImageUrls).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="text-small text-muted" style={{ fontSize: '8pt', marginBottom: 8 }}>
                We found listing images for this vehicle, but the database has not been backfilled yet.
              </div>
              <button
                className="button button-secondary"
                style={{ fontSize: '9pt', padding: '10px 20px' }}
                onClick={() => {
                  // Trigger a refetch via state: simplest is to just reload the page section
                  window.location.reload();
                }}
              >
                Show Listing Images
              </button>
            </div>
          )}
          <div className="text-small text-muted" style={{ marginTop: '10px', fontSize: '8pt' }}>
            Ownership/title documents should be submitted via the Ownership panel (not the gallery).
          </div>
        </div>
        
        {/* Onboarding Modal */}
        <OnboardingSlideshow
          isOpen={showOnboardingModal}
          onClose={() => setShowOnboardingModal(false)}
        />
      </div>
    );
  }

  const currentImage = displayedImages[currentImageIndex];
  const lightboxImageId = currentImage && String((currentImage as any).__external) === 'true' ? undefined : (isUuid(String(currentImage?.id || '')) ? String(currentImage.id) : undefined);

  return (
    <div>
      {usingFallback && (
        <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
          <div className="card-body" style={{ fontSize: '8pt', lineHeight: 1.4 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              Showing listing images (read-only)
            </div>
            <div className="text-muted">
              These images were discovered from external listings and may not be fully attributed yet. Upload your own photos to add verified evidence.
            </div>
            {session?.user?.id && normalizeFallbackUrls(fallbackImageUrls).length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="button button-secondary"
                  style={{ fontSize: '8pt', padding: '6px 10px', cursor: importingFallback ? 'not-allowed' : 'pointer', opacity: importingFallback ? 0.7 : 1 }}
                  onClick={importFallbackImages}
                  disabled={importingFallback}
                >
                  {importingFallback ? 'Importing...' : `Import ${Math.min(normalizeFallbackUrls(fallbackImageUrls).length, 120)} Images`}
                </button>
                <span className="text-muted" style={{ fontSize: '8pt' }}>
                  Imports these into the vehicle gallery for dedupe, tagging, and AI analysis.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Upload Progress Bar */}
      {uploadProgress.uploading && (
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span className="text">Uploading images...</span>
              <span className="text-muted">{uploadProgress.completed} of {uploadProgress.total}</span>
            </div>
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: 'var(--grey-200)',
              border: '1px inset var(--border-medium)'
            }}>
              <div style={{
                width: `${(uploadProgress.completed / uploadProgress.total) * 100}%`,
                height: '100%',
                backgroundColor: 'var(--grey-600)'
              }}></div>
            </div>
          </div>
        </div>
      )}

      {/* Gallery Controls */}
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
          {/* View Mode */}
          <div style={{ display: 'flex', border: '2px solid var(--border)', backgroundColor: 'var(--white)' }}>
            <button
              onClick={() => setViewMode('grid')}
              className={viewMode === 'grid' ? 'button button-primary' : 'button'}
              style={{ padding: '4px 12px', fontSize: '8pt', margin: 0, border: 'none', borderRadius: 0, height: '24px', minHeight: '24px' }}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('masonry')}
              className={viewMode === 'masonry' ? 'button button-primary' : 'button'}
              style={{ padding: '4px 12px', fontSize: '8pt', margin: 0, border: 'none', borderRadius: 0, height: '24px', minHeight: '24px' }}
            >
              Full
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={viewMode === 'list' ? 'button button-primary' : 'button'}
              style={{ padding: '4px 12px', fontSize: '8pt', margin: 0, border: 'none', borderRadius: 0, height: '24px', minHeight: '24px' }}
            >
              Info
            </button>
          </div>

          {/* Image Count */}
          <span style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>
            {allImages.length} {allImages.length === 1 ? 'image' : 'images'}
          </span>

          {/* Toggle Buttons for Sorting */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {/* Group by Source Toggle */}
            <button
              onClick={() => {
                setGroupBySource(!groupBySource);
                if (!groupBySource) setGroupByCategory(false); // Disable category grouping when enabling source
              }}
              className={groupBySource ? 'button button-primary' : 'button'}
              style={{ 
                fontSize: '8pt', 
                padding: '4px 8px', 
                height: '24px', 
                minHeight: '24px',
                whiteSpace: 'nowrap'
              }}
              title="Group images by source (User, Import Queue, Organization, BaT, External)"
            >
              By Source
            </button>
            {/* Groups Toggle */}
            <button
              onClick={() => {
                setGroupByCategory(!groupByCategory);
                if (!groupByCategory) setGroupBySource(false); // Disable source grouping when enabling category
              }}
              className={groupByCategory ? 'button button-primary' : 'button'}
              style={{ 
                fontSize: '8pt', 
                padding: '4px 8px', 
                height: '24px', 
                minHeight: '24px',
                whiteSpace: 'nowrap'
              }}
              title="Group images by category"
            >
              By Category
            </button>
            
            {/* Chronological Toggle (3-state: off -> asc -> desc -> off) */}
            <button
              onClick={() => {
                if (chronologicalMode === 'off') setChronologicalMode('asc');
                else if (chronologicalMode === 'asc') setChronologicalMode('desc');
                else setChronologicalMode('off');
              }}
              className={chronologicalMode !== 'off' ? 'button button-primary' : 'button'}
              style={{ 
                fontSize: '8pt', 
                padding: '4px 8px', 
                height: '24px', 
                minHeight: '24px',
                whiteSpace: 'nowrap'
              }}
              title={`Chronological: ${chronologicalMode === 'off' ? 'Off' : chronologicalMode === 'asc' ? 'Ascending' : 'Descending'}`}
            >
              Chrono{chronologicalMode === 'asc' ? ' ↑' : chronologicalMode === 'desc' ? ' ↓' : ''}
            </button>
          </div>

          {/* Images Per Row Slider */}
          {viewMode === 'grid' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '120px' }}>
              <span style={{ fontSize: '7pt', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{imagesPerRow}/row</span>
              <input
                type="range"
                min="1"
                max="16"
                value={imagesPerRow}
                onChange={(e) => setImagesPerRow(parseInt(e.target.value, 10))}
                className="nuke-range nuke-range-accent"
                style={{ flex: 1 }}
                title={`${imagesPerRow} images per row`}
              />
            </div>
          )}

          {/* Original Ratio Toggle */}
          <button
            onClick={() => setPreserveAspectRatio(!preserveAspectRatio)}
            className={preserveAspectRatio ? 'button button-primary' : 'button'}
            style={{ 
              fontSize: '8pt', 
              padding: '4px 8px', 
              height: '24px', 
              minHeight: '24px',
              whiteSpace: 'nowrap'
            }}
            title="Preserve original image aspect ratio"
          >
            Original Ratio
          </button>

          {/* Upload Button */}
          {queueStats && (queueStats.pending > 0 || queueStats.failed > 0) && session?.user?.id && (
            <button
              onClick={uploadFromQueue}
              className="button cursor-button"
              style={{ 
                fontSize: '8pt', 
                padding: '4px 12px',
                height: '24px',
                minHeight: '24px',
                border: '2px solid var(--warning)',
                background: 'var(--warning-light)',
                color: 'var(--warning-dark)',
                fontWeight: 700
              }}
            >
              RESUME UPLOAD ({queueStats.pending + queueStats.failed} files)
            </button>
          )}
          <input
            id={`gallery-upload-${vehicleId}`}
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => {
              if (e.target.files) {
                handleFileUpload(e.target.files);
                e.target.value = '';
              }
            }}
            style={{ display: 'none' }}
          />
          <button
            onClick={handleUploadClick}
            className="button button-primary"
            style={{ fontSize: '8pt', padding: '4px 12px', cursor: 'pointer', height: '24px', minHeight: '24px' }}
          >
            Upload
          </button>
        </div>
      </div>

      {/* Show/Hide Images Controls */}
      {!showImages && allImages.length > 0 && (
        <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
          <button
            className="button button-primary"
            onClick={handleShowImages}
            style={{ marginBottom: 'var(--space-2)' }}
          >
            Show Images ({allImages.length})
          </button>
          <p className="text text-muted" style={{ fontSize: '7pt' }}>
            Images load progressively for better performance
          </p>
        </div>
      )}

      {/* Image Grid */}
      {viewMode === 'grid' && showImages && (
        <div>
          {(() => {
            // If grouping by source, add section headers
            if (groupBySource) {
              const grouped: Array<{ source: ReturnType<typeof getImageSource>; images: any[] }> = [];
              const currentGroup: { source: ReturnType<typeof getImageSource> | null; images: any[] } = { source: null, images: [] };
              
              displayedImages.forEach((image) => {
                const source = getImageSource(image);
                if (!currentGroup.source || currentGroup.source.type !== source.type) {
                  if (currentGroup.source && currentGroup.images.length > 0) {
                    grouped.push({ source: currentGroup.source, images: [...currentGroup.images] });
                  }
                  currentGroup.source = source;
                  currentGroup.images = [image];
                } else {
                  currentGroup.images.push(image);
                }
              });
              
              if (currentGroup.source && currentGroup.images.length > 0) {
                grouped.push({ source: currentGroup.source, images: currentGroup.images });
              }
              
              return grouped.map((group, groupIndex) => (
                <div key={group.source.type}>
                  {/* Section Header */}
                  <div style={{
                    padding: 'var(--space-3) var(--space-2)',
                    backgroundColor: 'var(--grey-100)',
                    borderBottom: '2px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)'
                  }}>
                    <div style={{
                      width: '12px',
                      height: '12px',
                      backgroundColor: group.source.color,
                      border: '1px solid var(--border)'
                    }} />
                    <span style={{ 
                      fontSize: '9pt', 
                      fontWeight: 700, 
                      color: 'var(--text)',
                      textTransform: 'uppercase'
                    }}>
                      {group.source.label} ({group.images.length})
                    </span>
                  </div>
                  
                  {/* Images in this group */}
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${imagesPerRow}, 1fr)`, gap: 0 }}>
                    {group.images.map((image, imgIndex) => {
                      const isSelected = selectMode && selectedImages?.has(image.id);
                      const globalIndex = displayedImages.indexOf(image);
                      const source = getImageSource(image);
                      return (
                        <div
                          key={image.id}
                          style={{ 
                            cursor: 'pointer', 
                            position: 'relative', 
                            overflow: 'hidden', 
                            backgroundColor: 'var(--grey-100)',
                            aspectRatio: preserveAspectRatio ? undefined : '1 / 1',
                            border: 'none',
                            ...(preserveAspectRatio ? { height: 'auto' } : {})
                          }}
                          onClick={(e) => {
                            if (selectMode) {
                              handleImageSelect(image.id, e);
                            } else {
                              openLightbox(globalIndex);
                            }
                          }}
                        >
                          {/* Selection Checkbox */}
                          {selectMode && (
                            <div
                              style={{
                                position: 'absolute',
                                top: 'var(--space-1)',
                                left: 'var(--space-1)',
                                width: '24px',
                                height: '24px',
                                backgroundColor: isSelected ? 'var(--grey-900)' : 'var(--white)',
                                border: '2px solid var(--grey-900)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 20,
                                cursor: 'pointer'
                              }}
                              onClick={(e) => handleImageSelect(image.id, e)}
                            >
                              {isSelected && (
                                <span style={{ color: 'var(--white)', fontWeight: 'bold', fontSize: '10pt' }}>X</span>
                              )}
                            </div>
                          )}
                          
                          {/* Image Container */}
                          <div style={{ 
                            width: '100%', 
                            height: preserveAspectRatio ? 'auto' : '100%', 
                            overflow: 'hidden', 
                            backgroundColor: 'var(--grey-100)',
                            position: 'relative'
                          }}>
                            <SensitiveImageOverlay
                              imageId={image.id}
                              vehicleId={vehicleId}
                              imageUrl={getOptimalImageUrl(image,'medium')}
                              isSensitive={image.is_sensitive || false}
                              sensitiveType={image.sensitive_type}
                              objectFit={preserveAspectRatio ? 'contain' : 'cover'}
                            />
                          </div>

                          {/* Analysis Badge */}
                          {(() => {
                            const metadata = image.ai_scan_metadata;
                            const hasAnalysis = metadata && (
                              metadata.appraiser?.primary_label ||
                              metadata.tier_1_analysis ||
                              metadata.appraiser ||
                              image.ai_last_scanned ||
                              image.angle
                            );
                            if (!hasAnalysis) return null;
                            const angle = image.angle || metadata?.appraiser?.angle || metadata?.appraiser?.primary_label;
                            const analysisType = metadata?.tier_1_analysis ? 'TIER1' : metadata?.appraiser ? 'AI' : 'SCANNED';
                            return (
                              <div style={{
                                position: 'absolute',
                                top: 'var(--space-1)',
                                right: imageTagCounts[image.id] ? '28px' : 'var(--space-1)',
                                backgroundColor: '#10b981',
                                color: '#fff',
                                borderRadius: '0px',
                                border: '1px solid #fff',
                                padding: '2px 6px',
                                fontSize: '7pt',
                                fontWeight: 'bold',
                                fontFamily: '"MS Sans Serif", sans-serif',
                                zIndex: 10,
                                cursor: 'help',
                                maxWidth: '60px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={angle ? `${analysisType}: ${angle}` : `${analysisType} analyzed`}
                              >
                                {angle ? angle.substring(0, 6).toUpperCase() : analysisType}
                              </div>
                            );
                          })()}

                          {/* Source Badge - Only show if not user (already grouped by source) */}
                          {source.type !== 'user' && (
                            <div style={{
                              position: 'absolute',
                              bottom: 'var(--space-1)',
                              left: 'var(--space-1)',
                              backgroundColor: source.color,
                              color: '#fff',
                              borderRadius: '0px',
                              border: '1px solid #fff',
                              padding: '2px 6px',
                              fontSize: '7pt',
                              fontWeight: 'bold',
                              fontFamily: '"MS Sans Serif", sans-serif',
                              zIndex: 10,
                              cursor: 'help'
                            }}
                            title={`Source: ${source.label}`}
                            >
                              {source.label}
                            </div>
                          )}

                          {/* Tag Count Badge */}
                          {imageTagCounts[image.id] && (
                            <div style={{
                              position: 'absolute',
                              top: 'var(--space-1)',
                              right: 'var(--space-1)',
                              backgroundColor: '#000',
                              color: '#fff',
                              borderRadius: '0px',
                              border: '1px solid #fff',
                              width: '18px',
                              height: '18px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '8pt',
                              fontWeight: 'bold',
                              fontFamily: '"MS Sans Serif", sans-serif',
                              zIndex: 10
                            }}>
                              {imageTagCounts[image.id]}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            }
            
            // Default: flat grid without headers
            return (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${imagesPerRow}, 1fr)`, gap: 0 }}>
                {displayedImages.map((image, index) => {
                  const isSelected = selectMode && selectedImages?.has(image.id);
                  return (
                    <div
                      key={image.id}
                      style={{ 
                        cursor: 'pointer', 
                        position: 'relative', 
                        overflow: 'hidden', 
                        backgroundColor: 'var(--grey-100)',
                        aspectRatio: preserveAspectRatio ? undefined : '1 / 1',
                        border: 'none',
                        ...(preserveAspectRatio ? { height: 'auto' } : {})
                      }}
                      onClick={(e) => {
                        if (selectMode) {
                          handleImageSelect(image.id, e);
                        } else {
                          openLightbox(index);
                        }
                      }}
                    >
                      {/* Selection Checkbox */}
                      {selectMode && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 'var(--space-1)',
                            left: 'var(--space-1)',
                            width: '24px',
                            height: '24px',
                            backgroundColor: isSelected ? 'var(--grey-900)' : 'var(--white)',
                            border: '2px solid var(--grey-900)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 20,
                            cursor: 'pointer'
                          }}
                          onClick={(e) => handleImageSelect(image.id, e)}
                        >
                          {isSelected && (
                            <span style={{ color: 'var(--white)', fontWeight: 'bold', fontSize: '10pt' }}>X</span>
                          )}
                        </div>
                      )}
                      
                      {/* Image Container */}
                      <div style={{ 
                        width: '100%', 
                        height: preserveAspectRatio ? 'auto' : '100%', 
                        overflow: 'hidden', 
                        backgroundColor: 'var(--grey-100)',
                        position: 'relative'
                      }}>
                        <SensitiveImageOverlay
                          imageId={image.id}
                          vehicleId={vehicleId}
                          imageUrl={getOptimalImageUrl(image,'medium')}
                          isSensitive={image.is_sensitive || false}
                          sensitiveType={image.sensitive_type}
                          objectFit={preserveAspectRatio ? 'contain' : 'cover'}
                        />
                      </div>

                      {/* Analysis Badge */}
                      {(() => {
                        const metadata = image.ai_scan_metadata;
                        const hasAnalysis = metadata && (
                          metadata.appraiser?.primary_label ||
                          metadata.tier_1_analysis ||
                          metadata.appraiser ||
                          image.ai_last_scanned ||
                          image.angle
                        );
                        if (!hasAnalysis) return null;
                        const angle = image.angle || metadata?.appraiser?.angle || metadata?.appraiser?.primary_label;
                        const analysisType = metadata?.tier_1_analysis ? 'TIER1' : metadata?.appraiser ? 'AI' : 'SCANNED';
                        return (
                          <div style={{
                            position: 'absolute',
                            top: 'var(--space-1)',
                            right: imageTagCounts[image.id] ? '28px' : 'var(--space-1)',
                            backgroundColor: '#10b981',
                            color: '#fff',
                            borderRadius: '0px',
                            border: '1px solid #fff',
                            padding: '2px 6px',
                            fontSize: '7pt',
                            fontWeight: 'bold',
                            fontFamily: '"MS Sans Serif", sans-serif',
                            zIndex: 10,
                            cursor: 'help',
                            maxWidth: '60px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                          title={angle ? `${analysisType}: ${angle}` : `${analysisType} analyzed`}
                          >
                            {angle ? angle.substring(0, 6).toUpperCase() : analysisType}
                          </div>
                        );
                      })()}

                      {/* Source Badge */}
                      {(() => {
                        const source = getImageSource(image);
                        if (source.type === 'user') return null;
                        return (
                          <div style={{
                            position: 'absolute',
                            bottom: 'var(--space-1)',
                            left: 'var(--space-1)',
                            backgroundColor: source.color,
                            color: '#fff',
                            borderRadius: '0px',
                            border: '1px solid #fff',
                            padding: '2px 6px',
                            fontSize: '7pt',
                            fontWeight: 'bold',
                            fontFamily: '"MS Sans Serif", sans-serif',
                            zIndex: 10,
                            cursor: 'help'
                          }}
                          title={`Source: ${source.label}`}
                          >
                            {source.label}
                          </div>
                        );
                      })()}

                      {/* Tag Count Badge */}
                      {imageTagCounts[image.id] && (
                        <div style={{
                          position: 'absolute',
                          top: 'var(--space-1)',
                          right: 'var(--space-1)',
                          backgroundColor: '#000',
                          color: '#fff',
                          borderRadius: '0px',
                          border: '1px solid #fff',
                          width: '18px',
                          height: '18px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '8pt',
                          fontWeight: 'bold',
                          fontFamily: '"MS Sans Serif", sans-serif',
                          zIndex: 10
                        }}>
                          {imageTagCounts[image.id]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
      
      {/* Legacy grid rendering (disabled, kept for reference) */}
      {viewMode === 'grid' && showImages && false && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${imagesPerRow}, 1fr)`, gap: 0 }}>
          {displayedImages.map((image, index) => {
            const isSelected = selectMode && selectedImages?.has(image.id);
            return (
            <div
              key={image.id}
              style={{ 
                cursor: 'pointer', 
                position: 'relative', 
                overflow: 'hidden', 
                backgroundColor: 'var(--grey-100)',
                aspectRatio: preserveAspectRatio ? undefined : '1 / 1',
                border: 'none',
                ...(preserveAspectRatio ? { height: 'auto' } : {})
              }}
              onClick={(e) => {
                if (selectMode) {
                  handleImageSelect(image.id, e);
                } else {
                  openLightbox(index);
                }
              }}
            >
              {/* NEW: Selection Checkbox (top-left when in select mode) */}
              {selectMode && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'var(--space-1)',
                    left: 'var(--space-1)',
                    width: '24px',
                    height: '24px',
                    backgroundColor: isSelected ? 'var(--grey-900)' : 'var(--white)',
                    border: '2px solid var(--grey-900)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 20,
                    cursor: 'pointer'
                  }}
                  onClick={(e) => handleImageSelect(image.id, e)}
                >
                  {isSelected && (
                    <span style={{ color: 'var(--white)', fontWeight: 'bold', fontSize: '10pt' }}>X</span>
                  )}
                </div>
              )}
              
              {/* Image Container with Sensitive Content Protection */}
              <div style={{ 
                width: '100%', 
                height: preserveAspectRatio ? 'auto' : '100%', 
                overflow: 'hidden', 
                backgroundColor: 'var(--grey-100)',
                position: 'relative'
              }}>
                <SensitiveImageOverlay
                  imageId={image.id}
                  vehicleId={vehicleId}
                  imageUrl={getOptimalImageUrl(image,'medium')}
                  isSensitive={image.is_sensitive || false}
                  sensitiveType={image.sensitive_type}
                  objectFit={preserveAspectRatio ? 'contain' : 'cover'}
                />
              </div>

              {/* Analysis Badge - Shows if image has been analyzed */}
              {(() => {
                const metadata = image.ai_scan_metadata;
                const hasAnalysis = metadata && (
                  metadata.appraiser?.primary_label ||
                  metadata.tier_1_analysis ||
                  metadata.appraiser ||
                  image.ai_last_scanned ||
                  image.angle
                );
                
                if (!hasAnalysis) return null;
                
                const angle = image.angle || metadata?.appraiser?.angle || metadata?.appraiser?.primary_label;
                const analysisType = metadata?.tier_1_analysis ? 'TIER1' : metadata?.appraiser ? 'AI' : 'SCANNED';
                
                return (
                  <div style={{
                    position: 'absolute',
                    top: 'var(--space-1)',
                    right: imageTagCounts[image.id] ? '28px' : 'var(--space-1)',
                    backgroundColor: '#10b981',
                    color: '#fff',
                    borderRadius: '0px',
                    border: '1px solid #fff',
                    padding: '2px 6px',
                    fontSize: '7pt',
                    fontWeight: 'bold',
                    fontFamily: '"MS Sans Serif", sans-serif',
                    zIndex: 10,
                    cursor: 'help',
                    maxWidth: '60px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={angle ? `${analysisType}: ${angle}` : `${analysisType} analyzed`}
                  >
                    {angle ? angle.substring(0, 6).toUpperCase() : analysisType}
                  </div>
                );
              })()}

              {/* Source Badge - Bottom left - Round stamp for validation */}
              {(() => {
                const source = getImageSource(image);
                // Only show badge if not a user upload (to reduce clutter)
                if (source.type === 'user') return null;
                return (
                  <div 
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      left: '4px',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(0,0,0,0.75)',
                      border: `2px solid ${source.color}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      zIndex: 10,
                      cursor: 'help',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                    }}
                    title={`Verified by: ${source.label}`}
                  >
                    {source.logoUrl ? (
                      <img 
                        src={source.logoUrl} 
                        alt={source.label}
                        style={{ 
                          width: '16px', 
                          height: '16px', 
                          objectFit: 'contain',
                          filter: 'brightness(1.1)'
                        }}
                        onError={(e) => { 
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).parentElement!.innerHTML = `<span style="font-size: 8px; font-weight: 700; color: ${source.color}">${source.label[0]}</span>`;
                        }}
                      />
                    ) : (
                      <span style={{ 
                        fontSize: '9px', 
                        fontWeight: 700, 
                        color: source.color,
                        textTransform: 'uppercase'
                      }}>
                        {source.label[0]}
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* Tag Count Badge */}
              {imageTagCounts[image.id] && (
                <div style={{
                  position: 'absolute',
                  top: 'var(--space-1)',
                  right: 'var(--space-1)',
                  backgroundColor: '#000',
                  color: '#fff',
                  borderRadius: '0px',
                  border: '1px solid #fff',
                  width: '18px',
                  height: '18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '8pt',
                  fontWeight: 'bold',
                  fontFamily: '"MS Sans Serif", sans-serif',
                  zIndex: 10
                }}>
                  {imageTagCounts[image.id]}
                </div>
              )}

              {/* NEW: Set Count Badge (top-right, below tag count) */}
              {showSetCount && imageSetCounts[image.id] && (
                <div style={{
                  position: 'absolute',
                  top: imageTagCounts[image.id] ? '28px' : 'var(--space-1)',
                  right: 'var(--space-1)',
                  backgroundColor: '#4169E1',
                  color: '#fff',
                  borderRadius: '0px',
                  border: '1px solid #fff',
                  padding: '2px 6px',
                  fontSize: '7pt',
                  fontWeight: 'bold',
                  fontFamily: '"MS Sans Serif", sans-serif',
                  zIndex: 10
                }}>
                  {imageSetCounts[image.id]} SETS
                </div>
              )}

              {/* NEW: Priority Badge (bottom-right corner) */}
              {showPriority && image.manual_priority > 0 && (
                <div style={{
                  position: 'absolute',
                  bottom: 'var(--space-1)',
                  right: 'var(--space-1)',
                  backgroundColor: image.manual_priority >= 90 ? '#FFD700' : image.manual_priority >= 70 ? '#C0C0C0' : '#CD7F32',
                  color: '#000',
                  borderRadius: '0px',
                  border: '2px solid #fff',
                  padding: '2px 6px',
                  fontSize: '7pt',
                  fontWeight: 'bold',
                  fontFamily: '"MS Sans Serif", sans-serif',
                  zIndex: 10
                }}>
                  {image.manual_priority}
                </div>
              )}

              {/* Image Info Overlay */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)', padding: 'var(--space-2)' }}>
                {image.is_primary && (
                  <div className="button button-small" style={{ fontSize: '6pt', padding: '2px 6px', marginBottom: 'var(--space-1)', backgroundColor: 'var(--grey-600)', color: 'var(--white)' }}>
                    PRIMARY
                  </div>
                )}
                {image.caption && (
                  <p className="text" style={{ color: 'var(--white)', fontSize: '7pt', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.caption}</p>
                )}
                <p className="text" style={{ color: 'var(--surface-glass)', fontSize: '6pt', marginTop: '2px' }}>
                  {getDisplayDate(image)}
                  {imageTagCounts[image.id] && ` • ${imageTagCounts[image.id]} tags`}
                  {showSetCount && imageSetCounts[image.id] && ` • ${imageSetCounts[image.id]} sets`}
                  {(() => {
                    const metadata = image.ai_scan_metadata;
                    const hasAnalysis = metadata && (
                      metadata.appraiser?.primary_label ||
                      metadata.tier_1_analysis ||
                      metadata.appraiser ||
                      image.ai_last_scanned
                    );
                    return hasAnalysis ? ' • Analyzed' : '';
                  })()}
                </p>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Load More - Infinite Scroll */}
      {showImages && displayedImages.length < allImages.length && (
        <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-2)' }}>
          {loadingMore && (
            <div style={{ padding: 'var(--space-2)', color: 'var(--text-muted)', fontSize: '8pt' }}>
              Loading more images...
            </div>
          )}
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: '1px' }} />
        </div>
      )}

      {/* Full View - Single column, full width images */}
      {viewMode === 'masonry' && showImages && (
        <div>
          {displayedImages.map((image, index) => (
            <div
              key={image.id}
              style={{ 
                cursor: 'pointer', 
                position: 'relative', 
                overflow: 'hidden', 
                backgroundColor: 'var(--grey-100)',
                width: '100%'
              }}
              onClick={() => openLightbox(index)}
            >
              <img
                src={getOptimalImageUrl(image, 'large')}
                alt={image.caption || 'Vehicle image'}
                style={{ width: '100%', height: 'auto', display: 'block' }}
                loading="lazy"
              />

              {/* Analysis Badge */}
              {(() => {
                const metadata = image.ai_scan_metadata;
                const hasAnalysis = metadata && (
                  metadata.appraiser?.primary_label ||
                  metadata.tier_1_analysis ||
                  metadata.appraiser ||
                  image.ai_last_scanned ||
                  image.angle
                );
                
                if (!hasAnalysis) return null;
                
                const angle = image.angle || metadata?.appraiser?.angle || metadata?.appraiser?.primary_label;
                
                return (
                  <div style={{
                    position: 'absolute',
                    top: 'var(--space-1)',
                    right: 'var(--space-1)',
                    backgroundColor: '#10b981',
                    color: '#fff',
                    borderRadius: '0px',
                    border: '1px solid #fff',
                    padding: '2px 6px',
                    fontSize: '7pt',
                    fontWeight: 'bold',
                    fontFamily: '"MS Sans Serif", sans-serif',
                    zIndex: 10
                  }}
                  title={angle ? `Analyzed: ${angle}` : 'AI analyzed'}
                  >
                    {angle ? angle.substring(0, 8).toUpperCase() : 'AI'}
                  </div>
                );
              })()}

              {/* Source Badge - Round stamp for validation (masonry view) */}
              {(() => {
                const source = getImageSource(image);
                if (source.type === 'user') return null;
                return (
                  <div 
                    style={{
                      position: 'absolute',
                      bottom: '50px',
                      left: '8px',
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(0,0,0,0.75)',
                      border: `2px solid ${source.color}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      zIndex: 10,
                      cursor: 'help',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                    }}
                    title={`Verified by: ${source.label}`}
                  >
                    {source.logoUrl ? (
                      <img 
                        src={source.logoUrl} 
                        alt={source.label}
                        style={{ width: '18px', height: '18px', objectFit: 'contain', filter: 'brightness(1.1)' }}
                        onError={(e) => { 
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).parentElement!.innerHTML = `<span style="font-size: 10px; font-weight: 700; color: ${source.color}">${source.label[0]}</span>`;
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: '10px', fontWeight: 700, color: source.color, textTransform: 'uppercase' }}>
                        {source.label[0]}
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* Image Info Overlay */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)', padding: 'var(--space-2)' }}>
                {image.is_primary && (
                  <div className="button button-small" style={{ fontSize: '6pt', padding: '2px 6px', marginBottom: 'var(--space-1)', backgroundColor: 'var(--grey-600)', color: 'var(--white)' }}>
                    PRIMARY
                  </div>
                )}
                {image.caption && (
                  <p className="text" style={{ color: 'var(--white)', fontSize: '7pt', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.caption}</p>
                )}
                <p className="text" style={{ color: 'var(--surface-glass)', fontSize: '6pt', marginTop: '2px' }}>
                  {getDisplayDate(image)}
                  {(() => {
                    const metadata = image.ai_scan_metadata;
                    const hasAnalysis = metadata && (
                      metadata.appraiser?.primary_label ||
                      metadata.tier_1_analysis ||
                      metadata.appraiser ||
                      image.ai_last_scanned
                    );
                    return hasAnalysis ? ' • Analyzed' : '';
                  })()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info View - Compact list with image left, info right, zero spacing */}
      {viewMode === 'list' && showImages && (
        <div>
          {displayedImages.map((image, index) => (
            <div
              key={image.id}
              style={{ 
                display: 'flex', 
                gap: 'var(--space-2)', 
                padding: 'var(--space-2)', 
                cursor: 'pointer', 
                borderBottom: '1px solid var(--border)', 
                backgroundColor: 'var(--white)',
                margin: 0
              }}
              onClick={() => openLightbox(index)}
            >
              {/* Thumbnail with Source Badge */}
              <div style={{ flexShrink: 0, width: '100px', height: '100px', overflow: 'hidden', backgroundColor: 'var(--grey-100)', position: 'relative' }}>
                <img
                  src={getOptimalImageUrl(image, 'thumbnail')}
                  alt={image.caption || 'Vehicle image'}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    imageOrientation: 'from-image'
                  }}
                  loading="lazy"
                />
                {/* Source Badge - Round stamp (list view) */}
                {(() => {
                  const source = getImageSource(image);
                  if (source.type === 'user') return null;
                  return (
                    <div 
                      style={{
                        position: 'absolute',
                        bottom: '4px',
                        left: '4px',
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(0,0,0,0.75)',
                        border: `2px solid ${source.color}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        zIndex: 10,
                        cursor: 'help',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.3)'
                      }}
                      title={`Verified by: ${source.label}`}
                    >
                      {source.logoUrl ? (
                        <img 
                          src={source.logoUrl} 
                          alt={source.label}
                          style={{ width: '14px', height: '14px', objectFit: 'contain', filter: 'brightness(1.1)' }}
                          onError={(e) => { 
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: '8px', fontWeight: 700, color: source.color }}>
                          {source.label[0]}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Info - Everything compressed */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1px' }}>
                <div style={{ fontSize: '8pt', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {image.is_primary && <span style={{ backgroundColor: 'var(--grey-900)', color: 'var(--white)', padding: '1px 4px', marginRight: '4px', fontSize: '6pt' }}>PRIMARY</span>}
                  {image.caption || 'Vehicle Image'}
                </div>
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                  {getDisplayDate(image)}
                  {getTimeOfDayLabel(image.taken_at || image.created_at) && ` • ${getTimeOfDayLabel(image.taken_at || image.created_at)}`}
                  {(() => {
                    // Imported images (scraped listings) should NOT appear “authored” by the user who ran the import.
                    const domain = getImportedSourceDomain(image);
                    if (domain) return ` • Imported (${domain})`;
                    return image.user_id ? ` • ${uploaderOrgNames[image.user_id] || imageUploaderNames[image.user_id] || 'user'}` : '';
                  })()}
                  {(() => {
                    const metadata = image.ai_scan_metadata;
                    const hasAnalysis = metadata && (
                      metadata.appraiser?.primary_label ||
                      metadata.tier_1_analysis ||
                      metadata.appraiser ||
                      image.ai_last_scanned ||
                      image.angle
                    );
                    if (!hasAnalysis) return null;
                    const angle = image.angle || metadata?.appraiser?.angle || metadata?.appraiser?.primary_label;
                    return angle ? ` • ${angle}` : ' • Analyzed';
                  })()}
                </div>
                {/* Everything else on one line */}
                <div style={{ fontSize: '6pt', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {getCameraText(image.exif_data) && <span>{getCameraText(image.exif_data)}</span>}
                  {(() => {
                    const locationText = getLocationText(image.exif_data);
                    const hasGps = image.exif_data?.gps && image.exif_data.gps.latitude && image.exif_data.gps.longitude;
                    const gpsText = hasGps ? `${image.exif_data.gps.latitude.toFixed?.(2) || image.exif_data.gps.latitude}, ${image.exif_data.gps.longitude.toFixed?.(2) || image.exif_data.gps.longitude}` : null;
                    const finalLocationText = locationText || gpsText;
                    return (
                      <>
                        {getCameraText(image.exif_data) && finalLocationText && <span> • </span>}
                        {finalLocationText && <span>{finalLocationText}</span>}
                      </>
                    );
                  })()}
                  {typeof imageViewCounts[image.id] === 'number' && imageViewCounts[image.id] > 0 && <span> • {imageViewCounts[image.id]}v</span>}
                  {typeof imageCommentCounts[image.id] === 'number' && imageCommentCounts[image.id] > 0 && <span> • {imageCommentCounts[image.id]}c</span>}
                  {imageTagCounts[image.id] && <span> • {imageTagCounts[image.id]}t</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image Lightbox - Using proper ImageLightbox component with tags */}
      {lightboxOpen && currentImage && (
        <ImageLightbox
          imageUrl={getOptimalImageUrl(currentImage, 'full')}
          imageId={lightboxImageId}
          vehicleId={vehicleId}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          onNext={displayedImages.length > 1 ? nextImage : undefined}
          onPrev={displayedImages.length > 1 ? previousImage : undefined}
          canEdit={canCreateTags && !usingFallback}
          title={`${currentImageIndex + 1} of ${displayedImages.length}`}
          description={getDisplayDate(currentImage)}
        />
      )}

      {/* Onboarding Modal for non-logged-in users */}
      <OnboardingSlideshow
        isOpen={showOnboardingModal}
        onClose={() => setShowOnboardingModal(false)}
      />
    </div>
  );
};

export default ImageGallery;
