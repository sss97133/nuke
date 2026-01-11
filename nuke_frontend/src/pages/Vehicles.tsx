import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
// AppLayout now provided globally by App.tsx
import GarageVehicleCard from '../components/vehicles/GarageVehicleCard';
import VehicleRelationshipManager from '../components/VehicleRelationshipManager';
import OrganizationContextFilter from '../components/vehicles/OrganizationContextFilter';
import BulkActionsToolbar from '../components/vehicles/BulkActionsToolbar';
import VehicleOrganizationToolbar from '../components/vehicles/VehicleOrganizationToolbar';
import VehicleConfirmationQuestions from '../components/vehicles/VehicleConfirmationQuestions';
import TitleTransferApproval from '../components/ownership/TitleTransferApproval';
import { MyOrganizationsService, type MyOrganization } from '../services/myOrganizationsService';
import { usePageTitle } from '../hooks/usePageTitle';
import '../design-system.css';

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  color: string | null;
  mileage: number | null;
  primaryImageUrl: string | null;
  isAnonymous: boolean;
  created_at: string;
}

interface VehicleRelationship {
  vehicle: Vehicle;
  relationshipType: 'owned' | 'contributing' | 'interested' | 'discovered' | 'curated' | 'consigned' | 'previously_owned';
  role?: string;
  context?: string;
  lastActivity?: string;
}

// Simple error boundary for debugging
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Vehicles page error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong in Vehicles page.</div>;
    }
    return this.props.children;
  }
}

type VehiclesTab =
  | 'associated'
  | 'owned'
  | 'contributing'
  | 'interested'
  | 'discovered'
  | 'curated'
  | 'consigned'
  | 'previously_owned';

