import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import ReactDOM from 'react-dom';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';
import { FaviconIcon } from '../components/common/FaviconIcon';
// Always loaded — used in the overview tab or global page structure
import OrganizationTimelineHeatmap from '../components/organization/OrganizationTimelineHeatmap';
import SoldInventoryBrowser from '../components/organization/SoldInventoryBrowser';
import { ServiceVehicleCardRich } from '../components/organization/ServiceVehicleCardRich';
import { extractImageMetadata } from '../utils/imageMetadata';
import { DynamicTabBar } from '../components/organization/DynamicTabBar';
import { OrganizationIntelligenceService, type OrganizationIntelligence, type TabConfig } from '../services/organizationIntelligenceService';
import VehicleThumbnail from '../components/VehicleThumbnail';
import { getOrganizationProfileData, getOrganizationCompetitiveContext, type SellerTrackRecord, type CompetitiveContext } from '../services/profileStatsService';
import { AdminNotificationService } from '../services/adminNotificationService';
import BroadArrowMetricsDisplay from '../components/organization/BroadArrowMetricsDisplay';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import '../styles/unified-design-system.css';

// Lazy-loaded — only pulled in when the relevant tab or modal is activated
const TradePanel = React.lazy(() => import('../components/trading/TradePanel'));
const AddOrganizationData = React.lazy(() => import('../components/organization/AddOrganizationData'));
const OrganizationInventory = React.lazy(() => import('../components/organization/OrganizationInventory'));
const OrganizationLocationPicker = React.lazy(() => import('../components/organization/OrganizationLocationPicker'));
const LaborRateEditor = React.lazy(() => import('../components/organization/LaborRateEditor'));
const WorkOrderRequestForm = React.lazy(() => import('../components/organization/WorkOrderRequestForm'));
const MobileVINScanner = React.lazy(() => import('../components/dealer/MobileVINScanner'));
const ContractorWorkInput = React.lazy(() => import('../components/contractor/ContractorWorkInput'));
const OrganizationEditor = React.lazy(() => import('../components/organization/OrganizationEditor'));
const EnhancedDealerInventory = React.lazy(() => import('../components/organization/EnhancedDealerInventory'));
const BaTBulkImporter = React.lazy(() => import('../components/dealer/BaTBulkImporter'));
const MarketplaceComplianceForm = React.lazy(() => import('../components/organization/MarketplaceComplianceForm'));
const OrganizationNotifications = React.lazy(() => import('../components/organization/OrganizationNotifications'));
const VehicleInquiryModal = React.lazy(() => import('../components/organization/VehicleInquiryModal'));
const OrganizationServiceTab = React.lazy(() => import('../components/organization/OrganizationServiceTab').then(m => ({ default: m.OrganizationServiceTab })));
const OrganizationAuctionsTab = React.lazy(() => import('../components/organization/OrganizationAuctionsTab').then(m => ({ default: m.OrganizationAuctionsTab })));
const OrganizationLegalTab = React.lazy(() => import('../components/organization/OrganizationLegalTab'));
const OrganizationOfferingTab = React.lazy(() => import('../components/organization/OrganizationOfferingTab'));
const DataRoomGate = React.lazy(() => import('../components/organization/DataRoomGate'));
const ProfileListingsTab = React.lazy(() => import('../components/profile/ProfileListingsTab').then(m => ({ default: m.ProfileListingsTab })));
const ProfileBidsTab = React.lazy(() => import('../components/profile/ProfileBidsTab').then(m => ({ default: m.ProfileBidsTab })));
const StorefrontSettings = React.lazy(() => import('../components/organization/StorefrontSettings'));
const ProfileSuccessStoriesTab = React.lazy(() => import('../components/profile/ProfileSuccessStoriesTab').then(m => ({ default: m.ProfileSuccessStoriesTab })));
const CollectionIntelligenceTab = React.lazy(() => import('../components/organization/CollectionIntelligenceTab'));

// Canonical Bring a Trailer org – we show extraction coverage (target 222k, queue) and turnover/metrics note
const BAT_ORG_ID = 'd2bd6370-11d1-4af0-8dd2-3de2c3899166';

interface OrgExtractionCoverage {
  org_id: string;
  label: string | null;
  extracted: number | null;
  queue_pending: number | null;
  target: number | null;
  metrics_note?: string;
}

// Types for sorting and controls
type OrgSortBy = 'newest' | 'oldest' | 'year' | 'make' | 'model' | 'price_high' | 'price_low';
type OrgSortDirection = 'asc' | 'desc';

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
  total_vehicles?: number;
  total_images?: number;
  total_events?: number;
  discovered_by?: string;
  uploaded_by?: string;
  labor_rate?: number;
  // SEC compliance fields
  incorporation_jurisdiction?: string;
  year_incorporated?: number;
  naics_code?: string;
  revenue_range?: string;
  revenue_declaration_date?: string;
  is_sec_filer?: boolean;
  cik_number?: string;
  latest_form_d_date?: string;
  latest_form_c_date?: string;
  risk_factors?: string;
  target_market_description?: string;
  created_at: string;
  updated_at: string;
}

