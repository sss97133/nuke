import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
// AppLayout now provided globally by App.tsx
import GarageVehicleCard from '../components/vehicles/GarageVehicleCard';
import VehicleRelationshipManager from '../components/VehicleRelationshipManager';
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
  const [activeTab, setActiveTab] = useState<VehiclesTab>('associated');
  const [relationshipModal, setRelationshipModal] = useState<{
    vehicleId: string;
    currentRelationship: string | null;
  } | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    checkAuth();
    
    // URL params for tab selection removed - categorize tab no longer exists
    
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event, session?.user?.id);
        setSession(session);
        loadVehicleRelationships(); // Reload vehicle relationships when auth state changes
      }
    );

    return () => subscription.unsubscribe();
  }, [searchParams]);

  useEffect(() => {
    loadVehicleRelationships();
  }, [session]); // Reload vehicle relationships when session changes

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
        
        const discoveredVehicles = (rpcData.discovered_vehicles || []).map((item: any) => ({
          relationship_type: item.relationship_type || 'interested',
          vehicles: {
            ...item.vehicle,
            vehicle_images: item.images || []
          }
        }));
        
        const verifiedOwnerships = (rpcData.verified_ownerships || []).map((item: any) => ({
          vehicle_id: item.vehicle_id,
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

        // Process discovered vehicles
        discoveredVehicles.forEach((discovery: any) => {
          const vehicle = discovery.vehicles;
          if (!vehicle) return;

          const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
          const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;

          const relationshipType = discovery.relationship_type || 'interested';
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
            relationshipType: relationshipType as any,
            role: relationshipType,
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

        // Process vehicles uploaded by user that don't have explicit relationships
        const explicitVehicleIds = new Set([
          ...verifiedOwnerships.map((o: any) => o.vehicle_id),
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
              isAnonymous: false,
              created_at: vehicle.created_at
            },
            relationshipType: 'contributing',
            role: 'Uploader (needs ownership verification)',
            lastActivity: vehicle.created_at
          });
        });

        setVehicleRelationships({ owned, contributing, interested, discovered, curated, consigned, previously_owned });
        console.log(`[Vehicles] RPC: ${owned.length} owned, ${contributing.length} contributing, ${interested.length} interested`);
        return;
      }
      
      // Fallback: RPC doesn't exist or failed - use separate queries
      console.warn('[Vehicles] RPC function not available, using fallback queries');
      
      // Load vehicles and their relationships
      // Get all vehicles the user uploaded (for "Uploaded" tab, not "Owned")
      // Query vehicles first, then fetch images separately to avoid PostgREST relationship ambiguity
      const [userVehiclesResult, uploadedVehiclesResult] = await Promise.all([
        supabase
          .from('vehicles')
          .select('*')
          .eq('user_id', session.user.id),
        supabase
          .from('vehicles')
          .select('*')
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
        .select('relationship_type, vehicle_id')
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
          relationship_type: 'interested' // Default fallback
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
            .select('*')
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
          
          discoveredVehicles = discoveredVehicles.map(dv => ({
            ...dv,
            vehicles: vehiclesMap.get(dv.vehicle_id) ? {
              ...vehiclesMap.get(dv.vehicle_id),
              vehicle_images: imagesByVehicle.get(dv.vehicle_id) || []
            } : null
          }));
        }
      }

      // Get verified ownership (LEGAL ownership with documents)
      // Query ownership_verifications first, then fetch vehicles and images separately
      const { data: verifiedOwnershipsData, error: verifiedError } = await supabase
        .from('ownership_verifications')
        .select('vehicle_id')
        .eq('user_id', session.user.id)
        .eq('status', 'approved');
      
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
      
      console.log('[Vehicles] Verified ownerships:', verifiedOwnerships?.length || 0);
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

      // Process discovered vehicles (from discovered_vehicles table)
      (discoveredVehicles || []).forEach((discovery: any) => {
        const vehicle = discovery.vehicles;
        if (!vehicle) return;

        const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
        const imageUrl = primaryImage?.variants?.large || primaryImage?.variants?.medium || primaryImage?.image_url;

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

      // Process vehicles uploaded by user that don't have explicit relationships
      // IMPORTANT: These are vehicles where uploaded_by matches but no relationship is explicitly set
      // The uploader is NOT automatically the owner - they need to verify ownership separately
      const explicitVehicleIds = new Set([
        ...(verifiedOwnerships || []).map((o: any) => o.vehicle_id),
        ...(discoveredVehicles || []).map((d: any) => d.vehicles?.id).filter(Boolean)
      ]);

      (userAddedVehicles || []).forEach((vehicle: any) => {
        // Skip if this vehicle already has an explicit relationship
        if (explicitVehicleIds.has(vehicle.id)) return;

        // Place in contributing section - uploaders are contributors, not automatic owners
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
            isAnonymous: false,
            created_at: vehicle.created_at
          },
          relationshipType: 'contributing',
          role: 'Uploader (needs ownership verification)',
          lastActivity: vehicle.created_at
        });
      });

      setVehicleRelationships({ owned, contributing, interested, discovered, curated, consigned, previously_owned });
      
      console.log(`Categorized vehicles: ${owned.length} owned, ${contributing.length} contributing, ${interested.length} interested`);
    } catch (error) {
      console.error('Error in loadVehicleRelationships:', error);
    } finally {
      setLoading(false);
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

  // Filter and sort current relationships
  const filteredRelationships = currentRelationships
    .filter(relationship => {
      if (!searchTerm) return true;
      const searchLower = searchTerm.toLowerCase();
      const vehicle = relationship.vehicle;
      return (
        vehicle.year.toString().includes(searchLower) ||
        vehicle.make.toLowerCase().includes(searchLower) ||
        vehicle.model.toLowerCase().includes(searchLower) ||
        (vehicle.vin && vehicle.vin.toLowerCase().includes(searchLower)) ||
        (vehicle.color && vehicle.color.toLowerCase().includes(searchLower)) ||
        (relationship.role && relationship.role.toLowerCase().includes(searchLower))
      );
    })
    .sort((a, b) => {
      const aVehicle = a.vehicle;
      const bVehicle = b.vehicle;
      switch (sortBy) {
        case 'year':
          return bVehicle.year - aVehicle.year;
        case 'make':
          return aVehicle.make.localeCompare(bVehicle.make);
        case 'model':
          return aVehicle.model.localeCompare(bVehicle.model);
        case 'created_at':
        default:
          return new Date(bVehicle.created_at).getTime() - new Date(aVehicle.created_at).getTime();
      }
    });


  return (
    <>
      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading vehicles...</p>
        </div>
      ) : (
        <div className="fade-in">
          {/* Page Header with Add Vehicle Button */}
          <section className="section">
            <div className="card">
              <div className="card-body">
                <button 
                  className="button button-primary w-full"
                  onClick={() => navigate('/add-vehicle')}
                >
                  Add Vehicle
                </button>
              </div>
            </div>
          </section>

          {/* Relationship Tabs */}
          <section className="section">
            <div className="card">
              <div className="card-header">
                <div className="vehicle-controls-container">
                  {/* Filter Buttons */}
                  <div className="filter-buttons">
                    <button
                      className={`button-win95 ${
                        activeTab === 'associated' ? 'button-win95-pressed' : ''
                      }`}
                      onClick={() => setActiveTab('associated')}
                    >
                      Associated ({allRelationships.length})
                    </button>
                    <button
                      className={`button-win95 ${
                        activeTab === 'owned' ? 'button-win95-pressed' : ''
                      }`}
                      onClick={() => setActiveTab('owned')}
                    >
                      Owned ({vehicleRelationships.owned.length})
                    </button>
                    <button
                      className={`button-win95 ${
                        activeTab === 'discovered' ? 'button-win95-pressed' : ''
                      }`}
                      onClick={() => setActiveTab('discovered')}
                    >
                      Discovered ({vehicleRelationships.discovered.length})
                    </button>
                    <button
                      className={`button-win95 ${
                        activeTab === 'curated' ? 'button-win95-pressed' : ''
                      }`}
                      onClick={() => setActiveTab('curated')}
                    >
                      Curated ({vehicleRelationships.curated.length})
                    </button>
                    <button
                      className={`button-win95 ${
                        activeTab === 'consigned' ? 'button-win95-pressed' : ''
                      }`}
                      onClick={() => setActiveTab('consigned')}
                    >
                      Consigned ({vehicleRelationships.consigned.length})
                    </button>
                    <button
                      className={`button-win95 ${
                        activeTab === 'previously_owned' ? 'button-win95-pressed' : ''
                      }`}
                      onClick={() => setActiveTab('previously_owned')}
                    >
                      Previously Owned ({vehicleRelationships.previously_owned.length})
                    </button>
                    <button
                      className={`button-win95 ${
                        activeTab === 'contributing' ? 'button-win95-pressed' : ''
                      }`}
                      onClick={() => setActiveTab('contributing')}
                    >
                      Contributing ({vehicleRelationships.contributing.length})
                    </button>
                    <button
                      className={`button-win95 ${
                        activeTab === 'interested' ? 'button-win95-pressed' : ''
                      }`}
                      onClick={() => setActiveTab('interested')}
                    >
                      Interested ({vehicleRelationships.interested.length})
                    </button>
                  </div>

                  {/* Search and Sort Controls */}
                  {currentRelationships.length > 0 && (
                    <div className="search-sort-controls">
                      <input
                        type="text"
                        placeholder="Search vehicles..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input-win95"
                      />
                      <button className="button-win95 sort-button">
                        <select
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value)}
                          className="select-win95"
                        >
                          <option value="created_at">Sort by Date Added</option>
                          <option value="year">Sort by Year</option>
                          <option value="make">Sort by Make</option>
                          <option value="model">Sort by Model</option>
                        </select>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Empty State */}
          {currentRelationships.length === 0 && (
            <section className="section">
              <div className="card">
                <div className="card-body text-center" style={{ padding: '48px 24px' }}>
                  <h3 style={{ fontSize: '8px', marginBottom: '0' }}>
                    {activeTab === 'associated' ? 'No associated vehicles' : `No ${activeTab} vehicles`}
                  </h3>
                </div>
              </div>
            </section>
          )}


          {/* Vehicle Relationships Grid */}
          {filteredRelationships && filteredRelationships.length > 0 ? (
                <section className="section">
                  <div 
                    style={{ 
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                      gap: '12px',
                      padding: '8px'
                    }}
                  >
                    {filteredRelationships.map((relationship) => {
                      const vehicle = relationship?.vehicle;
                      if (!vehicle || !relationship) return null;
                      return (
                        <GarageVehicleCard
                          key={vehicle.id}
                          vehicle={vehicle}
                          relationship={relationship}
                          onRefresh={loadVehicleRelationships}
                          onEditRelationship={(vehicleId, current) => {
                            setRelationshipModal({
                              vehicleId,
                              currentRelationship: current
                            });
                          }}
                        />
                      );
                    })}
                  </div>
                </section>
              ) : (
                <section className="section">
                  <div className="card">
                    <div className="card-body text-center">
                      <h3 style={{ fontSize: '8px', marginBottom: '0' }}>
                        {activeTab === 'associated' ? 'No associated vehicles' : `No ${activeTab} vehicles`}
                      </h3>
                    </div>
                  </div>
                </section>
              )}

          {/* Authentication Notice */}
          {!session && Object.values(vehicleRelationships).some(arr => arr.length > 0) && (
            <section className="section">
              <div className="card">
                <div className="card-header">Local Storage Notice</div>
                <div className="card-body">
                  <p className="text-small" style={{ marginBottom: '12px' }}>
                    Your vehicles are stored locally. Sign in to sync across devices and access advanced features.
                  </p>
                  <button 
                    className="button button-primary"
                    onClick={() => navigate('/login')}
                  >
                    Sign In to Sync
                  </button>
                </div>
              </div>
            </section>
          )}
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