import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import MobileVehicleProfile from '../components/mobile/MobileVehicleProfile';
import { TimelineEventService } from '../services/timelineEventService';
import AddEventWizard from '../components/AddEventWizard';
import EventMap from '../components/EventMap';
// AppLayout now provided globally by App.tsx
import CommentPopup from '../components/CommentPopup';
import CommentingGuide from '../components/CommentingGuide';
import VehicleDataEditor from '../components/vehicle/VehicleDataEditor';
import VehicleStats from '../components/vehicle/VehicleStats';
import VehicleDocumentManager from '../components/VehicleDocumentManager';
import PurchaseAgreementManager from '../components/PurchaseAgreementManager';
import ConsignerManagement from '../components/ConsignerManagement';
import ReceiptManager from '../components/vehicle/ReceiptManager';
import VehicleTagExplorer from '../components/vehicle/VehicleTagExplorer';
import EnhancedImageTagger from '../components/vehicle/EnhancedImageTagger';
import VehicleProfileTrading from '../components/vehicle/VehicleProfileTrading';
import {
  VehicleHeader,
  VehicleHeroImage,
  VehicleBasicInfo,
  VehicleTimelineSection,
  VehicleCommentsSection,
  VehicleImageGallery,
  VehiclePricingSection,
  VehicleSaleSettings,
  WorkMemorySection
} from './vehicle-profile';
import type {
  Vehicle,
  VehiclePermissions,
  SaleSettings,
  FieldAudit,
  LiveSession
} from './vehicle-profile/types';
import '../design-system.css';