interface OrgImage {
  id: string;
  image_url: string;
  thumbnail_url?: string;
  medium_url?: string;
  large_url?: string;
  caption?: string;
  category?: string;
  taken_at?: string;
  uploaded_at: string;
  user_id: string;
  is_primary?: boolean;
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
  vehicle_asking_price?: number;
  vehicle_image_url?: string;
  vehicle_location?: string | null;
  sale_date?: string;
  sale_price?: number;
  vehicle_sale_status?: string;
  listing_status?: string;
  cost_basis?: number;
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
  external_listings?: Array<{
    id: string;
    vehicle_id: string;
    listing_status?: string;
    end_date?: string;
    current_bid?: any;
    bid_count?: number | null;
    comment_count?: number | null;
    watcher_count?: number | null;
    view_count?: number | null;
    final_price?: any;
    sold_at?: string | null;
    platform?: string;
    listing_url?: string;
    source?: string;
  }>;
  bat_listing_title?: string | null;
  is_sold?: boolean;
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
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '2px' }}>
        Time Left
      </div>
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>
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
    if (v === 'developer') return 'Developer';
    if (v === 'other') return 'Other';
    return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };
  
  const navigate = useNavigate();

  // Toast notification system — replaces alert() calls
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>>([]);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

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
  const [dataRoomAccessGranted, setDataRoomAccessGranted] = useState(false);
  const [showDataRoomGate, setShowDataRoomGate] = useState(false);
  const [extractionCoverage, setExtractionCoverage] = useState<OrgExtractionCoverage | null>(null);
  const [selectedInquiryVehicle, setSelectedInquiryVehicle] = useState<{id: string, name: string} | null>(null);
  const [primaryHeroSrcIndex, setPrimaryHeroSrcIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const ownershipUploadId = `org-ownership-${organizationId}`;
  const [comprehensiveData, setComprehensiveData] = useState<any>(null);
  const [sellerTrackRecord, setSellerTrackRecord] = useState<SellerTrackRecord | null>(null);
  const [competitiveContext, setCompetitiveContext] = useState<CompetitiveContext | null>(null);
  
  // Grid and sorting controls (similar to CursorHomepage)
  const [cardsPerRow, setCardsPerRow] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('nuke_org_cardsPerRow');
      const n = Number(saved);
      if (Number.isFinite(n) && n >= 1 && n <= 16) return Math.round(n);
      return 6;
    } catch {
      return 6;
    }
  });
  const [sortBy, setSortBy] = useState<OrgSortBy>(() => {
    try {
      const saved = localStorage.getItem('nuke_org_sortBy');
      return (saved as OrgSortBy) || 'newest';
    } catch {
      return 'newest';
    }
  });
  const [sortDirection, setSortDirection] = useState<OrgSortDirection>(() => {
    try {
      const saved = localStorage.getItem('nuke_org_sortDirection');
      return (saved as OrgSortDirection) || 'desc';
    } catch {
      return 'desc';
    }
  });
  const [thumbFitMode, setThumbFitMode] = useState<'square' | 'original'>(() => {
    try {
      const saved = localStorage.getItem('nuke_org_thumbFitMode');
      return saved === 'original' ? 'original' : 'square';
    } catch {
      return 'square';
    }
  });
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState<number>(0);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam) {
      setActiveTab(tabParam);
    }
    if (params.get('edit') === '1' || params.get('edit') === 'true') {
      setShowOrganizationEditor(true);
    }
  }, [location.search]);

  // Hydrate data room access from sessionStorage for this org
  useEffect(() => {
    if (!organizationId) return;
    try {
      if (sessionStorage.getItem(`data_room_access_${organizationId}`) === 'true') {
        setDataRoomAccessGranted(true);
      }
    } catch {
      // ignore
    }
  }, [organizationId]);

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
    // Filter out magazine/news publication logos (they're not appropriate for organization hero images)
    if (s.includes('vanityfair') || s.includes('vanity-fair') || s.includes('vanity_fair')) return true;
    if (s.includes('time.com') || s.includes('time.com/')) return true;
    if (s.includes('forbes.com') || s.includes('forbes.com/')) return true;
    if (s.includes('wsj.com') || s.includes('wallstreetjournal')) return true;
    if (s.includes('nytimes.com') || s.includes('nytimes')) return true;
    if (s.includes('theatlantic.com') || s.includes('theatlantic')) return true;
    if (s.includes('newyorker.com') || s.includes('newyorker')) return true;
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

  // Theme is controlled by ThemeProvider only; do not set data-theme here (would override dark mode).

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (!session?.user?.id) {
      showToast('Please log in to upload images', 'error');
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

      showToast(`Uploaded ${files.length} image(s) successfully!`, 'success');
    } catch (error: any) {
      console.error('Upload failed:', error);
      showToast('Upload failed: ' + error.message, 'error');
    } finally {
      setUploadingImages(false);
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }
    }
  };

  // Save preferences to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('nuke_org_cardsPerRow', String(cardsPerRow));
    } catch (err) {
      // Failed to save preference - ignore
    }
  }, [cardsPerRow]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_org_sortBy', sortBy);
    } catch (err) {
      // Failed to save preference - ignore
    }
  }, [sortBy]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_org_sortDirection', sortDirection);
    } catch (err) {
      // Failed to save preference - ignore
    }
  }, [sortDirection]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_org_thumbFitMode', thumbFitMode);
    } catch (err) {
      // Failed to save preference - ignore
    }
  }, [thumbFitMode]);

  // Grid width tracking
  useEffect(() => {
    if (!gridRef.current) return;
    
    const updateGridWidth = () => {
      if (gridRef.current) {
        setGridWidth(gridRef.current.offsetWidth);
      }
    };
    
    updateGridWidth();
    const resizeObserver = new ResizeObserver(updateGridWidth);
    resizeObserver.observe(gridRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Calculate card size based on grid width and cards per row
  const gridCardSizePx = useMemo(() => {
    const cols = Math.max(1, Math.min(16, Math.floor(cardsPerRow || 1)));
    const gap = 8;
    const w = Number(gridWidth) || 0;
    if (!w) return undefined;
    const px = (w - gap * (cols - 1)) / cols;
    return Math.max(60, Math.floor(px));
  }, [gridWidth, cardsPerRow]);

  // Helper function to parse year/make/model from BaT listing title
  const parseBatTitle = (title: string | null | undefined): { year?: number; make?: string; model?: string } => {
    if (!title) return {};
    
    // Extract year (4 digits)
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0], 10) : undefined;
    if (year && (year < 1885 || year > new Date().getFullYear() + 1)) return {};
    
    if (!year) return {};
    
    // Everything after the year is make + model
    const afterYear = title.slice(title.indexOf(yearMatch![0]) + yearMatch![0].length).trim();
    const parts = afterYear.split(/\s+/).filter(p => p.length > 0);
    
    if (parts.length === 0) return { year };
    
    // First 1-2 words are usually make (handles "Mercedes-Benz", "Land Rover", etc.)
    let make: string | undefined;
    let model: string | undefined;
    
    // Check for hyphenated makes
    if (parts[0].toLowerCase() === 'mercedes-benz' || parts[0].toLowerCase().startsWith('mercedes')) {
      make = parts.slice(0, 2).join(' ').toLowerCase();
      if (parts.length > 2) model = parts.slice(2).join(' ').toLowerCase();
    } else if (parts[0].toLowerCase() === 'land-rover' || (parts[0].toLowerCase() === 'land' && parts[1]?.toLowerCase() === 'rover')) {
      make = parts.slice(0, 2).join(' ').toLowerCase();
      if (parts.length > 2) model = parts.slice(2).join(' ').toLowerCase();
    } else {
      // Single word make (Ford, BMW, Porsche, etc.)
      make = parts[0].toLowerCase();
      if (parts.length > 1) model = parts.slice(1).join(' ').toLowerCase();
    }
    
    return { year, make, model };
  };

  // Helper function to transform OrgVehicle to VehicleCardDense format
  const transformVehicleForCard = (orgVehicle: OrgVehicle) => {
    const vehicle = orgVehicle.vehicles || {};
    
    // Try to get year/make/model from multiple sources
    let year = orgVehicle.vehicle_year || (vehicle as any)?.year;
    let make = orgVehicle.vehicle_make || (vehicle as any)?.make;
    let model = orgVehicle.vehicle_model || (vehicle as any)?.model;
    
    // If still missing, try parsing from bat_listing_title if available
    if ((!year || !make || !model) && (orgVehicle as any).bat_listing_title) {
      const parsed = parseBatTitle((orgVehicle as any).bat_listing_title);
      year = year || parsed.year;
      make = make || parsed.make;
      model = model || parsed.model;
    }
    
    // Determine sale status from multiple sources
    const saleStatus = orgVehicle.status === 'sold' 
      ? 'sold' 
      : orgVehicle.listing_status === 'sold'
        ? 'sold'
        : (vehicle as any)?.sale_status || undefined;
    
    // Get auction outcome if available
    const auctionOutcome = (vehicle as any)?.auction_outcome || undefined;
    
    // Get external listings for auction data
    const externalListings = (orgVehicle as any)?.external_listings || [];
    const batListing = externalListings.find((el: any) => el.source === 'bat' || el.source === 'bringatrailer');
    
    return {
      id: orgVehicle.vehicle_id,
      year: year || undefined,
      make: make || undefined,
      model: model || undefined,
      series: (vehicle as any)?.series || undefined,
      trim: (vehicle as any)?.trim || undefined,
      vin: orgVehicle.vehicle_vin || (vehicle as any)?.vin || undefined,
      mileage: (vehicle as any)?.mileage || undefined,
      primary_image_url: orgVehicle.vehicle_image_url || (vehicle as any)?.primary_image_url || (vehicle as any)?.image_url || undefined,
      image_url: orgVehicle.vehicle_image_url || (vehicle as any)?.image_url || undefined,
      // Investment data - prioritize orgVehicle for accurate org context
      purchase_price: (vehicle as any)?.purchase_price || undefined,
      cost_basis: orgVehicle.cost_basis || (vehicle as any)?.cost_basis || undefined,
      current_value: orgVehicle.vehicle_current_value || (vehicle as any)?.current_value || undefined,
      asking_price: orgVehicle.vehicle_asking_price || (vehicle as any)?.asking_price || undefined,
      sale_price: orgVehicle.sale_price || (vehicle as any)?.sale_price || undefined,
      sale_status: saleStatus,
      auction_outcome: auctionOutcome,
      // Note: roi_pct and price_change are computed fields, not stored columns
      // They would need to be calculated from purchase_price vs current_value
      // Auction-specific data
      bid_count: batListing?.bid_count || (vehicle as any)?.bid_count || undefined,
      comment_count: batListing?.comment_count || (vehicle as any)?.comment_count || undefined,
      watcher_count: batListing?.watcher_count || undefined,
      external_listings: externalListings.length > 0 ? externalListings : undefined,
      location: orgVehicle.vehicle_location || (vehicle as any)?.location || undefined,
      discovery_url: organization?.website || orgVehicle.seller_org_website || undefined,
      discovery_source: (vehicle as any)?.profile_origin || undefined,
      created_at: (vehicle as any)?.created_at || undefined,
      updated_at: (vehicle as any)?.updated_at || undefined,
      profile_origin: (vehicle as any)?.profile_origin || undefined,
      view_count: (vehicle as any)?.view_count || undefined,
    };
  };

  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const load = async () => {
      if (!isMounted) return;

      // Load session in parallel
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (isMounted) {
          setSession(session);
        }
      });

      await loadOrganization();
    };

    load();

    return () => {
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
      // Error loading image tags - silent
    }
  };

  const loadOrganization = async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    // If param is not a UUID, try loading by slug (e.g. /org/nuke-ltd) then redirect to canonical /org/<id>
    if (!isUuid(organizationId)) {
      const slug = organizationId.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!slug) {
        setLoadError('Organization not found.');
        setLoading(false);
        return;
      }
      const { data: bySlug } = await supabase
        .from('businesses')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (bySlug?.id) {
        navigate(`/org/${bySlug.id}`, { replace: true });
        return;
      }
      setLoadError('Organization not found.');
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
      
      // CRITICAL: Set loading to false IMMEDIATELY after org loads so page can render
      setLoading(false);
      
      // Load comprehensive profile data (BaT-style stats) - LAZY LOAD in background
      (async () => {
        try {
          const comprehensive = await getOrganizationProfileData(organizationId);
          setComprehensiveData(comprehensive);
          if (comprehensive.seller_track_record) {
            setSellerTrackRecord(comprehensive.seller_track_record);
            // Load competitive context using the org state
            const orgState = org?.state || null;
            if (orgState) {
              getOrganizationCompetitiveContext(organizationId, orgState)
                .then(ctx => { if (ctx) setCompetitiveContext(ctx); })
                .catch(() => {});
            }
          }
        } catch (err) {
          // Failed to load comprehensive profile data - silent
        }
      })();
      
      // Load organization intelligence (respects explicit settings) - LAZY LOAD in background
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
              { id: 'offering', priority: 57, label: 'Offering' },
              { id: 'legal', priority: 55, label: 'Legal & SEC' },
              { id: 'contributors', priority: 50, label: 'Contributors' },
              { id: 'marketplace', priority: 40, label: 'Marketplace' },
              { id: 'notifications', priority: 20, label: 'Notifications' }
            ]);
          }
        } catch (error) {
          // Error loading organization intelligence - use defaults
          setTabs([
            { id: 'overview', priority: 100, label: 'Overview' },
            { id: 'vehicles', priority: 80, label: 'Vehicles' },
            { id: 'images', priority: 70, label: 'Images' },
            { id: 'inventory', priority: 60, label: 'Inventory' },
            { id: 'offering', priority: 57, label: 'Offering' },
            { id: 'legal', priority: 55, label: 'Legal & SEC' },
            { id: 'contributors', priority: 50, label: 'Contributors' },
            { id: 'marketplace', priority: 40, label: 'Marketplace' },
            { id: 'notifications', priority: 20, label: 'Notifications' }
          ]);
        }
      })();

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
            // Error loading images - show empty
            setImages([]);
          } else {
            setImages(orgImages || []);
            if (orgImages && orgImages.length > 0) {
              loadImageTags(orgImages.map(img => img.id)).catch(() => {});
            }
          }
        } catch (error) {
          // Exception loading images - show empty
          setImages([]);
        }
      })();

      // Vehicles (simplified, load in background)
      (async () => {
        try {
          const pageSize = 2000;
          const maxVehiclesToLoad = 5000;
          let offset = 0;
          let orgVehicles: any[] = [];
          let vehiclesError: any = null;
          let hasMore = true;

          while (hasMore && orgVehicles.length < maxVehiclesToLoad) {
            const { data, error } = await supabase
              .from('organization_vehicles')
              .select('id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, sale_price, listing_status, asking_price, cost_basis, days_on_lot')
              .eq('organization_id', organizationId)
              .or('status.eq.active,status.eq.sold,status.eq.archived')
              .order('created_at', { ascending: false })
              .range(offset, offset + pageSize - 1);

            if (error) {
              vehiclesError = error;
              break;
            }

            const rows = data || [];
            orgVehicles = orgVehicles.concat(rows);
            if (rows.length < pageSize) {
              hasMore = false;
            } else {
              offset += pageSize;
            }
          }

          if (vehiclesError) {
            setVehicles([]);
            return;
          }

          const vehicleIds = (orgVehicles || []).map((ov: any) => ov.vehicle_id).filter(Boolean);
          const now = new Date().toISOString();
          const nowDate = now.split('T')[0];

          const CHUNK = 200;
          const chunk = <T,>(arr: T[], size: number): T[][] => {
            const out: T[][] = [];
            for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
            return out;
          };
          const idsChunks = chunk(vehicleIds, CHUNK);

          const runChunked = async (fn: (ids: string[]) => Promise<{ data: any[] | null }>) => {
            if (idsChunks.length === 0) return [];
            const results = await Promise.all(idsChunks.map(fn));
            return results.flatMap(r => r.data || []);
          };

          const [allVehiclesData, allImagesData, allNativeAuctionsData, allExternalAuctionsData, allBatAuctionsData, soldExternalListingsData, soldBatListingsData, endedVehicleListingsData, allExternalListingsData] = await Promise.all([
            runChunked(ids => supabase.from('vehicles').select('id, year, make, model, vin, current_value, asking_price, purchase_price, sale_status, sale_price, sale_date, listing_location, listing_location_raw, analysis_tier, signal_score, auction_outcome').in('id', ids)),
            runChunked(ids => supabase.from('vehicle_images').select('vehicle_id, thumbnail_url, medium_url, image_url, variants, is_primary, created_at').in('vehicle_id', ids).order('is_primary', { ascending: false }).order('created_at', { ascending: true })),
            runChunked(ids => supabase.from('vehicle_listings').select('vehicle_id, id, status, sale_type, auction_end_time, current_high_bid_cents, bid_count, reserve_price_cents').in('vehicle_id', ids).eq('status', 'active').in('sale_type', ['auction', 'live_auction']).gt('auction_end_time', now)),
            runChunked(ids => supabase.from('external_listings').select('vehicle_id, id, organization_id, listing_status, end_date, current_bid, bid_count, reserve_price, platform, listing_url, view_count, watcher_count, metadata').in('vehicle_id', ids).gt('end_date', now)),
            runChunked(ids => supabase.from('bat_listings').select('vehicle_id, id, organization_id, seller_username, listing_status, auction_end_date, final_bid, bid_count, comment_count, view_count, reserve_price, bat_listing_url, bat_listing_title').in('vehicle_id', ids).gt('auction_end_date', nowDate)),
            runChunked(ids => supabase.from('external_listings').select('vehicle_id, id, organization_id, listing_status, end_date, current_bid, final_price, sold_at, platform').in('vehicle_id', ids).eq('listing_status', 'sold')),
            runChunked(ids => supabase.from('bat_listings').select('vehicle_id, id, organization_id, listing_status, auction_end_date, final_bid, bat_listing_title').in('vehicle_id', ids).in('listing_status', ['sold', 'ended'])),
            runChunked(ids => supabase.from('vehicle_listings').select('vehicle_id, id, status, auction_end_time').in('vehicle_id', ids).lte('auction_end_time', now)),
            runChunked(ids => supabase.from('external_listings').select('vehicle_id, id, listing_status, end_date').in('vehicle_id', ids)),
          ]);

          const allVehicles = { data: allVehiclesData };
          const allImages = { data: allImagesData };
          const allNativeAuctions = { data: allNativeAuctionsData };
          const allExternalAuctions = { data: allExternalAuctionsData };
          const allBatAuctions = { data: allBatAuctionsData };
          const soldExternalListings = { data: soldExternalListingsData };
          const soldBatListings = { data: soldBatListingsData };
          const endedVehicleListings = { data: endedVehicleListingsData };
          const allExternalListings = { data: allExternalListingsData };
          
          // Build lookup maps for O(1) access
          const vehiclesById = new Map((allVehicles.data || []).map(v => [v.id, v]));
          const imagesByVehicleId = new Map<string, any>();
          (allImages.data || []).forEach(img => {
            if (!imagesByVehicleId.has(img.vehicle_id)) {
              imagesByVehicleId.set(img.vehicle_id, img);
            }
          });
          const nativeAuctionsByVehicleId = new Map((allNativeAuctions.data || []).map(a => [a.vehicle_id, a]));
          const externalAuctionsByVehicleId = new Map((allExternalAuctions.data || []).map(a => [a.vehicle_id, a]));
          const batAuctionsByVehicleId = new Map((allBatAuctions.data || []).map(a => [a.vehicle_id, a]));
          
          // NEW: Maps for sold/ended listings
          const soldExternalListingsByVehicleId = new Map((soldExternalListings.data || []).map((a: any) => [a.vehicle_id, a]));
          const soldBatListingsByVehicleId = new Map((soldBatListings.data || []).map((a: any) => [a.vehicle_id, a]));
          const endedVehicleListingsByVehicleId = new Map((endedVehicleListings.data || []).map((a: any) => [a.vehicle_id, a]));
          // Map of all external listings by vehicle_id to check for ended auctions
          const allExternalListingsByVehicleId = new Map<string, any[]>();
          (allExternalListings.data || []).forEach((listing: any) => {
            if (!allExternalListingsByVehicleId.has(listing.vehicle_id)) {
              allExternalListingsByVehicleId.set(listing.vehicle_id, []);
            }
            allExternalListingsByVehicleId.get(listing.vehicle_id)!.push(listing);
          });
          
          // Enrich vehicles using pre-loaded data
          const enriched = (orgVehicles || []).map((ov: any) => {
            try {
              const vehicle = vehiclesById.get(ov.vehicle_id);
              const image = imagesByVehicleId.get(ov.vehicle_id);
              const nativeAuction = nativeAuctionsByVehicleId.get(ov.vehicle_id);
              const externalAuction = externalAuctionsByVehicleId.get(ov.vehicle_id);
              const batAuction = batAuctionsByVehicleId.get(ov.vehicle_id);
                
              // Determine which auction is active (prioritize native, then external, then bat)
              const auctionListing = nativeAuction || externalAuction || batAuction;
              let auctionData: any = null;
              
              if (nativeAuction) {
                auctionData = {
                  auction_end_time: nativeAuction.auction_end_time,
                  auction_current_bid: nativeAuction.current_high_bid_cents,
                  auction_bid_count: nativeAuction.bid_count || 0,
                  auction_reserve_price: nativeAuction.reserve_price_cents,
                  auction_platform: null,
                  auction_url: null,
                  auction_view_count: null,
                  auction_watcher_count: null
                };
              } else if (externalAuction) {
                const endDate = externalAuction.end_date;
                const meta = externalAuction.metadata && typeof externalAuction.metadata === 'object' ? externalAuction.metadata : {};
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
                  auction_current_bid: parseBid(externalAuction.current_bid),
                  auction_bid_count: externalAuction.bid_count || 0,
                  auction_reserve_price: externalAuction.reserve_price ? Math.round(Number(externalAuction.reserve_price) * 100) : null,
                  auction_platform: externalAuction.platform,
                  auction_url: externalAuction.listing_url,
                  auction_view_count: typeof externalAuction.view_count === 'number' ? externalAuction.view_count : null,
                  auction_watcher_count: typeof externalAuction.watcher_count === 'number' ? externalAuction.watcher_count : null,
                  auction_comment_count: null,
                  vehicle_location: metaLocation || null,
                  seller_org_id: typeof externalAuction.organization_id === 'string' ? externalAuction.organization_id : null,
                  seller_handle: null
                };
              } else if (batAuction) {
                // Convert DATE to TIMESTAMPTZ for end of day
                const endDate = new Date(batAuction.auction_end_date);
                endDate.setHours(23, 59, 59, 999);
                // Use high_bid for live auctions, final_bid only for sold auctions
                const isLive = endDate.getTime() > Date.now();
                const currentBid = (batAuction.final_bid || null);
                auctionData = {
                  auction_end_time: endDate.toISOString(),
                  auction_current_bid: currentBid ? Math.round(Number(currentBid) * 100) : null,
                  auction_bid_count: batAuction.bid_count || 0,
                  auction_reserve_price: batAuction.reserve_price ? Math.round(Number(batAuction.reserve_price) * 100) : null,
                  auction_platform: 'bat',
                  auction_url: batAuction.bat_listing_url,
                  auction_view_count: typeof batAuction.view_count === 'number' ? batAuction.view_count : null,
                  auction_watcher_count: null,
                  auction_comment_count: typeof batAuction.comment_count === 'number' ? batAuction.comment_count : null,
                  seller_org_id: typeof batAuction.organization_id === 'string' ? batAuction.organization_id : null,
                  seller_handle: typeof batAuction.seller_username === 'string' ? batAuction.seller_username : null
                };
              }
              
              // COMPREHENSIVE SOLD DETECTION - Check all possible sources
              const soldExternalListing = soldExternalListingsByVehicleId.get(ov.vehicle_id);
              const soldBatListing = soldBatListingsByVehicleId.get(ov.vehicle_id);
              const endedVehicleListing = endedVehicleListingsByVehicleId.get(ov.vehicle_id);
              
              // Check for ended external listings (past end date)
              const externalListingsForVehicle = allExternalListingsByVehicleId.get(ov.vehicle_id) || [];
              const hasEndedExternalListing = externalListingsForVehicle.some((listing: any) => {
                if (!listing.end_date) return false;
                const endDate = new Date(listing.end_date).getTime();
                const isEnded = endDate <= Date.now();
                return isEnded && (listing.listing_status === 'sold' || listing.listing_status === 'ended' || !listing.listing_status || listing.listing_status === 'active');
              });
              
              // Comprehensive sold detection
              const isSold = 
                // From organization_vehicles
                ov.status === 'sold' ||
                ov.listing_status === 'sold' ||
                Boolean(ov.sale_date) ||
                Boolean(ov.sale_price) ||
                
                // From vehicles table
                vehicle?.sale_status === 'sold' ||
                Boolean(vehicle?.sale_date) ||
                Boolean(vehicle?.sale_price) ||
                vehicle?.auction_outcome === 'sold' ||
                
                // From external_listings (SOLD)
                soldExternalListing?.listing_status === 'sold' ||
                Boolean(soldExternalListing?.final_price) ||
                Boolean(soldExternalListing?.sold_at) ||
                
                // From bat_listings (SOLD)
                soldBatListing?.listing_status === 'sold' ||
                Boolean(soldBatListing?.final_bid) ||
                
                // From vehicle_listings (ENDED - implied sold if ended)
                Boolean(endedVehicleListing) ||
                
                // Check if any external listing has ended (past end date implies sold/ended)
                hasEndedExternalListing ||
                
                // Check if active auctions have ended (past end date)
                (externalAuction && new Date(externalAuction.end_date).getTime() <= Date.now() && externalAuction.listing_status !== 'active') ||
                (batAuction && new Date(batAuction.auction_end_date).getTime() <= Date.now() && batAuction.listing_status !== 'sold' && batAuction.listing_status !== 'ended');
              
              // Use sold listing data to fill in missing sale info
              let finalSaleDate = ov.sale_date || vehicle?.sale_date;
              let finalSalePrice = ov.sale_price || vehicle?.sale_price;
              
              if (!finalSaleDate && soldExternalListing) {
                finalSaleDate = soldExternalListing.sold_at || soldExternalListing.end_date;
              }
              if (!finalSalePrice && soldExternalListing) {
                finalSalePrice = soldExternalListing.final_price || soldExternalListing.current_bid;
              }
              
              if (!finalSalePrice && soldBatListing) {
                finalSalePrice = soldBatListing.final_bid;
              }
              
              if (!finalSaleDate && soldBatListing && soldBatListing.auction_end_date) {
                finalSaleDate = soldBatListing.auction_end_date;
              }
              
              const vehicleLocation =
                (auctionData?.vehicle_location as string | null) ||
                (vehicle?.listing_location_raw as string | null) ||
                (vehicle?.listing_location as string | null) ||
                null;

              const imgVariants = image?.variants && typeof image.variants === 'object' ? image.variants : {};
              const bestImg =
                (typeof imgVariants?.thumbnail === 'string' && imgVariants.thumbnail) ||
                (typeof imgVariants?.medium === 'string' && imgVariants.medium) ||
                (typeof image?.thumbnail_url === 'string' && image.thumbnail_url) ||
                (typeof image?.medium_url === 'string' && image.medium_url) ||
                (typeof image?.image_url === 'string' && image.image_url) ||
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
                vehicle_year: vehicle?.year,
                vehicle_make: vehicle?.make,
                vehicle_model: vehicle?.model,
                vehicle_vin: vehicle?.vin,
                vehicle_current_value: vehicle?.current_value,
                vehicle_asking_price: vehicle?.asking_price || ov.asking_price,
                vehicle_sale_status: vehicle?.sale_status,
                vehicle_image_url: bestImg,
                vehicle_location: vehicleLocation,
                listing_status: ov.listing_status,
                cost_basis: ov.cost_basis,
                days_on_lot: ov.days_on_lot,
                has_active_auction: !!auctionListing, // Flag for sorting
                is_sold: isSold, // NEW: Comprehensive sold flag
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
                analysis_tier: typeof vehicle?.analysis_tier === 'number' ? vehicle.analysis_tier : null,
                signal_score: typeof vehicle?.signal_score === 'number' ? vehicle.signal_score : null,
                vehicles: vehicle || {},
                // Attach bat_listing_title for parsing if year/make/model missing
                bat_listing_title: batAuction?.bat_listing_title || soldBatListing?.bat_listing_title || null,
                // Attach external_listings array for VehicleCardDense
                external_listings: externalListingsForVehicle.length > 0 ? externalListingsForVehicle.map((el: any) => ({
                  id: el.id,
                  vehicle_id: el.vehicle_id,
                  listing_status: el.listing_status,
                  end_date: el.end_date,
                  current_bid: el.current_bid,
                  bid_count: el.bid_count || null,
                  comment_count: el.comment_count || null,
                  watcher_count: el.watcher_count || null,
                  view_count: el.view_count || null,
                  final_price: el.final_price || null,
                  sold_at: el.sold_at || null,
                  platform: el.platform,
                  listing_url: el.listing_url,
                  source: el.platform === 'bat' || el.platform === 'bringatrailer' ? 'bat' : el.platform
                })) : []
              };
            } catch {
              return { id: ov.id, vehicle_id: ov.vehicle_id, relationship_type: ov.relationship_type, status: ov.status, vehicles: {} };
            }
          });
          
          const baseRows = enriched as OrgVehicle[];

          // Batch-load seller org metadata (for favicon + dealer name)
          const sellerOrgIds = Array.from(
            new Set(
              baseRows
                .map((v) => v?.seller_org_id)
                .filter((x): x is string => typeof x === 'string' && x.length > 0)
            )
          );

          const orgById = new Map<string, { business_name?: string | null; website?: string | null }>();
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
            // No organizationId - skip timeline events
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
            // Error loading timeline events - show empty
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
          // Exception loading timeline events - show empty
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
      showToast('Image deleted', 'success');
    } catch (error: any) {
      console.error('Error deleting image:', error);
      showToast(`Failed to delete: ${error.message}`, 'error');
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
      showToast('Primary image updated', 'success');
    } catch (error: any) {
      console.error('Error setting primary:', error);
      showToast(`Failed: ${error.message}`, 'error');
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
      showToast(`Scan complete — ${result.tags?.length || 0} tags found`, 'success');

      // Reload to show tags
      loadOrganization();
    } catch (error: any) {
      console.error('Error scanning image:', error);
      showToast(`Scan failed: ${error.message}`, 'error');
    }
  };

  const handleAddArticle = async (articleUrl: string) => {
    if (!session?.user?.id || !organizationId) {
      showToast('Please log in to add articles', 'error');
      return;
    }

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        showToast('Session expired — please log in again', 'error');
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
        let errorMsg = 'Failed to process article';
        try {
          const error = await response.json();
          errorMsg = error.error || errorMsg;
        } catch { /* non-JSON error response */ }
        throw new Error(errorMsg);
      }

      const result = await response.json();
      if (result.success) {
        showToast('Article added to timeline', 'success');
        // Reload timeline events
        loadOrganization();
      } else {
        showToast(`Failed: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (error: any) {
      console.error('Error adding article:', error);
      showToast(`Failed to add article: ${error.message}`, 'error');
    }
  };

  const handleOwnershipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !organization?.id) return;

    const formData = new FormData(e.target as HTMLFormElement);
    const verificationType = formData.get('verificationType') as string;
    const documentFile = fileInputRef.current?.files?.[0];

    if (!documentFile) {
      showToast('Please select a document file', 'error');
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

      showToast('Ownership claim submitted — awaiting review', 'success');
      setShowOwnershipModal(false);
      setSelectedFileName('');
      loadOrganization();

    } catch (error: any) {
      console.error('Ownership submission error:', error);
      showToast(`Failed: ${error.message}`, 'error');
    }
  };

  // Safety check - if we've been loading for too long, show error
  useEffect(() => {
    if (loading && organizationId) {
      const timeout = setTimeout(() => {
        // Loading timeout - force error state
        setLoadError('Loading took too long. The organization may be private or the server is slow.');
        setLoading(false);
      }, 10000);
      return () => clearTimeout(timeout);
    }
  }, [loading, organizationId]);

  // Fetch extraction coverage for this org (BAT, C&B, Craigslist, etc.) – poll so numbers update in real time
  useEffect(() => {
    if (!organizationId) {
      setExtractionCoverage(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const url = `${SUPABASE_URL}/functions/v1/org-extraction-coverage?org_id=${encodeURIComponent(organizationId)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as OrgExtractionCoverage;
        if (!cancelled && data?.org_id && (data.extracted != null || data.target != null)) setExtractionCoverage(data);
        else if (!cancelled) setExtractionCoverage(null);
      } catch {
        if (!cancelled) setExtractionCoverage(null);
      }
    };
    load();
    const interval = setInterval(load, 45_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [organizationId]);

  if (loading) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
        {/* Skeleton header */}
        <div style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '10px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div style={{ width: 28, height: 28, background: 'var(--grey-300)', borderRadius: 2 }} />
            <div style={{ width: 200, height: 18, background: 'var(--grey-300)', borderRadius: 2 }} />
            <div style={{ width: 80, height: 16, background: 'var(--grey-200)', borderRadius: 2 }} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ width: 120, height: 13, background: 'var(--grey-200)', borderRadius: 2 }} />
            <div style={{ width: 80, height: 13, background: 'var(--grey-200)', borderRadius: 2 }} />
          </div>
        </div>
        {/* Skeleton hero */}
        <div style={{ height: 180, background: 'var(--grey-200)' }} />
        {/* Skeleton tabs */}
        <div style={{ background: 'var(--surface)', borderBottom: '2px solid var(--border)', padding: '0 16px', display: 'flex', gap: '4px' }}>
          {[100, 70, 60, 80, 90].map((w, i) => (
            <div key={i} style={{ width: w, height: 36, background: 'var(--grey-200)', margin: '4px 0', borderRadius: 2 }} />
          ))}
        </div>
        {/* Skeleton body */}
        <div style={{ padding: '16px', display: 'grid', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'var(--border-light)' }}>
            {[0,1,2,3].map(i => <div key={i} style={{ background: 'var(--white)', height: 64 }} />)}
          </div>
          <div style={{ background: 'var(--white)', border: '1px solid var(--border-light)', height: 200, borderRadius: 2 }} />
          <div style={{ background: 'var(--white)', border: '1px solid var(--border-light)', height: 120, borderRadius: 2 }} />
        </div>
        {!organizationId && (
          <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', padding: '20px' }}>
            No organization ID found in URL
          </div>
        )}
        {loadError && (
          <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', padding: '20px' }}>
            {loadError}
          </div>
        )}
      </div>
    );
  }

  if (!organization) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
        <div className="text" style={{ fontSize: '19px', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
          Organization Not Found
        </div>
        {loadError && (
          <div className="text text-muted" style={{ marginTop: 'var(--space-2)', fontSize: '12px', marginBottom: 'var(--space-4)' }}>
            {loadError}
          </div>
        )}
        {!loadError && (
          <div className="text text-muted" style={{ marginTop: 'var(--space-2)', fontSize: '12px', marginBottom: 'var(--space-4)' }}>
            The organization you're looking for doesn't exist or has been removed.
          </div>
        )}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/org')}
            className="button button-secondary"
            style={{ fontSize: '12px', padding: '8px 16px' }}
          >
            Browse Organizations
          </button>
          <button
            onClick={() => navigate(-1)}
            className="button button-primary"
            style={{ fontSize: '12px', padding: '8px 16px' }}
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
    <div style={{
      background: 'var(--bg, #f5f5f5)',
      color: 'var(--text, #2a2a2a)',
      minHeight: '100vh',
      width: '100%'
    }}>
      {/* Toast notifications */}
      {toasts.length > 0 && ReactDOM.createPortal(
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          pointerEvents: 'none',
        }}>
          {toasts.map(toast => (
            <div
              key={toast.id}
              style={{
                padding: '10px 16px',
                background: toast.type === 'success' ? '#1a472a' : toast.type === 'error' ? '#7f1d1d' : '#1a1a2e',
                color: '#fff',
                fontSize: '12px',
                fontFamily: 'var(--font-family)',
                fontWeight: 500,
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                maxWidth: '320px',
                pointerEvents: 'all',
                animation: 'fadeIn 0.15s ease',
              }}
            >
              {toast.message}
            </div>
          ))}
        </div>,
        document.body
      )}

      {/* HEADER */}
      <div style={{
        position: 'sticky',
        top: 'var(--header-height, 40px)',
        zIndex: 900,
        background: 'var(--surface-glass)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '10px 20px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)'
      }}>
        {/* Row 1: Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          {headerLogoUrl && (
            <img
              src={String(headerLogoUrl).startsWith('//') ? `https:${headerLogoUrl}` : headerLogoUrl}
              alt=""
              style={{ display: 'block', height: '28px', width: 'auto' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          {isBatOrg && !headerLogoUrl && (
            <img src="/vendor/bat/favicon.ico" alt="" style={{ display: 'block', height: '28px', width: 'auto' }} />
          )}
          {organization.website && !headerLogoUrl && (
            <FaviconIcon url={organization.website} size={18} style={{ flexShrink: 0 }} />
          )}
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)', margin: 0, lineHeight: 1.1 }}>
            {displayName}
          </h1>
          {organization.business_type && (
            <span style={{
              fontSize: '9px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              padding: '2px 8px',
              border: '1px solid var(--border-light)',
              background: 'var(--grey-50)',
            }}>
              {formatBusinessTypeLabel(organization.business_type) || organization.business_type}
            </span>
          )}

          {/* Verification badge */}
          {organization.verification_level && organization.verification_level !== 'none' && organization.verification_level !== 'unverified' && (
            <span style={{
              fontSize: '9px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              padding: '2px 8px',
              border: '1px solid #c8e6c9',
              background: '#e8f5e9',
              color: '#2e7d32',
            }}>
              {organization.verification_level === 'verified' ? 'Verified' : organization.verification_level}
            </span>
          )}

          {/* Stock ticker inline */}
          {organization.is_tradable && offering && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--success)', letterSpacing: '0.5px' }}>
                {organization.stock_symbol || 'ORG'}
              </span>
              <span style={{ fontSize: '16px', fontWeight: 700 }}>
                ${offering.current_share_price.toFixed(2)}
              </span>
              <button onClick={() => setShowTrade(true)} className="button button-primary button-small" style={{ fontSize: '9px', padding: '3px 10px' }}>
                Trade
              </button>
            </div>
          )}
        </div>

        {/* Row 2: Actions + Meta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {organization.discovered_by && (() => {
            const creator = contributors.find(c => c.user_id === organization.discovered_by);
            const creatorName = creator?.profiles?.full_name || creator?.profiles?.username || 'Unknown';
            const creatorRole = creator?.role;
            const isCurrentUser = session?.user?.id === organization.discovered_by;
            if (isCurrentUser) {
              const isCreatorOwner = creatorRole && ['owner', 'co_founder', 'board_member', 'manager'].includes(creatorRole);
              if (!isCreatorOwner) return null;
            }
            return (
              <a href={`/profile/${organization.discovered_by}`} style={{ fontSize: '9px', color: 'var(--text-muted)', textDecoration: 'none' }}>
                by {creatorName}
              </a>
            );
          })()}
          {organization.website && (
            <a href={organization.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
              {organization.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
            </a>
          )}
          {organization.phone && (
            <a href={`tel:${organization.phone}`} style={{ fontSize: '9px', color: 'var(--text-muted)', textDecoration: 'none' }}>
              {organization.phone}
            </a>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            {session && (
              <>
                <button onClick={() => setShowWorkOrderForm(true)} className="button button-primary button-small" style={{ fontSize: '9px', padding: '3px 10px' }}>
                  Request Work
                </button>
                <button onClick={() => setShowContributeModal(true)} className="button button-secondary button-small" style={{ fontSize: '9px', padding: '3px 10px' }}>
                  Contribute
                </button>
                {!isOwner && (
                  <button onClick={() => setShowOwnershipModal(true)} className="button button-secondary button-small" style={{ fontSize: '9px', padding: '3px 10px' }}>
                    Claim
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Hero Image */}
      {heroCandidates.length > 0 && (
        <div style={{
          height: '220px',
          overflow: 'hidden',
          background: '#1a1a1a',
          borderBottom: '1px solid var(--border)',
        }}>
          <img
            src={heroCandidates[Math.min(primaryHeroSrcIndex, heroCandidates.length - 1)]}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.9 }}
            onError={() => { setPrimaryHeroSrcIndex((idx) => Math.min(idx + 1, heroCandidates.length - 1)); }}
          />
        </div>
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
          {(['overview', 'vehicles', 'images', 'inventory', 'contributors', 'marketplace', 'notifications', 'storefront'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? 'var(--grey-200)' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : 'none',
                padding: '8px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: 'var(--font-family)',
                textTransform: 'capitalize',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text)'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Content — Suspense covers all lazy tab + modal components */}
      <Suspense fallback={null}>
      <div style={{
        padding: '16px',
        background: 'var(--bg, #f5f5f5)',
        color: 'var(--text, #2a2a2a)',
        minHeight: 'calc(100vh - 200px)'
      }}>
        {activeTab === 'overview' && (
          <>
            {/* Key Metrics Bar - vehicles, images, events (no Est. Value — circular estimates removed) */}
            {(((organization?.total_vehicles ?? 0) > 0) || ((organization?.total_images ?? 0) > 0) || ((organization?.total_events ?? 0) > 0)) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: '1px',
              background: 'var(--border-light)',
              border: '1px solid var(--border-light)',
              marginBottom: '16px',
            }}>
              {[
                ...((organization?.total_vehicles ?? 0) > 0 ? [{ label: 'Vehicles', value: organization!.total_vehicles! }] : []),
                ...((organization?.total_images ?? 0) > 0 ? [{ label: 'Images', value: organization!.total_images! }] : []),
                ...((organization?.total_events ?? 0) > 0 ? [{ label: 'Events', value: organization!.total_events! }] : []),
              ].map((stat, i) => (
                <div key={i} style={{
                  background: 'var(--white)',
                  padding: '12px 16px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '19px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
                    {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
            )}

            {/* Seller Track Record — per-vehicle table with sale prices */}
            {sellerTrackRecord && sellerTrackRecord.vehicles_sold.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                {/* GMV by Year + Volume by Quarter (inline) */}
                {Object.keys(sellerTrackRecord.gmv_by_year).length > 0 && (
                  <div style={{
                    display: 'flex',
                    gap: '24px',
                    flexWrap: 'wrap',
                    padding: '12px 16px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    marginBottom: '8px',
                  }}>
                    <div>
                      <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                        GMV BY YEAR
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text)', fontFamily: 'Courier New, monospace' }}>
                        {Object.entries(sellerTrackRecord.gmv_by_year)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([yr, amt]) => `${yr}: $${Number(amt).toLocaleString()}`)
                          .join('  ·  ')}
                      </div>
                    </div>
                    {sellerTrackRecord.volume_by_quarter.length > 0 && (
                      <div>
                        <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                          VOLUME BY QUARTER
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text)', fontFamily: 'Courier New, monospace' }}>
                          {sellerTrackRecord.volume_by_quarter
                            .slice(-8)
                            .map(q => `${q.quarter}: ${q.count}`)
                            .join('  ·  ')}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* State distribution */}
                {Object.keys(sellerTrackRecord.state_distribution).length > 0 && (
                  <div style={{
                    padding: '8px 16px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    marginBottom: '8px',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                  }}>
                    <span style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '8px' }}>
                      GEOGRAPHY
                    </span>
                    {Object.entries(sellerTrackRecord.state_distribution)
                      .sort(([, a], [, b]) => b - a)
                      .map(([st, count]) => `${st} (${count})`)
                      .join('  ·  ')}
                  </div>
                )}

                {/* Per-vehicle sold table */}
                <div style={{
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
                        <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Vehicle</th>
                        <th style={{ padding: '6px 12px', textAlign: 'right', fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Sale Price</th>
                        <th style={{ padding: '6px 12px', textAlign: 'right', fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Date</th>
                        <th style={{ padding: '6px 12px', textAlign: 'center', fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Role</th>
                        <th style={{ padding: '6px 12px', textAlign: 'right', fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Estimate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellerTrackRecord.vehicles_sold.slice(0, 50).map((v, i) => {
                        const roleBadge = v.relationship_type === 'owner' ? 'OWNED'
                          : v.relationship_type === 'consigner' ? 'CONSIGNED'
                          : v.relationship_type === 'supplier_build' ? 'BUILT'
                          : v.relationship_type === 'sold_by' ? '' : '';
                        const roleColor = v.relationship_type === 'owner' ? '#2563eb'
                          : v.relationship_type === 'consigner' ? '#7c3aed'
                          : v.relationship_type === 'supplier_build' ? '#059669'
                          : '#6b7280';
                        const estimateQuality = v.comp_method === 'self_price_fallback' ? 'low'
                          : (v.estimate_confidence ?? 0) >= 60 ? 'high'
                          : (v.estimate_confidence ?? 0) >= 30 ? 'medium' : 'low';
                        return (
                          <tr key={v.vehicle_id} style={{
                            borderBottom: '1px solid var(--border-light)',
                            cursor: 'pointer',
                            background: i % 2 === 0 ? 'var(--white)' : 'var(--surface)',
                          }}
                          onClick={() => navigate(`/vehicles/${v.vehicle_id}`)}>
                            <td style={{ padding: '6px 12px', color: 'var(--text)' }}>
                              {[v.year, v.make, v.model].filter(Boolean).join(' ') || '—'}
                            </td>
                            <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: 600, color: 'var(--text)' }}>
                              {v.sale_price ? `$${Number(v.sale_price).toLocaleString()}` : '—'}
                            </td>
                            <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>
                              {v.sale_date ? new Date(v.sale_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                            </td>
                            <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                              {roleBadge && (
                                <span style={{
                                  fontSize: '8px',
                                  fontWeight: 700,
                                  color: roleColor,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  padding: '1px 4px',
                                  border: `1px solid ${roleColor}`,
                                }}>
                                  {roleBadge}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'Courier New, monospace', color: estimateQuality === 'high' ? 'var(--text)' : 'var(--text-muted)' }}>
                              {v.nuke_estimate && v.comp_method !== 'self_price_fallback'
                                ? `$${Number(v.nuke_estimate).toLocaleString()}`
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sellerTrackRecord.vehicles_sold.length > 50 && (
                    <div style={{ padding: '8px 12px', fontSize: '10px', color: 'var(--text-muted)', background: 'var(--surface)', borderTop: '1px solid var(--border-light)' }}>
                      Showing 50 of {sellerTrackRecord.vehicles_sold.length} vehicles
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Competitive Context */}
            {competitiveContext && (
              <div style={{
                padding: '8px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                marginBottom: '16px',
                fontSize: '11px',
                color: 'var(--text-muted)',
              }}>
                <span style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '8px' }}>
                  MARKET CONTEXT
                </span>
                {competitiveContext.state}: #{competitiveContext.state_rank} of {competitiveContext.state_total} sellers with 3+ vehicles
                {competitiveContext.volume_peers.length > 0 && (
                  <span style={{ marginLeft: '12px' }}>
                    Similar volume: {competitiveContext.volume_peers.map(p => (
                      <a key={p.org_id} href={`/org/${p.org_id}`} onClick={(e) => { e.preventDefault(); navigate(`/org/${p.org_id}`); }}
                        style={{ color: 'var(--text)', textDecoration: 'underline', marginRight: '8px' }}>
                        {p.business_name} ({p.vehicle_count})
                      </a>
                    ))}
                  </span>
                )}
              </div>
            )}

            {/* Business docs for advisors — only show for owners or when data room has been granted */}
            {organization && organizationId && (isOwner || dataRoomAccessGranted) && (
              <div style={{
                marginBottom: '16px',
                padding: '12px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                    Business documents
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Deck, business plan, data room
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('offering')}
                  className="button button-secondary button-small"
                  style={{ fontSize: '11px', padding: '4px 12px', whiteSpace: 'nowrap' }}
                >
                  View docs
                </button>
              </div>
            )}

            {/* Data coverage: what we have + what we're loading in (scraping in real time) */}
            {extractionCoverage && (extractionCoverage.extracted != null || extractionCoverage.target != null) && (
              <div style={{
                marginBottom: '16px',
                padding: '12px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                borderLeft: '4px solid var(--blue-500)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Data coverage
                  </span>
                  {extractionCoverage.queue_pending != null && extractionCoverage.queue_pending > 0 && (
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 600,
                      color: 'var(--blue-600)',
                      background: 'rgba(59, 130, 246, 0.12)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      animation: 'pulse 2s ease-in-out infinite',
                    }}>
                      Scraping in progress
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: 1.5 }}>
                  {extractionCoverage.extracted != null && `${(extractionCoverage.extracted / 1000).toFixed(0)}k listings`}
                  {extractionCoverage.queue_pending != null && extractionCoverage.queue_pending > 0 && (
                    <span> · {extractionCoverage.queue_pending.toLocaleString()} in queue · <strong style={{ color: 'var(--blue-600)' }}>loading in…</strong></span>
                  )}
                </div>
                {extractionCoverage.metrics_note && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                    {extractionCoverage.metrics_note}
                  </div>
                )}
              </div>
            )}

            {/* Activity Heatmap */}
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
                
                // Check all sold indicators - use comprehensive sold detection
                const isSold = (v as any).is_sold ||
                  v.sale_date || 
                  v.sale_price || 
                  v.vehicle_sale_status === 'sold' ||
                  v.listing_status === 'sold' ||
                  (v.vehicles && (v.vehicles as any).sale_price) ||
                  (v.vehicles && (v.vehicles as any).sale_date) ||
                  (v.vehicles && (v.vehicles as any).auction_outcome === 'sold');
                
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
                  <div className="card" style={{ marginBottom: '16px', borderTop: '3px solid var(--error)' }}>
                    <div className="card-header" style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--error)', display: 'inline-block' }} />
                        LIVE ({sortedAuctions.length})
                      </span>
                    </div>
                    <div className="card-body">
                      <div
                        ref={gridRef}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `repeat(${Math.max(1, Math.min(16, cardsPerRow))}, minmax(0, 1fr))`,
                          gap: '8px'
                        }}
                      >
                        {sortedAuctions.map((vehicle) => {
                        // Transform to VehicleCardDense format with auction metadata
                        const vehicleData = transformVehicleForCard(vehicle);
                        // Add auction-specific data
                        vehicleData.auction_end_date = vehicle.auction_end_time || undefined;
                        vehicleData.asking_price = vehicle.auction_current_bid ? vehicle.auction_current_bid / 100 : undefined;
                        vehicleData.current_value = vehicle.auction_current_bid ? vehicle.auction_current_bid / 100 : undefined;
                        vehicleData.view_count = (vehicle as any).auction_view_count || undefined;
                        
                        return (
                          <VehicleCardDense
                            key={vehicle.id}
                            vehicle={vehicleData}
                            viewMode="grid"
                            cardSizePx={gridCardSizePx}
                            infoDense={false}
                            viewerUserId={session?.user?.id}
                            thermalPricing={false}
                            thumbnailFit={thumbFitMode === 'original' ? 'contain' : 'cover'}
                            sourceStampUrl={organization?.website || vehicle.seller_org_website || vehicle.auction_url || undefined}
                          />
                        );
                      })}
                    </div>
                  </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Vehicles for Sale / Currently in Service — only show when org has vehicles */}
            {(organization?.total_vehicles ?? 0) > 0 && (
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header" style={{
                fontSize: '12px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}>
                <span>
                  {intelligence?.effectivePrimaryFocus === 'service' ? 'In Service' : 'Inventory'}
                  {vehicles.length > 0 && (
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '6px' }}>
                      {vehicles.filter((v: any) => !v.is_sold && v.status === 'active').length}
                    </span>
                  )}
                </span>

                {/* Compact controls */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {intelligence?.effectivePrimaryFocus !== 'service' && (
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as OrgSortBy)}
                      style={{ padding: '2px 4px', fontSize: '9px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
                    >
                      <option value="newest">Newest</option>
                      <option value="oldest">Oldest</option>
                      <option value="year">Year</option>
                      <option value="make">Make</option>
                      <option value="model">Model</option>
                      <option value="price_high">Price ↓</option>
                      <option value="price_low">Price ↑</option>
                    </select>
                  )}
                  <input
                    type="range"
                    min="1" max="16" step="1"
                    value={cardsPerRow}
                    onChange={(e) => setCardsPerRow(parseInt(e.target.value, 10))}
                    className="nuke-range nuke-range-accent"
                    style={{ width: '80px' }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setThumbFitMode(thumbFitMode === 'square' ? 'original' : 'square'); }}
                    style={{ padding: '1px 5px', fontSize: '9px', border: '1px solid var(--border)', background: 'var(--grey-200)', color: 'var(--text)', cursor: 'pointer' }}
                    title={thumbFitMode === 'square' ? 'Original aspect ratio' : 'Square crop'}
                  >
                    {thumbFitMode === 'square' ? '⊞' : '□'}
                  </button>
                </div>
              </div>
              <div className="card-body">
                {organization?.total_vehicles != null && organization.total_vehicles > vehicles.length && vehicles.length > 0 && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Showing first {vehicles.length.toLocaleString()} of {organization.total_vehicles.toLocaleString()} vehicles.
                  </div>
                )}
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
                      
                      // Exclude sold/completed service vehicles - use comprehensive sold detection
                      const isSold = (v as any).is_sold || // Primary comprehensive flag
                        v.sale_date || 
                        v.sale_price || 
                        v.vehicle_sale_status === 'sold' ||
                        v.listing_status === 'sold' ||
                        (v.vehicles && (v.vehicles as any).sale_price) ||
                        (v.vehicles && (v.vehicles as any).sale_date) ||
                        (v.vehicles && (v.vehicles as any).auction_outcome === 'sold');
                      return !isSold;
                    });
                    
                    if (serviceVehicles.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '12px' }}>
                          No vehicles currently in service. Service vehicles will appear here.
                        </div>
                      );
                    }
                    
                    return (
                      <div
                        ref={gridRef}
                        style={{ 
                          display: 'grid', 
                          gridTemplateColumns: `repeat(${Math.max(1, Math.min(16, cardsPerRow))}, minmax(0, 1fr))`, 
                          gap: '8px' 
                        }}
                      >
                        {serviceVehicles.map((vehicle) => (
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
                  // 1. Not sold - comprehensive detection from all sources
                  // 2. Active status (not sold/archived)
                  // 3. Relationship type indicates inventory/for sale (not service/work vehicles)
                  // 4. EXCLUDE vehicles with active auctions (those are shown above)
                  const productsForSale = vehicles.filter(v => {
                    // Must be active (not sold/archived status)
                    if (v.status === 'sold' || v.status === 'archived') return false;
                    
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
                    
                    // COMPREHENSIVE SOLD DETECTION - use the flag set during enrichment
                    const isSold = (v as any).is_sold || // Primary comprehensive flag
                      v.sale_date || // Has sale date
                      v.sale_price || // Has sale price
                      v.vehicle_sale_status === 'sold' || // Vehicle marked as sold
                      v.listing_status === 'sold' || // Listing status says sold
                      (v.vehicles && (v.vehicles as any).sale_price) || // Vehicle has sale_price
                      (v.vehicles && (v.vehicles as any).sale_date) || // Vehicle has sale_date
                      (v.vehicles && (v.vehicles as any).auction_outcome === 'sold'); // Auction outcome is sold
                    
                    return !isSold;
                  });
                  
                  if (productsForSale.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        No current inventory. Add vehicles to display them here.
                      </div>
                    );
                  }
                  
                  // Apply sorting based on sortBy and sortDirection
                  const sorted = [...productsForSale];
                  const dir = sortDirection === 'desc' ? 1 : -1;
                  
                  switch (sortBy) {
                    case 'year':
                      sorted.sort((a, b) => {
                        const ay = Number((a as any).vehicle_year || 0) || 0;
                        const by = Number((b as any).vehicle_year || 0) || 0;
                        return dir * (by - ay);
                      });
                      break;
                    case 'make':
                      sorted.sort((a, b) => {
                        const am = String((a as any).vehicle_make || '');
                        const bm = String((b as any).vehicle_make || '');
                        return dir * am.localeCompare(bm);
                      });
                      break;
                    case 'model':
                      sorted.sort((a, b) => {
                        const amd = String((a as any).vehicle_model || '');
                        const bmd = String((b as any).vehicle_model || '');
                        return dir * amd.localeCompare(bmd);
                      });
                      break;
                    case 'price_high':
                      sorted.sort((a, b) => {
                        const ap = Number((a as any).vehicle_current_value || (a as any).vehicle_asking_price || 0);
                        const bp = Number((b as any).vehicle_current_value || (b as any).vehicle_asking_price || 0);
                        return dir * (bp - ap);
                      });
                      break;
                    case 'price_low':
                      sorted.sort((a, b) => {
                        const ap = Number((a as any).vehicle_current_value || (a as any).vehicle_asking_price || 0);
                        const bp = Number((b as any).vehicle_current_value || (b as any).vehicle_asking_price || 0);
                        return dir * (ap - bp);
                      });
                      break;
                    case 'oldest':
                    case 'newest':
                    default:
                      // Sort by year (newer first by default) as fallback
                      sorted.sort((a, b) => {
                        const ay = Number((a as any).vehicle_year || 0) || 0;
                        const by = Number((b as any).vehicle_year || 0) || 0;
                        if (ay !== by) return dir * (by - ay);
                        const am = String((a as any).vehicle_make || '');
                        const bm = String((b as any).vehicle_make || '');
                        if (am !== bm) return am.localeCompare(bm);
                        const amd = String((a as any).vehicle_model || '');
                        const bmd = String((b as any).vehicle_model || '');
                        return amd.localeCompare(bmd);
                      });
                      break;
                  }
                  
                  return (
                    <div
                      ref={gridRef}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${Math.max(1, Math.min(16, cardsPerRow))}, minmax(0, 1fr))`,
                        gap: '8px'
                      }}
                    >
                      {sorted.map((vehicle) => (
                        <VehicleCardDense
                          key={vehicle.id}
                          vehicle={transformVehicleForCard(vehicle)}
                          viewMode="grid"
                          cardSizePx={gridCardSizePx}
                          infoDense={false}
                          viewerUserId={session?.user?.id}
                          thermalPricing={false}
                          thumbnailFit={thumbFitMode === 'original' ? 'contain' : 'cover'}
                          sourceStampUrl={organization?.website || vehicle.seller_org_website || undefined}
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
            )}

            {/* SOLD INVENTORY BROWSER / SERVICE ARCHIVE - only show when org has sold vehicles */}
            <SoldInventoryBrowser 
              organizationId={organizationId!} 
              title={intelligence?.effectivePrimaryFocus === 'service' ? 'Service Archive' : 'Sold Inventory Archive'}
            />

            {/* Details */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header" style={{ fontSize: '12px', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Details</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {isOwner && (
                    <button className="button button-small button-secondary" onClick={() => setShowLocationPicker(true)} style={{ fontSize: '9px', padding: '2px 8px' }}>
                      {organization.latitude ? 'GPS' : 'Set Location'}
                    </button>
                  )}
                  {(isOwner || currentUserRole === 'moderator' || currentUserRole === 'contractor') && (
                    <button onClick={() => setShowOrganizationEditor(true)} className="button button-small" style={{ fontSize: '9px', padding: '2px 8px' }}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
              <div className="card-body">
                {organization.description && (
                  <p style={{ fontSize: '12px', lineHeight: 1.5, margin: '0 0 12px 0', color: 'var(--text)' }}>
                    {organization.description}
                  </p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                  {organization.business_type && (
                    <div><div style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Type</div><div style={{ fontWeight: 600 }}>{formatBusinessTypeLabel(organization.business_type) || organization.business_type}</div></div>
                  )}
                  {(organization.estimated_value || organization.current_value) && (
                    <div><div style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Value</div><div style={{ fontWeight: 600 }}>{formatUsd(organization.estimated_value || organization.current_value || 0)}</div></div>
                  )}
                  {organization.address && (
                    <div><div style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Location</div><div>{organization.city}{organization.state ? `, ${organization.state}` : ''}{organization.zip_code ? ` ${organization.zip_code}` : ''}</div></div>
                  )}
                  {organization.phone && (
                    <div><div style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Phone</div><a href={`tel:${organization.phone}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>{organization.phone}</a></div>
                  )}
                  {organization.email && (
                    <div><div style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</div><a href={`mailto:${organization.email}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>{organization.email}</a></div>
                  )}
                  {organization.website && (
                    <div><div style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Website</div><a href={organization.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{organization.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></div>
                  )}
                  {organization.labor_rate && (
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Labor Rate</div>
                      <div style={{ fontWeight: 600 }}>
                        ${organization.labor_rate}/hr
                        {isOwner && <button onClick={() => setShowLaborRateEditor(true)} style={{ marginLeft: '6px', fontSize: '9px', padding: '1px 4px', background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer' }}>edit</button>}
                      </div>
                    </div>
                  )}
                  {organization.latitude && organization.longitude && (
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GPS</div>
                      <a href={`https://www.google.com/maps?q=${organization.latitude},${organization.longitude}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '11px' }}>
                        {organization.latitude.toFixed(4)}, {organization.longitude.toFixed(4)}
                      </a>
                    </div>
                  )}
                </div>
                {!organization.labor_rate && isOwner && (
                  <div style={{ marginTop: '8px' }}>
                    <button onClick={() => setShowLaborRateEditor(true)} className="button button-small button-secondary" style={{ fontSize: '9px', padding: '2px 8px' }}>Set Labor Rate</button>
                  </div>
                )}
              </div>
            </div>

            {/* Stock Info (if tradable) */}
            {organization.is_tradable && offering && (
              <div className="card" style={{ marginBottom: '16px' }}>
                <div className="card-header">Stock Information</div>
                <div className="card-body" style={{ fontSize: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Symbol</div>
                      <div style={{ fontWeight: 600 }}>{offering.stock_symbol}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Current Price</div>
                      <div style={{ fontWeight: 600 }}>${offering.current_share_price.toFixed(2)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Total Shares</div>
                      <div style={{ fontWeight: 600 }}>{offering.total_shares.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Market Cap</div>
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

            {/* Stats moved to top metrics bar */}
          </>
        )}

        {activeTab === 'service' && organizationId && (
          <OrganizationServiceTab organizationId={organizationId} />
        )}

        {activeTab === 'vehicles' && (
            <>
              {organization?.business_type === 'forum' && vehicles.length === 0 && (
                <div style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  background: 'var(--gray-50)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  padding: '10px 14px',
                  marginBottom: '12px',
                }}>
                  Forum-discovered vehicles are being linked to this organization; inventory will appear here once linked.
                </div>
              )}
              <EnhancedDealerInventory
                organizationId={organizationId!}
                userId={session?.user?.id || null}
                canEdit={canEdit}
                isOwner={isOwner}
              />
            </>
        )}

        {activeTab === 'receipts' && organizationId && (
          <div style={{ padding: '16px' }}>
            <div className="card">
              <div className="card-header">Work Orders</div>
              <div className="card-body">
                <div style={{ fontSize: '12px', color: 'var(--grey-600)', textAlign: 'center', padding: '40px' }}>
                  Receipt/work order browser coming soon
                  <br />
                  <span style={{ fontSize: '11px' }}>
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
              <span>Images ({organization?.total_images != null ? organization.total_images.toLocaleString() : images.length})</span>
              {(canEdit || isOwner) && (
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="button button-primary button-small"
                  style={{ fontSize: '11px', padding: '6px 12px' }}
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
                  <div style={{ fontSize: '15px', marginBottom: '12px', fontWeight: 600 }}>
                    No images yet
                  </div>
                  <div style={{ fontSize: '12px', marginBottom: '20px' }}>
                    Upload the first image to get started
                  </div>
                  {(canEdit || isOwner) ? (
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      className="button button-primary"
                      style={{ fontSize: '13px', padding: '10px 24px' }}
                      disabled={uploadingImages}
                    >
                      {uploadingImages ? 'Uploading...' : 'Upload Images'}
                    </button>
                  ) : (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
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
                            fontSize: '9px',
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
                            fontSize: '9px',
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
                            fontSize: '9px',
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
                                  fontSize: '9px',
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
                                    fontSize: '9px',
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
                                    fontSize: '9px',
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
                                fontSize: '9px',
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
                          <div style={{ fontSize: '11px', marginBottom: '6px', fontWeight: 600 }}>
                            {img.caption}
              </div>
                        )}

                        {/* Date and location */}
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          {img.taken_at ? new Date(img.taken_at).toLocaleDateString() : new Date(img.uploaded_at).toLocaleDateString()}
                          {img.location_name && ` · ${img.location_name}`}
            </div>

                        {/* EXIF data */}
                        {img.exif_data && Object.keys(img.exif_data).length > 0 && (
                          <div style={{
                            fontSize: '9px',
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
                            fontSize: '9px',
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
                            <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>
                              AI Tags
                            </div>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {imageTags[img.id].map((t, idx) => (
                                <span
                                  key={idx}
                                  style={{
                                    fontSize: '9px',
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
                <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)', fontSize: '12px' }}>
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
                        <div style={{ fontSize: '13px', fontWeight: 700 }}>
                          {contributor.profiles?.full_name || contributor.profiles?.username}
                </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          @{contributor.profiles?.username} · {contributor.role}
                  </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--accent)' }}>
                          {contributor.contribution_count}
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
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
                  <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0 }}>
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
                      style={{ fontSize: '11px' }}
                    >
                      Add Article
                    </button>
                  )}
                </div>
                {timelineEvents.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>
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
                          <div style={{ fontSize: '11px', fontWeight: 700 }}>
                            {event.profiles?.full_name || event.profiles?.username}
                          </div>
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                            {new Date(event.event_date).toLocaleDateString()}
                          </div>
                        </div>
                        <div style={{ fontSize: '12px', marginBottom: '2px' }}>
                          {event.title}
                        </div>
                        {event.description && (
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
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
                              style={{ fontSize: '9px', color: 'var(--accent)', textDecoration: 'none' }}
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
              <h3 style={{ fontSize: '13px', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-2)' }}>
                Services Offered
              </h3>
              {comprehensiveData.website_mapping && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
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
                    <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                      {service.service_name}
                    </div>
                    {service.service_category && (
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                        {service.service_category.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </div>
                    )}
                    {service.description && (
                      <div style={{ fontSize: '11px', color: 'var(--text)', marginBottom: 'var(--space-2)', lineHeight: '1.5' }}>
                        {service.description}
                      </div>
                    )}
                    {service.pricing_model && service.pricing_model !== 'unknown' && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Pricing:</div>
                        {service.pricing_model === 'fixed_price' && service.base_price && `$${service.base_price.toLocaleString()}`}
                        {service.pricing_model === 'hourly_rate' && service.hourly_rate && `$${service.hourly_rate.toLocaleString()}/hour`}
                        {service.pricing_model === 'percentage' && service.percentage_rate && `${service.percentage_rate}%`}
                        {service.pricing_model === 'tiered' && 'Tiered Pricing'}
                        {service.pricing_model === 'custom_quote' && 'Custom Quote Available'}
                      </div>
                    )}
                    {service.source_url && (
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
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
                fontSize: '11px',
              }}>
                No services defined yet. Services can be automatically discovered from your website or manually added.
              </div>
            )}
          </div>
        )}

        {/* Collection Intelligence Tab */}
        {activeTab === 'collection-intel' && organization && (
          <CollectionIntelligenceTab organizationId={organizationId!} />
        )}

        {/* Inventory Tab */}
        {activeTab === 'inventory' && organization && (
          <div style={{ padding: '16px' }}>
            {/* Data Source Connection (dealers/owners only) */}
            {isOwner && (
              <div className="card" style={{ marginBottom: '16px' }}>
                <div className="card-header" style={{ fontSize: '15px', fontWeight: 700 }}>
                  Connect Data Sources
                </div>
                <div className="card-body">
                  <div style={{ fontSize: '12px', marginBottom: '12px', color: 'var(--text-secondary)' }}>
                    Import inventory, vehicles, and documents from external sources
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <a
                      href={`/dealer/${organization.id}/ai-assistant`}
                      className="button button-primary"
                      style={{ fontSize: '12px', textDecoration: 'none', display: 'inline-block' }}
                    >
                      AI Assistant
                    </a>
                    <a
                      href={`/dealer/${organization.id}/bulk-editor`}
                      className="button button-secondary"
                      style={{ fontSize: '12px', textDecoration: 'none', display: 'inline-block' }}
                    >
                      Bulk Editor
                    </a>
                    <button
                      onClick={() => setShowBaTImporter(true)}
                      className="button button-secondary"
                      style={{ fontSize: '12px' }}
                    >
                      Import BaT Sales
                    </button>
                    <a
                      href={`/dealer/${organization.id}/dropbox-import`}
                      className="button button-secondary"
                      style={{ fontSize: '12px', textDecoration: 'none', display: 'inline-block' }}
                    >
                      Dropbox Import
                    </a>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: '12px' }}
                      disabled
                      title="Coming soon"
                    >
                      Google Drive
                    </button>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: '12px' }}
                      disabled
                      title="Coming soon"
                    >
                      CSV Upload
                    </button>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: '12px' }}
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
                    // Vehicle updated with VIN
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

        {/* Offering Tab: gated by NDA; anon must verify phone, then sign */}
        {activeTab === 'offering' && organization && organizationId && (
          (() => {
            const hasDataRoomAccess = isOwner || dataRoomAccessGranted;
            if (!hasDataRoomAccess) {
              return (
                <DataRoomGate
                  organizationId={organizationId}
                  organizationName={organization.business_name}
                  onAccessGranted={() => setDataRoomAccessGranted(true)}
                />
              );
            }
            return (
              <OrganizationOfferingTab
                organizationId={organizationId}
                organizationName={organization.business_name}
                isOwner={isOwner}
              />
            );
          })()
        )}

        {/* Legal & SEC Tab */}
        {activeTab === 'legal' && organization && organizationId && (
          <OrganizationLegalTab
            organizationId={organizationId}
            organization={organization}
            isOwner={isOwner}
            canEdit={canEdit}
          />
        )}

        {/* Storefront Settings Tab */}
        {activeTab === 'storefront' && organization && (isOwner || canEdit) && (
          <div style={{ padding: 16 }}>
            <StorefrontSettings
              organization={organization}
              onSave={() => loadOrganization()}
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

      {/* Data room gate modal (from overview CTA) */}
      {showDataRoomGate && organization && organizationId && (
        <DataRoomGate
          organizationId={organizationId}
          organizationName={organization.business_name}
          onAccessGranted={() => {
            setDataRoomAccessGranted(true);
            setShowDataRoomGate(false);
            setActiveTab('offering');
          }}
          onClose={() => setShowDataRoomGate(false)}
        />
      )}

      {/* Contribute Data Modal */}
      {showContributeModal && organization && (
        <AddOrganizationData
          organizationId={organization.id}
          onClose={() => setShowContributeModal(false)}
          onSaved={() => {
            setShowContributeModal(false);
            loadOrganization();
          }}
        />
      )}

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
              <h3 style={{ margin: 0, fontSize: '13px' }}>Claim Organization Ownership</h3>
            </div>
            <div className="modal-body">
              <form onSubmit={handleOwnershipSubmit}>
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ marginBottom: '4px', fontSize: '12px' }}>Document Type:</div>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '12px' }}>
                    <input type="radio" value="business_license" defaultChecked name="verificationType" />
                    {' '}Business License
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '12px' }}>
                    <input type="radio" value="tax_id" name="verificationType" />
                    {' '}Tax ID / EIN
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '12px' }}>
                    <input type="radio" value="articles_incorporation" name="verificationType" />
                    {' '}Articles of Incorporation
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '12px' }}>
                    <input type="radio" value="dba_certificate" name="verificationType" />
                    {' '}DBA Certificate
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '12px' }}>
                    <input type="radio" value="lease_agreement" name="verificationType" />
                    {' '}Lease/Property Agreement
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '12px' }}>
                    <input type="radio" value="utility_bill" name="verificationType" />
                    {' '}Utility Bill (business address)
                  </label>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ marginBottom: '4px', fontSize: '12px' }}>Upload Document:</div>
                  
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
                        <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', color: 'var(--accent)' }}>
                          File selected
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {selectedFileName}
                  </div>
                </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                          {isDragging ? 'Drop file here' : 'Drag & drop or click to choose'}
                </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
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
                    style={{ fontSize: '11px' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    style={{ fontSize: '12px' }}
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
                fontSize: '32px',
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
              fontSize: '12px',
              maxWidth: '600px'
            }}>
              {lightboxImage.caption && (
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                  {lightboxImage.caption}
              </div>
            )}
              <div style={{ fontSize: '11px', opacity: 0.8 }}>
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
                fontSize: '32px',
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
              fontSize: '27px',
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
      </Suspense>
    </div>
  );
}
