import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import ReactDOM from 'react-dom';
import { supabase, SUPABASE_URL } from '../lib/supabase';
import { FaviconIcon } from '../components/common/FaviconIcon';
import TradePanel from '../components/trading/TradePanel';
import AddOrganizationData from '../components/organization/AddOrganizationData';
import OrganizationInventory from '../components/organization/OrganizationInventory';
import OrganizationTimelineHeatmap from '../components/organization/OrganizationTimelineHeatmap';
import OrganizationLocationPicker from '../components/organization/OrganizationLocationPicker';
import LaborRateEditor from '../components/organization/LaborRateEditor';
import WorkOrderRequestForm from '../components/organization/WorkOrderRequestForm';
import DropboxImporter from '../components/dealer/DropboxImporter';
import MobileVINScanner from '../components/dealer/MobileVINScanner';
import ContractorWorkInput from '../components/contractor/ContractorWorkInput';
import OrganizationEditor from '../components/organization/OrganizationEditor';
import EnhancedDealerInventory from '../components/organization/EnhancedDealerInventory';
import BaTBulkImporter from '../components/dealer/BaTBulkImporter';
import SoldInventoryBrowser from '../components/organization/SoldInventoryBrowser';
import { ServiceVehicleCardRich } from '../components/organization/ServiceVehicleCardRich';
import MarketplaceComplianceForm from '../components/organization/MarketplaceComplianceForm';
import OrganizationNotifications from '../components/organization/OrganizationNotifications';
import VehicleInquiryModal from '../components/organization/VehicleInquiryModal';
import { extractImageMetadata } from '../utils/imageMetadata';
import { DynamicTabBar } from '../components/organization/DynamicTabBar';
import { OrganizationServiceTab } from '../components/organization/OrganizationServiceTab';
import { OrganizationAuctionsTab } from '../components/organization/OrganizationAuctionsTab';
import { OrganizationIntelligenceService, type OrganizationIntelligence, type TabConfig } from '../services/organizationIntelligenceService';
import VehicleThumbnail from '../components/VehicleThumbnail';
import { ComprehensiveProfileStats } from '../components/profile/ComprehensiveProfileStats';
import { ProfileListingsTab } from '../components/profile/ProfileListingsTab';
import { ProfileBidsTab } from '../components/profile/ProfileBidsTab';
import { ProfileSuccessStoriesTab } from '../components/profile/ProfileSuccessStoriesTab';
import { getOrganizationProfileData } from '../services/profileStatsService';
import { AdminNotificationService } from '../services/adminNotificationService';
import BroadArrowMetricsDisplay from '../components/organization/BroadArrowMetricsDisplay';
import '../design-system.css';

interface Organization {
  id: string;
  business_name: string;
  legal_name?: string;
  business_type?: string;
  description?: string;
  logo_url?: string;
  banner_url?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  latitude?: number;
  longitude?: number;
  status?: string;
  verification_level?: string;
  is_public: boolean;
  is_tradable?: boolean;
  stock_symbol?: string;
  current_value?: number;
  estimated_value?: number;
  last_valuation_date?: string;
  total_vehicles?: number;
  total_images?: number;
  total_events?: number;
  discovered_by?: string;
  uploaded_by?: string;
  labor_rate?: number;
  // Neutral facts (human-readable)
  inventory_numbers?: string;
  market_share?: string;
  branding?: string;
  labeling?: string;
  created_at: string;
  updated_at: string;
}

interface OrgImage {
  id: string;
  image_url: string;
  thumbnail_url?: string;
  large_url?: string;
  caption?: string;
  category?: string;
  taken_at?: string;
  uploaded_at: string;
  user_id: string;
  location_name?: string;
  latitude?: number;
  longitude?: number;
  exif_data?: any;
  is_sensitive?: boolean;
  sensitivity_type?: string;
  visibility_level?: string;
  blur_preview?: boolean;
  contains_financial_data?: boolean;
}

interface OrgVehicle {
  id: string;
  vehicle_id: string;
  relationship_type: string;
  status?: string;
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_vin?: string;
  vehicle_current_value?: number;
  vehicle_image_url?: string;
  vehicle_location?: string | null;
  sale_date?: string;
  sale_price?: number;
  vehicle_sale_status?: string;
  listing_status?: string;
  has_active_auction?: boolean;
  auction_end_time?: string | null;
  auction_current_bid?: number | null;
  auction_bid_count?: number;
  auction_reserve_price?: number | null;
  auction_platform?: string | null;
  auction_url?: string | null;
  auction_view_count?: number | null;
  auction_watcher_count?: number | null;
  auction_comment_count?: number | null;
  seller_handle?: string | null;
  seller_org_id?: string | null;
  seller_org_name?: string | null;
  seller_org_website?: string | null;
  analysis_tier?: number | null;
  signal_score?: number | null;
  vehicles?: any;
}

interface Offering {
  id: string;
  offering_type: string;
  stock_symbol: string;
  total_shares: number;
  current_share_price: number;
  opening_price?: number;
  closing_price?: number;
  status: string;
}

