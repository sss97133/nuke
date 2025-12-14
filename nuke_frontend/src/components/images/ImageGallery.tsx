import React, { useState, useEffect, useCallback } from 'react';
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
  const [sortBy, setSortBy] = useState<'quality' | 'date_desc' | 'date_asc'>('quality'); // Default to quality (best first)
  const [showFilters, setShowFilters] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [imagesPerPage] = useState(25);
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

  // Vehicle meta (used to suppress "BaT homepage noise" images that were mistakenly attached to some vehicles)
  const [vehicleMeta, setVehicleMeta] = useState<any | null>(null);
  useEffect(() => {
    (async () => {
      try {
        if (!vehicleId) { setVehicleMeta(null); return; }
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, year, make, model, profile_origin, discovery_url')
          .eq('id', vehicleId)
          .maybeSingle();
        if (!error) setVehicleMeta(data || null);
      } catch {
        setVehicleMeta(null);
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

  const filterBatNoiseRows = (rows: any[], meta: any = vehicleMeta): any[] => {
    const needle = buildBatImageNeedle(meta);
    if (!needle) return rows;
    const keep = (rows || []).filter((img: any) => {
      const url = String(img?.image_url || '');
      if (!url) return false;
      // Never filter out non-BaT URLs (user uploads, Supabase storage, etc.)
      if (!url.includes('bringatrailer.com/wp-content/uploads/')) return true;
      return url.toLowerCase().includes(needle.toLowerCase());
    });
    return keep.length > 0 ? keep : rows;
  };

  // When vehicle meta arrives, re-filter any already-loaded images so the UI doesn't briefly show
  // unrelated BaT homepage / other-lot images for bat_import vehicles.
  useEffect(() => {
    if (!vehicleMeta) return;
    if (!allImages || allImages.length === 0) return;
    const nextAll = filterBatNoiseRows(allImages);
    if (nextAll.length === allImages.length) return;
    setAllImages(nextAll);
    setDisplayedImages(nextAll.slice(0, Math.min(50, nextAll.length)));
    // Do not toggle usingFallback here; we only filter the current view.
  }, [vehicleMeta]); // intentionally not depending on allImages to avoid loops

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
    return out.slice(0, 120); // hard cap to keep UI performant
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
        .eq('is_document', false)
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
          caption: fallbackLabel,
          category: 'general',
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
        .select('id, image_url, thumbnail_url, medium_url, large_url, variants, is_primary, caption, created_at, taken_at, exif_data, user_id, is_sensitive, sensitive_type, is_document, document_category, ai_scan_metadata, ai_last_scanned, angle, category, storage_path, file_hash')
        .eq('vehicle_id', vehicleId)
        .eq('is_document', false)
        .or('is_duplicate.is.null,is_duplicate.eq.false')
        .order('is_primary', { ascending: false });
      if (refreshErr) throw refreshErr;

      const images = filterBatNoiseRows(dedupeFetchedImages(refreshed || []));
      setUsingFallback(false);
      setAllImages(images);
      setDisplayedImages(images.slice(0, Math.min(50, images.length)));
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
  const getSortedImages = () => {
    if (sortBy === 'quality') {
      // Presentation sorting - best images first
      // Try AI-based sorting first, fallback to heuristics if no angle data
      try {
        const sorted = sortImagesByPriority(allImages);
        // Check if it actually sorted (has variety in positions)
        if (sorted.length > 0) return sorted;
      } catch (e) {
        console.log('AI sorting unavailable, using heuristics');
      }
      
      // Fallback: Smart heuristics when no AI angle data exists
      return [...allImages].sort((a, b) => {
        // Primary images always first
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        
        // Category-based priority (exterior > interior > engine > other)
        const catPriority: Record<string, number> = {
          'exterior': 100,
          'hero': 95,
          'interior': 80,
          'engine': 70,
          'engine_bay': 70,
          'undercarriage': 50,
          'detail': 40,
          'general': 30,
          'work': 10,
          'document': 5,
          'receipt': -10
        };
        
        const catA = catPriority[(a.category || 'general').toLowerCase()] || 20;
        const catB = catPriority[(b.category || 'general').toLowerCase()] || 20;
        
        if (catA !== catB) return catB - catA;
        
        // Within same category, newer first
        const dateA = new Date(a.taken_at || a.created_at).getTime();
        const dateB = new Date(b.taken_at || b.created_at).getTime();
        
        if (dateA !== dateB) return dateB - dateA;
        
        // Stable fallback when dates are equal
        return (a.id || '').localeCompare(b.id || '');
      });
    } else if (sortBy === 'date_desc') {
      return [...allImages].sort((a, b) => {
        const dateA = new Date(a.taken_at || a.created_at).getTime();
        const dateB = new Date(b.taken_at || b.created_at).getTime();
        
        if (dateA !== dateB) return dateB - dateA;
        
        // Stable fallback when dates are equal
        return (a.id || '').localeCompare(b.id || '');
      });
    } else {
      // date_asc
      return [...allImages].sort((a, b) => {
        const dateA = new Date(a.taken_at || a.created_at).getTime();
        const dateB = new Date(b.taken_at || b.created_at).getTime();
        
        if (dateA !== dateB) return dateA - dateB;
        
        // Stable fallback when dates are equal
        return (a.id || '').localeCompare(b.id || '');
      });
    }
  };

  const dedupeFetchedImages = (images: any[]): any[] => {
    // Defensive UI de-dupe: older rows may not have is_duplicate populated,
    // or multiple rows may point at the same underlying file/variant.
    const keyFor = (img: any): string => {
      return (
        img?.file_hash ||
        img?.storage_path ||
        img?.variants?.full ||
        img?.variants?.large ||
        img?.image_url ||
        img?.large_url ||
        img?.medium_url ||
        img?.thumbnail_url ||
        img?.id ||
        ''
      );
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
    for (const img of prioritized) {
      const k = keyFor(img);
      if (!k) {
        out.push(img);
        continue;
      }
      if (seen.has(k)) continue;
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
          .select('id, image_url, thumbnail_url, medium_url, large_url, variants, is_primary, caption, created_at, taken_at, exif_data, user_id, is_sensitive, sensitive_type, is_document, document_category, ai_scan_metadata, ai_last_scanned, angle, category, storage_path, file_hash')
          .eq('vehicle_id', vehicleId)
          .eq('is_document', false) // Filter out documents - they should be in a separate section
          // Hide duplicate rows by default (upload pipeline marks true duplicates)
          .or('is_duplicate.is.null,is_duplicate.eq.false')
          .order('is_primary', { ascending: false });

        if (error) throw error;
        const images = filterBatNoiseRows(dedupeFetchedImages(rawImages || []), meta);

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
          // Load an initial batch (50 or fewer) immediately
          const sorted = [...images].sort((a: any, b: any) => {
            const da = new Date(a.taken_at || a.created_at).getTime();
            const db = new Date(b.taken_at || b.created_at).getTime();
            return sortBy === 'date_desc' ? db - da : da - db;
          });
          const initialBatch = Math.min(50, sorted.length);
          setDisplayedImages(sorted.slice(0, initialBatch));
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
              .select('id, image_url, thumbnail_url, medium_url, large_url, variants, is_primary, caption, created_at, taken_at, exif_data, user_id, is_sensitive, sensitive_type, is_document, document_category, ai_scan_metadata, ai_last_scanned, angle, category')
              .eq('vehicle_id', vehicleId)
              .eq('is_document', false)
              .or('is_duplicate.is.null,is_duplicate.eq.false')
              .order('is_primary', { ascending: false });
            
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
    
    window.addEventListener('image_processing_complete', handleImageProcessingComplete as EventListener);
    
    return () => {
      window.removeEventListener('image_processing_complete', handleImageProcessingComplete as EventListener);
    };
  }, [vehicleId, displayedImages.length, onImagesUpdated]);

  // Re-sort displayed images when sort option changes
  useEffect(() => {
    if (showImages && displayedImages.length > 0) {
      const sortedImages = getSortedImages();
      setDisplayedImages(sortedImages.slice(0, displayedImages.length));
    }
  }, [sortBy]);

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
        .select('id, image_url, thumbnail_url, medium_url, large_url, is_primary, caption, created_at, taken_at, is_document, document_category')
        .eq('vehicle_id', vehicleId)
        .eq('is_document', false) // Filter out documents
        .or('is_duplicate.is.null,is_duplicate.eq.false')
        .order('is_primary', { ascending: false });

      const refreshedDeduped = dedupeFetchedImages(refreshedImages || []);
      const refreshedFiltered = filterBatNoiseRows(refreshedDeduped);
      setAllImages(refreshedFiltered);
      
      // Always show images after upload and refresh the display
      setShowImages(true);
      
      // Refresh displayed images with the new uploads
      const sortedImages = (refreshedFiltered || []).sort((a: any, b: any) => {
        if (sortBy === 'primary') {
          if (a.is_primary && !b.is_primary) return -1;
          if (!a.is_primary && b.is_primary) return 1;
          return 0;
        }
        const da = new Date(a.taken_at || a.created_at).getTime();
        const db = new Date(b.taken_at || b.created_at).getTime();
        return sortBy === 'date_desc' ? db - da : da - db;
      });
      
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
    // Use taken_at (when photo was taken) if available, otherwise fall back to created_at (when uploaded)
    const displayDate = image.taken_at || image.created_at;
    if (!displayDate) return 'No date';
    try {
      const date = new Date(displayDate);
      if (isNaN(date.getTime())) return 'Invalid date';
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

          {/* Sort Options */}
          <select
            value={sortBy}
            onChange={(e) => {
              const newSort = e.target.value as any;
              if (newSort === 'quality') {
                alert('Presentation sorting requires AI angle analysis.\n\nImages will be analyzed automatically on upload in the future.\n\nUsing newest first for now.');
                setSortBy('date_desc');
              } else {
                setSortBy(newSort);
              }
            }}
            className="form-select"
            style={{ fontSize: '8pt', padding: '4px 8px', height: '24px', minHeight: '24px' }}
          >
            <option value="quality">Best First</option>
            <option value="date_desc">Newest First</option>
            <option value="date_asc">Oldest First</option>
          </select>

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0 }}>
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
                aspectRatio: '1 / 1',
                border: 'none'
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
              <div style={{ width: '100%', height: '100%', overflow: 'hidden', backgroundColor: 'var(--grey-100)' }}>
                <SensitiveImageOverlay
                  imageId={image.id}
                  vehicleId={vehicleId}
                  imageUrl={getOptimalImageUrl(image, 'medium')}
                  isSensitive={image.is_sensitive || false}
                  sensitiveType={image.sensitive_type}
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
                <p className="text" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '6pt', marginTop: '2px' }}>
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
                <p className="text" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '6pt', marginTop: '2px' }}>
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
              {/* Thumbnail */}
              <div style={{ flexShrink: 0, width: '100px', height: '100px', overflow: 'hidden', backgroundColor: 'var(--grey-100)' }}>
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
                  {image.user_id && ` • ${uploaderOrgNames[image.user_id] || imageUploaderNames[image.user_id] || 'user'}`}
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
