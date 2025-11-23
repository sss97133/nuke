import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getSupabaseFunctionsUrl } from '../../lib/supabase';
import { uploadQueue } from '../../services/globalUploadQueue';
import { TimelineEventService } from '../../services/timelineEventService';
// AppLayout now provided globally by App.tsx
import TitleScan from '../../components/TitleScan';
import { UniversalImageUpload } from '../../components/UniversalImageUpload';
// Modular components
import { useVehicleForm } from './hooks/useVehicleForm';
import VehicleFormFields from './components/VehicleFormFields';
import VerificationProgress from './components/VerificationProgress';
import type { VehicleFormData, DetailLevel, ImageUploadProgress, ImageUploadStatus } from './types/index';
import { extractImageMetadata, reverseGeocode, getEventDateFromImages, getEventLocationFromImages, type ImageMetadata } from '../../utils/imageMetadata';
import { generateCraigslistEmail } from '../../utils/generateCraigslistEmail';

const toDateTimeLocalString = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num: number) => String(num).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const parseCurrencyValue = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const cleaned = trimmed.replace(/[^0-9.,-]+/g, '');
    if (!cleaned) return null;
    // If multiple commas and a dot, assume dot is decimal separator
    const normalized = cleaned.includes('.')
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatCurrency = (value: number | null | undefined): string | null => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0
    }).format(value);
  } catch (error) {
    console.warn('Failed to format currency value:', value, error);
    return `$${value}`;
  }
};

const mapDiscoverySourceToCategory = (source?: string | null): 'search' | 'recommendation' | 'social_share' | 'direct_link' | 'auction_site' | 'dealer_listing' | 'user_submission' => {
  if (!source) return 'direct_link';
  const normalized = source.toLowerCase();
  if (normalized.includes('bring a trailer') || normalized.includes('bat') || normalized.includes('auction')) {
    return 'auction_site';
  }
  if (normalized.includes('craigslist') || normalized.includes('marketplace') || normalized.includes('dealer') || normalized.includes('autotrader') || normalized.includes('cars.com')) {
    return 'dealer_listing';
  }
  return 'direct_link';
};

interface AddVehicleProps {
  mode?: 'modal' | 'page';
  onClose?: () => void;
  onSuccess?: (vehicleId: string) => void;
}