const VehiclesInner: React.FC = () => {
  usePageTitle('Vehicles');
  
  const [vehicleRelationships, setVehicleRelationships] = useState<{
    owned: VehicleRelationship[];
    contributing: VehicleRelationship[];
    interested: VehicleRelationship[];
    discovered: VehicleRelationship[];
    curated: VehicleRelationship[];
    consigned: VehicleRelationship[];
    previously_owned: VehicleRelationship[];
  }>({ owned: [], contributing: [], interested: [], discovered: [], curated: [], consigned: [], previously_owned: [] });
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  // Default to "Owned" so users land on "their stuff" first.
  // If they have no owned vehicles, we'll fall back to "All" after loading.
  const [activeTab, setActiveTab] = useState<VehiclesTab>('owned');
  const [relationshipModal, setRelationshipModal] = useState<{
    vehicleId: string;
    currentRelationship: string | null;
  } | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<string>>(new Set());
  const [preferenceFilter, setPreferenceFilter] = useState<'all' | 'favorites' | 'hidden' | 'collection'>('all');
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [discoverySourceFilter, setDiscoverySourceFilter] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState(50); // Initial display limit for pagination
  const [vehiclePreferences, setVehiclePreferences] = useState<Map<string, {
    is_favorite: boolean;
    is_hidden: boolean;
    collection_name: string | null;
  }>>(new Map());
  const [newCollectionName, setNewCollectionName] = useState('');
  const [myOrganizations, setMyOrganizations] = useState<MyOrganization[]>([]);
  const [orgDropRelationshipType, setOrgDropRelationshipType] = useState<'work_location' | 'service_provider' | 'storage' | 'consigner' | 'sold_by' | 'owner'>('work_location');
  // Default collapsed: users shouldn't have to constantly manage sidebar real estate.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem('vehicles.sidebarCollapsed');
      if (v === null) return true;
      return v === 'true';
    } catch {
      return true;
    }
  });
  
  // Sidebar width - default 280px, stored in localStorage
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('vehicles.sidebarWidth');
      if (saved) {
        const width = parseInt(saved, 10);
        if (width >= 200 && width <= 600) return width;
      }
    } catch {
      // ignore
    }
    return 280;
  });
  
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarSections, setSidebarSections] = useState<{
    selection: boolean;
    inbox: boolean;
    context: boolean;
    library: boolean;
    relationships: boolean;
    sources: boolean;
    vehicles: boolean;
  }>({
    selection: true,
    inbox: true,
    // Organizations selector should be available but not constantly expanded by default.
    context: false,
    library: true,
    relationships: true,
    sources: true,
    vehicles: true
  });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlSearchQuery = searchParams.get('search') || '';

  useEffect(() => {
    checkAuth();
    
    // URL params for tab selection removed - categorize tab no longer exists
    
    // Handle search query from URL
    if (urlSearchQuery) {
      setSearchTerm(urlSearchQuery);
    }
    
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event, session?.user?.id);
        setSession(session);
        loadVehicleRelationships(); // Reload vehicle relationships when auth state changes
      }
    );

    return () => subscription.unsubscribe();
  }, [searchParams, urlSearchQuery]);

  useEffect(() => {
    try {
      localStorage.setItem('vehicles.sidebarCollapsed', String(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem('vehicles.sidebarWidth', String(sidebarWidth));
    } catch {
      // ignore
    }
  }, [sidebarWidth]);

  // Handle sidebar resize
  useEffect(() => {
    if (!isResizing) return;

    const sidebarElement = document.querySelector('.vehicle-library-sidebar') as HTMLElement;
    if (!sidebarElement) return;

    const startX = sidebarElement.getBoundingClientRect().left;
    const startWidth = sidebarWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, sidebarWidth]);

  useEffect(() => {
    loadVehicleRelationships();
    if (session?.user?.id) {
      loadVehiclePreferences();
    }
    // Reset pagination when filters change
    setDisplayLimit(50);
  }, [session, selectedOrganizationId, activeTab, preferenceFilter, collectionFilter, discoverySourceFilter]); // Reload vehicle relationships when session or organization changes

  useEffect(() => {
    if (!session?.user?.id) return;
    (async () => {
      const orgs = await MyOrganizationsService.getMyOrganizations({ status: 'active', sortBy: 'name' });
      setMyOrganizations(orgs || []);
    })();
  }, [session?.user?.id]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    console.log('Initial session check:', session?.user?.id);
    setSession(session);
  };

  const loadVehicleRelationships = async () => {
    if (!session?.user?.id) {
      console.log('No session, skipping vehicle load');
      setLoading(false);
      return;
    }

    try {
      console.log('Loading vehicle relationships for user:', session.user.id);
      
      // Use optimized RPC function for single-query performance
      // Falls back to separate queries if RPC doesn't exist
      console.log('[Vehicles] Attempting to call RPC function: get_user_vehicle_relationships');
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('get_user_vehicle_relationships', { p_user_id: session.user.id });
      
      if (rpcError) {
        console.error('[Vehicles] ❌ RPC function error:', rpcError);
        console.error('[Vehicles] RPC error code:', rpcError.code);
        console.error('[Vehicles] RPC error message:', rpcError.message);
        console.error('[Vehicles] RPC error details:', rpcError.details);
        console.error('[Vehicles] RPC error hint:', rpcError.hint);
        console.error('[Vehicles] Full RPC error object:', JSON.stringify(rpcError, null, 2));
        console.warn('[Vehicles] Falling back to separate queries');
      } else if (rpcData) {
        console.log('[Vehicles] ✅ RPC function succeeded, using optimized path');
        console.log('[Vehicles] RPC data keys:', Object.keys(rpcData || {}));
        console.log('[Vehicles] RPC data summary:', {
          user_added: rpcData.user_added_vehicles?.length || 0,
          discovered: rpcData.discovered_vehicles?.length || 0,
          verified: rpcData.verified_ownerships?.length || 0
        });
      } else {
        console.warn('[Vehicles] ⚠️ RPC function returned no data (null/undefined), using fallback');
      }
      
      if (!rpcError && rpcData) {
        // RPC function exists and worked - use optimized path
        const userAddedVehicles = (rpcData.user_added_vehicles || []).map((item: any) => ({
          ...item.vehicle,
          vehicle_images: item.images || []
        }));
        
        const discoveredVehicles = (rpcData.discovered_vehicles || []).map((item: any) => {
          const vehicle = item.vehicle || {};
          // Get discovery source from vehicle or infer from URL
          const discoverySource = item.discovery_source || vehicle.discovery_source ||
            (vehicle.discovery_url?.includes('craigslist.org') ? 'Craigslist' :
             vehicle.discovery_url?.includes('marketplace') ? 'Marketplace' :
             vehicle.discovery_url?.includes('autotrader') ? 'AutoTrader' :
             vehicle.discovery_url?.includes('cars.com') ? 'Cars.com' :
             vehicle.discovery_url ? 'External URL' : null);
          
          return {
            relationship_type: item.relationship_type || 'interested',
            discovery_source: discoverySource,
            vehicles: {
              ...vehicle,
              vehicle_images: item.images || []
            }
          };
        });
        
        const verifiedOwnerships = (rpcData.verified_ownerships || []).map((item: any) => ({
          vehicle_id: item.vehicle_id,
          vehicles: {
            ...item.vehicle,
            vehicle_images: item.images || []
          }
        }));

        const permissionOwnerships = (rpcData.permission_ownerships || []).map((item: any) => ({
          vehicle_id: item.vehicle_id,
          role: item.role,
          vehicles: {
            ...item.vehicle,
            vehicle_images: item.images || []
          }
        }));
        
        // Process relationships (same logic as before)
        const owned: VehicleRelationship[] = [];
        const contributing: VehicleRelationship[] = [];
        const interested: VehicleRelationship[] = [];
        const discovered: VehicleRelationship[] = [];
        const curated: VehicleRelationship[] = [];
        const consigned: VehicleRelationship[] = [];
        const previously_owned: VehicleRelationship[] = [];

        // Process verified owned vehicles
        verifiedOwnerships.forEach((ownership: any) => {
          const vehicle = ownership.vehicles;
          if (!vehicle) return;

          const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
          const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;

          owned.push({
            vehicle: {
              id: vehicle.id,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              vin: vehicle.vin,
              color: vehicle.color,
              mileage: vehicle.mileage,
              primaryImageUrl: imageUrl,
              isAnonymous: false,
              created_at: vehicle.created_at
            },
            relationshipType: 'owned',
            role: 'Verified Owner',
            lastActivity: vehicle.created_at
          });
        });

        // Process permission-based owned vehicles (owner/co_owner)
        permissionOwnerships.forEach((ownership: any) => {
          const vehicle = ownership.vehicles;
          if (!vehicle) return;

          const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
          const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;

          const roleLabel = ownership.role === 'co_owner' ? 'Co-owner' : 'Owner';
          owned.push({
            vehicle: {
              id: vehicle.id,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              vin: vehicle.vin,
              color: vehicle.color,
              mileage: vehicle.mileage,
              primaryImageUrl: imageUrl,
              isAnonymous: false,
              created_at: vehicle.created_at
            },
            relationshipType: 'owned',
            role: roleLabel,
            lastActivity: vehicle.created_at
          });
        });

        // Process discovered vehicles
        discoveredVehicles.forEach((discovery: any) => {
          const vehicle = discovery.vehicles;
          if (!vehicle) return;

          const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
          const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;

          const relationshipType = discovery.relationship_type || 'interested';
          const discoverySource = discovery.discovery_source || vehicle.discovery_source ||
            (vehicle.discovery_url?.includes('craigslist.org') ? 'Craigslist' :
             vehicle.discovery_url?.includes('marketplace') ? 'Marketplace' :
             vehicle.discovery_url?.includes('autotrader') ? 'AutoTrader' :
             vehicle.discovery_url?.includes('cars.com') ? 'Cars.com' :
             vehicle.discovery_url ? 'External URL' : null);
          
          const vehicleRelationship: VehicleRelationship = {
            vehicle: {
              id: vehicle.id,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              vin: vehicle.vin,
              color: vehicle.color,
              mileage: vehicle.mileage,
              primaryImageUrl: imageUrl,
              vehicle_images: vehicle.vehicle_images || [], // Pass images array for fallback
              isAnonymous: false,
              created_at: vehicle.created_at
            },
            relationshipType: relationshipType as any,
            role: relationshipType,
            context: discoverySource || undefined,
            lastActivity: vehicle.created_at
          };

          switch (relationshipType) {
            case 'discovered':
              discovered.push(vehicleRelationship);
              break;
            case 'curated':
              curated.push(vehicleRelationship);
              break;
            case 'consigned':
              consigned.push(vehicleRelationship);
              break;
            case 'previously_owned':
              previously_owned.push(vehicleRelationship);
              break;
            case 'interested':
              interested.push(vehicleRelationship);
              break;
            default:
              interested.push(vehicleRelationship);
          }
        });

        // Process vehicles uploaded/added by user that don't have explicit relationships
        const explicitVehicleIds = new Set([
          ...verifiedOwnerships.map((o: any) => o.vehicle_id),
          ...permissionOwnerships.map((o: any) => o.vehicle_id),
          ...discoveredVehicles.map((d: any) => d.vehicles?.id).filter(Boolean)
        ]);

        userAddedVehicles.forEach((vehicle: any) => {
          if (explicitVehicleIds.has(vehicle.id)) return;

          const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
          const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;

          contributing.push({
            vehicle: {
              id: vehicle.id,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              vin: vehicle.vin,
              color: vehicle.color,
              mileage: vehicle.mileage,
              primaryImageUrl: imageUrl,
              vehicle_images: vehicle.vehicle_images || [], // Pass images array for fallback
              isAnonymous: false,
              created_at: vehicle.created_at
            },
            relationshipType: 'contributing',
            role: 'Uploader (needs ownership verification)',
            lastActivity: vehicle.created_at
          });
        });

        // De-duplicate: if something is owned, it should not also appear in other buckets
        const ownedIds = new Set(owned.map(r => r.vehicle.id));
        const dedupe = (arr: VehicleRelationship[]) => arr.filter(r => !ownedIds.has(r.vehicle.id));
        const dedupedContributing = dedupe(contributing);
        const dedupedInterested = dedupe(interested);
        const dedupedDiscovered = dedupe(discovered);
        const dedupedCurated = dedupe(curated);
        const dedupedConsigned = dedupe(consigned);
        const dedupedPreviouslyOwned = dedupe(previously_owned);

        setVehicleRelationships({
          owned,
          contributing: dedupedContributing,
          interested: dedupedInterested,
          discovered: dedupedDiscovered,
          curated: dedupedCurated,
          consigned: dedupedConsigned,
          previously_owned: dedupedPreviouslyOwned
        });
        console.log(`[Vehicles] RPC: ${owned.length} owned, ${dedupedContributing.length} contributing, ${dedupedInterested.length} interested`);

        // UX: If we defaulted to Owned but the user has none, fall back to All.
        setActiveTab((prev) => {
          if (prev !== 'owned') return prev;
          return owned.length > 0 ? 'owned' : 'associated';
        });
        return;
      }
      
      // Fallback: RPC doesn't exist or failed - use separate queries
      console.warn('[Vehicles] RPC function not available, using fallback queries');
      
      // Load vehicles and their relationships
      // Get all vehicles the user uploaded (for "Uploaded" tab, not "Owned")
      // Query vehicles first, then fetch images separately to avoid PostgREST relationship ambiguity
      // Include discovery fields to identify URL-found vehicles
      const [userVehiclesResult, uploadedVehiclesResult] = await Promise.all([
        supabase
          .from('vehicles')
          .select('*, discovery_url, discovery_source, profile_origin')
          .eq('user_id', session.user.id),
        supabase
          .from('vehicles')
          .select('*, discovery_url, discovery_source, profile_origin')
          .eq('uploaded_by', session.user.id)
      ]);
      
      // Combine results, deduplicate by id
      const userVehicles = userVehiclesResult.data || [];
      const uploadedVehicles = uploadedVehiclesResult.data || [];
      const vehicleMap = new Map();
      [...userVehicles, ...uploadedVehicles].forEach(v => {
        if (!vehicleMap.has(v.id)) {
          vehicleMap.set(v.id, v);
        }
      });
      const userAddedVehicles = Array.from(vehicleMap.values());
      const addedError = userVehiclesResult.error || uploadedVehiclesResult.error;
      
      // Fetch images separately for all vehicles
      if (userAddedVehicles.length > 0) {
        const vehicleIds = userAddedVehicles.map(v => v.id);
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url, is_primary, variants')
          .in('vehicle_id', vehicleIds);
        
        // Attach images to vehicles
        const imagesByVehicle = new Map();
        (images || []).forEach(img => {
          if (!imagesByVehicle.has(img.vehicle_id)) {
            imagesByVehicle.set(img.vehicle_id, []);
          }
          imagesByVehicle.get(img.vehicle_id).push(img);
        });
        
        userAddedVehicles.forEach(vehicle => {
          vehicle.vehicle_images = imagesByVehicle.get(vehicle.id) || [];
        });
      }

      // Get explicit relationships from discovered_vehicles table
      // Query discovered_vehicles first, then fetch vehicles and images separately
      let discoveredVehicles: any[] = [];
      let discoveredError: any = null;
      
      const result = await supabase
        .from('discovered_vehicles')
        .select('relationship_type, vehicle_id, discovery_source, discovery_context')
        .eq('user_id', session.user.id)
        .eq('is_active', true);
      
      if (result.error && result.error.message?.includes('relationship_type')) {
        // Column doesn't exist, query without it and default to 'interested'
        console.warn('[Vehicles] relationship_type column missing, using fallback');
        const fallback = await supabase
          .from('discovered_vehicles')
          .select('vehicle_id')
          .eq('user_id', session.user.id)
          .eq('is_active', true);
        
          discoveredVehicles = (fallback.data || []).map((dv: any) => ({
            ...dv,
            relationship_type: 'interested', // Default fallback
            discovery_source: null,
            discovery_context: null
          }));
        discoveredError = fallback.error;
      } else {
        discoveredVehicles = result.data || [];
        discoveredError = result.error;
      }
      
      // Fetch vehicles and images for discovered vehicles
      if (discoveredVehicles.length > 0) {
        const vehicleIds = discoveredVehicles.map(dv => dv.vehicle_id).filter(Boolean);
        if (vehicleIds.length > 0) {
          const { data: vehicles } = await supabase
            .from('vehicles')
            .select('*, discovery_url, discovery_source, profile_origin')
            .in('id', vehicleIds);
          
          const { data: images } = await supabase
            .from('vehicle_images')
            .select('vehicle_id, image_url, is_primary, variants')
            .in('vehicle_id', vehicleIds);
          
          // Attach vehicles and images to discovered vehicles
          const vehiclesMap = new Map((vehicles || []).map(v => [v.id, v]));
          const imagesByVehicle = new Map();
          (images || []).forEach(img => {
            if (!imagesByVehicle.has(img.vehicle_id)) {
              imagesByVehicle.set(img.vehicle_id, []);
            }
            imagesByVehicle.get(img.vehicle_id).push(img);
          });
          
          discoveredVehicles = discoveredVehicles.map(dv => {
            const vehicle = vehiclesMap.get(dv.vehicle_id);
            // Use discovery_source from discovered_vehicles, fallback to vehicle's discovery_source
            const discoverySource = dv.discovery_source || vehicle?.discovery_source || 
              (vehicle?.discovery_url?.includes('craigslist.org') ? 'Craigslist' :
               vehicle?.discovery_url?.includes('marketplace') ? 'Marketplace' :
               vehicle?.discovery_url?.includes('autotrader') ? 'AutoTrader' :
               vehicle?.discovery_url?.includes('cars.com') ? 'Cars.com' :
               vehicle?.discovery_url ? 'External URL' : null);
            
            return {
              ...dv,
              discovery_source: discoverySource,
              vehicles: vehicle ? {
                ...vehicle,
                vehicle_images: imagesByVehicle.get(dv.vehicle_id) || []
              } : null
            };
          });
        }
      }

      // Get verified ownership (LEGAL ownership with documents)
      // Query ownership_verifications first, then fetch vehicles and images separately
      const { data: verifiedOwnershipsData, error: verifiedError } = await supabase
        .from('ownership_verifications')
        .select('vehicle_id')
        .eq('user_id', session.user.id)
        .eq('status', 'approved');

      // Get permission-based ownership (OWNER/CO_OWNER roles)
      const { data: permissionOwnershipsData, error: permissionOwnershipsError } = await supabase
        .from('vehicle_user_permissions')
        .select('vehicle_id, role')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .in('role', ['owner', 'co_owner']);
      
      let verifiedOwnerships: any[] = [];
      if (verifiedOwnershipsData && verifiedOwnershipsData.length > 0) {
        const vehicleIds = verifiedOwnershipsData.map(ov => ov.vehicle_id).filter(Boolean);
        const { data: vehicles } = await supabase
          .from('vehicles')
          .select('*')
          .in('id', vehicleIds);
        
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url, is_primary, variants')
          .in('vehicle_id', vehicleIds);
        
        // Attach vehicles and images to ownerships
        const vehiclesMap = new Map((vehicles || []).map(v => [v.id, v]));
        const imagesByVehicle = new Map();
        (images || []).forEach(img => {
          if (!imagesByVehicle.has(img.vehicle_id)) {
            imagesByVehicle.set(img.vehicle_id, []);
          }
          imagesByVehicle.get(img.vehicle_id).push(img);
        });
        
        verifiedOwnerships = verifiedOwnershipsData.map(ov => ({
          ...ov,
          vehicles: vehiclesMap.get(ov.vehicle_id) ? {
            ...vehiclesMap.get(ov.vehicle_id),
            vehicle_images: imagesByVehicle.get(ov.vehicle_id) || []
          } : null
        }));
      }

      let permissionOwnerships: any[] = [];
      if (permissionOwnershipsData && permissionOwnershipsData.length > 0) {
        const vehicleIds = permissionOwnershipsData.map((ov: any) => ov.vehicle_id).filter(Boolean);
        const { data: vehicles } = await supabase
          .from('vehicles')
          .select('*')
          .in('id', vehicleIds);

        const { data: images } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url, is_primary, variants')
          .in('vehicle_id', vehicleIds);

        const vehiclesMap = new Map((vehicles || []).map(v => [v.id, v]));
        const imagesByVehicle = new Map();
        (images || []).forEach(img => {
          if (!imagesByVehicle.has(img.vehicle_id)) {
            imagesByVehicle.set(img.vehicle_id, []);
          }
          imagesByVehicle.get(img.vehicle_id).push(img);
        });

        permissionOwnerships = (permissionOwnershipsData || []).map((ov: any) => ({
          ...ov,
          vehicles: vehiclesMap.get(ov.vehicle_id) ? {
            ...vehiclesMap.get(ov.vehicle_id),
            vehicle_images: imagesByVehicle.get(ov.vehicle_id) || []
          } : null
        }));
      }
      
      console.log('[Vehicles] Verified ownerships:', verifiedOwnerships?.length || 0);
      console.log('[Vehicles] Permission ownerships:', permissionOwnerships?.length || 0);
      console.log('[Vehicles] Uploaded vehicles:', userAddedVehicles?.length || 0);
      console.log('[Vehicles] Discovered vehicles:', discoveredVehicles?.length || 0);

      if (addedError) {
        console.error('[Vehicles] Error loading added vehicles:', addedError);
        console.error('[Vehicles] Error details:', JSON.stringify(addedError, null, 2));
        console.error('[Vehicles] Error message:', addedError.message);
        console.error('[Vehicles] Error code:', addedError.code);
        console.error('[Vehicles] Error details:', addedError.details);
        console.error('[Vehicles] Error hint:', addedError.hint);
      }
      if (discoveredError) {
        console.error('[Vehicles] Error loading discovered vehicles:', discoveredError);
        console.error('[Vehicles] Error details:', JSON.stringify(discoveredError, null, 2));
        console.error('[Vehicles] Error message:', discoveredError.message);
        console.error('[Vehicles] Error code:', discoveredError.code);
        console.error('[Vehicles] Error details:', discoveredError.details);
        console.error('[Vehicles] Error hint:', discoveredError.hint);
      }
      if (verifiedError) {
        console.error('[Vehicles] Error loading verified ownerships:', verifiedError);
        console.error('[Vehicles] Error details:', JSON.stringify(verifiedError, null, 2));
        console.error('[Vehicles] Error message:', verifiedError.message);
        console.error('[Vehicles] Error code:', verifiedError.code);
        console.error('[Vehicles] Error details:', verifiedError.details);
        console.error('[Vehicles] Error hint:', verifiedError.hint);
      }
      if (permissionOwnershipsError) {
        console.error('[Vehicles] Error loading permission ownerships:', permissionOwnershipsError);
        console.error('[Vehicles] Error details:', JSON.stringify(permissionOwnershipsError, null, 2));
      }

      // Only log full data in development
      if (process.env.NODE_ENV === 'development') {
        console.log('[Vehicles] User added vehicles:', userAddedVehicles);
        console.log('[Vehicles] Discovered vehicles:', discoveredVehicles);
        console.log('[Vehicles] Verified ownerships:', verifiedOwnerships);
      }
      // Process relationships by type
      const owned: VehicleRelationship[] = [];
      const contributing: VehicleRelationship[] = [];
      const interested: VehicleRelationship[] = [];
      const discovered: VehicleRelationship[] = [];
      const curated: VehicleRelationship[] = [];
      const consigned: VehicleRelationship[] = [];
      const previously_owned: VehicleRelationship[] = [];

      // Process verified owned vehicles
      (verifiedOwnerships || []).forEach((ownership: any) => {
        const vehicle = ownership.vehicles;
        if (!vehicle) return;

        const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
        const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;

        owned.push({
          vehicle: {
            id: vehicle.id,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            vin: vehicle.vin,
            color: vehicle.color,
            mileage: vehicle.mileage,
            primaryImageUrl: imageUrl,
            isAnonymous: false,
            created_at: vehicle.created_at
          },
          relationshipType: 'owned',
          role: 'Verified Owner',
          lastActivity: vehicle.created_at
        });
      });

      // Process permission-based owned vehicles
      (permissionOwnerships || []).forEach((ownership: any) => {
        const vehicle = ownership.vehicles;
        if (!vehicle) return;

        const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
        const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;
        const roleLabel = ownership.role === 'co_owner' ? 'Co-owner' : 'Owner';

        owned.push({
          vehicle: {
            id: vehicle.id,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            vin: vehicle.vin,
            color: vehicle.color,
            mileage: vehicle.mileage,
            primaryImageUrl: imageUrl,
            isAnonymous: false,
            created_at: vehicle.created_at
          },
          relationshipType: 'owned',
          role: roleLabel,
          lastActivity: vehicle.created_at
        });
      });

      // Process discovered vehicles (from discovered_vehicles table)
      (discoveredVehicles || []).forEach((discovery: any) => {
        const vehicle = discovery.vehicles;
        if (!vehicle) return;

        const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
        const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;

        // Get discovery source from discovered_vehicles or vehicle
        const discoverySource = discovery.discovery_source || vehicle.discovery_source ||
          (vehicle.discovery_url?.includes('craigslist.org') ? 'Craigslist' :
           vehicle.discovery_url?.includes('marketplace') ? 'Marketplace' :
           vehicle.discovery_url?.includes('autotrader') ? 'AutoTrader' :
           vehicle.discovery_url?.includes('cars.com') ? 'Cars.com' :
           vehicle.discovery_url ? 'External URL' : null);

        const vehicleRelationship: VehicleRelationship = {
          vehicle: {
            id: vehicle.id,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            vin: vehicle.vin,
            color: vehicle.color,
            mileage: vehicle.mileage,
            primaryImageUrl: imageUrl,
            isAnonymous: false,
            created_at: vehicle.created_at
          },
          relationshipType: discovery.relationship_type,
          role: discovery.relationship_type,
          context: discoverySource || undefined,
          lastActivity: vehicle.created_at
        };

        // Default to 'interested' if relationship_type is null/undefined
        const relationshipType = discovery.relationship_type || 'interested';
        
        switch (relationshipType) {
          case 'discovered':
            discovered.push(vehicleRelationship);
            break;
          case 'curated':
            curated.push(vehicleRelationship);
            break;
          case 'consigned':
            consigned.push(vehicleRelationship);
            break;
          case 'previously_owned':
            previously_owned.push(vehicleRelationship);
            break;
          case 'interested':
            interested.push(vehicleRelationship);
            break;
          default:
            console.warn('Unknown relationship type:', relationshipType);
            interested.push(vehicleRelationship);
        }
      });

      // Process vehicles uploaded/added by user that don't have explicit relationships
      // IMPORTANT: uploaded_by is NOT automatically the owner. However, vehicles.user_id indicates direct ownership.
      const explicitVehicleIds = new Set([
        ...(verifiedOwnerships || []).map((o: any) => o.vehicle_id),
        ...(permissionOwnerships || []).map((o: any) => o.vehicle_id),
        ...(discoveredVehicles || []).map((d: any) => d.vehicles?.id).filter(Boolean)
      ]);

      (userAddedVehicles || []).forEach((vehicle: any) => {
        // Skip if this vehicle already has an explicit relationship
        if (explicitVehicleIds.has(vehicle.id)) return;

        // URL-found vehicles should NOT be in contributing - they should only be in discovered
        // Check if vehicle was found via URL (discovery_url, discovery_source, or profile_origin = 'url_scraper')
        const isUrlFound = !!(
          vehicle.discovery_url || 
          vehicle.discovery_source || 
          vehicle.profile_origin === 'url_scraper' ||
          vehicle.profile_origin === 'bat_import'
        );

        // If it's a URL find, skip it - it should already be in discovered_vehicles
        if (isUrlFound) {
          console.log('[Vehicles] Skipping URL-found vehicle from contributing:', vehicle.id, vehicle.discovery_url);
          return;
        }

        const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
        const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;

        // Place in contributing section - uploaders are contributors, not automatic owners
        // Only for manually uploaded vehicles (not URL finds)
        contributing.push({
          vehicle: {
            id: vehicle.id,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            vin: vehicle.vin,
            color: vehicle.color,
            mileage: vehicle.mileage,
            primaryImageUrl: imageUrl,
            isAnonymous: false,
            created_at: vehicle.created_at
          },
          relationshipType: 'contributing',
          role: 'Uploader (needs ownership verification)',
          lastActivity: vehicle.created_at
        });
      });

      // De-duplicate: if something is owned, it should not also appear in other buckets
      const ownedIds = new Set(owned.map(r => r.vehicle.id));
      const dedupe = (arr: VehicleRelationship[]) => arr.filter(r => !ownedIds.has(r.vehicle.id));
      const dedupedContributing = dedupe(contributing);
      const dedupedInterested = dedupe(interested);
      const dedupedDiscovered = dedupe(discovered);
      const dedupedCurated = dedupe(curated);
      const dedupedConsigned = dedupe(consigned);
      const dedupedPreviouslyOwned = dedupe(previously_owned);

      // Filter by organization context if selected
      let filteredOwned = owned;
      let filteredContributing = dedupedContributing;
      let filteredInterested = dedupedInterested;
      let filteredDiscovered = dedupedDiscovered;
      let filteredCurated = dedupedCurated;
      let filteredConsigned = dedupedConsigned;
      let filteredPreviouslyOwned = dedupedPreviouslyOwned;

      if (selectedOrganizationId) {
        // Load vehicles linked to this organization
        const { data: orgVehicles } = await supabase
          .from('organization_vehicles')
          .select('vehicle_id')
          .eq('organization_id', selectedOrganizationId)
          .eq('status', 'active');

        const orgVehicleIds = new Set((orgVehicles || []).map((ov: any) => ov.vehicle_id));

        filteredOwned = owned.filter(r => orgVehicleIds.has(r.vehicle.id));
        filteredContributing = dedupedContributing.filter(r => orgVehicleIds.has(r.vehicle.id));
        filteredInterested = dedupedInterested.filter(r => orgVehicleIds.has(r.vehicle.id));
        filteredDiscovered = dedupedDiscovered.filter(r => orgVehicleIds.has(r.vehicle.id));
        filteredCurated = dedupedCurated.filter(r => orgVehicleIds.has(r.vehicle.id));
        filteredConsigned = dedupedConsigned.filter(r => orgVehicleIds.has(r.vehicle.id));
        filteredPreviouslyOwned = dedupedPreviouslyOwned.filter(r => orgVehicleIds.has(r.vehicle.id));
      }

      setVehicleRelationships({
        owned: filteredOwned,
        contributing: filteredContributing,
        interested: filteredInterested,
        discovered: filteredDiscovered,
        curated: filteredCurated,
        consigned: filteredConsigned,
        previously_owned: filteredPreviouslyOwned
      });
      
      console.log(`Categorized vehicles: ${filteredOwned.length} owned, ${filteredContributing.length} contributing, ${filteredInterested.length} interested`);

      // UX: If we defaulted to Owned but the user has none, fall back to All.
      setActiveTab((prev) => {
        if (prev !== 'owned') return prev;
        return filteredOwned.length > 0 ? 'owned' : 'associated';
      });
    } catch (error) {
      console.error('Error in loadVehicleRelationships:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadVehiclePreferences = async () => {
    if (!session?.user?.id) return;

    try {
      const { data, error } = await supabase
        .from('user_vehicle_preferences')
        .select('vehicle_id, is_favorite, is_hidden, collection_name')
        .eq('user_id', session.user.id);

      if (error) {
        // Table might not exist yet - that's ok, just return empty map
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          console.log('user_vehicle_preferences table not found - migration may not be applied yet');
          setVehiclePreferences(new Map());
          return;
        }
        throw error;
      }

      const prefsMap = new Map();
      (data || []).forEach((pref: any) => {
        prefsMap.set(pref.vehicle_id, {
          is_favorite: pref.is_favorite || false,
          is_hidden: pref.is_hidden || false,
          collection_name: pref.collection_name || null
        });
      });

      setVehiclePreferences(prefsMap);
    } catch (error) {
      console.error('Error loading vehicle preferences:', error);
      // Set empty map on error so UI doesn't break
      setVehiclePreferences(new Map());
    }
  };

  const handleDeleteVehicle = (vehicleId: string) => {
    if (window.confirm('Are you sure you want to delete this vehicle?')) {
      deleteVehicle(vehicleId, false);
    }
  };

  const loadVehicles = async () => {
    try {
      setLoading(true);
      let authenticatedVehicles: Vehicle[] = [];
      
      // Skip localStorage to prevent hardcoded vehicles
      const localVehicles: Vehicle[] = [];
      
      if (session?.user?.id) {
        try {
          console.log('Fetching vehicles for user:', session.user.id);
          const { data, error } = await supabase
            .from('vehicles')
            .select('*')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false });

          if (error) {
            console.error('Supabase error loading vehicles:', error);
          } else if (data) {
            console.log('Found vehicles in database:', data.length);
            authenticatedVehicles = data.map(v => ({
              ...v,
              isAnonymous: false
            }));
          } else {
            console.log('No vehicles found in database');
          }
        } catch (error) {
          console.error('Error loading authenticated vehicles:', error);
        }
      } else {
        console.log('No session - skipping database vehicle fetch');
      }

      // Combine both types of vehicles, prioritizing Supabase vehicles
      const allVehicles = [...authenticatedVehicles, ...localVehicles];
      // Legacy code - vehicles now handled by relationships
      // setVehicles(allVehicles);
      
      console.log(`Loaded ${authenticatedVehicles.length} Supabase vehicles and ${localVehicles.length} local vehicles`);
    } catch (error) {
      console.error('Error loading vehicles:', error);
    } finally {
      setLoading(false);
    }
  };

  const syncLocalVehiclesToSupabase = async () => {
    if (!session?.user?.id) {
      alert('Please log in to sync vehicles to the cloud');
      return;
    }

    const localVehicles = JSON.parse(localStorage.getItem('anonymousVehicles') || '[]');
    if (localVehicles.length === 0) {
      alert('No local vehicles to sync');
      return;
    }

    setLoading(true);
    try {
      let syncedCount = 0;
      
      for (const vehicle of localVehicles) {
        // Remove local-specific properties and add user_id
        const vehicleData = {
          id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          color: vehicle.color,
          mileage: vehicle.mileage,
          trim: vehicle.trim,
          engine: vehicle.engine,
          transmission: vehicle.transmission,
          description: vehicle.description,
          primaryImageUrl: vehicle.primaryImageUrl,
          isPublic: vehicle.isPublic ?? true,
          uploaded_by: session.user.id,
          created_at: vehicle.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase
          .from('vehicles')
          .upsert([{ ...vehicleData, is_public: (vehicle as any).isPublic ?? true }], { onConflict: 'id' });

        if (!error) {
          syncedCount++;
        } else {
          console.error('Error syncing vehicle:', error);
        }
      }

      // Clear localStorage after successful sync
      if (syncedCount > 0) {
        localStorage.removeItem('anonymousVehicles');
        alert(`Successfully synced ${syncedCount} vehicles to the cloud!`);
        loadVehicles(); // Reload to show updated state
      }
    } catch (error) {
      console.error('Error syncing vehicles:', error);
      alert('Error syncing vehicles. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const deleteVehicle = async (vehicleId: string, isAnonymous: boolean) => {
    if (isAnonymous) {
      // Delete from localStorage - not implemented for relationships
      console.log('Local vehicle deletion not implemented for relationship model');
    } else {
      // Delete from database
      try {
        const { error } = await supabase
          .from('vehicles')
          .delete()
          .eq('id', vehicleId);

        if (!error) {
          // Reload relationships after deletion
          loadVehicleRelationships();
        } else {
          console.error('Error deleting vehicle:', error);
        }
      } catch (error) {
        console.error('Error deleting vehicle:', error);
      }
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    // After 30 days (720 hours), show actual date
    if (diffInHours >= 720) {
      return date.toLocaleDateString();
    }

    // Within 30 days, show relative time
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return `${Math.floor(diffInHours / 168)}w ago`;
  };

  const calculateHype = (vehicle: Vehicle, relationship?: VehicleRelationship) => {
    let hype = 0;

    // Base rarity score (older/rarer = more hype)
    const currentYear = new Date().getFullYear();
    const age = currentYear - (vehicle.year || currentYear);
    if (age > 50) hype += 30;      // Classic
    else if (age > 25) hype += 20; // Modern classic
    else if (age > 10) hype += 10; // Appreciating

    // Brand/Model rarity (simplified)
    const rareBrands = ['Ferrari', 'Lamborghini', 'McLaren', 'Porsche', 'Aston Martin', 'Bentley'];
    const premiumBrands = ['BMW', 'Mercedes', 'Audi', 'Lexus', 'Acura'];

    if (rareBrands.some(brand => vehicle.make?.includes(brand))) hype += 25;
    else if (premiumBrands.some(brand => vehicle.make?.includes(brand))) hype += 10;

    // Ownership verification status
    if (relationship?.relationshipType === 'owned') hype += 15;

    // Recent activity (new additions get temporary boost)
    const hoursAgo = Math.floor((new Date().getTime() - new Date(vehicle.created_at || new Date().toISOString()).getTime()) / (1000 * 60 * 60));
    if (hoursAgo < 24) hype += 20;       // New today
    else if (hoursAgo < 168) hype += 10; // This week

    // Cap at 100% and ensure minimum of 5%
    return Math.min(Math.max(hype, 5), 100);
  };

  // Get current tab's relationships
  const allRelationships: VehicleRelationship[] = [
    ...vehicleRelationships.owned,
    ...vehicleRelationships.contributing,
    ...vehicleRelationships.interested,
    ...vehicleRelationships.discovered,
    ...vehicleRelationships.curated,
    ...vehicleRelationships.consigned,
    ...vehicleRelationships.previously_owned
  ];

  const currentRelationships: VehicleRelationship[] =
    activeTab === 'associated'
      ? allRelationships
      : vehicleRelationships[activeTab as Exclude<VehiclesTab, 'associated'>] || [];

  const relationshipLabel = (t: VehicleRelationship['relationshipType']) => {
    switch (t) {
      case 'owned': return 'Owned';
      case 'previously_owned': return 'Previously Owned';
      case 'discovered': return 'Discovered (Craigslist, etc.)';
      case 'curated': return 'Curated';
      case 'consigned': return 'Consigned';
      case 'contributing': return 'Contributing';
      case 'interested': return 'Interested';
      default: return String(t);
    }
  };

  const relationshipOrder: VehicleRelationship['relationshipType'][] = [
    'owned',
    'previously_owned',
    'contributing',
    'consigned',
    'curated',
    'discovered',
    'interested'
  ];

  const groupByRelationship = (rels: VehicleRelationship[]) => {
    const map = new Map<VehicleRelationship['relationshipType'], VehicleRelationship[]>();
    rels.forEach((r) => {
      const key = r.relationshipType;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return relationshipOrder
      .map((k) => ({ type: k, items: map.get(k) || [] }))
      .filter((g) => g.items.length > 0);
  };

  // Filter and sort current relationships
  const filteredRelationships = currentRelationships
    .filter(relationship => {
      const vehicle = relationship.vehicle;
      const prefs = vehiclePreferences.get(vehicle.id);

      // Apply preference filters (only in personal view, not org context)
      if (!selectedOrganizationId) {
        if (preferenceFilter === 'favorites' && !prefs?.is_favorite) return false;
        if (preferenceFilter === 'hidden' && !prefs?.is_hidden) return false;
        if (preferenceFilter === 'collection') {
          if (!collectionFilter) return false; // Need to select a collection
          if (prefs?.collection_name !== collectionFilter) return false;
        }
        // Hide hidden vehicles unless explicitly viewing hidden
        if (preferenceFilter !== 'hidden' && prefs?.is_hidden) return false;
      }

      // Apply discovery source filter (only for discovered tab)
      if (activeTab === 'discovered' && discoverySourceFilter) {
        const relationshipSource = relationship.context?.toLowerCase() || '';
        if (relationshipSource !== discoverySourceFilter.toLowerCase()) return false;
      }

      // Apply search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const yearStr = vehicle.year != null ? String(vehicle.year) : '';
        const makeStr = String(vehicle.make || '').toLowerCase();
        const modelStr = String(vehicle.model || '').toLowerCase();
        const vinStr = vehicle.vin ? String(vehicle.vin).toLowerCase() : '';
        const colorStr = vehicle.color ? String(vehicle.color).toLowerCase() : '';
        const roleStr = relationship.role ? String(relationship.role).toLowerCase() : '';
        const matchesSearch = (
          yearStr.includes(searchLower) ||
          makeStr.includes(searchLower) ||
          modelStr.includes(searchLower) ||
          vinStr.includes(searchLower) ||
          colorStr.includes(searchLower) ||
          roleStr.includes(searchLower)
        );
        if (!matchesSearch) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const aVehicle = a.vehicle;
      const bVehicle = b.vehicle;
      const aPrefs = vehiclePreferences.get(aVehicle.id);
      const bPrefs = vehiclePreferences.get(bVehicle.id);

      // Sort favorites first
      if (aPrefs?.is_favorite && !bPrefs?.is_favorite) return -1;
      if (!aPrefs?.is_favorite && bPrefs?.is_favorite) return 1;

      switch (sortBy) {
        case 'year':
          return (Number(bVehicle.year) || 0) - (Number(aVehicle.year) || 0);
        case 'make':
          return aVehicle.make.localeCompare(bVehicle.make);
        case 'model':
          return aVehicle.model.localeCompare(bVehicle.model);
        case 'created_at':
        default:
          return new Date(bVehicle.created_at).getTime() - new Date(aVehicle.created_at).getTime();
      }
    });

  const groupedRelationships = activeTab === 'associated' ? groupByRelationship(filteredRelationships) : [];

  const collectionCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const rel of allRelationships) {
      const prefs = vehiclePreferences.get(rel.vehicle.id);
      const name = (prefs?.collection_name || '').trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return counts;
  }, [allRelationships, vehiclePreferences]);

  const collectionNames = React.useMemo(() => {
    return Array.from(collectionCounts.keys()).sort((a, b) => a.localeCompare(b));
  }, [collectionCounts]);

  const assignCollectionToVehicles = async (vehicleIds: string[], collectionName: string | null) => {
    if (!session?.user?.id) return;
    if (!vehicleIds.length) return;
    try {
      const rows = vehicleIds.map((vehicleId) => ({
        user_id: session.user.id,
        vehicle_id: vehicleId,
        collection_name: collectionName
      }));

      const { error } = await supabase
        .from('user_vehicle_preferences')
        .upsert(rows, { onConflict: 'user_id,vehicle_id' });
      if (error) throw error;

      setVehiclePreferences((prev) => {
        const next = new Map(prev);
        for (const vehicleId of vehicleIds) {
          const existing = next.get(vehicleId) || { is_favorite: false, is_hidden: false, collection_name: null };
          next.set(vehicleId, { ...existing, collection_name: collectionName });
        }
        return next;
      });
    } catch (error) {
      console.error('Failed to assign collection:', error);
    }
  };

  const getDraggedVehicleIds = (dragVehicleId: string) => {
    if (selectedVehicleIds.size > 0 && selectedVehicleIds.has(dragVehicleId)) {
      return Array.from(selectedVehicleIds);
    }
    return [dragVehicleId];
  };

  const handleCardDragStart = (e: React.DragEvent, vehicleId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/n-zero.vehicle', JSON.stringify({ vehicleId }));
    e.dataTransfer.setData('text/plain', vehicleId);
  };

  const extractVehicleIdFromDrop = (e: React.DragEvent): string | null => {
    try {
      const json = e.dataTransfer.getData('application/n-zero.vehicle');
      if (json) {
        const parsed = JSON.parse(json);
        if (parsed?.vehicleId && typeof parsed.vehicleId === 'string') return parsed.vehicleId;
      }
    } catch {
      // ignore
    }
    const raw = e.dataTransfer.getData('text/plain');
    return raw && typeof raw === 'string' ? raw : null;
  };

  const linkVehiclesToOrganization = async (vehicleIds: string[], organizationId: string, relationshipType: typeof orgDropRelationshipType) => {
    if (!session?.user?.id) return;
    if (!vehicleIds.length) return;
    if (!organizationId) return;
    try {
      const rows = vehicleIds.map((vehicleId) => ({
        organization_id: organizationId,
        vehicle_id: vehicleId,
        relationship_type: relationshipType,
        status: 'active',
        linked_by_user_id: session.user.id
      }));

      const { error } = await supabase
        .from('organization_vehicles')
        .upsert(rows as any, { onConflict: 'organization_id,vehicle_id,relationship_type' });
      if (error) throw error;
    } catch (error) {
      console.error('Failed to link vehicles to organization:', error);
    }
  };


  const tabMeta: Array<{ key: VehiclesTab; label: string; count: number }> = [
    { key: 'associated', label: 'All', count: allRelationships.length },
    { key: 'owned', label: 'Owned', count: vehicleRelationships.owned.length },
    { key: 'discovered', label: 'Discovered', count: vehicleRelationships.discovered.length },
    { key: 'curated', label: 'Curated', count: vehicleRelationships.curated.length },
    { key: 'consigned', label: 'Consigned', count: vehicleRelationships.consigned.length },
    { key: 'previously_owned', label: 'Previously Owned', count: vehicleRelationships.previously_owned.length },
    { key: 'contributing', label: 'Contributing', count: vehicleRelationships.contributing.length },
    { key: 'interested', label: 'Interested', count: vehicleRelationships.interested.length }
  ];

  const toggleSidebarSection = (key: keyof typeof sidebarSections) => {
    setSidebarSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const currentTabLabel = tabMeta.find(t => t.key === activeTab)?.label || activeTab;

  const SidebarSection: React.FC<{
    title: string;
    sectionKey: keyof typeof sidebarSections;
    right?: React.ReactNode;
    children: React.ReactNode;
    hidden?: boolean;
  }> = ({ title, sectionKey, right, children, hidden }) => {
    if (hidden) return null;
    const open = sidebarSections[sectionKey];
    return (
      <div className="vehicle-sidebar-section">
        <div
          className="vehicle-sidebar-section-title"
          role="button"
          tabIndex={0}
          onClick={() => toggleSidebarSection(sectionKey)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') toggleSidebarSection(sectionKey);
          }}
        >
          <span>{title}</span>
          <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {right}
            {/* Less noisy than SHOW/HIDE but still communicates state */}
            <span className="vehicle-sidebar-mini">{open ? '▼' : '▶'}</span>
          </span>
        </div>
        {open && <div className="vehicle-sidebar-section-body">{children}</div>}
      </div>
    );
  };

  const SidebarItem: React.FC<{
    active?: boolean;
    onClick: () => void;
    label: string;
    right?: React.ReactNode;
  }> = ({ active, onClick, label, right }) => (
    <button
      type="button"
      className={`vehicle-sidebar-item ${active ? 'vehicle-sidebar-item-active' : ''}`}
      onClick={onClick}
    >
      <span style={{ textAlign: 'left' }}>{label}</span>
      {right}
    </button>
  );

  return (
    <>
      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading vehicles...</p>
        </div>
      ) : (
        <div className="fade-in vehicle-library-layout">
          <aside
            className={`vehicle-library-sidebar ${sidebarCollapsed ? 'vehicle-library-sidebar-collapsed' : ''}`}
            aria-label="Vehicle sidebar"
            style={!sidebarCollapsed ? { 
              width: `${sidebarWidth}px`,
              flex: `0 0 ${sidebarWidth}px`,
              minWidth: `${sidebarWidth}px`,
              position: 'relative'
            } : undefined}
          >
            <div className="vehicle-library-sidebar-header">
              {!sidebarCollapsed && (
                <>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => setSidebarCollapsed(v => !v)}
                  >
                    COLLAPSE
                  </button>
                  <button
                    type="button"
                    className="button button-primary button-small"
                    onClick={() => navigate('/vehicle/add')}
                  >
                    ADD VEHICLE
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min="200"
                      max="600"
                      value={sidebarWidth}
                      onChange={(e) => {
                        const width = parseInt(e.target.value, 10);
                        if (width >= 200 && width <= 600) {
                          setSidebarWidth(width);
                        }
                      }}
                      style={{
                        width: '50px',
                        padding: '2px 4px',
                        fontSize: '7pt',
                        border: '1px solid var(--border-light)',
                        background: 'var(--white)'
                      }}
                      title="Sidebar width (px)"
                    />
                    <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>px</span>
                  </div>
                </>
              )}
            </div>
            
            {/* Resize handle */}
            {!sidebarCollapsed && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizing(true);
                }}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: '6px',
                  cursor: 'col-resize',
                  background: 'transparent',
                  zIndex: 10,
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 123, 255, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
                title="Drag to resize sidebar"
              />
            )}

            {!sidebarCollapsed && (
              <div className="vehicle-library-sidebar-scroll">
                {/* Selection tools removed (bulk GPS assignment was too heavy/noisy for day-to-day use). */}

                <SidebarSection
                  title="Inbox"
                  sectionKey="inbox"
                  hidden={!session?.user?.id || !!selectedOrganizationId}
                  right={<span className="vehicle-sidebar-mini">REVIEW</span>}
                >
                  {session?.user?.id && !selectedOrganizationId && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <TitleTransferApproval
                        userId={session.user.id}
                        onUpdate={() => {
                          loadVehicleRelationships();
                          loadVehiclePreferences();
                        }}
                      />
                      <VehicleConfirmationQuestions
                        userId={session.user.id}
                        onUpdate={() => {
                          loadVehicleRelationships();
                          loadVehiclePreferences();
                        }}
                      />
                    </div>
                  )}
                </SidebarSection>

                <SidebarSection title="Organizations" sectionKey="context" hidden={!session?.user?.id}>
                  <OrganizationContextFilter
                    selectedOrganizationId={selectedOrganizationId}
                    onOrganizationChange={(orgId) => {
                      setSelectedOrganizationId(orgId);
                      setSelectedVehicleIds(new Set());
                    }}
                    showPersonalView={true}
                  />

                  {/* Drag-and-drop organization assignment */}
                  <div
                    style={{
                      marginTop: '10px',
                      border: '1px solid var(--border-light)',
                      background: 'var(--surface)',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                    onDragOver={(e) => {
                      if (!session?.user?.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                  >
                    <div className="vehicle-sidebar-mini" style={{ fontWeight: 700 }}>
                      Drop vehicles onto an organization
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className="vehicle-sidebar-mini">Link as</span>
                      <select
                        className="select"
                        value={orgDropRelationshipType}
                        onChange={(e) => setOrgDropRelationshipType(e.target.value as any)}
                        style={{ flex: 1 }}
                      >
                        <option value="work_location">Work location</option>
                        <option value="service_provider">Service provider</option>
                        <option value="storage">Storage</option>
                        <option value="consigner">Consigner</option>
                        <option value="sold_by">Sold by</option>
                        <option value="owner">Owner</option>
                      </select>
                    </div>

                    {myOrganizations.length === 0 ? (
                      <div className="vehicle-sidebar-mini">
                        No organizations found for your account.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {myOrganizations.slice(0, 12).map((org) => {
                          const orgId = org.organization_id;
                          const name = org.organization?.business_name || 'Organization';
                          const active = selectedOrganizationId === orgId;
                          return (
                            <button
                              key={orgId}
                              type="button"
                              className={`vehicle-sidebar-item ${active ? 'vehicle-sidebar-item-active' : ''}`}
                              style={{ justifyContent: 'space-between' }}
                              onClick={() => {
                                setSelectedOrganizationId(orgId);
                                setSelectedVehicleIds(new Set());
                              }}
                              onDragOver={(e) => {
                                if (!session?.user?.id) return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                              }}
                              onDrop={async (e) => {
                                e.preventDefault();
                                const dragged = extractVehicleIdFromDrop(e);
                                if (!dragged) return;
                                const ids = getDraggedVehicleIds(dragged);
                                await linkVehiclesToOrganization(ids, orgId, orgDropRelationshipType);
                                // Keep UI snappy: refresh relationship lists (org filter relies on org links)
                                await loadVehicleRelationships();
                              }}
                            >
                              <span style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {name}
                              </span>
                              <span className="vehicle-sidebar-mini">{org.role}</span>
                            </button>
                          );
                        })}
                        {myOrganizations.length > 12 && (
                          <div className="vehicle-sidebar-mini">Showing first 12. Pin/sort orgs later.</div>
                        )}
                      </div>
                    )}

                    <div className="vehicle-sidebar-mini">
                      Tip: select multiple vehicles, then drag one of the selected vehicles to batch-link.
                    </div>
                  </div>
                </SidebarSection>

                <SidebarSection title="Library" sectionKey="library" hidden={!session?.user?.id || !!selectedOrganizationId}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <SidebarItem
                      active={preferenceFilter === 'all'}
                      onClick={() => {
                        setPreferenceFilter('all');
                        setCollectionFilter(null);
                      }}
                      label="All"
                    />
                    <SidebarItem
                      active={preferenceFilter === 'favorites'}
                      onClick={() => {
                        setPreferenceFilter('favorites');
                        setCollectionFilter(null);
                      }}
                      label="Favorites"
                    />
                    <SidebarItem
                      active={preferenceFilter === 'hidden'}
                      onClick={() => {
                        setPreferenceFilter('hidden');
                        setCollectionFilter(null);
                      }}
                      label="Hidden"
                    />
                    <SidebarItem
                      active={preferenceFilter === 'collection'}
                      onClick={() => setPreferenceFilter('collection')}
                      label="Collections"
                    />

                    {/* Drag-and-drop collections (fast sorting) */}
                    <div
                      style={{
                        border: '1px solid var(--border-light)',
                        background: 'var(--surface)',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                      onDragOver={(e) => {
                        if (!session?.user?.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                    >
                      <div className="vehicle-sidebar-mini" style={{ fontWeight: 700 }}>
                        Drop vehicles onto a collection
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          className="input"
                          value={newCollectionName}
                          placeholder="New collection name"
                          onChange={(e) => setNewCollectionName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            const next = newCollectionName.trim();
                            if (!next) return;
                            setPreferenceFilter('collection');
                            setCollectionFilter(next);
                            setNewCollectionName('');
                          }}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => {
                            const next = newCollectionName.trim();
                            if (!next) return;
                            setPreferenceFilter('collection');
                            setCollectionFilter(next);
                            setNewCollectionName('');
                          }}
                        >
                          CREATE
                        </button>
                      </div>

                      <button
                        type="button"
                        className="vehicle-sidebar-item"
                        style={{ justifyContent: 'space-between' }}
                        onClick={() => {
                          setPreferenceFilter('collection');
                          setCollectionFilter(null);
                        }}
                        onDragOver={(e) => {
                          if (!session?.user?.id) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={async (e) => {
                          e.preventDefault();
                          const dragged = extractVehicleIdFromDrop(e);
                          if (!dragged) return;
                          const ids = getDraggedVehicleIds(dragged);
                          await assignCollectionToVehicles(ids, null);
                        }}
                      >
                        <span style={{ textAlign: 'left' }}>Unassigned</span>
                        <span className="vehicle-sidebar-mini">
                          {Array.from(vehiclePreferences.values()).filter((p) => !p.collection_name).length}
                        </span>
                      </button>

                      {collectionNames.length === 0 && (
                        <div className="vehicle-sidebar-mini">
                          No collections yet. Create one, then drag vehicles onto it.
                        </div>
                      )}

                      {collectionNames.map((name) => {
                        const isActive = preferenceFilter === 'collection' && collectionFilter === name;
                        const count = collectionCounts.get(name) || 0;
                        return (
                          <button
                            key={name}
                            type="button"
                            className={`vehicle-sidebar-item ${isActive ? 'vehicle-sidebar-item-active' : ''}`}
                            style={{ justifyContent: 'space-between' }}
                            onClick={() => {
                              setPreferenceFilter('collection');
                              setCollectionFilter(name);
                            }}
                            onDragOver={(e) => {
                              if (!session?.user?.id) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              const dragged = extractVehicleIdFromDrop(e);
                              if (!dragged) return;
                              const ids = getDraggedVehicleIds(dragged);
                              await assignCollectionToVehicles(ids, name);
                              setPreferenceFilter('collection');
                              setCollectionFilter(name);
                            }}
                          >
                            <span style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                            <span className="vehicle-sidebar-mini">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </SidebarSection>

                <SidebarSection title="Relationships" sectionKey="relationships">
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {tabMeta.map(t => (
                      <SidebarItem
                        key={t.key}
                        active={activeTab === t.key}
                        onClick={() => {
                          setActiveTab(t.key);
                          setSelectedVehicleIds(new Set());
                          if (t.key !== 'discovered') setDiscoverySourceFilter(null);
                        }}
                        label={t.label}
                        right={<span className="vehicle-sidebar-mini">{t.count}</span>}
                      />
                    ))}
                  </div>
                </SidebarSection>

                <SidebarSection
                  title="Sources"
                  sectionKey="sources"
                  hidden={activeTab !== 'discovered' || vehicleRelationships.discovered.length === 0}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <SidebarItem
                      active={discoverySourceFilter === null}
                      onClick={() => setDiscoverySourceFilter(null)}
                      label="All sources"
                    />
                    {Array.from(
                      new Set(vehicleRelationships.discovered.map(r => r.context).filter(Boolean))
                    )
                      .sort()
                      .map((source) => (
                        <SidebarItem
                          key={String(source)}
                          active={discoverySourceFilter === source}
                          onClick={() => setDiscoverySourceFilter(source || null)}
                          label={String(source)}
                        />
                      ))}
                  </div>
                </SidebarSection>

                <SidebarSection title={`Vehicles (${filteredRelationships.length})`} sectionKey="vehicles">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {filteredRelationships.slice(0, 60).map((rel, index) => (
                      <Link
                        key={`sidebar-${rel.vehicle.id}-${rel.relationshipType || 'default'}-${index}`}
                        to={`/vehicle/${rel.vehicle.id}`}
                        style={{
                          display: 'block',
                          padding: '8px 10px',
                          border: '1px solid var(--border-light)',
                          background: 'var(--white)',
                          textDecoration: 'none',
                          color: 'inherit'
                        }}
                      >
                        <div style={{ fontSize: '8pt', fontWeight: 700 }}>
                          {rel.vehicle.year} {rel.vehicle.make} {rel.vehicle.model}
                        </div>
                        <div className="vehicle-sidebar-mini">
                          {rel.relationshipType.toUpperCase()}
                          {rel.context ? ` · ${rel.context}` : ''}
                        </div>
                      </Link>
                    ))}
                    {filteredRelationships.length > 60 && (
                      <div className="vehicle-sidebar-mini">
                        Showing first 60. Use search to narrow.
                      </div>
                    )}
                  </div>
                </SidebarSection>

                {!session && Object.values(vehicleRelationships).some(arr => arr.length > 0) && (
                  <div className="vehicle-sidebar-section">
                    <div className="vehicle-sidebar-section-title">Sync</div>
                    <div className="vehicle-sidebar-section-body">
                      <p className="text-small" style={{ marginBottom: '12px' }}>
                        Your vehicles are stored locally. Sign in to sync across devices.
                      </p>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => navigate('/login')}
                      >
                        SIGN IN
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>

          <main className="vehicle-library-main">
            <div className="vehicle-library-toolbar">
              <div className="vehicle-library-toolbar-left">
                <div style={{ fontSize: '8pt', fontWeight: 700 }}>
                  {currentTabLabel} ({filteredRelationships.length})
                </div>
                <input
                  type="text"
                  placeholder="Search vehicles..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input"
                  style={{ maxWidth: '420px' }}
                />
              </div>
              <div className="vehicle-library-toolbar-right">
                {sidebarCollapsed && (
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => setSidebarCollapsed(false)}
                  >
                    EXPAND
                  </button>
                )}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="select"
                >
                  <option value="created_at">Sort by Date Added</option>
                  <option value="year">Sort by Year</option>
                  <option value="make">Sort by Make</option>
                  <option value="model">Sort by Model</option>
                </select>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => loadVehicleRelationships()}
                >
                  REFRESH
                </button>
                <button
                  type="button"
                  className="button button-primary button-small"
                  onClick={() => navigate('/vehicle/add')}
                >
                  ADD
                </button>
              </div>
            </div>

            <div className="vehicle-library-scroll">
              {currentRelationships.length === 0 && (
                <div className="card">
                  <div className="card-body text-center" style={{ padding: '48px 24px' }}>
                    <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px' }}>
                      No vehicles yet
                    </div>
                    <div className="text-small" style={{ marginBottom: '16px' }}>
                      Add a vehicle to start building a clean, low-stress library.
                    </div>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => navigate('/vehicle/add')}
                    >
                      ADD VEHICLE
                    </button>
                  </div>
                </div>
              )}

              {filteredRelationships && filteredRelationships.length > 0 && (
                <>
                  {/* All view: group by relationship so buckets never mix (e.g., Discovered vs Previously Owned) */}
                  {activeTab === 'associated' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                      {groupedRelationships.map((group) => (
                        <div key={group.type}>
                          <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
                            {relationshipLabel(group.type)} ({group.items.length})
                          </div>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                              gap: '12px'
                            }}
                          >
                            {group.items.slice(0, displayLimit).map((relationship, index) => {
                              const vehicle = relationship?.vehicle;
                              if (!vehicle || !relationship) return null;
                              const isSelected = selectedVehicleIds.has(vehicle.id);
                              // Use composite key with index to avoid duplicates when same vehicle appears in multiple groups
                              return (
                                <div key={`${vehicle.id}-${group.type}-${relationship.relationshipType || 'default'}-${index}`} style={{ position: 'relative' }}>
                                  {session?.user?.id && (
                                    <>

                                      <div
                                        style={{
                                          position: 'absolute',
                                          bottom: '8px',
                                          right: '8px',
                                          zIndex: 10,
                                          background: 'var(--surface-glass)',
                                          border: '1px solid var(--border-light)',
                                          padding: '3px'
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={(e) => {
                                            const newSelection = new Set(selectedVehicleIds);
                                            if (e.target.checked) newSelection.add(vehicle.id);
                                            else newSelection.delete(vehicle.id);
                                            setSelectedVehicleIds(newSelection);
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                        />
                                      </div>
                                    </>
                                  )}

                                  <GarageVehicleCard
                                    vehicle={vehicle}
                                    relationship={relationship}
                                    onRefresh={() => {
                                      loadVehicleRelationships();
                                      loadVehiclePreferences();
                                    }}
                                    onEditRelationship={(vehicleId, current) => {
                                      setRelationshipModal({
                                        vehicleId,
                                        currentRelationship: current
                                      });
                                    }}
                                  />

                                  {session?.user?.id && isSelected && (
                                    <div style={{ marginTop: '8px', padding: '8px', background: 'var(--grey-50)', border: '1px solid var(--border-light)' }}>
                                      <VehicleOrganizationToolbar
                                        vehicleId={vehicle.id}
                                        userId={session.user.id}
                                        onUpdate={() => {
                                          loadVehiclePreferences();
                                          loadVehicleRelationships();
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {group.items.length > displayLimit && (
                              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px' }}>
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  onClick={() => setDisplayLimit(prev => prev + 50)}
                                >
                                  Load More ({group.items.length - displayLimit} remaining)
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '12px'
                      }}
                    >
                      {filteredRelationships.slice(0, displayLimit).map((relationship, index) => {
                        const vehicle = relationship?.vehicle;
                        if (!vehicle || !relationship) return null;
                        const isSelected = selectedVehicleIds.has(vehicle.id);
                        // Use composite key with index to avoid duplicates when same vehicle appears multiple times
                        return (
                          <div key={`filtered-${vehicle.id}-${relationship.relationshipType || 'default'}-${index}`} style={{ position: 'relative' }}>
                            {session?.user?.id && (
                              <>

                                <div
                                  style={{
                                    position: 'absolute',
                                    bottom: '8px',
                                    right: '8px',
                                    zIndex: 10,
                                    background: 'var(--surface-glass)',
                                    border: '1px solid var(--border-light)',
                                    padding: '3px'
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      const newSelection = new Set(selectedVehicleIds);
                                      if (e.target.checked) newSelection.add(vehicle.id);
                                      else newSelection.delete(vehicle.id);
                                      setSelectedVehicleIds(newSelection);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                  />
                                </div>
                              </>
                            )}

                            <GarageVehicleCard
                              vehicle={vehicle}
                              relationship={relationship}
                              onRefresh={() => {
                                loadVehicleRelationships();
                                loadVehiclePreferences();
                              }}
                              onEditRelationship={(vehicleId, current) => {
                                setRelationshipModal({
                                  vehicleId,
                                  currentRelationship: current
                                });
                              }}
                            />

                            {session?.user?.id && isSelected && (
                              <div style={{ marginTop: '8px', padding: '8px', background: 'var(--grey-50)', border: '1px solid var(--border-light)' }}>
                                <VehicleOrganizationToolbar
                                  vehicleId={vehicle.id}
                                  userId={session.user.id}
                                  onUpdate={() => {
                                    loadVehiclePreferences();
                                    loadVehicleRelationships();
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {filteredRelationships.length > displayLimit && (
                        <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px' }}>
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => setDisplayLimit(prev => prev + 50)}
                          >
                            Load More ({filteredRelationships.length - displayLimit} remaining)
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </main>
        </div>
      )}
      {/* Profile relationship editor modal */}
      {relationshipModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 10002,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px'
          }}
          onClick={() => setRelationshipModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--white)',
              border: '2px solid var(--border)',
              boxShadow: 'var(--shadow)',
              maxWidth: '520px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
          >
            <VehicleRelationshipManager
              vehicleId={relationshipModal.vehicleId}
              currentRelationship={relationshipModal.currentRelationship}
              onUpdate={() => {
                loadVehicleRelationships();
                setRelationshipModal(null);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};

const Vehicles: React.FC = () => (
  <ErrorBoundary>
    <VehiclesInner />
  </ErrorBoundary>
);

export default Vehicles; 