// Countdown Timer Component
const CountdownTimer: React.FC<{ endTime: string | null }> = ({ endTime }) => {
  const [timeRemaining, setTimeRemaining] = useState<string>(() => {
    if (!endTime) return 'N/A';
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();
    if (diff <= 0) return 'Ended';
    const totalSeconds = Math.floor(diff / 1000);
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  });

  useEffect(() => {
    if (!endTime) return;
    const interval = setInterval(() => {
      const now = new Date();
      const end = new Date(endTime);
      const diff = end.getTime() - now.getTime();
      if (diff <= 0) {
        setTimeRemaining('Ended');
        return;
      }
      const totalSeconds = Math.floor(diff / 1000);
      const d = Math.floor(totalSeconds / 86400);
      const h = Math.floor((totalSeconds % 86400) / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;
      const pad = (n: number) => String(n).padStart(2, '0');
      if (d > 0) {
        setTimeRemaining(`${d}d ${pad(h)}:${pad(m)}:${pad(s)}`);
      } else {
        setTimeRemaining(`${pad(h)}:${pad(m)}:${pad(s)}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  if (!endTime) return null;

  return (
    <div style={{ textAlign: 'right', flexShrink: 0 }}>
      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px' }}>
        Time Left
      </div>
      <div style={{ fontSize: '9pt', fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>
        {timeRemaining}
      </div>
    </div>
  );
};

export default function OrganizationProfile() {
  const params = useParams();
  const location = useLocation();
  
  // Extract orgId from params - memoized to prevent excessive re-renders
  const organizationId = useMemo(() => {
    const id = (params as any)?.id;
    const orgId = (params as any)?.orgId;
    
    // Fallback: Extract from pathname if params don't work
    // Path should be /org/{orgId}
    const pathnameMatch = location.pathname.match(/\/org\/([^/]+)/);
    const pathnameOrgId = pathnameMatch ? pathnameMatch[1] : null;
    
    return id || orgId || pathnameOrgId;
  }, [params, location.pathname]);

  const isUuid = (value: string | null | undefined): boolean => {
    if (!value) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  };

  const formatBusinessTypeLabel = (t?: string | null) => {
    const v = String(t || '').toLowerCase().trim();
    if (!v) return null;
    if (v === 'auction_house') return 'Online Auction Platform';
    if (v === 'dealership') return 'Dealership';
    if (v === 'body_shop') return 'Body Shop';
    if (v === 'restoration_shop') return 'Restoration Shop';
    if (v === 'performance_shop') return 'Performance Shop';
    if (v === 'garage') return 'Garage';
    if (v === 'other') return 'Other';
    return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };
  
  const navigate = useNavigate();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [images, setImages] = useState<OrgImage[]>([]);
  const [vehicles, setVehicles] = useState<OrgVehicle[]>([]);
  const [offering, setOffering] = useState<Offering | null>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [intelligence, setIntelligence] = useState<OrganizationIntelligence | null>(null);
  const [tabs, setTabs] = useState<TabConfig[]>([]);
  const [showTrade, setShowTrade] = useState(false);
  const [showOwnershipModal, setShowOwnershipModal] = useState(false);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [contributors, setContributors] = useState<any[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<OrgImage | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);
  const [imageTags, setImageTags] = useState<Record<string, Array<{tag: string, confidence: number}>>>({});
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showLaborRateEditor, setShowLaborRateEditor] = useState(false);
  const [showWorkOrderForm, setShowWorkOrderForm] = useState(false);
  const [showContractorWorkInput, setShowContractorWorkInput] = useState(false);
  const [selectedWorkOrderImage, setSelectedWorkOrderImage] = useState<OrgImage | null>(null);
  const [showOrganizationEditor, setShowOrganizationEditor] = useState(false);
  const [showBaTImporter, setShowBaTImporter] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showVehicleInquiry, setShowVehicleInquiry] = useState(false);
  const [selectedInquiryVehicle, setSelectedInquiryVehicle] = useState<{id: string, name: string} | null>(null);
  const [primaryHeroSrcIndex, setPrimaryHeroSrcIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const ownershipUploadId = `org-ownership-${organizationId}`;
  const [comprehensiveData, setComprehensiveData] = useState<any>(null);

  // One-time CSS for "aliveness" bursts
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const id = 'nuke-alive-burst-css-v1';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes nuke-alive-burst {
        0% { transform: translateY(0) scale(0.9); opacity: 0; }
        15% { opacity: 0.35; }
        100% { transform: translateY(-52px) scale(1.15); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const formatUsd = (value: number | null | undefined): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    return `$${Math.round(value).toLocaleString()}`;
  };

  const computeSignal = (opts: { bids?: number | null; watchers?: number | null; views?: number | null; comments?: number | null }) => {
    const bids = Math.max(0, Math.floor(Number(opts.bids ?? 0) || 0));
    const watchers = Math.max(0, Math.floor(Number(opts.watchers ?? 0) || 0));
    const views = Math.max(0, Math.floor(Number(opts.views ?? 0) || 0));
    const comments = Math.max(0, Math.floor(Number(opts.comments ?? 0) || 0));
    const score = bids * 10 + watchers * 3 + comments * 2 + Math.floor(views / 100);
    return { bids, watchers, views, comments, score };
  };

  const tierLabelFromAnalysisTier = (tier: number | null | undefined): string | null => {
    if (typeof tier !== 'number' || !Number.isFinite(tier)) return null;
    const t = Math.max(0, Math.min(10, Math.floor(tier)));
    return `TIER ${t}`;
  };

  const hasSeenCardThisSession = (vehicleId: string): boolean => {
    try {
      const key = `nuke:card_seen:v1:${vehicleId}`;
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  };

  const markCardSeenThisSession = (vehicleId: string) => {
    try {
      const key = `nuke:card_seen:v1:${vehicleId}`;
      sessionStorage.setItem(key, '1');
    } catch {
      // ignore
    }
  };

  const AliveBurst = ({ vehicleId, intensity }: { vehicleId: string; intensity: number }) => {
    const [show, setShow] = useState(false);

    useEffect(() => {
      if (!vehicleId) return;
      if (hasSeenCardThisSession(vehicleId)) return;
      if (intensity <= 0) return;
      markCardSeenThisSession(vehicleId);
      setShow(true);
      const t = window.setTimeout(() => setShow(false), 900);
      return () => window.clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vehicleId, intensity]);

    if (!show) return null;

    const count = Math.max(6, Math.min(18, Math.floor(intensity)));
    const dots = Array.from({ length: count }, (_, i) => i);

    return (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {dots.map((i) => {
          const left = (i * 37) % 100;
          const delay = (i % 6) * 35;
          const size = 4 + (i % 3) * 2;
          const opacity = 0.22 + (i % 4) * 0.08;
          return (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: '65%',
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: 999,
                background: 'var(--accent)',
                opacity,
                transform: 'translateY(0)',
                animation: `nuke-alive-burst 900ms ease-out ${delay}ms 1 both`,
                filter: 'saturate(1.1)',
              }}
            />
          );
        })}
      </div>
    );
  };

  // Primary image selection (safe even before organization is loaded)
  const primaryImage = images.find(i => i.is_primary) || images.find(i => i.category === 'logo') || images[0];
  const fallbackVehicleImageUrl =
    vehicles.find(v => typeof v.vehicle_image_url === 'string' && v.vehicle_image_url.length > 0)?.vehicle_image_url || null;
  const bannerUrl = (organization as any)?.banner_url || null;
  const isBadHeroImageUrl = (u: string) => {
    const s = String(u || '').toLowerCase();
    // Never use favicons as hero images (they are tiny and will look terrible when stretched).
    if (s.includes('google.com/s2/favicons') || s.includes('/s2/favicons')) return true;
    if (s.includes('favicon')) return true;
    if (s.endsWith('.ico')) return true;
    return false;
  };
  const heroCandidates = [
    bannerUrl,
    primaryImage?.large_url,
    primaryImage?.image_url,
    fallbackVehicleImageUrl,
  ]
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .filter((u) => !isBadHeroImageUrl(u))
    .map((u) => (u.startsWith('//') ? `https:${u}` : u));
  const heroKey = heroCandidates.join('|');

  // Reset hero fallback index when candidate set changes
  useEffect(() => {
    setPrimaryHeroSrcIndex(0);
  }, [heroKey]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (!session?.user?.id) {
      alert('Please log in to upload images');
      return;
    }

    setUploadingImages(true);
    try {
      const uploadedImages: string[] = [];
      let earliestDate: Date | null = null;

      for (const file of files) {
        // Extract EXIF metadata
        const metadata = await extractImageMetadata(file);
        
        // Track earliest date for timeline event
        if (metadata.dateTaken) {
          if (!earliestDate || metadata.dateTaken < earliestDate) {
            earliestDate = metadata.dateTaken;
          }
        }

        // Upload to Supabase Storage
        const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(`organization-data/${organizationId}/images/${fileName}`, file);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(uploadData.path);

        uploadedImages.push(publicUrl);

        // Insert image record
        const { error: insertError } = await supabase
          .from('organization_images')
          .insert({
            organization_id: organizationId,
            user_id: session.user.id,
            image_url: publicUrl,
            category: 'facility',
            taken_at: metadata.dateTaken?.toISOString(),
            latitude: metadata.location?.latitude,
            longitude: metadata.location?.longitude,
            exif_data: {
              camera: metadata.camera,
              technical: metadata.technical,
              location: metadata.location
            }
          });

        if (insertError) throw insertError;
      }

      // Create timeline event for the image upload
      const eventDate = earliestDate || new Date();
      const { error: timelineError } = await supabase
        .from('business_timeline_events')
        .insert({
          business_id: organizationId,
          created_by: session.user.id,
          event_type: 'other', // Using 'other' since 'image_upload' is not in allowed types
          event_category: 'operational', // Must be one of: legal, operational, personnel, financial, recognition, growth, other
          title: `${uploadedImages.length} image${uploadedImages.length === 1 ? '' : 's'} uploaded`,
          description: `Location/facility images added to organization profile`,
          event_date: eventDate.toISOString().split('T')[0],
          image_urls: uploadedImages, // Use image_urls field (added in migration 20251101000009)
          metadata: {
            image_count: uploadedImages.length,
            submitted_by: session.user.id,
            exif_extracted: !!earliestDate,
            earliest_date: earliestDate?.toISOString(),
            actual_event_type: 'image_upload' // Store actual type in metadata for filtering
          }
        });

      if (timelineError) {
        console.error('Failed to create timeline event:', timelineError);
        console.error('Timeline event data:', {
          business_id: organizationId,
          created_by: session.user.id,
          event_type: 'other',
          event_category: 'operational',
          event_date: eventDate.toISOString().split('T')[0],
          image_count: uploadedImages.length
        });
        // Don't fail the upload if timeline event creation fails, but log it
      } else {
        console.log('Successfully created timeline event for image upload');
      }

      // Update contributor count
      await supabase.from('organization_contributors').upsert({
        organization_id: organizationId,
        user_id: session.user.id,
        role: 'photographer',
        contribution_count: uploadedImages.length
      }, {
        onConflict: 'organization_id,user_id',
        ignoreDuplicates: false
      });

      // Reload images with all fields
      const { data: orgImages, error: imagesError } = await supabase
        .from('organization_images')
        .select(`
          id,
          organization_id,
          user_id,
          image_url,
          thumbnail_url,
          medium_url,
          large_url,
          category,
          caption,
          is_primary,
          taken_at,
          latitude,
          longitude,
          uploaded_at,
          created_at,
          is_sensitive,
          blur_preview,
          contains_financial_data,
          location_name,
          exif_data
        `)
        .eq('organization_id', organizationId)
        .order('taken_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      
      if (!imagesError && orgImages) {
        console.log(`Reloaded ${orgImages.length} images after upload`);
        setImages(orgImages);
        if (orgImages.length > 0) {
          loadImageTags(orgImages.map(img => img.id)).catch(() => {});
        }
      } else if (imagesError) {
        console.error('Error reloading images:', imagesError);
      }

      // Reload timeline events
      const { data: eventsData, error: eventsError } = await supabase
        .from('business_timeline_events')
        .select('id, event_type, title, description, event_date, created_by, metadata')
        .eq('business_id', organizationId)
        .order('event_date', { ascending: false })
        .limit(50);
      
      if (eventsError) {
        console.error('Error reloading timeline events:', eventsError);
      } else if (eventsData) {
        console.log(`Reloaded ${eventsData.length} timeline events after upload`);
        const enriched = await Promise.allSettled(
          eventsData.map(async (e: any) => {
            if (!e.created_by) {
              return { ...e, profiles: null };
            }
            const { data: profile } = await supabase.from('profiles').select('full_name, username, avatar_url').eq('id', e.created_by).maybeSingle();
            return { ...e, profiles: profile || null };
          })
        );
        const validEvents = enriched.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map(r => r.value);
        console.log(`Enriched ${validEvents.length} timeline events with profiles`);
        setTimelineEvents(validEvents);
      } else {
        console.log('No timeline events returned after reload');
      }

      alert(`Uploaded ${files.length} image(s) successfully!`);
    } catch (error: any) {
      console.error('Upload failed:', error);
      alert('Upload failed: ' + error.message);
    } finally {
      setUploadingImages(false);
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }
    }
  };

  useEffect(() => {
    console.log('[OrgProfile] useEffect triggered - organizationId:', organizationId);
    
    if (!organizationId) {
      console.error('[OrgProfile] No organizationId in useEffect!');
      setLoading(false);
      return;
    }
    
    let isMounted = true;
    
    const load = async () => {
      if (!isMounted) {
        console.log('[OrgProfile] Component unmounted, skipping load');
        return;
      }
      
      console.log('[OrgProfile] Starting load sequence');
      
      // Load session in parallel
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (isMounted) {
          console.log('[OrgProfile] Session loaded:', session?.user?.id || 'none');
          setSession(session);
        }
      });
      
      // Load organization
      console.log('[OrgProfile] Calling loadOrganization');
      await loadOrganization();
      console.log('[OrgProfile] loadOrganization completed');
    };
    
    load();
    
    return () => {
      console.log('[OrgProfile] Cleanup - unmounting');
      isMounted = false;
    };
  }, [organizationId]);

  const loadImageTags = async (imageIds: string[]) => {
    try {
      const { data: tags } = await supabase
        .from('organization_image_tags')
        .select('image_id, tag, confidence')
        .in('image_id', imageIds)
        .order('confidence', { ascending: false });

      if (tags) {
        const tagsByImage: Record<string, Array<{tag: string, confidence: number}>> = {};
        tags.forEach(t => {
          if (!tagsByImage[t.image_id]) {
            tagsByImage[t.image_id] = [];
          }
          tagsByImage[t.image_id].push({ tag: t.tag, confidence: t.confidence || 0 });
        });
        setImageTags(tagsByImage);
      }
    } catch (error) {
      console.error('Error loading image tags:', error);
    }
  };

  const loadOrganization = async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    // Prevent PostgREST 400 spam when route params are malformed (e.g. "undefined", "null", etc.).
    if (!isUuid(organizationId)) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      setLoadError(null);

      // STEP 1: Load basic organization data - SIMPLE, no timeout complexity
      
      // Use maybeSingle() instead of single() to avoid throwing on RLS/permission errors
      const { data: org, error: orgError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', organizationId)
        .maybeSingle();
      

      if (orgError) {
        // Log full error for debugging
        console.error('[OrgProfile] Supabase error:', {
          code: (orgError as any)?.code,
          message: orgError.message,
          details: (orgError as any)?.details,
          hint: (orgError as any)?.hint
        });
        
        // For now, if there's an error, try to continue anyway (might be RLS issue that resolves)
        // Don't block the page - let it try to render with null org which shows proper error UI
      }
      
      if (!org) {
        // Organization not found or blocked by RLS
        let errorMessage = 'Organization not found or not accessible.';
        
        if (orgError) {
          const rawMessage = orgError.message || String(orgError);
          // Check if it's an RLS/permission issue
          if (rawMessage.includes('row-level security') || rawMessage.includes('permission') || (orgError as any)?.code === '42501') {
            errorMessage = 'This organization may be private. Try logging in to view it.';
          } else if (rawMessage.includes('NOT_FOUND') || rawMessage.includes('No rows')) {
            errorMessage = 'This organization does not exist.';
          }
        }
        
        setLoadError(errorMessage);
        setLoading(false);
        setOrganization(null);
        return;
      }
      
      setOrganization(org);
      
      // Load comprehensive profile data (BaT-style stats)
      try {
        const comprehensive = await getOrganizationProfileData(organizationId);
        setComprehensiveData(comprehensive);
      } catch (err) {
        console.warn('[OrgProfile] Failed to load comprehensive profile data:', err);
      }
      
      // Load organization intelligence (respects explicit settings)
      (async () => {
        try {
          const intelligence = await OrganizationIntelligenceService.getIntelligence(organizationId);
          
          if (intelligence) {
            setIntelligence(intelligence);
            
            // Get data signals for tab priority calculation
            let dataSignals = intelligence.dataSignals;
            if (!dataSignals || Object.keys(dataSignals).length === 0) {
              dataSignals = await OrganizationIntelligenceService.analyzeDataSignals(organizationId);
            }
            
            // Determine tab priority based on intelligence
            const priorityTabs = OrganizationIntelligenceService.determineTabPriority(intelligence, dataSignals);
            setTabs(priorityTabs);
          } else {
            // Fallback to default tabs
            setTabs([
              { id: 'overview', priority: 100, label: 'Overview' },
              { id: 'vehicles', priority: 80, label: 'Vehicles' },
              { id: 'images', priority: 70, label: 'Images' },
              { id: 'inventory', priority: 60, label: 'Inventory' },
              { id: 'contributors', priority: 50, label: 'Contributors' },
              { id: 'marketplace', priority: 40, label: 'Marketplace' },
              { id: 'notifications', priority: 20, label: 'Notifications' }
            ]);
          }
        } catch (error) {
          console.error('[OrgProfile] Error loading organization intelligence:', error);
          // Fallback to default tabs
          setTabs([
            { id: 'overview', priority: 100, label: 'Overview' },
            { id: 'vehicles', priority: 80, label: 'Vehicles' },
            { id: 'images', priority: 70, label: 'Images' },
            { id: 'inventory', priority: 60, label: 'Inventory' },
            { id: 'contributors', priority: 50, label: 'Contributors' },
            { id: 'marketplace', priority: 40, label: 'Marketplace' },
            { id: 'notifications', priority: 20, label: 'Notifications' }
          ]);
        }
      })();
      
      // CRITICAL: Set loading to false IMMEDIATELY after org loads so page can render
      setLoading(false);

      // STEP 2: Load everything else in background (non-blocking)
      // Images - Load ALL fields needed for display
      (async () => {
        try {
          const { data: orgImages, error: imagesError } = await supabase
            .from('organization_images')
            .select(`
              id,
              organization_id,
              user_id,
              image_url,
              thumbnail_url,
              medium_url,
              large_url,
              category,
              caption,
              is_primary,
              taken_at,
              latitude,
              longitude,
              uploaded_at,
              created_at,
              is_sensitive,
              blur_preview,
              contains_financial_data,
              location_name,
              exif_data
            `)
            .eq('organization_id', organizationId)
            .order('taken_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false });
          
          if (imagesError) {
            console.error('Error loading images:', imagesError);
            setImages([]);
          } else {
            setImages(orgImages || []);
            if (orgImages && orgImages.length > 0) {
              loadImageTags(orgImages.map(img => img.id)).catch(() => {});
            }
          }
        } catch (error) {
          console.error('Exception loading images:', error);
          setImages([]);
        }
      })();

      // Vehicles (simplified, load in background)
      (async () => {
        try {
          const { data: orgVehicles, error: vehiclesError } = await supabase
            .from('organization_vehicles')
            .select('id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, sale_price, listing_status, asking_price, cost_basis, days_on_lot')
            .eq('organization_id', organizationId)
            .or('status.eq.active,status.eq.sold,status.eq.archived')
            .order('created_at', { ascending: false });
          
          if (vehiclesError) {
            setVehicles([]);
            return;
          }
          
                  // Enrich vehicles in background
          const enriched = await Promise.allSettled(
            (orgVehicles || []).map(async (ov: any) => {
              try {
                const now = new Date().toISOString();
                const [vehicleResult, imageResult, nativeAuction, externalAuction, batAuction] = await Promise.all([
                  supabase
                    .from('vehicles')
                    .select('id, year, make, model, vin, current_value, asking_price, sale_status, sale_price, sale_date, listing_location, listing_location_raw, analysis_tier, signal_score')
                    .eq('id', ov.vehicle_id)
                    .single(),
                  // Prefer primary image, but fall back to the first available image so thumbnails don't look "broken"
                  supabase
                    .from('vehicle_images')
                    .select('thumbnail_url, medium_url, image_url, variants')
                    .eq('vehicle_id', ov.vehicle_id)
                    .order('is_primary', { ascending: false })
                    .order('created_at', { ascending: true })
                    .limit(1)
                    .maybeSingle(),
                  // Check for active native auction listing
                  supabase.from('vehicle_listings')
                    .select('id, status, sale_type, auction_end_time, current_high_bid_cents, bid_count, reserve_price_cents')
                    .eq('vehicle_id', ov.vehicle_id)
                    .eq('status', 'active')
                    .in('sale_type', ['auction', 'live_auction'])
                    .gt('auction_end_time', now)
                    .maybeSingle(),
                  // Check for active external listing (BaT, Cars & Bids, etc.)
                  // Use end_date > NOW() as primary check (more reliable than status)
                  supabase.from('external_listings')
                    .select('id, organization_id, listing_status, end_date, current_bid, bid_count, reserve_price, platform, listing_url, view_count, watcher_count, metadata')
                    .eq('vehicle_id', ov.vehicle_id)
                    .gt('end_date', now)
                    .maybeSingle(),
                  // Check for active BaT listing
                  // Use auction_end_date > NOW() as primary check (more reliable than status)
                  supabase.from('bat_listings')
                    .select('id, organization_id, seller_username, listing_status, auction_end_date, high_bid, final_bid, bid_count, comment_count, view_count, reserve_price, bat_listing_url')
                    .eq('vehicle_id', ov.vehicle_id)
                    .gt('auction_end_date', now.split('T')[0])
                    .maybeSingle()
                ]);
                
                // Determine which auction is active (prioritize native, then external, then bat)
                let auctionListing = nativeAuction.data || externalAuction.data || batAuction.data;
                let auctionData: any = null;
                
                if (nativeAuction.data) {
                  auctionData = {
                    auction_end_time: nativeAuction.data.auction_end_time,
                    auction_current_bid: nativeAuction.data.current_high_bid_cents,
                    auction_bid_count: nativeAuction.data.bid_count || 0,
                    auction_reserve_price: nativeAuction.data.reserve_price_cents,
                    auction_platform: null,
                    auction_url: null,
                    auction_view_count: null,
                    auction_watcher_count: null
                  };
                } else if (externalAuction.data) {
                  const endDate = externalAuction.data.end_date;
                  const meta = externalAuction.data.metadata && typeof externalAuction.data.metadata === 'object' ? externalAuction.data.metadata : {};
                  const metaLocation = typeof meta?.location === 'string' ? meta.location : null;
                  // Parse current_bid (may be string or number)
                  const parseBid = (bid: any): number | null => {
                    if (bid === null || bid === undefined) return null;
                    if (typeof bid === 'number') return Math.round(bid * 100);
                    if (typeof bid === 'string') {
                      const cleaned = bid.replace(/[^0-9.]/g, '');
                      const num = parseFloat(cleaned);
                      return Number.isFinite(num) ? Math.round(num * 100) : null;
                    }
                    return null;
                  };
                  auctionData = {
                    auction_end_time: endDate,
                    auction_current_bid: parseBid(externalAuction.data.current_bid),
                    auction_bid_count: externalAuction.data.bid_count || 0,
                    auction_reserve_price: externalAuction.data.reserve_price ? Math.round(Number(externalAuction.data.reserve_price) * 100) : null,
                    auction_platform: externalAuction.data.platform,
                    auction_url: externalAuction.data.listing_url,
                    auction_view_count: typeof externalAuction.data.view_count === 'number' ? externalAuction.data.view_count : null,
                    auction_watcher_count: typeof externalAuction.data.watcher_count === 'number' ? externalAuction.data.watcher_count : null,
                    auction_comment_count: null,
                    vehicle_location: metaLocation || null,
                    seller_org_id: typeof externalAuction.data.organization_id === 'string' ? externalAuction.data.organization_id : null,
                    seller_handle: null
                  };
                } else if (batAuction.data) {
                  // Convert DATE to TIMESTAMPTZ for end of day
                  const endDate = new Date(batAuction.data.auction_end_date);
                  endDate.setHours(23, 59, 59, 999);
                  // Use high_bid for live auctions, final_bid only for sold auctions
                  const isLive = endDate.getTime() > Date.now();
                  const currentBid = isLive ? (batAuction.data.high_bid || null) : (batAuction.data.final_bid || null);
                  auctionData = {
                    auction_end_time: endDate.toISOString(),
                    auction_current_bid: currentBid ? Math.round(Number(currentBid) * 100) : null,
                    auction_bid_count: batAuction.data.bid_count || 0,
                    auction_reserve_price: batAuction.data.reserve_price ? Math.round(Number(batAuction.data.reserve_price) * 100) : null,
                    auction_platform: 'bat',
                    auction_url: batAuction.data.bat_listing_url,
                    auction_view_count: typeof batAuction.data.view_count === 'number' ? batAuction.data.view_count : null,
                    auction_watcher_count: null,
                    auction_comment_count: typeof batAuction.data.comment_count === 'number' ? batAuction.data.comment_count : null,
                    seller_org_id: typeof batAuction.data.organization_id === 'string' ? batAuction.data.organization_id : null,
                    seller_handle: typeof batAuction.data.seller_username === 'string' ? batAuction.data.seller_username : null
                  };
                }
                
                // Use vehicle's sale data if org_vehicle doesn't have it
                const finalSaleDate = ov.sale_date || vehicleResult.data?.sale_date;
                const finalSalePrice = ov.sale_price || vehicleResult.data?.sale_price;
                
                const vehicleLocation =
                  (auctionData?.vehicle_location as string | null) ||
                  (vehicleResult.data?.listing_location_raw as string | null) ||
                  (vehicleResult.data?.listing_location as string | null) ||
                  null;

                const imgVariants = imageResult.data?.variants && typeof imageResult.data.variants === 'object' ? imageResult.data.variants : {};
                const bestImg =
                  (typeof imgVariants?.thumbnail === 'string' && imgVariants.thumbnail) ||
                  (typeof imgVariants?.medium === 'string' && imgVariants.medium) ||
                  (typeof imageResult.data?.thumbnail_url === 'string' && imageResult.data.thumbnail_url) ||
                  (typeof imageResult.data?.medium_url === 'string' && imageResult.data.medium_url) ||
                  (typeof imageResult.data?.image_url === 'string' && imageResult.data.image_url) ||
                  null;

                return {
                  id: ov.id,
                  vehicle_id: ov.vehicle_id,
                  relationship_type: ov.relationship_type,
                  status: ov.status,
                  start_date: ov.start_date,
                  end_date: ov.end_date,
                  sale_date: finalSaleDate,
                  sale_price: finalSalePrice,
                  vehicle_year: vehicleResult.data?.year,
                  vehicle_make: vehicleResult.data?.make,
                  vehicle_model: vehicleResult.data?.model,
                  vehicle_vin: vehicleResult.data?.vin,
                  vehicle_current_value: vehicleResult.data?.current_value,
                  vehicle_asking_price: vehicleResult.data?.asking_price || ov.asking_price,
                  vehicle_sale_status: vehicleResult.data?.sale_status,
                  vehicle_image_url: bestImg,
                  vehicle_location: vehicleLocation,
                  listing_status: ov.listing_status,
                  cost_basis: ov.cost_basis,
                  days_on_lot: ov.days_on_lot,
                  has_active_auction: !!auctionListing, // Flag for sorting
                  auction_end_time: auctionData?.auction_end_time || null,
                  auction_current_bid: auctionData?.auction_current_bid || null,
                  auction_bid_count: auctionData?.auction_bid_count || 0,
                  auction_reserve_price: auctionData?.auction_reserve_price || null,
                  auction_platform: auctionData?.auction_platform || null,
                  auction_url: auctionData?.auction_url || null,
                  auction_view_count: auctionData?.auction_view_count || null,
                  auction_watcher_count: auctionData?.auction_watcher_count || null,
                  auction_comment_count: auctionData?.auction_comment_count || null,
                  seller_org_id: auctionData?.seller_org_id || null,
                  seller_handle: auctionData?.seller_handle || null,
                  analysis_tier: typeof vehicleResult.data?.analysis_tier === 'number' ? vehicleResult.data.analysis_tier : null,
                  signal_score: typeof vehicleResult.data?.signal_score === 'number' ? vehicleResult.data.signal_score : null,
                  vehicles: vehicleResult.data || {}
                };
              } catch {
                return { id: ov.id, vehicle_id: ov.vehicle_id, relationship_type: ov.relationship_type, status: ov.status, vehicles: {} };
              }
            })
          );
          
          const baseRows = enriched
            .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
            .map((r) => r.value) as OrgVehicle[];

          // Batch-load seller org metadata (for favicon + dealer name)
          const sellerOrgIds = Array.from(
            new Set(
              baseRows
                .map((v) => v?.seller_org_id)
                .filter((x): x is string => typeof x === 'string' && x.length > 0)
            )
          );

          let orgById = new Map<string, { business_name?: string | null; website?: string | null }>();
          if (sellerOrgIds.length > 0) {
            const { data: orgRows } = await supabase
              .from('businesses')
              .select('id, business_name, website')
              .in('id', sellerOrgIds);
            for (const o of (orgRows || []) as any[]) {
              if (!o?.id) continue;
              orgById.set(String(o.id), { business_name: o.business_name ?? null, website: o.website ?? null });
            }
          }

          const withSeller = baseRows.map((v) => {
            const sellerOrgId = v?.seller_org_id || null;
            const org = sellerOrgId ? orgById.get(String(sellerOrgId)) : null;
            return {
              ...v,
              seller_org_name: org?.business_name ?? null,
              seller_org_website: org?.website ?? null,
            };
          });

          setVehicles(withSeller);
        } catch {
          setVehicles([]);
        }
      })();

      // Offering (background)
      if (org.is_tradable && org.stock_symbol) {
        (async () => {
          try {
            const { data: offeringData, error: offeringError } = await supabase
              .from('organization_offerings')
              .select('*')
              .eq('organization_id', organizationId)
              .eq('status', 'active')
              .maybeSingle();
            if (!offeringError && offeringData) setOffering(offeringData);
          } catch {
            // Ignore errors
          }
        })();
      }

      // Contributors (background)
      (async () => {
        try {
          const { data: contributorsData, error: contributorsError } = await supabase
            .from('organization_contributors')
            .select('id, user_id, role, contribution_count, created_at')
            .eq('organization_id', organizationId)
            .order('contribution_count', { ascending: false })
            .limit(20);
          
          if (contributorsError || !contributorsData) {
            setContributors([]);
            return;
          }
          
          const enriched = await Promise.allSettled(
            contributorsData.map(async (c: any) => {
              if (!c.user_id) {
                return { ...c, profiles: null };
              }
              const { data: profile } = await supabase.from('profiles').select('id, full_name, username, avatar_url').eq('id', c.user_id).maybeSingle();
              return { ...c, profiles: profile || null };
            })
          );
          
          setContributors(enriched.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map(r => r.value));
          
          // Check user permissions in background
          (async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (user && org) {
                const contributor = enriched.find((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.user_id === user.id);
                const userRole = contributor?.value?.role || null;
                setCurrentUserRole(userRole);
                
                // Check if user has edit permissions via role OR admin status
                const hasRoleEdit = ['owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician', 'moderator', 'contractor', 'contributor'].includes(userRole || '');
                const isAdmin = await AdminNotificationService.isCurrentUserAdmin();
                setCanEdit(hasRoleEdit || isAdmin);
                
                const { data: ownership } = await supabase.from('business_ownership').select('id').eq('business_id', org.id).eq('owner_id', user.id).eq('status', 'active').maybeSingle();
                setIsOwner(!!ownership);
              }
            } catch {
              // Ignore errors
            }
          })();
        } catch {
          setContributors([]);
        }
      })();

      // Timeline (background)
      (async () => {
        try {
          if (!organizationId) {
            console.warn('No organizationId, skipping timeline events load');
            setTimelineEvents([]);
            return;
          }

          const { data: eventsData, error: eventsError } = await supabase
            .from('business_timeline_events')
            .select('id, event_type, title, description, event_date, created_by, metadata, image_urls, documentation_urls')
            .eq('business_id', organizationId)
            .order('event_date', { ascending: false })
            .limit(50);
          
          if (eventsError) {
            console.error('Error loading timeline events:', eventsError);
            setTimelineEvents([]);
            return;
          }
          
          if (!eventsData || eventsData.length === 0) {
            setTimelineEvents([]);
            return;
          }
          
          const enriched = await Promise.allSettled(
            eventsData.map(async (e: any) => {
              if (!e.created_by) {
                return { ...e, profiles: null };
              }
              const { data: profile } = await supabase.from('profiles').select('full_name, username, avatar_url').eq('id', e.created_by).maybeSingle();
              return { ...e, profiles: profile || null };
            })
          );
          
          const validEvents = enriched.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map(r => r.value);
          setTimelineEvents(validEvents);
        } catch (error) {
          console.error('Exception loading timeline events:', error);
          setTimelineEvents([]);
        }
      })();

    } catch (error: any) {
      setLoadError(error?.message || 'Failed to load organization. Please try again.');
      setLoading(false);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!confirm('Delete this image? This cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('organization_images')
        .delete()
        .eq('id', imageId);

      if (error) throw error;

      // Remove from local state
      setImages(images.filter(img => img.id !== imageId));
      alert('Image deleted successfully');
    } catch (error: any) {
      console.error('Error deleting image:', error);
      alert(`Failed to delete: ${error.message}`);
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    try {
      const selectedImage = images.find(img => img.id === imageId);
      if (!selectedImage) return;

      // Clear primary flag for all org images (do NOT overwrite categories)
      await supabase
        .from('organization_images')
        .update({ is_primary: false })
        .eq('organization_id', organizationId);

      // Set selected image as primary (and optionally mark as logo category for legacy UI)
      const { error: imageError } = await supabase
        .from('organization_images')
        .update({ is_primary: true, category: selectedImage.category || 'logo' })
        .eq('id', imageId);

      if (imageError) throw imageError;

      // Also update the organization's logo_url
      const { error: orgError } = await supabase
        .from('businesses')
        .update({ logo_url: selectedImage.large_url || selectedImage.image_url })
        .eq('id', organizationId);

      if (orgError) throw orgError;

      // Reload images
      loadOrganization();
      alert('Primary image updated');
    } catch (error: any) {
      console.error('Error setting primary:', error);
      alert(`Failed: ${error.message}`);
    }
  };

  const handleScanImage = async (imageId: string) => {
    try {
      const image = images.find(img => img.id === imageId);
      if (!image) return;

      // Call AI scanning edge function
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/scan-organization-image`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            imageId: image.id,
            imageUrl: image.image_url,
            organizationId: organizationId
          })
        }
      );

      if (!response.ok) throw new Error('Scan failed');

      const result = await response.json();
      alert(`Scan complete! Found: ${result.tags?.length || 0} tags, ${result.inventory?.length || 0} inventory items`);
      
      // Reload to show tags
      loadOrganization();
    } catch (error: any) {
      console.error('Error scanning image:', error);
      alert(`Scan failed: ${error.message}`);
    }
  };

  const handleAddArticle = async (articleUrl: string) => {
    if (!session?.user?.id || !organizationId) {
      alert('Please log in to add articles');
      return;
    }

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        alert('Session expired. Please log in again.');
        return;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/discover-org-articles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession.access_token}`
        },
        body: JSON.stringify({
          organizationId,
          articleUrl
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process article');
      }

      const result = await response.json();
      if (result.success) {
        alert('Article added to timeline! Images extracted and timeline event created.');
        // Reload timeline events
        loadOrganization();
      } else {
        alert(`Failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('Error adding article:', error);
      alert(`Failed to add article: ${error.message}`);
    }
  };

  const handleOwnershipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !organization?.id) return;

    const formData = new FormData(e.target as HTMLFormElement);
    const verificationType = formData.get('verificationType') as string;
    const documentFile = fileInputRef.current?.files?.[0];

    if (!documentFile) {
      alert('Please select a document file');
      return;
    }

    try {
      // Upload to storage
      const fileExt = documentFile.name.split('.').pop();
      const fileName = `${Date.now()}_${verificationType}.${fileExt}`;
      const storagePath = `organization-data/${organization.id}/ownership/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('vehicle-data')
        .upload(storagePath, documentFile);

      if (uploadError) throw uploadError;

      const publicUrl = supabase.storage.from('vehicle-data').getPublicUrl(storagePath).data.publicUrl;

      // Check for existing verification
      const { data: existing } = await supabase
        .from('organization_ownership_verifications')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('organization_id', organization.id)
        .or('status.eq.pending,status.eq.approved')
        .maybeSingle();

      if (existing) {
        // Update existing
        await supabase
          .from('organization_ownership_verifications')
          .update({
            verification_type: verificationType,
            document_url: publicUrl,
            status: 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Create new
        await supabase
          .from('organization_ownership_verifications')
          .insert({
            organization_id: organization.id,
            user_id: session.user.id,
            verification_type: verificationType,
            document_url: publicUrl,
            status: 'pending'
          });
      }

      alert('Ownership claim submitted. Awaiting review.');
      setShowOwnershipModal(false);
      setSelectedFileName('');
      loadOrganization();

    } catch (error: any) {
      console.error('Ownership submission error:', error);
      alert(`Failed: ${error.message}`);
    }
  };

  // Safety check - if we've been loading for too long, show error
  useEffect(() => {
    if (loading && organizationId) {
      const timeout = setTimeout(() => {
        console.error('[OrgProfile] Loading timeout - forcing error state');
        setLoadError('Loading took too long. The organization may be private or the server is slow.');
        setLoading(false);
      }, 10000);
      return () => clearTimeout(timeout);
    }
  }, [loading, organizationId]);

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Loading organization...</div>
        {!organizationId && (
          <div className="text text-muted" style={{ marginTop: 'var(--space-2)', fontSize: '8pt' }}>
            No organization ID found in URL
          </div>
        )}
        {loadError && (
          <div className="text text-muted" style={{ marginTop: 'var(--space-2)', fontSize: '8pt' }}>
            {loadError}
          </div>
        )}
      </div>
    );
  }

  if (!organization) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
        <div className="text" style={{ fontSize: '14pt', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
          Organization Not Found
        </div>
        {loadError && (
          <div className="text text-muted" style={{ marginTop: 'var(--space-2)', fontSize: '9pt', marginBottom: 'var(--space-4)' }}>
            {loadError}
          </div>
        )}
        {!loadError && (
          <div className="text text-muted" style={{ marginTop: 'var(--space-2)', fontSize: '9pt', marginBottom: 'var(--space-4)' }}>
            The organization you're looking for doesn't exist or has been removed.
          </div>
        )}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/org')}
            className="button button-secondary"
            style={{ fontSize: '9pt', padding: '8px 16px' }}
          >
            Browse Organizations
          </button>
          <button
            onClick={() => navigate(-1)}
            className="button button-primary"
            style={{ fontSize: '9pt', padding: '8px 16px' }}
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const displayName = organization.business_name || organization.legal_name || 'Unnamed Organization';
  
  // Detect BaT organization for proper logo
  const orgName = String(displayName).toLowerCase();
  const isBatOrg = orgName.includes('bring a trailer') || orgName === 'bat' || orgName.includes('ba t');
  const isBroadArrow = orgName.includes('broad arrow') || orgName.includes('broadarrow');
  
  // Use proper vendor logos when available, otherwise fall back to organization logo
  const headerLogoUrl = isBatOrg 
    ? '/vendor/bat/favicon.ico'
    : ((organization as any)?.logo_url || null);

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* HEADER: Organization Name - Top Focus */}
      <div style={{
        position: 'sticky',
        top: 'var(--header-height, 40px)',
        zIndex: 900,
        background: 'var(--surface-glass)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid var(--border)',
        padding: '8px 12px',
        marginBottom: '12px',
        boxShadow: 'rgba(0, 0, 0, 0.12) 0px 2px 4px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          {/* Organization name - PRIMARY FOCUS */}
          <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            {headerLogoUrl && (
              <img
                src={String(headerLogoUrl).startsWith('//') ? `https:${headerLogoUrl}` : headerLogoUrl}
                alt=""
                width={89}
                height={37}
                style={{
                  display: 'block',
                  maxWidth: 120,
                  height: 'auto',
                  imageRendering: 'auto'
                }}
                onError={(e) => {
                  // Hide broken external logos silently
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            {/* Favicon from website - show if no logo or as additional identifier */}
            {organization.website && (
              <FaviconIcon 
                url={organization.website} 
                size={20}
                style={{ flexShrink: 0 }}
              />
            )}
            <h1 style={{ 
              fontSize: '20pt', 
              fontWeight: 700, 
              color: 'var(--text)', 
              margin: 0,
              lineHeight: '1.2',
              wordBreak: 'break-word'
            }}>
              {displayName}
            </h1>
            {organization.business_type && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                  {formatBusinessTypeLabel(organization.business_type) || organization.business_type}
                </div>
              </div>
            )}
          </div>

          {/* Stock price (if tradable) - Secondary */}
          {organization.is_tradable && offering && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' }}>
                  ${offering.current_share_price.toFixed(2)}
                </div>
                <span style={{ fontSize: '9pt', color: 'var(--color-text-muted)' }}>per share</span>
              </div>
              <span style={{
                background: 'var(--surface-hover)',
                border: '1px solid var(--border)',
                padding: '2px 6px',
                borderRadius: '2px',
                fontSize: '8pt',
                color: 'var(--success)',
                fontWeight: 600
              }}>
                {organization.stock_symbol || 'ORG'}
              </span>
              <button
                onClick={() => setShowTrade(true)}
                className="button button-primary button-small"
                style={{ fontSize: '8pt', fontFamily: '"MS Sans Serif", sans-serif', borderRadius: 0 }}
              >
                Trade Shares
              </button>
            </div>
          )}

          {/* Creator badge with actual username - hide if creator is current user and only a contractor */}
          {organization.discovered_by && (() => {
            // Find the creator in contributors list
            const creator = contributors.find(c => c.user_id === organization.discovered_by);
            const creatorName = creator?.profiles?.full_name || creator?.profiles?.username || 'Unknown';
            const creatorRole = creator?.role;
            
            // Check if creator is the current user
            const isCurrentUser = session?.user?.id === organization.discovered_by;
            
            // Hide badge if current user is creator AND they're only a contractor/moderator (not owner/manager)
            if (isCurrentUser) {
              const isCreatorOwner = creatorRole && ['owner', 'co_founder', 'board_member', 'manager'].includes(creatorRole);
              if (!isCreatorOwner) {
                // Current user created it but is only contractor/moderator - hide badge
                return null;
              }
            }
            
            return (
              <a
                href={`/profile/${organization.discovered_by}`}
                className="badge badge-secondary"
                title="View profile"
                style={{ textDecoration: 'none', fontSize: '8pt', cursor: 'pointer' }}
              >
                Created by {creatorName}
              </a>
            );
          })()}

          {/* Action buttons */}
          {session && (
            <>
              <button
                onClick={() => setShowWorkOrderForm(true)}
                className="button button-primary button-small"
                style={{ fontSize: '8pt', fontFamily: '"MS Sans Serif", sans-serif', borderRadius: 0 }}
              >
                Request Work
              </button>
              <button
                onClick={() => setShowContributeModal(true)}
                className="button button-secondary button-small"
                style={{ fontSize: '8pt', fontFamily: '"MS Sans Serif", sans-serif', borderRadius: 0 }}
              >
                Contribute Data
              </button>
              {!isOwner && (
                <button
                  onClick={() => setShowOwnershipModal(true)}
                  className="button button-secondary button-small"
                  style={{ fontSize: '8pt', fontFamily: '"MS Sans Serif", sans-serif', borderRadius: 0 }}
                >
                  Claim Ownership
                </button>
              )}
            </>
                )}
        </div>
              </div>

      {/* Primary Image */}
      {heroCandidates.length > 0 && (
        <section style={{ margin: '16px' }}>
          <div
            style={{
              position: 'relative',
              height: '300px',
              border: '1px solid var(--border)',
              overflow: 'hidden',
              background: 'var(--surface)'
            }}
          >
            <img
              src={heroCandidates[Math.min(primaryHeroSrcIndex, heroCandidates.length - 1)]}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={() => {
                setPrimaryHeroSrcIndex((idx) => Math.min(idx + 1, heroCandidates.length - 1));
              }}
            />
          </div>
        </section>
      )}

      {/* Dynamic Tabs - Respects explicit settings, uses data-driven as fallback */}
      {tabs.length > 0 ? (
        <DynamicTabBar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          source={intelligence?.source}
        />
      ) : (
        // Fallback to default tabs while loading
        <div style={{
          background: 'var(--surface)',
          borderBottom: '2px solid var(--border)',
          padding: '0 16px'
        }}>
          {(['overview', 'vehicles', 'images', 'inventory', 'contributors', 'marketplace', 'notifications'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? 'var(--grey-200)' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : 'none',
                padding: '8px 12px',
                fontSize: '9pt',
                cursor: 'pointer',
                fontFamily: 'Arial, sans-serif',
                textTransform: 'capitalize',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text)'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: '16px' }}>
        {activeTab === 'overview' && (
          <>

            {/* GitHub-Style Activity Heatmap */}
            <div style={{ marginBottom: '16px' }}>
              <OrganizationTimelineHeatmap organizationId={organizationId!} />
            </div>

            {/* Live Auctions - Separate section at top */}
            {(() => {
              // Filter for vehicles with active auctions
              const liveAuctions = vehicles.filter(v => {
                // Must be active
                if (v.status !== 'active') return false;
                
                // Must have active auction
                if (!v.has_active_auction) return false;
                
                // Exclude service/work vehicles
                if (v.relationship_type === 'service_provider' || 
                    v.relationship_type === 'work_location' ||
                    v.relationship_type === 'transport' ||
                    v.relationship_type === 'storage') {
                  return false;
                }
                
                // Must be inventory type
                const isInventoryType = 
                  v.relationship_type === 'in_stock' ||
                  v.relationship_type === 'consigner' ||
                  v.relationship_type === 'owner' ||
                  v.relationship_type === 'current_consignment' ||
                  v.relationship_type === 'seller' ||
                  v.relationship_type === 'buyer';
                
                if (!isInventoryType && v.relationship_type) {
                  return false;
                }
                
                // Check all sold indicators
                const isSold = 
                  v.sale_date || 
                  v.sale_price || 
                  v.vehicle_sale_status === 'sold' ||
                  v.listing_status === 'sold' ||
                  (v.vehicles && (v.vehicles as any).sale_price) ||
                  (v.vehicles && (v.vehicles as any).sale_date);
                
                return !isSold;
              });
              
              // Sort by auction end time (ending soon first)
              const sortedAuctions = [...liveAuctions].sort((a, b) => {
                const aEnd = a.auction_end_time ? new Date(a.auction_end_time).getTime() : 0;
                const bEnd = b.auction_end_time ? new Date(b.auction_end_time).getTime() : 0;
                return aEnd - bEnd;
              });
              
              if (sortedAuctions.length > 0) {
                return (
                  <div className="card" style={{ marginBottom: '16px', border: '2px solid #dc2626' }}>
                    <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700, color: '#dc2626' }}>
                      LIVE AUCTIONS
                    </div>
                    <div className="card-body">
                      {sortedAuctions.map((vehicle) => {
                        const signal = computeSignal({
                          bids: vehicle.auction_bid_count,
                          watchers: (vehicle as any).auction_watcher_count,
                          views: (vehicle as any).auction_view_count,
                          comments: (vehicle as any).auction_comment_count,
                        });
                        const tierLabel = tierLabelFromAnalysisTier((vehicle as any).analysis_tier ?? null);
                        const formatTimeRemaining = (endTime: string | null) => {
                          if (!endTime) return 'N/A';
                          const now = new Date();
                          const end = new Date(endTime);
                          const diff = end.getTime() - now.getTime();
                          if (diff <= 0) return 'Ended';
                          const hours = Math.floor(diff / (60 * 60 * 1000));
                          const days = Math.floor(hours / 24);
                          if (days > 0) return `${days}d ${hours % 24}h`;
                          return `${hours}h`;
                        };
                        
                        return (
                        <div
                          key={vehicle.id}
                          style={{
                            padding: '12px',
                            marginBottom: '8px',
                            border: '2px solid #dc2626',
                            borderRadius: '4px',
                            background: 'var(--surface)',
                            cursor: 'pointer',
                            position: 'relative'
                          }}
                          onClick={() => navigate(`/vehicle/${vehicle.vehicle_id}`)}
                        >
                          <AliveBurst vehicleId={vehicle.vehicle_id} intensity={Math.min(18, Math.floor(signal.score / 12))} />
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: '6px' }}>
                            <div style={{ display: 'flex', gap: 10, minWidth: 0, flex: 1 }}>
                              {vehicle.vehicle_image_url ? (
                                <img
                                  src={vehicle.vehicle_image_url}
                                  alt={`${vehicle.vehicle_year} ${vehicle.vehicle_make} ${vehicle.vehicle_model}`}
                                  style={{
                                    width: '96px',
                                    height: '72px',
                                    objectFit: 'cover',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border)',
                                    background: 'var(--grey-100)',
                                  }}
                                  loading="lazy"
                                  decoding="async"
                                  onError={(e) => {
                                    const img = e.currentTarget as HTMLImageElement;
                                    img.style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: '96px',
                                    height: '72px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border)',
                                    background: 'var(--grey-100)',
                                  }}
                                />
                              )}

                              <div style={{ flex: 1, minWidth: 0 }}>
                              <a 
                                href={`/vehicle/${vehicle.vehicle_id}`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ 
                                  fontSize: '10pt', 
                                  fontWeight: 700, 
                                  color: '#dc2626', 
                                  marginBottom: '2px',
                                  display: 'block',
                                  textDecoration: 'none'
                                }}
                                className="hover:underline"
                              >
                                {vehicle.vehicle_year} {vehicle.vehicle_make} {vehicle.vehicle_model}
                              </a>

                              <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                                <div style={{ fontSize: '12pt', fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                                  {vehicle.auction_current_bid ? formatUsd(vehicle.auction_current_bid / 100) : 'No bids yet'}
                                </div>
                                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {vehicle.vehicle_location ? vehicle.vehicle_location : 'Location unknown'}
                                </div>
                              </div>

                              <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                {tierLabel ? (
                                  <span style={{ fontSize: '7pt', color: 'var(--text-secondary)' }}>{tierLabel}</span>
                                ) : null}
                                <span style={{ fontSize: '7pt', color: 'var(--text-secondary)' }}>
                                  SIGNAL {signal.score}
                                </span>
                                {signal.bids > 0 && (
                                  <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>BIDS {signal.bids}</span>
                                )}
                                {signal.watchers > 0 && (
                                  <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>WATCH {signal.watchers}</span>
                                )}
                                {signal.comments > 0 && (
                                  <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>COMM {signal.comments}</span>
                                )}
                                {signal.views > 0 && (
                                  <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>VIEWS {signal.views}</span>
                                )}
                                {!vehicle.auction_reserve_price && (
                                  <span style={{ fontSize: '7pt', color: 'var(--warning)', fontWeight: 700 }}>NO RESERVE</span>
                                )}
                              </div>
                            </div>
                            </div>
                            <div style={{ textAlign: 'right', marginLeft: '12px' }}>
                              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                Time Left
                              </div>
                              <div style={{ fontSize: '9pt', fontWeight: 700, color: '#dc2626', whiteSpace: 'nowrap' }}>
                                {formatTimeRemaining(vehicle.auction_end_time)}
                              </div>
                            </div>
                          </div>
                          
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <div
                                style={{
                                  fontSize: '7pt',
                                  padding: '2px 6px',
                                  borderRadius: '2px',
                                  background: '#dc2626',
                                  color: 'white',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  maxWidth: 220,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                                title={
                                  vehicle.seller_org_name
                                    ? `Seller: ${vehicle.seller_org_name}`
                                    : vehicle.seller_handle
                                      ? `Seller: ${vehicle.seller_handle}`
                                      : 'Seller'
                                }
                              >
                                {vehicle.seller_org_website ? (
                                  <FaviconIcon
                                    url={vehicle.seller_org_website}
                                    textSize={7}
                                    matchTextSize
                                    preserveAspectRatio
                                    style={{ marginRight: 0 }}
                                  />
                                ) : null}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {vehicle.seller_org_name || vehicle.seller_handle || 'SELLER'}
                                </span>
                              </div>
                              {vehicle.relationship_type && (
                                <div style={{
                                  fontSize: '7pt',
                                  padding: '2px 6px',
                                  borderRadius: '2px',
                                  background: 'var(--surface)',
                                  color: 'var(--text-secondary)',
                                  border: '1px solid var(--border)'
                                }}>
                                  {vehicle.relationship_type.replace(/_/g, ' ')}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // If external auction, open in new tab
                                  if (vehicle.auction_url) {
                                    window.open(vehicle.auction_url, '_blank');
                                  } else {
                                    navigate(`/vehicle/${vehicle.vehicle_id}`);
                                  }
                                }}
                                className="button button-primary button-small"
                                style={{ fontSize: '8pt', padding: '4px 8px', whiteSpace: 'nowrap', background: '#dc2626', borderColor: '#dc2626' }}
                              >
                                {vehicle.auction_url ? 'View on Platform' : 'View Auction'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )})}
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Vehicles for Sale / Currently in Service */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
                {intelligence?.effectivePrimaryFocus === 'service' ? 'Currently in Service' : 'Vehicles for Sale'}
              </div>
              <div className="card-body">
                {(() => {
                  // For service orgs: show service vehicles
                  // For inventory orgs: show vehicles for sale
                  const isServiceOrg = intelligence?.effectivePrimaryFocus === 'service';
                  
                  if (isServiceOrg) {
                    // Filter service vehicles (currently in service, not completed)
                    const serviceVehicles = vehicles.filter(v => {
                      // Must be active
                      if (v.status !== 'active') return false;
                      
                      // Must be service-related
                      if (v.relationship_type !== 'service_provider' && 
                          v.relationship_type !== 'work_location') {
                        return false;
                      }
                      
                      // Exclude sold/completed service vehicles
                      const isSold = v.sale_date || v.sale_price || v.vehicle_sale_status === 'sold';
                      return !isSold;
                    });
                    
                    if (serviceVehicles.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                          No vehicles currently in service. Service vehicles will appear here.
                        </div>
                      );
                    }
                    
                    return (
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
                        gap: '12px' 
                      }}>
                        {serviceVehicles.slice(0, 8).map((vehicle) => (
                          <ServiceVehicleCardRich
                            key={vehicle.id}
                            vehicleId={vehicle.vehicle_id}
                            vehicleYear={vehicle.vehicle_year}
                            vehicleMake={vehicle.vehicle_make}
                            vehicleModel={vehicle.vehicle_model}
                            vehicleVin={vehicle.vehicle_vin}
                            organizationId={organizationId!}
                            organizationName={organization?.business_name}
                            laborRate={organization?.labor_rate || 125}
                          />
                        ))}
                      </div>
                    );
                  }
                  
                  // Filter vehicles that are current inventory (not sold, active)
                  // Show vehicles that are:
                  // 1. Not sold - check multiple indicators: sale_date, sale_price, vehicle_sale_status, status
                  // 2. Active status
                  // 3. Relationship type indicates inventory/for sale (not service/work vehicles)
                  // 4. EXCLUDE vehicles with active auctions (those are shown above)
                  // 5. Preferably listing_status = 'for_sale' but include all active non-sold inventory vehicles
                  const productsForSale = vehicles.filter(v => {
                    // Must be active
                    if (v.status !== 'active') return false;
                    
                    // EXCLUDE vehicles with active auctions - they're shown in separate section above
                    if (v.has_active_auction) return false;
                    
                    // Exclude service/work vehicles - these are not for sale
                    if (v.relationship_type === 'service_provider' || 
                        v.relationship_type === 'work_location' ||
                        v.relationship_type === 'transport' ||
                        v.relationship_type === 'storage') {
                      return false;
                    }
                    
                    // Only show inventory/sale-related relationship types
                    // Include: in_stock, consigner, owner, current_consignment, seller, buyer (as inventory)
                    const isInventoryType = 
                      v.relationship_type === 'in_stock' ||
                      v.relationship_type === 'consigner' ||
                      v.relationship_type === 'owner' ||
                      v.relationship_type === 'current_consignment' ||
                      v.relationship_type === 'seller' ||
                      v.relationship_type === 'buyer';
                    
                    // If relationship_type is not an inventory type, exclude it
                    if (!isInventoryType && v.relationship_type) {
                      return false;
                    }
                    
                    // Check all sold indicators
                    const isSold = 
                      v.sale_date || // Has sale date
                      v.sale_price || // Has sale price
                      v.vehicle_sale_status === 'sold' || // Vehicle marked as sold
                      v.listing_status === 'sold' || // Listing status says sold
                      (v.vehicles && (v.vehicles as any).sale_price) || // Vehicle has sale_price
                      (v.vehicles && (v.vehicles as any).sale_date); // Vehicle has sale_date
                    
                    return !isSold;
                  });
                  
                  if (productsForSale.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                        No current inventory. Add vehicles to display them here.
                      </div>
                    );
                  }
                  
                  // IMPORTANT: Do not sort by price/value here. Scraped/derived values are often incomplete
                  // and create misleading UI. Prefer a stable, non-financial sort (newer model years first).
                  const sorted = [...productsForSale].sort((a, b) => {
                    const ay = Number((a as any).vehicle_year || 0) || 0;
                    const by = Number((b as any).vehicle_year || 0) || 0;
                    if (ay !== by) return by - ay;
                    const am = String((a as any).vehicle_make || '');
                    const bm = String((b as any).vehicle_make || '');
                    if (am !== bm) return am.localeCompare(bm);
                    const amd = String((a as any).vehicle_model || '');
                    const bmd = String((b as any).vehicle_model || '');
                    return amd.localeCompare(bmd);
                  });
                  
                  return (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                        gap: '10px'
                      }}
                    >
                      {sorted.slice(0, 12).map((vehicle) => {
                        const title = `${vehicle.vehicle_year || ''} ${vehicle.vehicle_make || ''} ${vehicle.vehicle_model || ''}`.trim() || 'Vehicle';
                        const relationshipLabel = vehicle.relationship_type
                          ? String(vehicle.relationship_type).replace(/_/g, ' ')
                          : null;
                        const signal = computeSignal({
                          bids: vehicle.auction_bid_count,
                          watchers: (vehicle as any).auction_watcher_count,
                          views: (vehicle as any).auction_view_count,
                          comments: (vehicle as any).auction_comment_count,
                        });
                        const tierLabel = tierLabelFromAnalysisTier((vehicle as any).analysis_tier ?? null);
                        const hasTelemetry = signal.bids > 0 || signal.watchers > 0 || signal.views > 0 || signal.comments > 0;

                        // This section already represents inventory; avoid repeating "For Sale" on every tile.
                        const listingStatus = String(vehicle.listing_status || '').toLowerCase();
                        const showListingPill = Boolean(listingStatus) && listingStatus !== 'for_sale' && listingStatus !== 'sold';
                        const listingLabel =
                          listingStatus === 'reserved' ? 'Reserved' :
                          listingStatus ? (vehicle.listing_status || 'Active') :
                          null;

                        return (
                          <div
                            key={vehicle.id}
                            style={{
                              border: '2px solid var(--border)',
                              background: 'var(--surface)',
                              padding: '12px',
                              cursor: 'pointer',
                              position: 'relative',
                              transition: 'all 0.12s ease',
                              borderRadius: '0px'
                            }}
                            onClick={() => navigate(`/vehicle/${vehicle.vehicle_id}`)}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = 'var(--text)';
                              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                              e.currentTarget.style.transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = 'var(--border)';
                              e.currentTarget.style.boxShadow = 'none';
                              e.currentTarget.style.transform = 'translateY(0)';
                            }}
                          >
                            <AliveBurst vehicleId={vehicle.vehicle_id} intensity={Math.min(14, Math.floor(signal.score / 18))} />
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '120px 1fr',
                                gap: '12px',
                                alignItems: 'start'
                              }}
                            >
                              {/* Thumbnail with proper resolution */}
                              <div
                                style={{
                                  width: '120px',
                                  height: '90px',
                                  border: '2px solid var(--border)',
                                  background: 'var(--grey-100)',
                                  overflow: 'hidden',
                                  flexShrink: 0
                                }}
                              >
                                <VehicleThumbnail
                                  vehicleId={vehicle.vehicle_id}
                                  vehicleName={title}
                                  size="medium"
                                />
                              </div>

                              {/* Main Content */}
                              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {/* Title Row with Countdown */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                  <a
                                    href={`/vehicle/${vehicle.vehicle_id}`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      navigate(`/vehicle/${vehicle.vehicle_id}`);
                                    }}
                                    style={{
                                      fontSize: '11pt',
                                      fontWeight: 700,
                                      color: 'var(--text)',
                                      display: 'block',
                                      textDecoration: 'none',
                                      lineHeight: 1.3,
                                      flex: 1,
                                      transition: 'color 0.12s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = 'var(--accent)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = 'var(--text)';
                                    }}
                                  >
                                    {title}
                                  </a>
                                  
                                  {/* Countdown Timer */}
                                  {vehicle.auction_end_time && <CountdownTimer endTime={vehicle.auction_end_time} />}
                                </div>

                                {/* Dealer Badge / Username Tag */}
                                {(vehicle.seller_org_name || vehicle.seller_handle) && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {vehicle.seller_org_website && (
                                      <FaviconIcon
                                        url={vehicle.seller_org_website}
                                        textSize={8}
                                        matchTextSize
                                        preserveAspectRatio
                                        style={{ marginRight: 0 }}
                                      />
                                    )}
                                    <span
                                      style={{
                                        fontSize: '8pt',
                                        padding: '3px 6px',
                                        border: '1px solid var(--border)',
                                        background: 'var(--grey-100)',
                                        color: 'var(--text)',
                                        fontWeight: 600,
                                        borderRadius: '0px',
                                        display: 'inline-block'
                                      }}
                                    >
                                      {vehicle.seller_org_name || vehicle.seller_handle}
                                    </span>
                                  </div>
                                )}

                                {/* Price / Bid and Comment Count Row */}
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '2px' }}>
                                  {(vehicle.sale_price || vehicle.auction_current_bid) && (
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                                      <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                                        {vehicle.sale_price ? 'Sold:' : 'Bid:'}
                                      </span>
                                      <span style={{ fontSize: '10pt', fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>
                                        {formatUsd((vehicle.sale_price || vehicle.auction_current_bid / 100) || 0)}
                                      </span>
                                    </div>
                                  )}
                                  {signal.comments > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                                      <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>Comments:</span>
                                      <span style={{ fontSize: '9pt', fontWeight: 600, color: 'var(--text)' }}>
                                        {signal.comments}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {/* Signal Badges Row */}
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '2px' }}>
                                  {tierLabel && (
                                    <span style={{ fontSize: '7pt', color: 'var(--text-secondary)' }}>
                                      {tierLabel}
                                    </span>
                                  )}
                                  {signal.score > 0 && (
                                    <span style={{ fontSize: '7pt', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                      SIGNAL {signal.score}
                                    </span>
                                  )}
                                  {signal.bids > 0 && (
                                    <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                                      BIDS {signal.bids}
                                    </span>
                                  )}
                                  {signal.watchers > 0 && (
                                    <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                                      WATCH {signal.watchers}
                                    </span>
                                  )}
                                  {signal.views > 0 && (
                                    <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                                      VIEWS {signal.views}
                                    </span>
                                  )}
                                  {showListingPill && listingLabel && (
                                    <span
                                      style={{
                                        fontSize: '7pt',
                                        padding: '3px 6px',
                                        border: '1px solid var(--border)',
                                        background: 'var(--grey-100)',
                                        color: 'var(--text)',
                                        fontWeight: 700,
                                        borderRadius: '0px'
                                      }}
                                    >
                                      {listingLabel}
                                    </span>
                                  )}
                                  {/* Sold/Unsold Badge */}
                                  {(() => {
                                    const status = String(vehicle.listing_status || '').toLowerCase();
                                    if (status === 'sold' || vehicle.sale_price) {
                                      return (
                                        <span
                                          style={{
                                            fontSize: '7pt',
                                            padding: '3px 6px',
                                            border: '1px solid #166534',
                                            background: '#dcfce7',
                                            color: '#166534',
                                            fontWeight: 700,
                                            borderRadius: '0px'
                                          }}
                                        >
                                          SOLD
                                        </span>
                                      );
                                    }
                                    if (status === 'unsold' || status === 'ended') {
                                      return (
                                        <span
                                          style={{
                                            fontSize: '7pt',
                                            padding: '3px 6px',
                                            border: '1px solid #991b1b',
                                            background: '#fee2e2',
                                            color: '#991b1b',
                                            fontWeight: 700,
                                            borderRadius: '0px'
                                          }}
                                        >
                                          UNSOLD
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* SOLD INVENTORY BROWSER / SERVICE ARCHIVE - Reference for buyers or completed service work */}
            <SoldInventoryBrowser 
              organizationId={organizationId!} 
              title={intelligence?.effectivePrimaryFocus === 'service' ? 'Service Archive' : 'Sold Inventory Archive'}
            />

            {/* Basic Info */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Organization Details</span>
                {isOwner && (
                  <button
                    className="button button-small button-secondary"
                    onClick={() => setShowLocationPicker(true)}
                    style={{ fontSize: '8pt' }}
                  >
                    {organization.latitude && organization.longitude ? 'Update Location' : 'Set GPS Location'}
                  </button>
                )}
              </div>
              <div className="card-body" style={{ fontSize: '9pt' }}>
                {organization.business_type && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Type:</strong> {organization.business_type}
                  </div>
                )}
                {(organization.estimated_value || organization.current_value) && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Estimated Value:</strong>{' '}
                    {typeof organization.estimated_value === 'number'
                      ? formatUsd(organization.estimated_value)
                      : (typeof organization.current_value === 'number' ? formatUsd(organization.current_value) : '—')}
                    {organization.last_valuation_date ? (
                      <span style={{ marginLeft: '6px', fontSize: '8pt', color: 'var(--text-muted)' }}>
                        (as of {organization.last_valuation_date})
                      </span>
                    ) : null}
                  </div>
                )}
              {organization.description && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Description:</strong> {organization.description}
                  </div>
              )}
                {(organization.inventory_numbers || isOwner) && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Inventory Numbers:</strong> {organization.inventory_numbers || '—'}
                  </div>
                )}
                {(organization.market_share || isOwner) && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Market Share:</strong> {organization.market_share || '—'}
                  </div>
                )}
                {(organization.branding || isOwner) && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Branding:</strong> {organization.branding || '—'}
                  </div>
                )}
                {(organization.labeling || isOwner) && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Labeling:</strong> {organization.labeling || '—'}
                  </div>
                )}
                {organization.address && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Address:</strong> {organization.address}, {organization.city}, {organization.state} {organization.zip_code}
                  </div>
                )}
                {organization.latitude && organization.longitude && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>GPS:</strong> {organization.latitude.toFixed(6)}, {organization.longitude.toFixed(6)}
                    {' '}
                    <a 
                      href={`https://www.google.com/maps?q=${organization.latitude},${organization.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '8pt', color: 'var(--accent)' }}
                    >
                      (view on map)
                    </a>
                  </div>
                )}
                {organization.phone && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Phone:</strong>{' '}
                    <a href={`tel:${organization.phone}`} style={{ color: 'var(--accent)', textDecoration: 'none' }} className="hover:underline">
                      {organization.phone}
                    </a>
                  </div>
                )}
                {organization.email && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Email:</strong>{' '}
                    <a href={`mailto:${organization.email}`} style={{ color: 'var(--accent)', textDecoration: 'none' }} className="hover:underline">
                      {organization.email}
                    </a>
                  </div>
                )}
                {organization.website && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Website:</strong>{' '}
                    <a href={organization.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }} className="hover:underline">
                      {organization.website}
                    </a>
                  </div>
                )}
                {organization.labor_rate && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Labor Rate:</strong> ${organization.labor_rate}/hr
                    {isOwner && (
                      <button
                        onClick={() => setShowLaborRateEditor(true)}
                        style={{
                          marginLeft: '8px',
                          fontSize: '8pt',
                          padding: '2px 6px',
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: '3px',
                          cursor: 'pointer'
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )}
                {!organization.labor_rate && isOwner && (
                  <div style={{ marginBottom: '6px' }}>
                    <button
                      onClick={() => setShowLaborRateEditor(true)}
                      className="button button-small button-secondary"
                      style={{ fontSize: '8pt' }}
                    >
                      Set Labor Rate
                    </button>
                  </div>
                )}
                
                {/* Edit Organization Details Button */}
                {(isOwner || currentUserRole === 'moderator' || currentUserRole === 'contractor') && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                    <button
                      onClick={() => setShowOrganizationEditor(true)}
                      className="button button-small"
                      style={{ fontSize: '8pt' }}
                    >
                      ✏️ Edit Organization Details
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Stock Info (if tradable) */}
            {organization.is_tradable && offering && (
              <div className="card" style={{ marginBottom: '16px' }}>
                <div className="card-header">Stock Information</div>
                <div className="card-body" style={{ fontSize: '9pt' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Symbol</div>
                      <div style={{ fontWeight: 600 }}>{offering.stock_symbol}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Current Price</div>
                      <div style={{ fontWeight: 600 }}>${offering.current_share_price.toFixed(2)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Total Shares</div>
                      <div style={{ fontWeight: 600 }}>{offering.total_shares.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Market Cap</div>
                      <div style={{ fontWeight: 600 }}>
                        ${(offering.current_share_price * offering.total_shares).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Broad Arrow Metrics Display */}
            {isBroadArrow && vehicles.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <BroadArrowMetricsDisplay vehicles={vehicles} showDetailed={true} />
              </div>
            )}

            {/* Stats */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header">Statistics</div>
              <div className="card-body" style={{ fontSize: '9pt' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>{vehicles.length}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Vehicles</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>{images.length}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Images</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>{timelineEvents.length}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Events</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'service' && organizationId && (
          <OrganizationServiceTab organizationId={organizationId} />
        )}

        {activeTab === 'vehicles' && (
            <EnhancedDealerInventory
              organizationId={organizationId!}
              userId={session?.user?.id || null}
              canEdit={canEdit}
              isOwner={isOwner}
            />
        )}

        {activeTab === 'receipts' && organizationId && (
          <div style={{ padding: '16px' }}>
            <div className="card">
              <div className="card-header">Work Orders</div>
              <div className="card-body">
                <div style={{ fontSize: '9pt', color: 'var(--grey-600)', textAlign: 'center', padding: '40px' }}>
                  Receipt/work order browser coming soon
                  <br />
                  <span style={{ fontSize: '8pt' }}>
                    View receipts in vehicle profiles for now
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div>
            {session?.user ? (
              <OrganizationNotifications
                organizationId={organizationId!}
                userId={session.user.id}
              />
            ) : (
              <div className="card">
                <div className="card-body" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  Sign in to view notifications
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'images' && (
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Images ({images.length})</span>
              {(canEdit || isOwner) && (
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="button button-primary button-small"
                  style={{ fontSize: '8pt', padding: '6px 12px' }}
                  disabled={uploadingImages}
                >
                  {uploadingImages ? 'Uploading...' : 'Upload Images'}
                </button>
              )}
            </div>
            <div className="card-body">
              {images.length === 0 ? (
                <div style={{ 
                  textAlign: 'center', 
                  padding: '60px 20px', 
                  color: 'var(--text-muted)',
                  border: '2px dashed var(--border)',
                  borderRadius: '8px',
                  background: 'var(--surface)'
                }}>
                  <div style={{ fontSize: '11pt', marginBottom: '12px', fontWeight: 600 }}>
                    No images yet
                  </div>
                  <div style={{ fontSize: '9pt', marginBottom: '20px' }}>
                    Upload the first image to get started
                  </div>
                  {(canEdit || isOwner) ? (
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      className="button button-primary"
                      style={{ fontSize: '10pt', padding: '10px 24px' }}
                      disabled={uploadingImages}
                    >
                      {uploadingImages ? 'Uploading...' : 'Upload Images'}
                    </button>
                  ) : (
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      Contact the organization owner to add images
                    </div>
                  )}
                </div>
              ) : (
            <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '16px'
                }}>
                  {images.map(img => (
                    <div
                      key={img.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        background: 'var(--surface)',
                        cursor: 'pointer'
                      }}
                      className="hover-lift"
                      onClick={() => {
                        setLightboxImage(img);
                        setLightboxIndex(images.indexOf(img));
                      }}
                    >
                      {/* Full-res image (with blur for sensitive) */}
                      <div
                        style={{
                          aspectRatio: '4/3',
                          backgroundImage: `url(${img.large_url || img.image_url})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          position: 'relative',
                          filter: img.blur_preview && img.is_sensitive ? 'blur(20px)' : 'none',
                          transition: 'filter 0.2s ease'
                        }}
                      >
                          {/* Category badge */}
                        {img.category && (
                          <div style={{
                            position: 'absolute',
                            top: '8px',
                            left: '8px',
                            background: 'rgba(0,0,0,0.7)',
                            color: 'var(--accent-bright)',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            fontSize: '7pt',
                            fontWeight: 700,
                            textTransform: 'capitalize'
                          }}>
                            {img.category.replace(/_/g, ' ')}
                          </div>
                        )}

                        {/* Primary badge */}
                        {img.category === 'logo' && (
                          <div style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            background: 'var(--accent)',
                            color: 'var(--accent-bright)',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            fontSize: '7pt',
                            fontWeight: 700
                          }}>
                            PRIMARY
                          </div>
                        )}
                        
                        {/* Sensitive/Private badge */}
                        {img.is_sensitive && (
                          <div style={{
                            position: 'absolute',
                            top: img.category === 'logo' ? '40px' : '8px',
                            right: '8px',
                            background: 'rgba(220, 38, 38, 0.9)',
                            color: 'var(--accent-bright)',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            fontSize: '7pt',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            PRIVATE
                            {img.blur_preview && ' (BLURRED)'}
                          </div>
                        )}

                        {/* Management buttons */}
                        {(isOwner || img.user_id === session?.user?.id) && (
                          <div style={{
                            position: 'absolute',
                            bottom: '8px',
                            right: '8px',
                            display: 'flex',
                            gap: '4px'
                          }}
                          onClick={(e) => e.stopPropagation()}
                          >
                            {/* Log Work button for work order images */}
                            {img.contains_financial_data && img.user_id === session?.user?.id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedWorkOrderImage(img);
                                  setShowContractorWorkInput(true);
                                }}
                                style={{
                                  background: 'var(--success)',
                                  border: '1px solid var(--success)',
                                  borderRadius: '2px',
                                  padding: '4px 8px',
                                  fontSize: '7pt',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  color: 'var(--accent-bright)'
                                }}
                                title="Log work from this receipt"
                              >
                                LOG WORK
                              </button>
                            )}
                            
                            {isOwner && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSetPrimary(img.id);
                                  }}
                                  style={{
                                    background: 'var(--surface-glass)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '2px',
                                    padding: '4px 8px',
                                    fontSize: '7pt',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                  title="Set as primary"
                                >
                                  PRIMARY
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleScanImage(img.id);
                                  }}
                                  style={{
                                    background: 'var(--surface-glass)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '2px',
                                    padding: '4px 8px',
                                    fontSize: '7pt',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                  title="Scan with AI"
                                >
                                  SCAN
                                </button>
                              </>
                            )}
                            
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteImage(img.id);
                              }}
                              style={{
                                background: 'var(--surface-glass)',
                                border: '1px solid var(--border)',
                                borderRadius: '2px',
                                padding: '4px 8px',
                                fontSize: '7pt',
                                cursor: 'pointer',
                                fontWeight: 600,
                                color: 'var(--error)'
                              }}
                              title="Delete image"
                            >
                              DELETE
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Image metadata */}
                      <div style={{ padding: '10px' }}>
                        {img.caption && (
                          <div style={{ fontSize: '8pt', marginBottom: '6px', fontWeight: 600 }}>
                            {img.caption}
              </div>
                        )}

                        {/* Date and location */}
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          {img.taken_at ? new Date(img.taken_at).toLocaleDateString() : new Date(img.uploaded_at).toLocaleDateString()}
                          {img.location_name && ` · ${img.location_name}`}
            </div>

                        {/* EXIF data */}
                        {img.exif_data && Object.keys(img.exif_data).length > 0 && (
                          <div style={{
                            fontSize: '7pt',
                            color: 'var(--text-secondary)',
                            background: 'var(--surface)',
                            padding: '6px',
                            borderRadius: '2px',
                            marginTop: '6px'
                          }}>
                            {img.exif_data.Make && <div>Camera: {img.exif_data.Make} {img.exif_data.Model}</div>}
                            {img.exif_data.FocalLength && <div>Focal: {img.exif_data.FocalLength}</div>}
                            {img.exif_data.ISO && <div>ISO: {img.exif_data.ISO}</div>}
          </div>
        )}

                        {/* GPS coordinates */}
                        {(img.latitude || img.longitude) && (
          <div style={{
                            fontSize: '7pt',
                            color: 'var(--accent)',
                            marginTop: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <span>Location</span>
                            <span>{img.latitude?.toFixed(4)}, {img.longitude?.toFixed(4)}</span>
                          </div>
                        )}

                        {/* AI Tags */}
                        {imageTags[img.id] && imageTags[img.id].length > 0 && (
                          <div style={{ marginTop: '8px' }}>
                            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>
                              AI Tags
                            </div>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {imageTags[img.id].map((t, idx) => (
                                <span
                                  key={idx}
                                  style={{
                                    fontSize: '7pt',
                                    padding: '2px 6px',
                                    background: 'var(--accent-dim)',
                                    color: 'var(--accent)',
                                    borderRadius: '2px',
                                    border: '1px solid var(--border)'
                                  }}
                                  title={`Confidence: ${(t.confidence * 100).toFixed(0)}%`}
                                >
                                  {t.tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONTRIBUTORS TAB - Attribution Chain */}
        {activeTab === 'contributors' && (
          <div className="card">
            <div className="card-header">
              {(intelligence?.effectiveType === 'auction_house' ? 'People' : 'Contributors')} ({contributors.length})
            </div>
            <div className="card-body">
              {contributors.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  {intelligence?.effectiveType === 'auction_house' ? 'No people yet' : 'No contributors yet'}
                </div>
              ) : (
                <>
                  {contributors.map((contributor: any) => (
              <div
                      key={contributor.id}
                style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                  borderBottom: '1px solid var(--border-light)',
                        cursor: 'pointer'
                }}
                      onClick={() => window.location.href = `/profile/${contributor.profiles?.id}`}
              >
                      <img
                        src={contributor.profiles?.avatar_url || '/default-avatar.png'}
                        alt={contributor.profiles?.full_name}
                        style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                          {contributor.profiles?.full_name || contributor.profiles?.username}
                </div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          @{contributor.profiles?.username} · {contributor.role}
                  </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11pt', fontWeight: 700, color: 'var(--accent)' }}>
                          {contributor.contribution_count}
                        </div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                          contributions
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Attribution Timeline */}
              <div style={{ marginTop: '24px', borderTop: '2px solid var(--border)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '10pt', fontWeight: 700, margin: 0 }}>
                    Contribution Timeline
                  </h4>
                  {session && (
                    <button
                      onClick={() => {
                        const url = prompt('Enter article URL to add to timeline (e.g., blog post, news article, press release):');
                        if (url && url.trim()) {
                          handleAddArticle(url.trim());
                        }
                      }}
                      className="button button-secondary button-small"
                      style={{ fontSize: '8pt' }}
                    >
                      Add Article
                    </button>
                  )}
                </div>
                {timelineEvents.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                    No timeline events yet
                </div>
                ) : (
                  <>
                    {timelineEvents.map((event: any) => (
                      <div
                        key={event.id}
                        style={{
                          padding: '10px',
                          marginBottom: '8px',
                          border: '1px solid var(--border-light)',
                          borderRadius: '4px',
                          background: 'var(--surface)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <img
                            src={event.profiles?.avatar_url || '/default-avatar.png'}
                            alt={event.profiles?.full_name}
                            style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                          />
                          <div style={{ fontSize: '8pt', fontWeight: 700 }}>
                            {event.profiles?.full_name || event.profiles?.username}
                          </div>
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                            {new Date(event.event_date).toLocaleDateString()}
                          </div>
                        </div>
                        <div style={{ fontSize: '9pt', marginBottom: '2px' }}>
                          {event.title}
                        </div>
                        {event.description && (
                          <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                            {event.description}
                          </div>
                        )}
                        {/* Display images from article */}
                        {event.image_urls && Array.isArray(event.image_urls) && event.image_urls.length > 0 && (
                          <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', 
                            gap: '8px',
                            marginTop: '8px'
                          }}>
                            {event.image_urls.slice(0, 6).map((imgUrl: string, idx: number) => (
                              <img
                                key={idx}
                                src={imgUrl}
                                alt=""
                                style={{
                                  width: '100%',
                                  height: '80px',
                                  objectFit: 'cover',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border)',
                                  cursor: 'pointer'
                                }}
                                onClick={() => window.open(imgUrl, '_blank')}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            ))}
                          </div>
                        )}
                        {/* Link to source article */}
                        {event.documentation_urls && Array.isArray(event.documentation_urls) && event.documentation_urls.length > 0 && (
                          <div style={{ marginTop: '8px' }}>
                            <a
                              href={event.documentation_urls[0]}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: '7pt', color: 'var(--accent)', textDecoration: 'none' }}
                            >
                              View Source Article →
                            </a>
                          </div>
                        )}
                      </div>
            ))}
                  </>
                )}
              </div>
            </div>
              </div>
            )}

        {activeTab === 'marketplace' && (
          <div>
            {organization ? (
              <MarketplaceComplianceForm organizationId={organization.id} canEdit={canEdit} />
            ) : (
              <div className="text text-small text-muted">Loading organization…</div>
            )}
          </div>
        )}

        {/* AUCTIONS TAB */}
        {activeTab === 'auctions' && organizationId && (
          <OrganizationAuctionsTab organizationId={organizationId} />
        )}

        {activeTab === 'listings' && comprehensiveData && (
          <ProfileListingsTab
            listings={comprehensiveData.listings || []}
            profileType="organization"
          />
        )}

        {activeTab === 'bids' && comprehensiveData && (
          <ProfileBidsTab
            bids={comprehensiveData.bids || []}
            profileType="organization"
          />
        )}

        {activeTab === 'stories' && comprehensiveData && (
          <ProfileSuccessStoriesTab
            stories={comprehensiveData.success_stories || []}
            profileType="organization"
          />
        )}

        {activeTab === 'services' && comprehensiveData && (
          <div style={{ padding: 'var(--space-4)' }}>
            <div style={{
              padding: 'var(--space-3)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              marginBottom: 'var(--space-3)',
            }}>
              <h3 style={{ fontSize: '10pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-2)' }}>
                Services Offered
              </h3>
              {comprehensiveData.website_mapping && (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                  Services mapped from: <a href={comprehensiveData.website_mapping.website_url} target="_blank" rel="noopener noreferrer">{comprehensiveData.website_mapping.website_url}</a>
                </div>
              )}
            </div>
            {comprehensiveData.services && comprehensiveData.services.length > 0 ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: 'var(--space-3)',
              }}>
                {comprehensiveData.services.map((service: any) => (
                  <div
                    key={service.id}
                    style={{
                      padding: 'var(--space-3)',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                    }}
                  >
                    <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                      {service.service_name}
                    </div>
                    {service.service_category && (
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                        {service.service_category.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </div>
                    )}
                    {service.description && (
                      <div style={{ fontSize: '8pt', color: 'var(--text)', marginBottom: 'var(--space-2)', lineHeight: '1.5' }}>
                        {service.description}
                      </div>
                    )}
                    {service.pricing_model && service.pricing_model !== 'unknown' && (
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Pricing:</div>
                        {service.pricing_model === 'fixed_price' && service.base_price && `$${service.base_price.toLocaleString()}`}
                        {service.pricing_model === 'hourly_rate' && service.hourly_rate && `$${service.hourly_rate.toLocaleString()}/hour`}
                        {service.pricing_model === 'percentage' && service.percentage_rate && `${service.percentage_rate}%`}
                        {service.pricing_model === 'tiered' && 'Tiered Pricing'}
                        {service.pricing_model === 'custom_quote' && 'Custom Quote Available'}
                      </div>
                    )}
                    {service.source_url && (
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                        <a href={service.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                          Source
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: 'var(--space-6)',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '8pt',
              }}>
                No services defined yet. Services can be automatically discovered from your website or manually added.
              </div>
            )}
          </div>
        )}

        {/* Inventory Tab */}
        {activeTab === 'inventory' && organization && (
          <div style={{ padding: '16px' }}>
            {/* Data Source Connection (dealers/owners only) */}
            {isOwner && (
              <div className="card" style={{ marginBottom: '16px' }}>
                <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
                  Connect Data Sources
                </div>
                <div className="card-body">
                  <div style={{ fontSize: '9pt', marginBottom: '12px', color: 'var(--text-secondary)' }}>
                    Import inventory, vehicles, and documents from external sources
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <a
                      href={`/dealer/${id}/ai-assistant`}
                      className="button button-primary"
                      style={{ fontSize: '9pt', textDecoration: 'none', display: 'inline-block' }}
                    >
                      AI Assistant
                    </a>
                    <a
                      href={`/dealer/${id}/bulk-editor`}
                      className="button button-secondary"
                      style={{ fontSize: '9pt', textDecoration: 'none', display: 'inline-block' }}
                    >
                      Bulk Editor
                    </a>
                    <button
                      onClick={() => setShowBaTImporter(true)}
                      className="button button-secondary"
                      style={{ fontSize: '9pt' }}
                    >
                      Import BaT Sales
                    </button>
                    <a
                      href={`/dealer/${id}/dropbox-import`}
                      className="button button-secondary"
                      style={{ fontSize: '9pt', textDecoration: 'none', display: 'inline-block' }}
                    >
                      Dropbox Import
                    </a>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: '9pt' }}
                      disabled
                      title="Coming soon"
                    >
                      Google Drive
                    </button>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: '9pt' }}
                      disabled
                      title="Coming soon"
                    >
                      CSV Upload
                    </button>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: '9pt' }}
                      disabled
                      title="Coming soon"
                    >
                      API Integration
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* VIN Scanner (dealers/owners only - mobile optimized) */}
            {isOwner && (
              <div style={{ marginBottom: '16px' }}>
                <MobileVINScanner
                  organizationId={organization.id}
                  onVehicleUpdated={(vehicleId, vin) => {
                    console.log(`Updated vehicle ${vehicleId} with VIN ${vin}`);
                    // Refresh the page to show updated data
                    window.location.reload();
                  }}
                />
              </div>
            )}

            <OrganizationInventory
              organizationId={organization.id}
              isOwner={isOwner}
            />
          </div>
        )}
      </div>

      {/* Trade Shares Modal */}
      {showTrade && offering && organization && (
        <TradePanel
          assetType="organization"
          assetId={organization.id}
          assetName={organization.business_name}
          offeringId={offering.id}
          currentPrice={offering.current_share_price}
          availableShares={offering.total_shares}
          onClose={() => setShowTrade(false)}
        />
      )}

      {/* Contribute Data Modal */}
      {showContributeModal && <AddOrganizationData
        organizationId={id!}
        onClose={() => setShowContributeModal(false)}
        onSaved={() => {
          setShowContributeModal(false);
          loadOrganization();
        }}
      />}

      {/* Claim Ownership Modal */}
      {showOwnershipModal && session && ReactDOM.createPortal(
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 10001,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setShowOwnershipModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--surface)',
            width: '540px',
            maxWidth: '95vw',
            border: '1px solid var(--border)',
            borderRadius: '4px'
          }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '10pt' }}>Claim Organization Ownership</h3>
            </div>
            <div className="modal-body">
              <form onSubmit={handleOwnershipSubmit}>
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ marginBottom: '4px', fontSize: '9pt' }}>Document Type:</div>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="business_license" defaultChecked name="verificationType" />
                    {' '}Business License
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="tax_id" name="verificationType" />
                    {' '}Tax ID / EIN
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="articles_incorporation" name="verificationType" />
                    {' '}Articles of Incorporation
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="dba_certificate" name="verificationType" />
                    {' '}DBA Certificate
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="lease_agreement" name="verificationType" />
                    {' '}Lease/Property Agreement
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="utility_bill" name="verificationType" />
                    {' '}Utility Bill (business address)
                  </label>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ marginBottom: '4px', fontSize: '9pt' }}>Upload Document:</div>
                  
                  {/* Hidden file input for ownership documents */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    required
                    capture="environment"
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      if (file) setSelectedFileName(file.name);
                    }}
                    style={{ display: 'none' }}
                  />

                  {/* Drag-and-drop zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file && fileInputRef.current) {
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        fileInputRef.current.files = dataTransfer.files;
                        setSelectedFileName(file.name);
                      }
                    }}
                style={{
                      border: isDragging ? '2px dashed var(--accent)' : '2px dashed var(--border)',
                      borderRadius: '4px',
                      padding: '20px',
                      textAlign: 'center',
                      background: isDragging ? 'var(--accent-dim)' : 'var(--surface)',
                      cursor: 'pointer',
                      transition: '0.12s'
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {selectedFileName ? (
                <div>
                        <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '4px', color: 'var(--accent)' }}>
                          File selected
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          {selectedFileName}
                  </div>
                </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: '9pt', marginBottom: '4px' }}>
                          {isDragging ? 'Drop file here' : 'Drag & drop or click to choose'}
                </div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          PDF or Image (JPG, PNG)
              </div>
          </div>
        )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    onClick={() => setShowOwnershipModal(false)}
                    className="button button-secondary button-small"
                    style={{ fontSize: '8pt' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    style={{ fontSize: '9pt' }}
                  >
                    Submit
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Hidden file input for image uploads */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleImageUpload}
        style={{ display: 'none' }}
      />

      {/* Lightbox */}
      {lightboxImage && ReactDOM.createPortal(
                <div
                  style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.95)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setLightboxImage(null)}
        >
          {/* Navigation arrows */}
          {lightboxIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const newIndex = lightboxIndex - 1;
                setLightboxIndex(newIndex);
                setLightboxImage(images[newIndex]);
              }}
              style={{
                position: 'absolute',
                left: '20px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(0,0,0,0.45)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: 'var(--accent-bright)',
                fontSize: '24pt',
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ‹
            </button>
          )}

          {/* Image container */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
          >
            <img
              src={lightboxImage.large_url || lightboxImage.image_url}
              alt={lightboxImage.caption || ''}
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: '4px'
              }}
                />

            {/* Metadata below image */}
            <div style={{
              background: 'rgba(0,0,0,0.45)',
              padding: '12px 16px',
              borderRadius: '4px',
              marginTop: '12px',
              color: 'var(--accent-bright)',
              fontSize: '9pt',
              maxWidth: '600px'
            }}>
              {lightboxImage.caption && (
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                  {lightboxImage.caption}
              </div>
            )}
              <div style={{ fontSize: '8pt', opacity: 0.8 }}>
                {lightboxImage.taken_at ? new Date(lightboxImage.taken_at).toLocaleDateString() : new Date(lightboxImage.uploaded_at).toLocaleDateString()}
                {lightboxImage.category && ` · ${lightboxImage.category.replace(/_/g, ' ')}`}
                {lightboxImage.location_name && ` · ${lightboxImage.location_name}`}
          </div>
      </div>
          </div>

          {/* Next arrow */}
          {lightboxIndex < images.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const newIndex = lightboxIndex + 1;
                setLightboxIndex(newIndex);
                setLightboxImage(images[newIndex]);
              }}
              style={{
                position: 'absolute',
                right: '20px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(0,0,0,0.45)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: 'var(--accent-bright)',
                fontSize: '24pt',
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ›
            </button>
          )}

          {/* Close button */}
          <button
            onClick={() => setLightboxImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(255,255,255,0.18)',
              color: 'var(--accent-bright)',
              fontSize: '20pt',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>,
        document.body
      )}

      {/* Location Picker Modal */}
      {showLocationPicker && organization && (
        <OrganizationLocationPicker
          organizationId={organization.id}
          organizationName={organization.business_name}
          currentLat={organization.latitude}
          currentLng={organization.longitude}
          currentAddress={organization.address}
          onSaved={() => {
            loadOrganization();
          }}
          onClose={() => setShowLocationPicker(false)}
        />
      )}

      {/* Labor Rate Editor Modal */}
      {showLaborRateEditor && organization && (
        <LaborRateEditor
          organizationId={organization.id}
          organizationName={organization.business_name}
          currentRate={organization.labor_rate}
          onSaved={() => {
            loadOrganization();
          }}
          onClose={() => setShowLaborRateEditor(false)}
        />
      )}

      {/* Work Order Request Form */}
      {showWorkOrderForm && organization && (
        <WorkOrderRequestForm
          organizationId={organization.id}
          organizationName={organization.business_name}
          laborRate={organization.labor_rate}
          onSubmitted={() => {
            loadOrganization();
          }}
          onClose={() => setShowWorkOrderForm(false)}
        />
      )}
      
      {/* Contractor Work Input Modal */}
      {showContractorWorkInput && organization && (
        <ContractorWorkInput
          organizationId={organization.id}
          organizationName={organization.business_name}
          imageId={selectedWorkOrderImage?.id}
          imageUrl={selectedWorkOrderImage?.large_url || selectedWorkOrderImage?.image_url}
          onSaved={() => {
            loadOrganization();
            setShowContractorWorkInput(false);
            setSelectedWorkOrderImage(null);
          }}
          onClose={() => {
            setShowContractorWorkInput(false);
            setSelectedWorkOrderImage(null);
          }}
        />
      )}

      {/* Organization Editor Modal */}
      {showOrganizationEditor && organization && (
        <OrganizationEditor
          organizationId={organization.id}
          onSaved={() => {
            loadOrganization();
            setShowOrganizationEditor(false);
          }}
          onClose={() => setShowOrganizationEditor(false)}
        />
      )}

      {/* BaT Bulk Importer Modal */}
      {showBaTImporter && organization && (
        <BaTBulkImporter
          organizationId={organization.id}
          organizationName={organization.business_name}
          onComplete={() => {
            loadOrganization();
            setShowBaTImporter(false);
          }}
          onClose={() => setShowBaTImporter(false)}
        />
      )}

      {/* Vehicle Inquiry Modal */}
      {showVehicleInquiry && selectedInquiryVehicle && organization && (
        <VehicleInquiryModal
          vehicleId={selectedInquiryVehicle.id}
          vehicleName={selectedInquiryVehicle.name}
          organizationId={organization.id}
          organizationName={organization.business_name}
          onClose={() => {
            setShowVehicleInquiry(false);
            setSelectedInquiryVehicle(null);
          }}
          onSubmitted={() => {
            loadOrganization();
          }}
        />
      )}
    </div>
  );
}