const AddVehicle: React.FC<AddVehicleProps> = ({ 
  mode = 'page',
  onClose,
  onSuccess 
}) => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);

  // Form state using custom hook
  const {
    formData,
    verificationProgress,
    autoSaveState,
    error: formError,
    updateField,
    updateFormData,
    validateForm,
    clearAutosave
  } = useVehicleForm();

  // Component-specific state
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('basic');
  const [showTitleScan, setShowTitleScan] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [autoFilledFields, setAutoFilledFields] = useState<string[]>([]);
  const [lastScrapedData, setLastScrapedData] = useState<any | null>(null);
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string } | null>(null);
  const [showEmailDraft, setShowEmailDraft] = useState(false);
  const [copiedField, setCopiedField] = useState<'subject' | 'body' | null>(null);

  // URL scraping state
  const [isScrapingUrl, setIsScrapingUrl] = useState(false);
  const [scrapingError, setScrapingError] = useState<string | null>(null);
  const [lastScrapedUrl, setLastScrapedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (autoFilledFields.length === 0) return;
    const timeoutId = window.setTimeout(() => setAutoFilledFields([]), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [autoFilledFields]);

  const autoFilledDisplay = autoFilledFields
    .slice(0, 8)
    .map((field) => field.replace(/_/g, ' '));

  // Image upload state
  const [uploadProgress, setUploadProgress] = useState<ImageUploadProgress>({});
  const [uploadStatus, setUploadStatus] = useState<ImageUploadStatus>({});
  const [uploadingImages, setUploadingImages] = useState(false);
  const [extractedImages, setExtractedImages] = useState<File[]>([]);
  const [imageMetadata, setImageMetadata] = useState<Map<string, ImageMetadata>>(new Map());
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{current: number, total: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
      } catch (error) {
        console.error('Error getting user:', error);
        setSubmitError('Failed to authenticate user');
      }
    };
    getUser();
  }, []);

  // Note: Do NOT return early here based on isMobile.
  // We must call all hooks in this component before any conditional return
  // to keep hook order consistent across renders. The mobile return is placed
  // later (just before the auth gate) after all hooks are declared.

  // Helper function to download images from URLs and convert to File objects
  const downloadImagesAsFiles = async (imageUrls: string[], source: string = 'external'): Promise<File[]> => {
    const files: File[] = [];
    const MAX_CONCURRENT = 5; // Download 5 images at a time
    const DOWNLOAD_TIMEOUT = 15000; // 15 second timeout per image
    
    try {
      // Process in batches to avoid overwhelming the browser
      for (let i = 0; i < imageUrls.length; i += MAX_CONCURRENT) {
        const batch = imageUrls.slice(i, i + MAX_CONCURRENT);
        const batchPromises = batch.map(async (url, batchIndex) => {
          try {
            const globalIndex = i + batchIndex;
            console.log(`Downloading image ${globalIndex + 1}/${imageUrls.length}: ${url}`);
            
            // Use CORS proxy to fetch images from external sites
            const corsProxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
            
            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
            
            const response = await fetch(corsProxyUrl, {
              signal: controller.signal,
              headers: {
                'Accept': 'image/*',
                'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)'
              }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const blob = await response.blob();
            
            // Validate blob size (max 10MB)
            if (blob.size > 10 * 1024 * 1024) {
              throw new Error(`Image too large: ${Math.round(blob.size / 1024 / 1024)}MB`);
            }
            
            // Determine file extension from URL or content type
            let extension = 'jpg';
            const urlExt = url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
            if (urlExt) {
              extension = urlExt[1].toLowerCase();
            } else if (blob.type) {
              const typeExt = blob.type.split('/')[1];
              if (typeExt && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(typeExt)) {
                extension = typeExt;
              }
            }
            
            // Create filename with source prefix
            const filename = `${source.toLowerCase().replace(/\s+/g, '_')}_${globalIndex + 1}.${extension}`;
            
            // Convert blob to File
            const file = new File([blob], filename, { type: blob.type || `image/${extension}` });
            
            return file;
          } catch (error: any) {
            if (error.name === 'AbortError') {
              console.error(`Download timeout for image ${url}`);
            } else {
              console.error(`Failed to download image ${url}:`, error);
            }
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const successfulFiles = batchResults.filter((f): f is File => f !== null);
        files.push(...successfulFiles);
        
        // Small delay between batches to be respectful
        if (i + MAX_CONCURRENT < imageUrls.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      console.error('Batch download error:', error);
      throw new Error(`Image download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    return files;
  };

  // Handle title scan completion
  const handleTitleScanComplete = useCallback((scannedData: any) => {
    // Automatically set relationship to owned when title is scanned
    // This pre-certifies ownership since they have the title document
    updateFormData({
      ...scannedData,
      relationship_type: 'owned',
      scanned_fields: Object.keys(scannedData)
    });
    setScanCompleted(true);
    setShowTitleScan(false);
    
    // If we have a document ID, automatically mark as ownership verified
    if (scannedData.documentId) {
      console.log('Title document uploaded, ownership pre-verified via title scan');
    }
  }, [updateFormData]);

  // Handle URL scraping when import_url changes
  const handleUrlScraping = useCallback(async (url: string) => {
    if (!url || url === lastScrapedUrl) return;

    // Check if it's a supported URL
    const supportedSites = [
      'bringatrailer.com',
      'hagerty.com',
      'classic.com',
      'cars.com',
      'autotrader.com',
      'facebook.com/marketplace',
      'craigslist.org'
    ];

    const isSupported = supportedSites.some(site => url.includes(site));
    if (!isSupported) {
      setScrapingError(`Supported sites: ${supportedSites.join(', ')}`);
      return;
    }

    try {
      setIsScrapingUrl(true);
      setScrapingError(null);
      setLastScrapedUrl(url);

      // URL DEDUPLICATION CHECK - prevent redundant imports
      const { data: existingVehicle, error: dupError } = await supabase
        .from('vehicles')
        .select('id, make, model, year, discovered_by')
        .eq('discovery_url', url)
        .single();

      if (existingVehicle && !dupError) {
        // This URL was already imported!
        
        // Count existing discoverers
        const { count: discovererCount } = await supabase
          .from('user_contributions')
          .select('id', { count: 'exact', head: true })
          .eq('vehicle_id', existingVehicle.id)
          .eq('contribution_type', 'discovery');

        const yourRank = (discovererCount || 0) + 1;

        // Credit this user as additional discoverer
        if (user?.id) {
          await supabase.from('user_contributions').insert({
            user_id: user.id,
            vehicle_id: existingVehicle.id,
            contribution_type: 'discovery',
            metadata: { 
              discovery_url: url,
              discovery_rank: yourRank,
              discovered_at: new Date().toISOString()
            }
          });

          try {
            await supabase.from('discovered_vehicles').upsert({
              user_id: user.id,
              vehicle_id: existingVehicle.id,
              discovery_source: mapDiscoverySourceToCategory(formData.listing_source),
              discovery_context: formData.discoverer_opinion || '',
              interest_level: 'high',
              is_active: true,
              updated_at: new Date().toISOString()
            }, { onConflict: 'vehicle_id,user_id' });
          } catch (err) {
            console.warn('Failed to upsert discovered_vehicles entry:', err);
          }
        }

        // Show notification and navigate to existing vehicle
        alert(`This vehicle is already in our system!

${existingVehicle.year} ${existingVehicle.make} ${existingVehicle.model}

You're discoverer #${yourRank}! 🎉
Redirecting to vehicle profile...`);

        setIsScrapingUrl(false);
        
        // Navigate to existing vehicle or close modal
        if (mode === 'modal' && onClose) {
          onClose();
        }
        navigate(`/vehicle/${existingVehicle.id}`);
        return;
      }

      // URL is new - proceed with scraping
      console.log('New URL - scraping data:', url);

      // Call Supabase Edge Function (scrape-vehicle)
      const { data: result, error: fnError } = await supabase.functions.invoke('scrape-vehicle', {
        body: { url }
      });
      if (fnError) {
        throw new Error(`Scraping failed: ${fnError.message || fnError}`);
      }

      if (result.success && result.data) {
        const scrapedData = result.data;
        console.log('Full scraped data received:', scrapedData);

        // Map ALL scraped data to form fields
        const updates: Partial<VehicleFormData> = {};

        // Basic vehicle info
        if (scrapedData.make) updates.make = scrapedData.make;
        if (scrapedData.model) updates.model = scrapedData.model;
        if (scrapedData.year) updates.year = parseInt(scrapedData.year);
        if (scrapedData.vin) updates.vin = scrapedData.vin;
        
        // Mileage (handle both string and number)
        if (scrapedData.mileage) {
          const mileageStr = typeof scrapedData.mileage === 'string' 
            ? scrapedData.mileage 
            : String(scrapedData.mileage);
          updates.mileage = parseInt(mileageStr.replace(/,/g, ''));
        }
        
        // Appearance
        if (scrapedData.color) updates.color = scrapedData.color;
        if (scrapedData.body_style) updates.body_style = scrapedData.body_style;
        
        // Mechanical (careful with types - displacement is STRING in form)
        if (scrapedData.transmission) updates.transmission = scrapedData.transmission;
        if (scrapedData.engine_size) updates.engine_size = scrapedData.engine_size;
        if (scrapedData.displacement) updates.displacement = String(scrapedData.displacement);
        if (scrapedData.engine_liters) updates.displacement = String(scrapedData.engine_liters);
        if (scrapedData.drivetrain) updates.drivetrain = scrapedData.drivetrain;
        if (scrapedData.fuel_type) updates.fuel_type = scrapedData.fuel_type;
        
        // Pricing
        const salePrice = parseCurrencyValue(scrapedData.sale_price);
        const askingPrice = parseCurrencyValue(scrapedData.asking_price ?? scrapedData.price);
        if (salePrice !== null) updates.sale_price = salePrice;
        if (askingPrice !== null) updates.asking_price = askingPrice;
        
        // Condition & Status
        if (scrapedData.title_status) updates.title_status = scrapedData.title_status;
        
        // Location & Listing Metadata
        if (scrapedData.location) updates.location = scrapedData.location;
        if (scrapedData.listing_url) {
          updates.listing_url = scrapedData.listing_url;
        } else if (!updates.listing_url) {
          updates.listing_url = url;
        }

        if (scrapedData.source) {
          updates.listing_source = scrapedData.source;
        }

        const parseListingDateText = (value?: string): string | null => {
          if (!value) return null;
          const trimmed = value.trim();
          if (!trimmed) return null;
          const normalized = trimmed.replace(' ', 'T');
          const candidates = [
            `${normalized}Z`,
            normalized,
            trimmed
          ];
          for (const candidate of candidates) {
            const parsed = new Date(candidate);
            if (!Number.isNaN(parsed.getTime())) {
              return parsed.toISOString();
            }
          }
          return null;
        };

        const postedIso = scrapedData.listing_posted_at || parseListingDateText(scrapedData.posted_date);
        const updatedIso = scrapedData.listing_updated_at || parseListingDateText(scrapedData.updated_date);

        if (postedIso) {
          const localValue = toDateTimeLocalString(postedIso);
          if (localValue) {
            updates.listing_posted_at = localValue;
          }
        }

        if (updatedIso) {
          const localValue = toDateTimeLocalString(updatedIso);
          if (localValue) {
            updates.listing_updated_at = localValue;
          }
        }

        // Description & Notes
        if (scrapedData.description) {
          updates.description = scrapedData.description;
        }
        
        // Advanced fields from description parsing
        if (scrapedData.trim) updates.trim = scrapedData.trim;
        if (scrapedData.transmission_subtype) updates.transmission = scrapedData.transmission_subtype;
        
        // Build comprehensive notes with ALL extracted data
        const notesLines = [];
        notesLines.push(`Source: ${scrapedData.source || 'Unknown'}`);
        notesLines.push(`Imported from: ${url}`);
        if (scrapedData.posted_date) notesLines.push(`Posted: ${scrapedData.posted_date}`);
        if (scrapedData.updated_date) notesLines.push(`Updated: ${scrapedData.updated_date}`);
        
        if (scrapedData.title) notesLines.push(`\nOriginal Title: ${scrapedData.title}`);
        if (scrapedData.location) notesLines.push(`Location: ${scrapedData.location}`);
        
        if (scrapedData.description) {
          notesLines.push(`\nSELLER DESCRIPTION:\n${scrapedData.description}`);
        }
        
        // Condition notes
        notesLines.push(`\nCONDITION NOTES:`);
        if (scrapedData.condition) notesLines.push(`- Overall: ${scrapedData.condition}`);
        if (scrapedData.known_issues) notesLines.push(`- Issues: ${scrapedData.known_issues.join(', ')}`);
        if (scrapedData.paint_history) notesLines.push(`- Paint: ${scrapedData.paint_history}${scrapedData.paint_age_years ? ` (${scrapedData.paint_age_years} years ago)` : ''}`);
        if (scrapedData.has_ac === false) notesLines.push(`- No A/C`);
        else if (scrapedData.has_ac === true) notesLines.push(`- Has A/C`);
        
        // Seller info
        if (scrapedData.seller_motivated) notesLines.push(`- Seller is motivated`);
        if (scrapedData.negotiable) notesLines.push(`- Price negotiable`);
        if (scrapedData.price_firm) notesLines.push(`- Price is firm`);
        if (scrapedData.trade_interests) notesLines.push(`- Trades for: ${scrapedData.trade_interests}`);
        
        // Technical specs
        notesLines.push(`\nTECHNICAL:`);
        if (scrapedData.cylinders) notesLines.push(`- ${scrapedData.cylinders} cylinders`);
        if (scrapedData.engine_type) notesLines.push(`- ${scrapedData.engine_type}`);
        if (scrapedData.transmission_subtype) notesLines.push(`- ${scrapedData.transmission_subtype}`);
        if (scrapedData.drivetrain) notesLines.push(`- ${scrapedData.drivetrain}`);

        const listingDateForNotes = postedIso || updatedIso;
        if (listingDateForNotes) {
          notesLines.push(`\nIMAGE CONTEXT:`);
          notesLines.push(`- Captured from ${scrapedData.source || 'external listing'} on ${listingDateForNotes}`);
          notesLines.push(`- Original photo EXIF data may differ; treat listing timestamp as capture reference`);
        }
        
        // Append to existing notes or create new
        updates.notes = formData.notes 
          ? `${formData.notes}\n\n--- Scraped Data ---\n${notesLines.join('\n')}`
          : notesLines.join('\n');

        // Build a structured discovery opinion so it can appear as the first comment
        const discoverySummary: string[] = [];
        if (scrapedData.source || scrapedData.listing_url) {
          const sourceLabel = scrapedData.source || 'External listing';
          const capturedDate = listingDateForNotes ? new Date(listingDateForNotes).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
          discoverySummary.push(`Pulled from ${sourceLabel}${capturedDate ? ` on ${capturedDate}` : ''}`);
        }

        const primaryPrice = updates.asking_price ?? updates.sale_price;
        const formattedPrice = formatCurrency(primaryPrice ?? null);
        if (formattedPrice) {
          discoverySummary.push(`Listed at ${formattedPrice}`);
        }

        if (updates.location) {
          discoverySummary.push(`Location: ${updates.location}`);
        }

        if (scrapedData.known_issues && scrapedData.known_issues.length > 0) {
          const issuesPreview = scrapedData.known_issues.slice(0, 3).join(', ');
          discoverySummary.push(`Seller notes issues: ${issuesPreview}${scrapedData.known_issues.length > 3 ? '…' : ''}`);
        } else if (scrapedData.condition) {
          discoverySummary.push(`Condition described as ${scrapedData.condition}`);
        }

        if (scrapedData.description) {
          const trimmed = scrapedData.description.trim();
          if (trimmed.length > 0) {
            const snippet = trimmed.length > 180 ? `${trimmed.slice(0, 180)}…` : trimmed;
            discoverySummary.push(`Seller pitch: "${snippet.replace(/\s+/g, ' ')}"`);
          }
        }

        if (discoverySummary.length > 0) {
          const composedOpinion = discoverySummary.join(' • ');
          updates.discoverer_opinion = formData.discoverer_opinion && formData.discoverer_opinion.trim().length > 0
            ? `${formData.discoverer_opinion.trim()}\n${composedOpinion}`
            : composedOpinion;
        }

        // Source attribution
        updates.discovery_source = 'user_import';
        updates.discovery_url = url;
        
        // Platform-specific fields
        if (scrapedData.source === 'Bring a Trailer') {
          updates.bat_auction_url = url;
          updates.source = 'Bring a Trailer';
          if (scrapedData.title) updates.bat_listing_title = scrapedData.title;
        } else if (scrapedData.source === 'Craigslist') {
          updates.source = 'Craigslist';
        }

        // Set relationship as discovered since importing from external source
        updates.relationship_type = 'discovered';

        const updatedKeys = Object.keys(updates);
        updateFormData(updates);
        setAutoFilledFields(updatedKeys);
        setLastScrapedData(scrapedData);
        setEmailDraft(null);
        setShowEmailDraft(false);
        setCopiedField(null);
 
        // Download images directly from source URLs (hi-res when available)
        const processedImages: any[] = Array.isArray(scrapedData.processed_images) ? scrapedData.processed_images : [];
        const rawImages: any[] = Array.isArray(scrapedData.images) ? scrapedData.images : [];
        const imageCandidates = processedImages.length > 0 ? processedImages : rawImages;

        if (imageCandidates.length > 0) {
          console.log(`Found ${imageCandidates.length} images (processed=${processedImages.length > 0})`);
          setExtracting(true);

          try {
            const imageFiles: File[] = [];
            const maxImages = Math.min(imageCandidates.length, 10);

            for (let i = 0; i < maxImages; i++) {
              try {
                if (processedImages.length > 0) {
                  const processed = processedImages[i];
                  if (!processed?.s3_url) continue;
                  console.log(`Downloading processed image ${i + 1}/${maxImages}: ${processed.s3_url}`);
                  const response = await fetch(processed.s3_url, { signal: AbortSignal.timeout(15000) });
                  if (!response.ok) throw new Error(`S3 fetch error: ${response.status}`);
                  const blob = await response.blob();
                  if (blob.size > 15 * 1024 * 1024) {
                    console.warn(`Processed image too large: ${blob.size} bytes`);
                    continue;
                  }
                  const extMatch = processed.original_url?.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
                  const ext = extMatch?.[1] || 'jpg';
                  const filename = `${scrapedData.source?.toLowerCase().replace(/\s+/g, '_') || 'listing'}_${processed.index != null ? processed.index + 1 : i + 1}.${ext}`;
                  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
                  Object.defineProperty(file, 'listingContext', {
                    value: {
                      listingCapturedAt: postedIso || updatedIso || new Date().toISOString(),
                      listingSource: scrapedData.source || 'External Listing',
                      originalUrl: processed.original_url || processed.s3_url
                    },
                    enumerable: false
                  });
                  imageFiles.push(file);
                } else {
                  const imageUrl = imageCandidates[i];
                  console.log(`Downloading image ${i + 1}/${maxImages}: ${imageUrl}`);
                  const proxyUrl = `${getSupabaseFunctionsUrl()}/image-proxy`;
                  const response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url: imageUrl }),
                    signal: AbortSignal.timeout(15000),
                  });
                  if (!response.ok) throw new Error(`Proxy error: ${response.status}`);
                  const blob = await response.blob();
                  if (blob.size > 10 * 1024 * 1024) {
                    console.warn(`Image too large: ${blob.size} bytes`);
                    continue;
                  }
                  const ext = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)?.[1] || 'jpg';
                  const filename = `${scrapedData.source?.toLowerCase().replace(/\s+/g, '_') || 'listing'}_${i + 1}.${ext}`;
                  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
                  Object.defineProperty(file, 'listingContext', {
                    value: {
                      listingCapturedAt: postedIso || updatedIso || new Date().toISOString(),
                      listingSource: scrapedData.source || 'External Listing',
                      originalUrl: imageUrl
                    },
                    enumerable: false
                  });
                  imageFiles.push(file);
                }
              } catch (err) {
                console.error(`Failed to download image ${i + 1}:`, err);
              }
            }

            if (imageFiles.length > 0) {
              await processImages(imageFiles);
              if (imageFiles.length === maxImages) {
                setScrapingError(null);
              } else {
                setScrapingError(`✓ Data imported! Downloaded ${imageFiles.length}/${maxImages} images (some failed)`);
              }
            } else {
              setScrapingError(`✓ Data imported! ${imageCandidates.length} image URLs found (download manually if needed).`);
            }
          } catch (imgError: any) {
            console.error('Image download error:', imgError);
            setScrapingError(`✓ Data imported successfully. Images available but download failed: ${imgError.message}`);
          } finally {
            setExtracting(false);
          }
        } else {
          setScrapingError(null);
        }

      } else {
        throw new Error(result.error || 'Failed to extract data from URL');
      }

    } catch (error: any) {
      console.error('URL scraping error:', error);
      setLastScrapedData(null);
      setEmailDraft(null);
      setShowEmailDraft(false);
      setScrapingError(error.message || 'Failed to import from URL');
    } finally {
      setIsScrapingUrl(false);
    }
  }, [updateFormData, lastScrapedUrl]);

  const handleGenerateSellerEmail = useCallback(() => {
    if (!lastScrapedData) return;

    const listingUrl = lastScrapedData.listing_url
      || lastScrapedData.url
      || lastScrapedUrl
      || formData.import_url
      || undefined;

    const scrapedPrice = typeof lastScrapedData.asking_price === 'number'
      ? lastScrapedData.asking_price
      : typeof lastScrapedData.price === 'number'
        ? lastScrapedData.price
        : null;

    const formPrice = typeof formData.asking_price === 'number' ? formData.asking_price : null;

    const sellerLocation = lastScrapedData.location
      || lastScrapedData.city
      || lastScrapedData.region
      || lastScrapedData.state
      || null;

    const descriptionSnippet = lastScrapedData.description
      || lastScrapedData.title
      || null;

    const draft = generateCraigslistEmail({
      vehicle: formData,
      listingUrl,
      askingPrice: scrapedPrice ?? formPrice ?? null,
      sellerLocation,
      descriptionSnippet,
    });

    setEmailDraft(draft);
    setShowEmailDraft(true);
    setCopiedField(null);
  }, [formData, lastScrapedData, lastScrapedUrl]);

  const handleCopyEmailField = useCallback(async (field: 'subject' | 'body') => {
    if (!emailDraft) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(emailDraft[field]);
        setCopiedField(field);
        window.setTimeout(() => setCopiedField(null), 2000);
      }
    } catch (error) {
      console.error('Failed to copy email draft field:', error);
    }
  }, [emailDraft]);

  // Watch for import_url changes
  React.useEffect(() => {
    if (formData.import_url) {
      // Debounce URL scraping
      const timeoutId = setTimeout(() => {
        handleUrlScraping(formData.import_url!);
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [formData.import_url, handleUrlScraping]);

  // (mobile rendering is handled near the bottom, after all hooks)

  // Handle submission - no validation, accept anything
  const handleShowPreview = (e: React.FormEvent) => {
    e.preventDefault();
    
    // NO VALIDATION - accept whatever user provides
    // Algorithm will calculate completion % based on what data exists
    
    setShowPreview(true);
  };

  // Handle final submission after preview
  const handleSubmit = async () => {

    if (!user) {
      setSubmitError('You must be logged in to add a vehicle');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);

      // Whitelist of valid vehicles table columns
      const validColumns = [
        'make', 'model', 'year', 'vin', 'color', 'mileage', 'fuel_type', 'transmission',
        'engine_size', 'horsepower', 'torque', 'drivetrain', 'body_style', 'doors', 'seats',
        'weight_lbs', 'length_inches', 'width_inches', 'height_inches', 'wheelbase_inches',
        'fuel_capacity_gallons', 'mpg_city', 'mpg_highway', 'mpg_combined', 'msrp',
        'current_value', 'purchase_price', 'purchase_date', 'purchase_location',
        'previous_owners', 'is_modified', 'modification_details', 'condition_rating',
        'maintenance_notes', 'insurance_company', 'insurance_policy_number',
        'registration_state', 'registration_expiry', 'inspection_expiry', 'is_public',
        'notes', 'sale_price', 'auction_end_date', 'bid_count', 'view_count',
        'auction_source', 'ownership_verified', 'bat_auction_url', 'bat_sold_price',
        'bat_sale_date', 'bat_bid_count', 'bat_view_count', 'is_daily_driver',
        'is_weekend_car', 'is_track_car', 'is_show_car', 'is_project_car', 'is_garage_kept',
        'discovered_by', 'discovery_source', 'discovery_url', 'bat_listing_title',
        'bat_bids', 'bat_comments', 'bat_views', 'bat_location', 'bat_seller',
        'sale_status', 'sale_date', 'status', 'completion_percentage', 'displacement',
        'interior_color', 'is_for_sale', 'is_draft', 'entry_type', 'verification_status',
        'confidence_score', 'source', 'import_source', 'import_metadata'
      ];
      
      // Filter formData to only include valid columns
      const vehicleData: any = {
        // Don't explicitly set user_id - let RLS/auth handle it
        // user_id is set by the database through auth context
        discovered_by: formData.import_url ? user.id : undefined,
        discovery_source: formData.import_url ? (formData.import_url.includes('craigslist.org') ? 'Craigslist' : 'External URL') : undefined,
        discovery_url: formData.import_url || undefined,
        // ORIGIN TRACKING - Save to database
        profile_origin: formData.bat_auction_url ? 'bat_import' : 
                       formData.import_url ? 'url_scraper' : 
                       'manual_entry',
        bat_auction_url: formData.bat_auction_url || undefined,
        origin_metadata: {
          import_source: formData.bat_auction_url ? 'bat_manual_entry' : 
                        formData.import_url ? 'url_scraper' : 
                        'manual_entry',
          import_date: new Date().toISOString().split('T')[0],
          ...(formData.bat_auction_url && { bat_url: formData.bat_auction_url }),
          ...(formData.import_url && { discovery_url: formData.import_url }),
          ...(lastScrapedData?.source && { scraped_source: lastScrapedData.source })
        }
      };
      
      const numericColumns = new Set([
        'year',
        'mileage',
        'asking_price',
        'sale_price',
        'purchase_price',
        'current_value',
        'msrp',
        'weight_lbs',
        'length_inches',
        'width_inches',
        'height_inches',
        'wheelbase_inches',
        'fuel_capacity_gallons',
        'mpg_city',
        'mpg_highway',
        'mpg_combined',
        'horsepower',
        'torque',
        'previous_owners',
        'condition_rating'
      ]);

      validColumns.forEach(col => {
        const rawValue = formData[col as keyof typeof formData];
        if (rawValue === undefined || rawValue === null || rawValue === '') {
          return;
        }

        if (numericColumns.has(col)) {
          const numericValue = typeof rawValue === 'number'
            ? rawValue
            : parseCurrencyValue(rawValue);
          if (numericValue !== null) {
            vehicleData[col] = numericValue;
          }
        } else {
          vehicleData[col] = rawValue;
        }
      });

      // Insert vehicle directly into Supabase
      const { data: vehicle, error: insertError } = await supabase
        .from('vehicles')
        .insert([vehicleData])
        .select()
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      if (vehicle) {
        const vehicleId = vehicle.id;
        
        // Create timeline event for vehicle creation or discovery
        try {
          await TimelineEventService.createVehicleCreationEvent(
            vehicleId,
            vehicle,
            extractedImages.map(f => f.name)
          );
          // Record discovery event when created from URL without EXIF time
          if (formData.import_url) {
            await supabase.from('timeline_events').insert({
              vehicle_id: vehicleId,
              user_id: user.id,
              event_type: 'discovery',
              source: 'external_listing',
              title: 'Vehicle Discovered',
              event_date: new Date().toISOString().split('T')[0],
              description: `Discovered on ${formData.import_url.includes('craigslist.org') ? 'Craigslist' : 'External site'}`,
              metadata: {
                source_type: 'external_listing',
                confidence_score: 70
              }
            });
          }
        } catch (error) {
          console.error('Failed to create vehicle creation timeline event:', error);
        }

        if (user?.id) {
          try {
            // Determine relationship_type based on import source
            // If it's from a Craigslist/external URL, it's 'discovered'
            // Otherwise use formData.relationship_type or default to 'interested'
            const relationshipType = formData.import_url && (formData.import_url.includes('craigslist.org') || formData.import_url.includes('marketplace') || formData.import_url.includes('autotrader') || formData.import_url.includes('cars.com'))
              ? 'discovered'
              : (formData.relationship_type || 'interested');
            
            // Determine discovery_source - use actual source name if available, otherwise use category
            let discoverySource: string;
            if (formData.import_url?.includes('craigslist.org')) {
              discoverySource = 'Craigslist';
            } else if (formData.listing_source) {
              discoverySource = formData.listing_source;
            } else if (lastScrapedData?.source) {
              discoverySource = lastScrapedData.source;
            } else {
              discoverySource = mapDiscoverySourceToCategory(formData.listing_source || lastScrapedData?.source);
            }
            
            await supabase.from('discovered_vehicles').upsert({
              user_id: user.id,
              vehicle_id: vehicleId,
              relationship_type: relationshipType,
              discovery_source: discoverySource,
              discovery_context: formData.import_url || formData.discoverer_opinion || '',
              interest_level: 'high',
              is_active: true,
              created_at: new Date().toISOString()
            }, { onConflict: 'vehicle_id,user_id' });
          } catch (err) {
            console.warn('Failed to upsert discovered_vehicles entry:', err);
          }
        }
        
        // If we have a title document from scanning, save it and check ownership
        const formDataAny = formData as any;
        if (formDataAny.documentId) {
          // Save title document
          const { data: docData } = await supabase
            .from('vehicle_documents')
            .insert([{
              vehicle_id: vehicleId,
              document_type: 'title',
              title: 'Vehicle Title',
              description: 'Scanned vehicle title document',
              file_url: formDataAny.documentId,
              privacy_level: 'private',
              contains_pii: true,
              uploaded_by: user.id
            }])
            .select()
            .single();
          
          // Check if user has verified legal ID on profile
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, legal_id_verified')
            .eq('id', user.id)
            .single();
          
          // If user has verified legal ID and title has owner name, check for match
          if (profile?.legal_id_verified && formDataAny.owner_name && docData) {
            const titleName = formDataAny.owner_name.toLowerCase().trim();
            const profileName = profile.full_name?.toLowerCase().trim();
            
            // Simple name match (you can enhance this logic)
            if (profileName && titleName.includes(profileName)) {
              // Auto-approve ownership since ID and title match
              await supabase
                .from('ownership_verifications')
                .insert([{
                  vehicle_id: vehicleId,
                  user_id: user.id,
                  status: 'approved',
                  verification_type: 'title_and_id',
                  document_id: docData.id,
                  submitted_at: new Date().toISOString(),
                  reviewed_at: new Date().toISOString(),
                  auto_verified: true
                }]);
            } else {
              // Names don't match - create pending verification for manual review
              await supabase
                .from('ownership_verifications')
                .insert([{
                  vehicle_id: vehicleId,
                  user_id: user.id,
                  status: 'pending',
                  verification_type: 'title_and_id',
                  document_id: docData.id,
                  submitted_at: new Date().toISOString()
                }]);
            }
          }
        }
        
        // Add images to global upload queue for persistent, resumable uploads
        if (extractedImages.length > 0) {
          const vehicleName = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle';
          console.log(`Adding ${extractedImages.length} images to global upload queue...`);
          uploadQueue.addFiles(vehicleId, vehicleName, extractedImages);
        }
        
        // Clear autosave data
        clearAutosave();

        // Call success callback (for modal mode)
        if (onSuccess) {
          onSuccess(vehicleId);
        }

        // Close modal or navigate
        if (mode === 'modal' && onClose) {
          onClose();
        } else {
          // Navigate immediately - uploads continue in background
          navigate(`/vehicle/${vehicleId}`);
        }
      } else {
        throw new Error('Failed to create vehicle - no data returned');
      }
    } catch (error: any) {
      console.error('Error creating vehicle:', error);
      setSubmitError(error.message || 'Failed to create vehicle. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Process images (from drag-drop or file picker)
  const processImages = useCallback(async (files: File[]) => {
    // Filter to image files - check both MIME type and file extension
    const imageFiles = files.filter(file => {
      // Check MIME type
      if (file.type && file.type.startsWith('image/')) {
        return true;
      }
      
      // Check file extension (fallback for files without MIME type, e.g. from iPhoto)
      const ext = file.name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|heic|heif)$/);
      return ext !== null;
    });

    if (imageFiles.length === 0) {
      console.error('No valid image files found', files.map(f => ({name: f.name, type: f.type})));
      alert(`No image files detected. Found ${files.length} file(s) but none are recognized as images.\n\nSupported formats: JPG, PNG, GIF, WebP, HEIC\n\nTip: Try dragging from Finder instead of iPhoto.`);
      return;
    }
    
    if (imageFiles.length < files.length) {
      console.warn(`Filtered out ${files.length - imageFiles.length} non-image files`);
    }

    // Limit to 300 images total - will process and upload in background
    const MAX_IMAGES = 300;
    const currentCount = extractedImages.length;
    const newTotal = currentCount + imageFiles.length;
    
    if (newTotal > MAX_IMAGES) {
      alert(`Adding ${imageFiles.length} images would exceed the ${MAX_IMAGES} image limit.\n\nYou currently have ${currentCount} images. You can add ${MAX_IMAGES - currentCount} more images.`);
      return;
    }

    try {
      setExtracting(true);
      
      // Append new images to existing ones
      const allImages = [...extractedImages, ...imageFiles];
      setExtractedImages(allImages);

      // Extract metadata from images in batches to avoid memory issues
      // Reduced BATCH_SIZE from 10 to 3 to prevent memory issues with large uploads
      const BATCH_SIZE = 3;
      const metadataResults: ImageMetadata[] = [];
      
      // Show progress indicator
      for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
        const batch = imageFiles.slice(i, i + BATCH_SIZE);
        const current = Math.min(i + BATCH_SIZE, imageFiles.length);
        setExtractProgress({ current, total: imageFiles.length });
        console.log(`Processing EXIF metadata: ${current}/${imageFiles.length} images`);
        
        try {
          // Add timeout to prevent hanging on problematic images
          const batchResults = await Promise.race([
            Promise.all(batch.map(extractImageMetadata)),
            new Promise<ImageMetadata[]>((_, reject) => 
              setTimeout(() => reject(new Error('EXIF extraction timeout')), 10000)
            )
          ]);
          metadataResults.push(...batchResults);
        } catch (error) {
          console.warn(`EXIF extraction failed for batch ${i}-${i + BATCH_SIZE}, continuing with empty metadata:`, error);
          metadataResults.push(
            ...batch.map((file) => ({
              fileName: file.name,
              fileSize: file.size,
              dateTaken: undefined,
              location: undefined
            } as ImageMetadata))
          );
        }
      }
      
      setExtractProgress(null); // Clear progress when done
      
      // Store metadata keyed by filename (merge with existing metadata)
      const metadataMap = new Map<string, ImageMetadata>(imageMetadata);
      imageFiles.forEach((file, index) => {
        const metadataResult = metadataResults[index] || { fileName: file.name, fileSize: file.size } as ImageMetadata;
        const listingContext = (file as any)?.listingContext;
        const metadataEntry: ImageMetadata = {
          ...metadataResult,
          fileName: metadataResult.fileName ?? file.name,
          fileSize: metadataResult.fileSize ?? file.size,
        };

        if (listingContext?.listingCapturedAt) {
          const captureDate = new Date(listingContext.listingCapturedAt);
          if (!Number.isNaN(captureDate.getTime())) {
            metadataEntry.listingCapturedAt = captureDate;
          }
        }

        if (listingContext?.listingSource) {
          metadataEntry.listingSource = listingContext.listingSource;
        }

        metadataMap.set(file.name, metadataEntry);
      });
      setImageMetadata(metadataMap);

      // Process the metadata to update form fields
      // Note: We extract date/location but DON'T auto-fill purchase_date
      // Image dates are just timeline events, not purchase confirmation
      const eventLocation = await getEventLocationFromImages(metadataResults);

      const updates: Partial<VehicleFormData> = {};

      // Only auto-fill location if not set (photos taken at purchase location is common)
      if (eventLocation && !formData.purchase_location) {
        updates.purchase_location = `${eventLocation.latitude}, ${eventLocation.longitude}`;
      }

      if (Object.keys(updates).length > 0) {
        updateFormData(updates);
      }

    } catch (error) {
      console.error('Error processing images:', error);
    } finally {
      setExtracting(false);
    }
  }, [formData.purchase_date, formData.purchase_location, updateFormData]);

  // Handle drag and drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if leaving the drop zone itself, not a child element
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    console.log('Drop event triggered');
    console.log('dataTransfer.files:', e.dataTransfer.files);
    console.log('dataTransfer.items:', e.dataTransfer.items);
    
    // Try to get files from both files and items APIs
    const files: File[] = [];
    
    // First try dataTransfer.files (standard way)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      console.log('Found files via dataTransfer.files');
      files.push(...Array.from(e.dataTransfer.files));
    }
    
    // Also try dataTransfer.items (better for some apps like iPhoto)
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      console.log('Processing dataTransfer.items');
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        console.log(`Item ${i}: kind=${item.kind}, type=${item.type}`);
        
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            console.log(`Got file from item: ${file.name}, type=${file.type}, size=${file.size}`);
            // Only add if not already in files array
            if (!files.find(f => f.name === file.name && f.size === file.size)) {
              files.push(file);
            }
          }
        }
      }
    }
    
    console.log(`Total files collected: ${files.length}`);
    if (files.length > 0) {
      await processImages(files);
    } else {
      console.error('No files found in drop event');
      alert('No files detected in drop. Please try:\n1. Selecting files using the "Click to Upload" button\n2. Dragging files from Finder instead of iPhoto\n3. Exporting files from iPhoto first, then dragging');
    }
  }, [processImages]);

  // Handle file input selection
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      await processImages(files);
      // Reset input so same files can be selected again
      e.target.value = '';
    }
  }, [processImages]);

  // Early return if not authenticated
  if (!user) {
    const authContent = (
      <div className="container">
        <div className="section">
          <div className="card">
            <div className="card-body text-center">
              <h2 className="text font-bold mb-4">Authentication Required</h2>
              <p className="text-muted mb-4">
                You must be logged in to add a vehicle to the database.
              </p>
              <button
                onClick={() => navigate('/login')}
                className="button button-primary"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    );

    return mode === 'modal' ? (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg max-w-md w-full p-6">
          {authContent}
        </div>
      </div>
    ) : (
      authContent
    );
  }

  // Main form content
  const formContent = (
    <>
      {/* Verification Progress Bar */}
      <div style={{
        position: 'sticky',
        top: '56px',
        zIndex: 90,
        backgroundColor: 'var(--grey-50)',
        padding: '6px 0',
        margin: 0,
        borderTop: 'none',
        borderBottom: '1px solid var(--border-light)'
      }}>
        <div className="container">
          <VerificationProgress progress={verificationProgress} />
        </div>
      </div>

      <div className="container">
        <div className="section" style={{ marginTop: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            {/* Left Column - Form Fields */}
            <div>
              <form onSubmit={handleShowPreview}>
                <div className="card">
                  <div className="card-header">
                    <h2 className="text font-bold">Vehicle Information</h2>
                    <div className="flex gap-2" style={{ marginTop: 'var(--space-1)' }}>
                      <select
                        value={detailLevel}
                        onChange={(e) => setDetailLevel(e.target.value as DetailLevel)}
                        style={{ 
                          fontSize: '8pt',
                          padding: '2px 4px',
                          border: '1px solid var(--border-medium)',
                          backgroundColor: 'var(--grey-100)'
                        }}
                      >
                        <option value="basic">Basic</option>
                        <option value="detailed">Detailed</option>
                        <option value="professional">Pro</option>
                        <option value="expert">Expert</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => setShowTitleScan(true)}
                        className="button button-secondary"
                        style={{ fontSize: '8pt', padding: '2px 6px' }}
                      >
                        Scan Title
                      </button>
                    </div>
                  </div>

                  <div className="card-body">
                    {/* Success/Error Messages */}
                    {scanCompleted && (
                      <div className="alert alert-success mb-4">
                        <div className="text-small">
                          ✓ Title scan completed successfully. Ownership pre-certified via title document. Review and modify the extracted data below.
                        </div>
                      </div>
                    )}

                    {/* URL Scraping Status */}
                    {isScrapingUrl && (
                      <div className="alert alert-info mb-4">
                        <div className="text-small">
                          Importing vehicle data from URL...
                        </div>
                      </div>
                    )}

                    {scrapingError && (
                      <div className="alert alert-error mb-4">
                        <div className="text-small">{scrapingError}</div>
                      </div>
                    )}

                    {lastScrapedUrl && !isScrapingUrl && !scrapingError && formData.bat_auction_url && (
                      <div className="alert alert-success mb-4">
                        <div className="text-small">
                          Successfully imported vehicle data from Bring a Trailer listing
                        </div>
                      </div>
                    )}

                    {(formError || submitError) && (
                      <div className="alert alert-error mb-4">
                        <div className="text-small">{formError || submitError}</div>
                      </div>
                    )}

                    {/* Autosave Notification */}
                    {autoSaveState.lastSaved && (
                      <div className="alert alert-info mb-4">
                        <div className="flex justify-between items-center">
                          <div className="text-small">
                            Draft saved {new Date(autoSaveState.lastSaved).toLocaleTimeString()}
                          </div>
                          <button
                            type="button"
                            onClick={clearAutosave}
                            className="button button-small button-secondary"
                          >
                            Clear Draft
                          </button>
                        </div>
                      </div>
                    )}

                    {autoFilledFields.length > 0 && (
                      <div className="alert alert-success mb-4">
                        <div className="text-small">
                          Auto-filled {autoFilledFields.length} field{autoFilledFields.length === 1 ? '' : 's'}:
                          {' '}
                          {autoFilledDisplay.join(', ')}
                          {autoFilledFields.length > autoFilledDisplay.length && (
                            <span> +{autoFilledFields.length - autoFilledDisplay.length} more</span>
                          )}
                        </div>
                      </div>
                    )}

                    {lastScrapedData && (
                      <div className="alert alert-info mb-4">
                        <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
                          <div className="text-small">
                            Need more detail from the seller? Generate a personalized email that asks for VIN, title photo, ownership history, and hi-res shots.
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleGenerateSellerEmail}
                              className="button button-small button-secondary"
                            >
                              Generate seller email
                            </button>
                            {emailDraft && (
                              <button
                                type="button"
                                onClick={() => setShowEmailDraft((prev) => !prev)}
                                className="button button-small"
                              >
                                {showEmailDraft ? 'Hide draft' : 'View last draft'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {showEmailDraft && emailDraft && (
                      <div className="card mb-4">
                        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                          <h3 className="text font-bold" style={{ margin: 0 }}>Seller Email Draft</h3>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleCopyEmailField('subject')}
                              className="button button-small button-secondary"
                            >
                              {copiedField === 'subject' ? 'Subject copied' : 'Copy subject'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyEmailField('body')}
                              className="button button-small button-secondary"
                            >
                              {copiedField === 'body' ? 'Body copied' : 'Copy body'}
                            </button>
                            <button
                              type="button"
                              onClick={handleGenerateSellerEmail}
                              className="button button-small"
                            >
                              Regenerate
                            </button>
                          </div>
                        </div>
                        <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
                          <div>
                            <label className="form-label" htmlFor="seller-email-subject">Subject</label>
                            <input
                              id="seller-email-subject"
                              className="form-input"
                              value={emailDraft.subject}
                              readOnly
                              onFocus={(e) => e.target.select()}
                            />
                          </div>
                          <div>
                            <label className="form-label" htmlFor="seller-email-body">Body</label>
                            <textarea
                              id="seller-email-body"
                              className="form-input"
                              value={emailDraft.body}
                              readOnly
                              rows={12}
                              style={{ whiteSpace: 'pre-wrap' }}
                              onFocus={(e) => e.target.select()}
                            />
                          </div>
                          <div className="text-small text-muted">
                            Tip: paste this into your mail client, tweak anything personal, then send it directly through Craigslist reply or SMS.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Form Fields */}
                    <VehicleFormFields
                      formData={formData}
                      detailLevel={detailLevel}
                      onFieldChange={updateField}
                    />

                    {/* Submit Button */}
                    <div className="form-actions">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="button button-primary button-large"
                      >
                        {submitting ? 'Creating Vehicle...' : 'Review Draft →'}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>

            {/* Right Column - Image Upload */}
            <div>
              <div className="card" style={{ 
                position: 'sticky', 
                top: '90px',
                alignSelf: 'flex-start'
              }}>
                <div className="card-header">
                  <h3 className="text font-bold">Vehicle Images</h3>
                  <p className="text-small text-muted">
                    {extractedImages.length > 0 
                      ? `${extractedImages.length}/300 images ready` 
                      : 'Add up to 300 images'}
                  </p>
                </div>
                <div className="card-body">
                  {/* Always show upload button for better UX */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,image/jpeg,image/jpg,image/png,image/gif,image/webp,image/heic,image/heif"
                    multiple
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  
                  {/* Add/Upload Button */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="button button-primary w-full mb-3"
                    style={{ 
                      fontSize: '9pt',
                      minHeight: '44px',
                      fontWeight: 'bold'
                    }}
                    disabled={extracting}
                  >
                    {extracting 
                      ? `Processing ${extractProgress?.current || 0}/${extractProgress?.total || 0}...`
                      : extractedImages.length > 0 
                      ? `Add Images (${extractedImages.length}/300)` 
                      : 'Upload Images'}
                  </button>
                  
                  <div style={{
                    fontSize: '8pt',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    marginBottom: 'var(--space-2)'
                  }}>
                    Or drag &amp; drop images below
                  </div>

                  {/* Image thumbnails - show only first 20 for performance */}
                  {extractedImages.length > 0 && (
                    <>
                      <div style={{
                        fontSize: '8pt',
                        textAlign: 'center',
                        color: 'var(--text-success)',
                        marginBottom: 'var(--space-2)',
                        padding: 'var(--space-2)',
                        backgroundColor: 'var(--success-bg)',
                        border: '1px solid var(--border-success)',
                        borderRadius: 'var(--radius)'
                      }}>
                        ✓ {extractedImages.length} image{extractedImages.length !== 1 ? 's' : ''} ready to upload
                        {extractedImages.length > 20 && ' (showing first 20)'}
                      </div>
                      
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                        gap: 'var(--space-1)',
                        marginBottom: 'var(--space-2)',
                        maxHeight: '40vh',
                        overflowY: 'auto'
                      }}>
                        {extractedImages.slice(0, 20).map((file, index) => {
                          const metadata = imageMetadata.get(file.name);
                          const dateTaken = metadata?.dateTaken;
                          
                          return (
                            <div key={index} style={{
                              border: '1px solid var(--border-medium)',
                              padding: '2px',
                              backgroundColor: 'var(--grey-100)',
                              position: 'relative'
                            }}>
                              <img
                                src={URL.createObjectURL(file)}
                                alt={file.name}
                                style={{
                                  width: '100%',
                                  height: '60px',
                                  objectFit: 'cover',
                                  border: '1px solid var(--border-dark)'
                                }}
                                loading="lazy"
                              />
                              {dateTaken && (
                                <div style={{ 
                                  fontSize: '7pt', 
                                  textAlign: 'center', 
                                  marginTop: '2px',
                                  color: 'var(--text-muted)'
                                }}>
                                  {dateTaken.toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric'
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      
                      {extractedImages.length > 20 && (
                        <div style={{
                          fontSize: '8pt',
                          textAlign: 'center',
                          color: 'var(--text-muted)',
                          fontStyle: 'italic'
                        }}>
                          + {extractedImages.length - 20} more image{extractedImages.length - 20 !== 1 ? 's' : ''} (not shown for performance)
                        </div>
                      )}
                    </>
                  )}

                  {/* Drop Zone - Always visible */}
                  <div
                    className={`border-2 border-dashed p-6 text-center transition-all ${
                      extracting 
                        ? 'border-primary bg-primary bg-opacity-10' 
                        : isDragging
                        ? 'border-blue-500 bg-blue-50 scale-102'
                        : 'border-grey-300 hover:border-primary hover:bg-grey-50 cursor-pointer'
                    }`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onClick={() => !extracting && fileInputRef.current?.click()}
                    style={{ 
                      marginTop: 'var(--space-2)',
                      borderRadius: '0px',
                      minHeight: '120px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transform: isDragging ? 'scale(1.02)' : 'scale(1)'
                    }}
                  >
                    {extracting ? (
                      <div className="flex flex-col items-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-2"></div>
                        <p className="text-small font-bold text-primary">
                          {extractProgress 
                            ? `Processing ${extractProgress.current}/${extractProgress.total} images...` 
                            : 'Processing...'}
                        </p>
                      </div>
                    ) : isDragging ? (
                      <div>
                        <div className="text font-medium text-blue-600 mb-1" style={{ fontSize: '9pt' }}>
                          Drop images now
                        </div>
                        <p className="text-small text-muted" style={{ fontSize: '8pt' }}>
                          Release to upload
                        </p>
                      </div>
                    ) : (
                      <div>
                        <div className="text font-medium text-grey-900 mb-1" style={{ fontSize: '8pt' }}>
                          Drag &amp; Drop Images Here
                        </div>
                        <p className="text-small text-muted" style={{ fontSize: '8pt' }}>
                          Accepts: JPG, PNG, HEIC, WebP • Max 300 images
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Title Scanner Modal */}
      {showTitleScan && (
        <div className="modal-overlay">
          <div className="modal-content">
            <TitleScan
              onComplete={handleTitleScanComplete}
              onCancel={() => setShowTitleScan(false)}
            />
          </div>
        </div>
      )}

      {/* Preview/Review Modal */}
      {showPreview && (
        <div className="modal-overlay" onClick={() => setShowPreview(false)}>
          <div className="modal-content" style={{ 
            maxWidth: '900px', 
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column'
          }} onClick={(e) => e.stopPropagation()}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="card-header">
                <h2 className="text font-bold">Review Vehicle Information</h2>
                <p className="text-small text-muted">Please review all information before submitting. You can go back to make edits.</p>
              </div>
              <div className="card-body" style={{ 
                overflowY: 'auto',
                flex: 1,
                paddingBottom: 'var(--space-2)'
              }}>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(2, 1fr)', 
                  gap: 'var(--space-3)',
                  fontSize: '8pt'
                }}>
                  <div>
                    <div className="text-small text-muted font-bold">Basic Information</div>
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <div><strong>Make:</strong> {formData.make || 'Not specified'}</div>
                      <div><strong>Model:</strong> {formData.model || 'Not specified'}</div>
                      <div><strong>Year:</strong> {formData.year || 'Not specified'}</div>
                      <div><strong>VIN:</strong> {formData.vin || 'Not specified'}</div>
                      <div><strong>Relationship:</strong> {formData.relationship_type || 'Not specified'}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-small text-muted font-bold">Specifications</div>
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <div><strong>Color:</strong> {formData.color || 'Not specified'}</div>
                      <div><strong>Mileage:</strong> {formData.mileage ? `${formData.mileage.toLocaleString()} mi` : 'Not specified'}</div>
                      <div><strong>Doors:</strong> {formData.doors || 'Not specified'}</div>
                      <div><strong>Seats:</strong> {formData.seats || 'Not specified'}</div>
                      {formData.sale_price && <div><strong>Price:</strong> ${formData.sale_price.toLocaleString()}</div>}
                    </div>
                  </div>
                </div>
                
                {extractedImages.length > 0 && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <div className="text-small text-muted font-bold">Vehicle Images ({extractedImages.length})</div>
                    <div className="text-small text-muted" style={{ fontSize: '8pt', marginTop: 'var(--space-1)' }}>
                      Images will upload in the background after vehicle creation. You can navigate the site while uploads continue.
                      {extractedImages.length > 12 && ' (Showing first 12 preview thumbnails)'}
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                      gap: 'var(--space-2)',
                      marginTop: 'var(--space-2)',
                      maxHeight: '300px',
                      overflowY: 'auto'
                    }}>
                      {extractedImages.slice(0, 12).map((file, index) => {
                        const metadata = imageMetadata.get(file.name);
                        const dateTaken = metadata?.dateTaken;
                        return (
                          <div key={index} style={{
                            border: '1px solid var(--border-medium)',
                            padding: 'var(--space-1)',
                            backgroundColor: 'var(--grey-100)'
                          }}>
                            <img
                              src={URL.createObjectURL(file)}
                              alt={file.name}
                              style={{
                                width: '100%',
                                height: '60px',
                                objectFit: 'cover',
                                border: '1px solid var(--border-dark)',
                                marginBottom: 'var(--space-1)'
                              }}
                              loading="lazy"
                            />
                            {dateTaken && (
                              <div className="text-muted" style={{ fontSize: '7pt', textAlign: 'center' }}>
                                {dateTaken.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {extractedImages.length > 12 && (
                      <div style={{
                        fontSize: '8pt',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        marginTop: 'var(--space-2)',
                        fontStyle: 'italic'
                      }}>
                        + {extractedImages.length - 12} more image{extractedImages.length - 12 !== 1 ? 's' : ''} ready to upload
                      </div>
                    )}
                  </div>
                )}

                {formData.notes && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <div className="text-small text-muted font-bold">Notes</div>
                    <div style={{ 
                      marginTop: 'var(--space-1)',
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--grey-100)',
                      fontSize: '8pt'
                    }}>
                      {formData.notes}
                    </div>
                  </div>
                )}

              </div>
              
              {/* Sticky Action Buttons */}
              <div style={{ 
                borderTop: '1px solid var(--border-medium)',
                padding: 'var(--space-3)',
                backgroundColor: 'var(--background)',
                display: 'flex', 
                gap: 'var(--space-2)',
                justifyContent: 'flex-end'
              }}>
                <button 
                  type="button" 
                  className="button button-secondary"
                  onClick={() => setShowPreview(false)}
                  disabled={submitting}
                >
                  ← Edit Information
                </button>
                <button 
                  type="button" 
                  className="button button-primary"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting 
                    ? (extractedImages.length > 0 
                        ? `Creating Vehicle (${extractedImages.length} images will upload in background)...` 
                        : 'Creating Vehicle...'
                      )
                    : '✓ Confirm & Create Vehicle'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Render based on mode
  if (mode === 'modal') {
    return (
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) {
            onClose();
          }
        }}
      >
        <div 
          className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
            <h2 className="text-xl font-bold">Add Vehicle</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>
          
          {/* Modal Content */}
          <div className="p-6">
            {formContent}
          </div>
        </div>
      </div>
    );
  }

  // Page mode - use AppLayout
  return formContent;
};

export default AddVehicle;