const VehicleProfile: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  
  // All state hooks must be declared before any conditional returns
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [session, setSession] = useState<any>(null);
  const [vehicleImages, setVehicleImages] = useState<string[]>([]);
  const [viewCount, setViewCount] = useState<number>(0);
  const [hasContributorAccess, setHasContributorAccess] = useState(false);
  const [showCommentingGuide, setShowCommentingGuide] = useState(false);
  const [showContributors, setShowContributors] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedDateEvents, setSelectedDateEvents] = useState<any[]>([]);
  const [showEventModal, setShowEventModal] = useState(false);
  const [responsibleName, setResponsibleName] = useState<string | null>(null);
  const [showDataEditor, setShowDataEditor] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [presenceCount, setPresenceCount] = useState<number>(0);
  const [leadImageUrl, setLeadImageUrl] = useState<string | null>(null);
  const [recentCommentCount, setRecentCommentCount] = useState<number>(0);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [contributorRole, setContributorRole] = useState<string | null>(null);
  const [ownershipVerifications, setOwnershipVerifications] = useState<any[]>([]);
  const [newEventsNotice, setNewEventsNotice] = useState<{ show: boolean; count: number; dates: string[] }>({ show: false, count: 0, dates: [] });
  const [showMap, setShowMap] = useState(false);
  const commentsSectionRef = React.useRef<HTMLDivElement | null>(null);
  const presenceAvailableRef = React.useRef<boolean>(true);
  const liveAvailableRef = React.useRef<boolean>(true);
  const [fieldAudit, setFieldAudit] = useState<FieldAudit>({
    open: false,
    fieldName: '',
    fieldLabel: '',
    entries: []
  });
  const [commentPopup, setCommentPopup] = useState<{
    isOpen: boolean;
    targetId: string;
    targetType: 'vehicle' | 'profile' | 'timeline_event';
    targetLabel: string;
  }>({
    isOpen: false,
    targetId: '',
    targetType: 'vehicle',
    targetLabel: ''
  });

  // For Sale settings
  const [saleSettings, setSaleSettings] = useState<SaleSettings>({
    for_sale: false,
    live_auction: false,
    partners: [],
    reserve: ''
  });
  const [savingSale, setSavingSale] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [bookmarklets, setBookmarklets] = useState<{ key: string; label: string; href: string }[]>([]);
  const [composeText, setComposeText] = useState<{ title: string; description: string; specs: string[] }>({ title: '', description: '', specs: [] });
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  
  // Detect mobile device - but DON'T use early return (breaks React hooks rules)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => {
      // Only consider screen width, not user agent, to avoid issues when devtools opens
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Calculate true legal ownership - requires verified title + matching legal ID
  const isVerifiedOwner = React.useMemo(() => {
    if (!session?.user?.id || !vehicle?.id) return false;

    // Check if user has approved ownership verification with both title and legal ID
    const hasVerifiedOwnership = ownershipVerifications.some(verification =>
      verification.user_id === session.user.id &&
      verification.status === 'approved' &&
      (verification.verification_type === 'title' || verification.verification_type === 'title_and_id')
    );

    return hasVerifiedOwnership;
  }, [session?.user?.id, vehicle?.id, ownershipVerifications]);

  // Legacy database uploader check (IMPORTANT: This is NOT ownership, just who uploaded)
  const isDbUploader = session?.user?.id === vehicle?.uploaded_by;

  // Consolidated permissions object
  const permissions: VehiclePermissions = {
    isVerifiedOwner,
    hasContributorAccess,
    contributorRole,
    isDbUploader
  };

  // Row-owner detection (DB owner of vehicle record)
  const isRowOwner = !!(session?.user?.id && (vehicle as any)?.user_id && session.user.id === (vehicle as any).user_id);

  const loadSaleSettings = async (vehId: string) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_sale_settings')
        .select('for_sale, live_auction, partners, reserve')
        .eq('vehicle_id', vehId)
        .maybeSingle();
      if (error) {
        // table may not exist yet — skip quietly
        return;
      }
      if (data) {
        setSaleSettings({
          for_sale: !!data.for_sale,
          live_auction: !!data.live_auction,
          partners: Array.isArray(data.partners) ? data.partners : [],
          reserve: typeof data.reserve === 'number' ? data.reserve : ''
        });
      }
    } catch {}
  };

  // Build a universal package from live vehicle + images and store in localStorage for bookmarklet
  const composeListingForPartner = async (partnerKey: string) => {
    if (!vehicle) return;
    try {
      // Load images from DB
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('image_url, is_primary')
        .eq('vehicle_id', vehicle.id)
        .limit(300);
      const images = (imgs || []) as any[];
      // Services removed during cleanup - simplified composition
      const pkg = {
        partner: partnerKey,
        vehicle,
        images,
        reserve: saleSettings.reserve === '' ? null : Number(saleSettings.reserve),
        title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        description: vehicle.description || ''
      };
      localStorage.setItem('nuke_sale_package', JSON.stringify(pkg));
      setComposeText({ title: pkg.title, description: pkg.description, specs: [] });
      // Bookmarklet functionality removed during cleanup
      setBookmarklets([]);
    } catch (e) {
      console.warn('Compose failed:', e);
    }
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  };

  const saveSaleSettings = async () => {
    if (!vehicle) return;
    setSavingSale(true);
    try {
      const payload = {
        vehicle_id: vehicle.id,
        for_sale: saleSettings.for_sale,
        live_auction: saleSettings.live_auction,
        partners: saleSettings.partners,
        reserve: saleSettings.reserve === '' ? null : Number(saleSettings.reserve),
        updated_at: new Date().toISOString()
      } as any;
      const { error } = await supabase
        .from('vehicle_sale_settings')
        .upsert(payload, { onConflict: 'vehicle_id' });
      if (error) {
        console.warn('Sale settings save failed (table may not exist):', error.message);
      }
    } catch (e) {
      console.warn('Sale settings save error:', e);
    } finally {
      setSavingSale(false);
    }
  };

  useEffect(() => {
    if (!vehicleId) return;
    console.log('VehicleProfile mounted with vehicleId:', vehicleId);
    checkAuth();
    loadOwnershipVerifications();
    // Don't load vehicle and timeline until we know auth status
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);
  
  // Check auth before loading vehicle
  useEffect(() => {
    const checkInitialAuth = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      setAuthChecked(true);
    };
    checkInitialAuth();
  }, []);
  
  useEffect(() => {
    if (!vehicleId || !authChecked) return;
    loadVehicle();
    loadTimelineEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, authChecked]);

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session);
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Check contributor status when session or vehicle changes
  useEffect(() => {
    checkContributorStatus();
    loadUserProfile();
  }, [session, vehicle]);

  useEffect(() => {
    const imageHandler = (e: any) => {
      const vid = e?.detail?.vehicleId;
      if (!vehicleId || (vid && vid !== vehicleId)) return;
      try {
        loadVehicleImages();
        loadTimelineEvents();
      } catch {}
    };

    const timelineHandler = (e: any) => {
      const vid = e?.detail?.vehicleId;
      if (!vehicleId || (vid && vid !== vehicleId)) return;
      try {
        loadTimelineEvents();
      } catch {}
    };

    window.addEventListener('vehicle_images_updated', imageHandler);
    window.addEventListener('timeline_updated', timelineHandler);

    // Force timeline refresh every 30 seconds if on page
    const intervalId = setInterval(() => {
      loadTimelineEvents();
    }, 30000);

    return () => {
      window.removeEventListener('vehicle_images_updated', imageHandler);
      window.removeEventListener('timeline_updated', timelineHandler);
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  useEffect(() => {
    if (vehicle) {
      loadVehicleImages();
      loadViewCount();
      recordView();
      loadTimelineEvents();
      loadSaleSettings(vehicle.id);
      loadResponsible();
      loadLiveSession();
      loadPresenceCount();
      loadRecentComments();
      checkContributorStatus();
    }
  }, [vehicle]);

  // Refresh hero/gallery when images update elsewhere
  useEffect(() => {
    const handler = (e: any) => {
      if (!vehicle?.id) return;
      if (!e?.detail?.vehicleId || e.detail.vehicleId === vehicle.id) {
        loadVehicleImages();
        recomputeScoresForVehicle(vehicle.id);
      }
    };
    window.addEventListener('vehicle_images_updated', handler);
    return () => window.removeEventListener('vehicle_images_updated', handler);
  }, [vehicle]);

  // Listen for timeline events created from image uploads to prompt review and refresh timeline
  useEffect(() => {
    const onEventsCreated = (e: any) => {
      if (!vehicle?.id) return;
      const { vehicleId, count, dates } = e?.detail || {};
      if (vehicleId && vehicleId === vehicle.id) {
        setNewEventsNotice({ show: true, count: count || 0, dates: Array.isArray(dates) ? dates : [] });
        loadTimelineEvents();
      }
    };
    window.addEventListener('timeline_events_created', onEventsCreated as any);
    return () => window.removeEventListener('timeline_events_created', onEventsCreated as any);
  }, [vehicle]);

  // Recompute and persist scores for key fields
  const recomputeScoresForVehicle = async (vehId: string) => {
    try {
      const fields = ['make','model','year','vin','color','mileage','engine','transmission','body_style','doors','seats'];
      // get current sources
      const { data: sources } = await supabase
        .from('vehicle_field_sources')
        .select('field_name, field_value, source_type, user_id, is_verified')
        .eq('vehicle_id', vehId);
      // get images
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('area, labels, sensitive_type')
        .eq('vehicle_id', vehId);
      const labelsList = (imgs || []).flatMap((r: any) => Array.isArray(r.labels) ? r.labels : []);
      const areaList = (imgs || []).map((r: any) => r.area).filter(Boolean);
      const hasTitle = (imgs || []).some((r: any) => r.sensitive_type === 'title' || (Array.isArray(r.labels) && r.labels.includes('paperwork')));
      const hasVinImg = labelsList.includes('vin') || areaList.includes('dash');
      const hasExteriorSet = labelsList.filter((l: string) => l === 'exterior').length;
      const hasSpeedo = labelsList.includes('speedometer') || areaList.includes('dash');
      const hasEngineImgs = areaList.includes('engine_bay');

      const byField: Record<string, any> = {};
      (sources || []).forEach((s: any) => { byField[s.field_name] = s; });

      const upserts: any[] = [];
      for (const fieldName of fields) {
        const entry = byField[fieldName];
        const userProvided = !!entry?.user_id || entry?.source_type === 'human_input';
        const valuePresent = !!entry?.field_value;
        let score = 0; const met: string[] = []; const next: string[] = [];
        const boost = (pts: number, why: string) => { score += pts; met.push(why); };
        const want = (why: string) => { next.push(why); };

        switch (fieldName) {
          case 'make':
          case 'model':
          case 'year':
          case 'vin': {
            if (userProvided) boost(90, 'Provided by signed-in user'); else if (valuePresent) boost(70, 'Provided');
            if (hasTitle || hasVinImg) boost(10, 'Paperwork/VIN image evidence'); else want('Add title or VIN/frame-stamp image');
            break;
          }
          case 'color': {
            if (valuePresent) boost(40, 'Color provided'); else want('Provide color');
            const extScore = Math.min(60, hasExteriorSet * 8);
            if (extScore > 0) boost(extScore, `Exterior coverage (${hasExteriorSet} angles)`); else want('Add exterior images from multiple angles');
            break;
          }
          case 'mileage': {
            if (valuePresent) boost(50, 'Mileage provided'); else want('Enter mileage');
            if (hasSpeedo) boost(50, 'Speedometer image evidence'); else want('Add speedometer photo');
            break;
          }
          case 'engine': {
            if (valuePresent) boost(50, 'Engine info provided'); else want('Enter engine details');
            if (hasEngineImgs) boost(50, 'Engine bay images'); else want('Add engine bay photos');
            break;
          }
          case 'body_style':
          case 'doors':
          case 'seats': {
            if (valuePresent) boost(100, 'Field complete'); else want('Fill this field');
            break;
          }
          case 'transmission': {
            if (valuePresent) boost(80, 'Provided'); else want('Provide transmission');
            break;
          }
          default: {
            if (valuePresent) boost(60, 'Provided'); else want('Provide this data');
          }
        }
        score = Math.max(0, Math.min(100, score));
        if (valuePresent) {
          upserts.push({
            vehicle_id: vehId,
            field_name: fieldName,
            field_value: entry?.field_value || '',
            source_type: entry?.source_type || 'computed',
            confidence_score: score,
            criteria: { met, next },
            updated_at: new Date().toISOString()
          });
        }
      }

      if (upserts.length > 0) {
        await supabase.from('vehicle_field_sources').upsert(upserts, { onConflict: 'vehicle_id,field_name' });
      }
    } catch (e) {
      console.warn('recomputeScoresForVehicle failed:', e);
    }
  };

  const loadUserProfile = async () => {
    try {
      if (!session?.user?.id) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, email, phone, address, city, state, zip')
        .eq('id', session.user.id)
        .maybeSingle();
      if (error) {
        console.warn('Unable to load user profile:', error.message);
        return;
      }
      if (data) {
        setUserProfile({
          id: data.id,
          full_name: data.full_name || data.username || session.user.email || 'Unknown User',
          email: session.user.email || data.email || '',
          phone: data.phone,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip
        });
      }
    } catch (err) {
      console.warn('Error loading user profile:', err);
    }
  };

  const loadResponsible = async () => {
    try {
      if (!vehicle?.uploaded_by) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('username, full_name')
        .eq('id', vehicle.uploaded_by)
        .maybeSingle();
      if (error) {
        console.warn('Unable to load responsible profile:', error.message);
        return;
      }
      if (data) {
        const display = data.full_name || data.username || null;
        setResponsibleName(display);
      }
    } catch (err) {
      console.warn('Error loading responsible profile:', err);
    }
  };

  const loadRecentComments = async () => {
    try {
      if (!vehicle?.id) return;
      // Count comments in the last 10 minutes for this vehicle
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from('vehicle_comments')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id)
        .gte('created_at', tenMinutesAgo);
      if (error) {
        console.warn('Unable to load recent comment count:', error.message);
        return;
      }
      setRecentCommentCount(count || 0);
    } catch (err) {
      console.warn('Error loading recent comment count:', err);
    }
  };

  const loadPresenceCount = async () => {
    try {
      if (!vehicle?.id) return;
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from('user_presence')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id)
        .gte('last_seen_at', fiveMinAgo);

      if (!error) {
        setPresenceCount(count || 0);
      } else {
        // Silently default to 0 if table doesn't exist
        setPresenceCount(0);
      }
    } catch {
      // Silently default to 0
      setPresenceCount(0);
    }
  };

  const loadOwnershipVerifications = async () => {
    try {
      if (!vehicle?.id) return;
      const { data, error } = await supabase
        .from('ownership_verifications')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Unable to load ownership verifications:', error.message);
        return;
      }
      setOwnershipVerifications(data || []);
    } catch (err) {
      console.warn('Error loading ownership verifications:', err);
    }
  };

  // Heartbeat: upsert current user presence
  useEffect(() => {
    let t: any;
    const beat = async () => {
      try {
        if (!vehicle?.id) return;
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id || null;
        // Presence tracking - silently ignore all errors as table may not exist
        const { error } = await supabase
          .from('user_presence')
          .upsert({ vehicle_id: vehicle.id, user_id: uid, last_seen_at: new Date().toISOString() }, { onConflict: 'vehicle_id,user_id' });
        // Intentionally ignore error - presence is non-critical
      } catch {
        // Silently ignore all presence tracking failures
      }
    };
    if (vehicle) {
      beat();
      t = setInterval(beat, 60 * 1000);
      return () => clearInterval(t);
    }
  }, [vehicle]);

  const loadLiveSession = async () => {
    try {
      if (!vehicle?.id) return;
      const { data, error } = await supabase
        .from('live_streaming_sessions')
        .select('id, platform, stream_url, title, ended_at')
        .eq('vehicle_id', vehicle.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Disable further polling if table is missing or endpoint 404s
        liveAvailableRef.current = false;
        return;
      }
      if (data) setLiveSession({ id: data.id, platform: data.platform, stream_url: data.stream_url, title: data.title });
      else setLiveSession(null);
    } catch (err) {
      liveAvailableRef.current = false;
    }
  };

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
  };

  const checkContributorStatus = async () => {
    if (!vehicle?.id || !session?.user?.id) return;

    try {
      // Check if user is a contributor (roles table)
      const { data, error } = await supabase
        .from('vehicle_contributor_roles')
        .select('role')
        .eq('vehicle_id', vehicle.id)
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error) {
        console.debug('Contributors table may not exist yet:', error);
        return;
      }

      if (data) {
        setContributorRole(data.role);
        setHasContributorAccess(true);
        // Give contributors with certain roles owner-like access
        if (data.role === 'owner' || data.role === 'restorer' || data.role === 'previous_owner') {
          console.log('Contributor has elevated access:', data.role);
        }
      }
    } catch (error) {
      console.debug('Error checking contributor status:', error);
    }
  };

  const loadTimelineEvents = async () => {
    if (!vehicleId) return;
    try {
      const [vte, legacy] = await Promise.all([
        supabase
          .from('vehicle_timeline_events')
          .select('*')
          .eq('vehicle_id', vehicleId),
        supabase
          .from('vehicle_timeline_events')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .limit(200)
      ]);

      const a = (vte.data || []).map((e: any) => ({ ...e, __table: 'vehicle_timeline_events' }));
      const b = (legacy.data || []).map((e: any) => ({ ...e, __table: 'timeline_events' }));
      let merged = [...a, ...b]
        .sort((x: any, y: any) => new Date(y.event_date).getTime() - new Date(x.event_date).getTime());

      // If no events in DB yet, derive photo events from vehicle_images so timeline isn't empty
      if (merged.length === 0) {
        const { data: imgs, error: imgErr } = await supabase
          .from('vehicle_images')
          .select('id, image_url, exif_data, created_at')
          .eq('vehicle_id', vehicleId)
          .limit(500);
        if (!imgErr && imgs && imgs.length > 0) {
          const derived = imgs.map((r: any) => {
            const dt = r?.exif_data?.dateTaken ? new Date(r.exif_data.dateTaken) : new Date(r.created_at);
            const dateOnly = isNaN(dt.getTime()) ? new Date().toISOString().split('T')[0] : dt.toISOString().split('T')[0];
            return {
              id: `derived-${r.id}`,
              vehicle_id: vehicleId,
              event_type: 'photo_added',
              source: 'derived_from_images',
              event_date: dateOnly,
              title: 'Photo Added',
              description: 'Derived from uploaded photo',
              image_urls: [r.image_url],
              metadata: { derived: true, image_id: r.id, exif: r.exif_data },
              __table: 'derived'
            };
          }).sort((x: any, y: any) => new Date(y.event_date).getTime() - new Date(x.event_date).getTime());
          merged = derived;
        }
      }

      setTimelineEvents(merged);
    } catch (error) {
      console.error('Error loading timeline events:', error);
    }
  };

  const handleDateClick = (date: string, events: any[]) => {
    setSelectedDate(date);
    setSelectedDateEvents(events);
    setShowEventModal(true);
  };

  const loadVehicle = async () => {
    try {
      setLoading(true);
      console.log('Loading vehicle with ID:', vehicleId);

      // Skip localStorage check - no hardcoded vehicles allowed
      console.log('Skipping localStorage check to prevent hardcoded vehicles');

      // Load from database with valid UUID
      console.log('Attempting to load vehicle from database');

      // Accept both UUID format (with hyphens) and VIN format (17 chars alphanumeric)
      const isUUID = vehicleId && vehicleId.length >= 20 && vehicleId.includes('-');
      const isVIN = vehicleId && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vehicleId);

      if (!vehicleId || (!isUUID && !isVIN)) {
        console.log('Invalid vehicle ID format:', vehicleId);
        navigate('/vehicles');
        return;
      }

      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (error || !data) {
        console.error('Vehicle not found or access denied:', error);
        setVehicle(null);
        setLoading(false);
        return;
      }

      // For non-authenticated users, only show public vehicles
      if (!session && !data.is_public) {
        console.log('Vehicle is private, redirecting non-authenticated user');
        navigate('/login');
        return;
      }

      // Preserve local API by mirroring DB snake_case to camel
      const vehicleData = { ...data, isPublic: (data as any).is_public ?? data.isPublic };
      console.log('Setting vehicle data:', vehicleData);
      setVehicle(vehicleData);
      setIsPublic(((data as any).is_public ?? data.isPublic) ?? true);
      console.log('Vehicle state set successfully');
    } catch (error) {
      console.error('Error loading vehicle:', error);
      navigate('/vehicles');
    } finally {
      setLoading(false);
    }
  };

  const updatePrivacy = async () => {
    if (!vehicle || vehicle.isAnonymous) return;

    try {
      const oldVehicle = { ...vehicle };
      const { error } = await supabase
        .from('vehicles')
        .update({ is_public: isPublic })
        .eq('id', vehicle.id);

      if (error) {
        console.error('Error updating vehicle visibility:', error);
        return;
      }

      // Create timeline event for visibility change
      await TimelineEventService.createVehicleEditEvent(
        vehicle.id,
        oldVehicle,
        { ...vehicle, is_public: isPublic, isPublic },
        vehicle.uploaded_by || undefined,
        {
          reason: `Vehicle visibility changed to ${isPublic ? 'public' : 'private'}`,
          source: 'manual_edit'
        }
      );
    } catch (error) {
      console.error('Error updating privacy:', error);
    }
  };

  const recordView = async () => {
    if (!vehicleId) return;

    try {
      // Record view in vehicle_views table
      const { error } = await supabase
        .from('vehicle_views')
        .insert({
          vehicle_id: vehicleId,
          user_id: session?.user?.id || null,
          viewed_at: new Date().toISOString(),
          ip_address: null // Could be added later
        });

      if (!error) {
        // Update vehicle view_count
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            view_count: (vehicle?.view_count || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', vehicleId);

        if (!updateError) {
          setViewCount(prev => prev + 1);
        }
      }
    } catch (error) {
      console.debug('Error recording view:', error);
    }
  };

  const loadViewCount = async () => {
    if (!vehicleId) return;

    try {
      const { count, error } = await supabase
        .from('vehicle_views')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);

      if (!error && count !== null) {
        setViewCount(count);
      } else {
        // Fallback to vehicle.view_count if table doesn't exist
        setViewCount(vehicle?.view_count || 0);
      }
    } catch (error) {
      console.debug('Error loading view count:', error);
      setViewCount(vehicle?.view_count || 0);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const handleDataPointClick = (event: React.MouseEvent, dataType: string, dataValue: string, label: string) => {
    event.preventDefault();
    openFieldAudit(dataType, label);
  };

  const openFieldAudit = async (fieldName: string, fieldLabel: string) => {
    try {
      if (!vehicle?.id) return;
      // Attempt to load field history from vehicle_field_sources
      const { data, error } = await supabase
        .from('vehicle_field_sources')
        .select('field_value, source_type, user_id, is_verified, updated_at')
        .eq('vehicle_id', vehicle.id)
        .eq('field_name', fieldName)
        .order('updated_at', { ascending: false });

      if (error) {
        console.warn('Field audit unavailable:', error.message);
        setFieldAudit({ open: true, fieldName, fieldLabel, entries: [], score: undefined, met: [], next: [] });
        return;
      }

      // Compute score based on entries and evidence images
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('area, labels, sensitive_type')
        .eq('vehicle_id', vehicle.id);

      const labelsList = (imgs || []).flatMap((r: any) => Array.isArray(r.labels) ? r.labels : []);
      const areaList = (imgs || []).map((r: any) => r.area).filter(Boolean);
      const hasTitle = (imgs || []).some((r: any) => r.sensitive_type === 'title' || (Array.isArray(r.labels) && r.labels.includes('paperwork')));
      const hasVinImg = labelsList.includes('vin') || areaList.includes('dash');
      const hasExteriorSet = labelsList.filter((l: string) => l === 'exterior').length;
      const hasSpeedo = labelsList.includes('speedometer') || areaList.includes('dash');
      const hasEngineImgs = areaList.includes('engine_bay');

      const userProvided = (data || []).some((e: any) => e.source_type === 'user_input' && !!e.user_id);
      const valuePresent = (data || []).length > 0;

      let score = 0; const met: string[] = []; const next: string[] = [];
      const boost = (pts: number, why: string) => { score += pts; met.push(why); };
      const want = (why: string) => { next.push(why); };

      switch (fieldName) {
        case 'make':
        case 'model':
        case 'year':
        case 'vin': {
          if (userProvided) boost(90, 'Provided by signed-in user'); else if (valuePresent) boost(70, 'Provided');
          if (hasTitle || hasVinImg) boost(10, 'Paperwork/VIN image evidence'); else want('Add title or VIN/frame-stamp image');
          break;
        }
        case 'color': {
          if (valuePresent) boost(40, 'Color provided'); else want('Provide color');
          const extCount = hasExteriorSet;
          const extScore = Math.min(60, extCount * 8);
          if (extScore > 0) boost(extScore, `Exterior coverage (${extCount} angles)`); else want('Add exterior images from multiple angles');
          break;
        }
        case 'mileage': {
          if (valuePresent) boost(50, 'Mileage provided'); else want('Enter mileage');
          if (hasSpeedo) boost(50, 'Speedometer image evidence'); else want('Add speedometer photo');
          break;
        }
        case 'engine': {
          if (valuePresent) boost(50, 'Engine info provided'); else want('Enter engine details');
          if (hasEngineImgs) boost(50, 'Engine bay images'); else want('Add engine bay photos');
          break;
        }
        case 'body_style':
        case 'doors':
        case 'seats': {
          if (valuePresent) boost(100, 'Field complete'); else want('Fill this field');
          break;
        }
        default: {
          if (valuePresent) boost(60, 'Provided'); else want('Provide this data');
        }
      }
      score = Math.max(0, Math.min(100, score));

      setFieldAudit({ open: true, fieldName, fieldLabel, entries: data || [], score, met, next });

      // Persist score and criteria back to vehicle_field_sources (best-effort)
      try {
        const latestVal = (data && data[0]?.field_value) || '';
        const payload: any = {
          vehicle_id: vehicle.id,
          field_name: fieldName,
          field_value: latestVal,
          source_type: (data && data[0]?.source_type) || 'computed',
          confidence_score: score,
          criteria: { met, next }
        };
        // Prefer upsert if unique constraint on (vehicle_id, field_name), else fallback to insert
        const { error: upErr } = await supabase.from('vehicle_field_sources').upsert(payload, { onConflict: 'vehicle_id,field_name' });
        if (upErr && upErr.code === '42710') {
          // constraint issue; fallback: update last row
          await supabase
            .from('vehicle_field_sources')
            .update({ confidence_score: score, criteria: { met, next } })
            .eq('vehicle_id', vehicle.id)
            .eq('field_name', fieldName);
        }
      } catch (persistErr) {
        console.warn('Score persistence skipped:', persistErr);
      }
    } catch (err) {
      console.warn('Error loading field audit:', err);
      setFieldAudit({ open: true, fieldName, fieldLabel, entries: [], score: undefined, met: [], next: [] });
    }
  };

  const formatNumber = (num: number | null) => {
    return num ? num.toLocaleString() : 'Not specified';
  };

  const handleImportComplete = (results: any) => {
    console.log('Vehicle import complete:', results);

    // Reload images from localStorage immediately after upload
    if (vehicle) {
      loadVehicleImages();
    }
  };

  const handleEditClick = () => {
    // Refresh vehicle data
    loadVehicle();
  };

  const handlePriceClick = () => {
    // Scroll to the price section
    const priceSection = document.getElementById('price-section');
    if (priceSection) {
      priceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const loadVehicleImages = async () => {
    if (!vehicle) return;

    let images: string[] = [];

    // Load images from database first
    try {
      const { data: imageRecords, error } = await supabase
        .from('vehicle_images')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('❌ Error loading vehicle images from database:', error);
      } else if (imageRecords && imageRecords.length > 0) {
        // PERFORMANCE FIX: Load lead image immediately, don't wait for all signed URLs
        const leadImage = imageRecords.find((r: any) => r.is_primary === true) || imageRecords[0];

        // Set lead image URL immediately using public URL (fast)
        if (leadImage) {
          setLeadImageUrl(leadImage.image_url);

          // Signed URL upgrade disabled due to storage configuration issues
          // Would generate 400 errors - using direct public URL instead
        }

        // Auto-set primary if none exists
        if (!imageRecords.find((r: any) => r.is_primary === true) && imageRecords[0]) {
          await supabase
            .from('vehicle_images')
            .update({ is_primary: true })
            .eq('id', imageRecords[0].id);
        }

        // Load all images using public URLs (fast)
        images = imageRecords.map((r: any) => r.image_url);
        setVehicleImages(images);

        // Signed URL generation disabled due to storage configuration issues
        // Would generate 400 errors: createSignedUrl calls failing
        // Using direct public URLs instead which work fine
      } else {
        // No DB rows: attempt storage fallback (canonical + legacy) to avoid empty hero/gallery
        try {
          const bucketCanonical = supabase.storage.from('vehicle-data');
          const bucketLegacy = supabase.storage.from('vehicle-images');
          const gathered: string[] = [];

          const listPath = async (bucketRef: ReturnType<typeof supabase.storage.from>, path: string) => {
            const { data: files, error: listErr } = await bucketRef.list(path, { limit: 1000 });
            if (listErr || !files) return;
            for (const f of files) {
              if (f.name && !f.name.endsWith('/')) {
                const full = path ? `${path}/${f.name}` : f.name;
                // Use public URLs for both buckets to avoid 400 errors
                const { data: pub } = bucketRef.getPublicUrl(full);
                if (pub?.publicUrl) gathered.push(pub.publicUrl);
              }
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

          images = Array.from(new Set(gathered));
          if (images.length > 0 && !leadImageUrl) setLeadImageUrl(images[0]);
        } catch (e) {
          console.warn('Storage fallback for hero/gallery failed:', e);
        }
      }
    } catch (error) {
      console.error('Error querying vehicle images:', error);
    }

    // Also include primary image if available
    if (vehicle.primaryImageUrl && !images.includes(vehicle.primaryImageUrl)) {
      images = [vehicle.primaryImageUrl, ...images];
      // Fallback for lead image
      if (!leadImageUrl) setLeadImageUrl(vehicle.primaryImageUrl);
    }

    setVehicleImages(images);

    if (images.length === 0) {
      console.log('No images found for vehicle:', vehicle.id);
    } else {
      console.log('Loaded images for vehicle:', images);
    }
  };

  if (loading) {
    return (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading vehicle...</p>
        </div>
    );
  }

  if (!vehicle) {
    console.log('Rendering Vehicle Not Found - vehicle state is null, loading:', loading);
    return (
        <div className="card">
          <div className="card-body text-center">
            <h2 className="text font-bold" style={{ marginBottom: '12px' }}>Vehicle Not Found</h2>
            <p className="text-small text-muted" style={{ marginBottom: '16px' }}>
              The requested vehicle could not be found.
            </p>
            <button
              className="button button-primary"
              onClick={() => navigate('/vehicles')}
            >
              View All Vehicles
            </button>
          </div>
        </div>
    );
  }
  
  console.log('Rendering vehicle profile with vehicle:', vehicle.id);

  // Debug ownership check (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.debug('Permissions:', {
      isVerifiedOwner,
      hasContributorAccess,
      contributorRole,
      canCreateAgreements: contributorRole === 'consigner' || isVerifiedOwner
    });
  }

  // Use mobile version if on mobile device (but AFTER all hooks have run)
  if (isMobile && vehicleId) {
    return <MobileVehicleProfile vehicleId={vehicleId} isMobile={isMobile} />;
  }

  return (
    <>
      <div>
        {/* Vehicle Header with Price */}
        <VehicleHeader
          vehicle={vehicle}
          session={session}
          permissions={permissions}
          responsibleName={responsibleName}
          onPriceClick={handlePriceClick}
        />

        {/* Live Stats Bar */}
        <VehicleStats
          viewCount={viewCount}
          presenceCount={presenceCount}
          recentCommentCount={recentCommentCount}
          liveSession={liveSession && liveSession.stream_url ? {
            id: liveSession.id,
            platform: liveSession.platform,
            stream_url: liveSession.stream_url,
            title: liveSession.title || ''
          } : null}
          totalImages={vehicleImages.length}
          totalEvents={timelineEvents.length}
        />

        {/* Hero Image Section */}
        <VehicleHeroImage leadImageUrl={leadImageUrl} />

        {/* Vehicle Timeline Section */}
        <VehicleTimelineSection
          vehicle={vehicle}
          session={session}
          permissions={permissions}
          onAddEventClick={() => setShowAddEvent(true)}
        />

        {/* Image Upload Section removed - unified under EnhancedImageViewer */}

        {/* Map Section (no header; toggle is in gallery toolbar) */}
        <section className="section">
          {showMap && (
            <EventMap vehicleId={vehicle.id} />
          )}
        </section>

        {/* AI Pricing Intelligence Section */}
        <VehiclePricingSection
          vehicle={vehicle}
          permissions={permissions}
        />

        {/* Data Sources moved to VehiclePricingWidget */}


        {/* Main Content Grid: Left Column (data) + Right Column (image gallery) */}
        <section className="section">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
            {/* Left Column: All vehicle data and details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

              {/* Basic Vehicle Information */}
              <VehicleBasicInfo
                vehicle={vehicle}
                session={session}
                permissions={permissions}
                onDataPointClick={handleDataPointClick}
                onEditClick={handleEditClick}
              />

              {/* Ownership Panel */}
              {/* (Ownership verification is already embedded in VehicleBasicInfo) */}

              {/* Memories Section - Owner/Moderator/Consigner Access Only */}
              {(isVerifiedOwner || hasContributorAccess) && (
                <WorkMemorySection
                  vehicleId={vehicle.id}
                  permissions={permissions}
                />
              )}

              {/* Documents Section — Verified owner, DB uploader, or permitted contributor roles */}
              {(isVerifiedOwner || isDbUploader || (hasContributorAccess && ['owner','moderator','consigner','co_owner','restorer','previous_owner'].includes(contributorRole || ''))) && (
                <div className="card">
                  <div className="card-header">Documents</div>
                  <div className="card-body">
                    <VehicleDocumentManager
                      vehicleId={vehicle.id}
                      isOwner={Boolean(isVerifiedOwner || isDbUploader || (hasContributorAccess && ['owner','moderator','consigner','co_owner','restorer','previous_owner'].includes(contributorRole || '')))}
                      hasContributorAccess={Boolean(hasContributorAccess && ['owner','moderator','consigner','co_owner','restorer','previous_owner'].includes(contributorRole || ''))}
                    />
                  </div>
                </div>
              )}

              {/* Receipt Manager — Verified owner, DB uploader, or permitted contributor roles */}
              {(isVerifiedOwner || isDbUploader || (hasContributorAccess && ['owner','moderator','consigner','co_owner','restorer','previous_owner'].includes(contributorRole || ''))) && (
                <ReceiptManager
                  vehicleId={vehicle.id}
                  canEdit={Boolean(isVerifiedOwner || isDbUploader || (hasContributorAccess && ['owner','moderator','consigner','co_owner','restorer'].includes(contributorRole || '')))}
                />
              )}

              {/* Enhanced Photo Tagging System */}
              {(isRowOwner || isVerifiedOwner || (hasContributorAccess && ['owner','moderator','consigner','co_owner','restorer'].includes(contributorRole || ''))) && vehicle.hero_image && (
                <div id="image-tagging" className="card">
                  <div className="card-header">🏷️ Image Tagging & AI Validation</div>
                  <div className="card-body">
                    <p className="text-small text-muted" style={{ marginBottom: '16px' }}>
                      Tag vehicle components, damage, or features. AI tags show as 🤖 (validate them), manual tags as 👤.
                      Click and drag to create bounding boxes or click to place point tags.
                    </p>
                    <EnhancedImageTagger
                      imageUrl={vehicle.hero_image}
                      vehicleId={vehicle.id}
                      onTagAdded={(tag) => {
                        console.log('Tag added:', tag);
                        // Reload the tag explorer to show updated data
                        window.dispatchEvent(new CustomEvent('tags_updated', { detail: { vehicleId: vehicle.id } }));
                      }}
                      onTagValidated={(tagId, action) => {
                        console.log('Tag validated:', tagId, action);
                        // Reload the tag explorer to show validation changes
                        window.dispatchEvent(new CustomEvent('tags_updated', { detail: { vehicleId: vehicle.id } }));
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Consigner Management Section — For Owners Only */}
              {(isRowOwner || isVerifiedOwner) && (
                <ConsignerManagement
                  vehicleId={vehicle.id}
                  isOwner={true}
                  onConsignerUpdated={() => {
                    checkContributorStatus();
                  }}
                />
              )}

              {/* Purchase Agreement Section — For Consigners and Owners */}
              {userProfile && (contributorRole === 'consigner' || isRowOwner || isVerifiedOwner || (hasContributorAccess && ['owner','moderator'].includes(contributorRole || ''))) && (
                <div className="card">
                  <div className="card-header">Purchase Agreements</div>
                  <div className="card-body">
                    <PurchaseAgreementManager
                      vehicle={vehicle as any}
                      userProfile={userProfile}
                      canCreateAgreement={Boolean(contributorRole === 'consigner' || isRowOwner || isVerifiedOwner)}
                    />
                  </div>
                </div>
              )}

              {/* Consigner Access Request — Only for vehicles accepting consignments */}
              {session?.user?.id && !contributorRole && !isRowOwner && !isVerifiedOwner &&
               (vehicle.for_sale || vehicle.accepting_consignments) && (
                <div className="card">
                  <div className="card-header">Request Consigner Access</div>
                  <div className="card-body">
                    <p className="text-small text-muted" style={{ marginBottom: '16px' }}>
                      This vehicle owner is accepting consignment requests. Consigner access allows you to create purchase agreements and manage sales.
                    </p>
                    <button
                      className="button button-secondary"
                      onClick={() => {
                        // This should send a request to the owner instead of auto-granting
                        alert('Consignment request feature coming soon. Contact the owner directly for now.');
                      }}
                    >
                      Request Consigner Access
                    </button>
                  </div>
                </div>
              )}

              {/* AI Tag Data Explorer Section */}
              <VehicleTagExplorer vehicleId={vehicle.id} />

              {/* Comments Section */}
              <VehicleCommentsSection
                ref={commentsSectionRef}
                vehicleId={vehicle.id}
              />
            </div>

            {/* Right Column: Image Gallery */}
            <div>
              <VehicleImageGallery
                vehicle={vehicle}
                session={session}
                permissions={permissions}
                showMap={showMap}
                onToggleMap={() => setShowMap(s => !s)}
                onImageUpdate={() => {
                  loadVehicleImages();
                  handleImportComplete(null);
                }}
              />
            </div>
          </div>
        </section>

        {/* Vehicle Metadata & Sale Settings */}
        <section className="section">
          <VehicleSaleSettings
            vehicle={vehicle}
            session={session}
            permissions={permissions}
            saleSettings={saleSettings}
            savingSale={savingSale}
            viewCount={viewCount}
            onSaleSettingsChange={setSaleSettings}
            onSaveSaleSettings={saveSaleSettings}
            onShowCompose={() => setShowCompose(true)}
          />

          {/* Trading Interface */}
          {vehicle && (
            <VehicleProfileTrading vehicleId={vehicle.id} />
          )}

          {/* Privacy Settings for non-anonymous vehicles */}
          {!vehicle.isAnonymous && session && (
            <div className="card mt-4">
              <div className="card-header">Privacy Settings</div>
              <div className="card-body">
                <div className="vehicle-detail">
                  <span>Visibility</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge ${isPublic ? 'badge-success' : 'badge-secondary'}`}>
                      {isPublic ? 'Public' : 'Private'}
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isPublic}
                        onChange={(e) => {
                          setIsPublic(e.target.checked);
                          updatePrivacy();
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Field Audit Modal */}
        {fieldAudit.open && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-header">
                <h3 className="modal-title">{fieldAudit.fieldLabel} — Data History</h3>
                <button
                  onClick={() => setFieldAudit(prev => ({ ...prev, open: false }))}
                  className="modal-close"
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                {typeof fieldAudit.score === 'number' && (
                  <div className="mb-3">
                    <div className="text-sm"><strong>Score:</strong> {fieldAudit.score}/100</div>
                    {fieldAudit.met && fieldAudit.met.length > 0 && (
                      <div className="text-xs text-gray-600 mt-1">
                        <strong>Met:</strong> {fieldAudit.met.join(', ')}
                      </div>
                    )}
                    {fieldAudit.next && fieldAudit.next.length > 0 && (
                      <div className="text-xs text-gray-600 mt-1">
                        <strong>To reach 100:</strong> {fieldAudit.next.join('; ')}
                      </div>
                    )}
                  </div>
                )}
                {fieldAudit.entries.length === 0 ? (
                  <p className="text-muted">No provenance recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {fieldAudit.entries.map((e, idx) => (
                      <div key={idx} className="border rounded p-2 flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">{e.field_value}</div>
                          <div className="text-xs text-gray-500">
                            {new Date(e.updated_at).toLocaleString()} • {e.source_type || 'unknown source'}
                            {e.is_verified ? ' • verified' : ''}
                          </div>
                        </div>
                        {e.user_id && (
                          <span className="text-xs text-gray-400">by {e.user_id.slice(0,8)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  onClick={() => setFieldAudit(prev => ({ ...prev, open: false }))}
                  className="button button-primary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Event Modal */}
        {showEventModal && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-header">
                <h3 className="modal-title">
                  Events for {selectedDate && new Date(selectedDate).toLocaleDateString()}
                </h3>
                <button
                  onClick={() => setShowEventModal(false)}
                  className="modal-close"
                >
                  ×
                </button>
              </div>

              <div className="modal-body">
                {selectedDateEvents.length > 0 ? (
                  <div className="event-list">
                    {selectedDateEvents.map((event, index) => (
                      <div key={event.id || index} className="event-item">
                        <h4 className="event-title">{event.title}</h4>
                        <p className="event-type">{event.event_type}</p>
                        {event.description && (
                          <p className="event-description">{event.description}</p>
                        )}
                        <p className="event-timestamp">
                          {new Date(event.event_date).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted">No events found for this date.</p>
                )}
              </div>

              <div className="modal-footer">
                <button
                  onClick={() => setShowEventModal(false)}
                  className="button button-primary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Event Wizard Modal */}
      {showAddEvent && (
        <AddEventWizard
          vehicleId={vehicle.id}
          onClose={() => {
            setShowAddEvent(false);
            window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
              detail: { vehicleId: vehicle.id }
            }));
          }}
          onEventAdded={() => {
            setShowAddEvent(false);
            window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
              detail: { vehicleId: vehicle.id }
            }));
          }}
          currentUser={session?.user || null}
        />
      )}

      {/* Data Editor Modal */}
      {showDataEditor && (
        <VehicleDataEditor
          vehicleId={vehicle?.id || ''}
          onClose={() => {
            setShowDataEditor(false);
            // Reload vehicle data after editing
            loadVehicle();
          }}
        />
      )}
    </>
  );
};

export default VehicleProfile;