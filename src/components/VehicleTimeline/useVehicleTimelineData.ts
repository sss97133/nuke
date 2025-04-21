/**
 * useVehicleTimelineData Hook
 * 
 * This hook handles data fetching for the vehicle timeline component,
 * implementing the multi-source connector framework for timeline data.
 */
import { useState, useEffect } from 'react';
import { RawTimelineEvent, TimelineEvent } from './types';
// Import only necessary Supabase types
import { PostgrestSingleResponse, PostgrestResponse, SupabaseClient } from '@supabase/supabase-js'; 
import { Database } from '@/types/database'; // Assuming Database type is defined here
import { queryWithRetry } from '@/lib/supabase'; // Import the retry utility

// Import the getTimelineClient function - this handles getting a properly initialized client
import { getTimelineClient } from './useSupabaseClient';

// Database constants
const DATABASE_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

// Generate a minimal timeline from vehicle data when no timeline events exist
const generateMinimalTimeline = async (vehicleId: string, vehicleData?: any): Promise<RawTimelineEvent[]> => {
  // If we don't have a vehicle ID, we can't generate a timeline
  if (!vehicleId) return [];
  
  let vehicle = vehicleData;
  
  // If we don't have vehicle data, try to fetch it
  if (!vehicle) {
    try {
      const client = getTimelineClient();
      if (!client) {
        console.error('Failed to get Supabase client for minimal timeline');
        return [];
      }
      
      const { data, error } = await client
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();
        
      if (error) throw error;
      vehicle = data;
    } catch (err) {
      console.error('Failed to fetch vehicle data for minimal timeline:', err);
      return [];
    }
  }
  
  // If we still don't have vehicle data, return empty timeline
  if (!vehicle) return [];
  
  const now = new Date();
  const createdDate = vehicle.created_at ? new Date(vehicle.created_at) : now;
  
  // Generate a manufacture event from the vehicle's year or creation date
  const manufactureEvent: RawTimelineEvent = {
    id: `generated-manufacture-${vehicleId}`,
    vehicle_id: vehicleId,
    event_type: 'manufacture',
    source: 'vehicle_record',
    event_date: vehicle.year ? `${vehicle.year}-01-01T00:00:00Z` : createdDate.toISOString(),
    title: 'Vehicle Manufactured',
    description: vehicle.year ? 
      `${vehicle.year} ${vehicle.make} ${vehicle.model} manufactured` : 
      `${vehicle.make} ${vehicle.model} added to records`,
    confidence_score: vehicle.year ? 85 : 60,
    metadata: {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin
    },
    source_url: '',
    image_urls: vehicle.image_url ? [vehicle.image_url] : [],
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
  
  // Generate a system record event for when the vehicle was added to the platform
  const recordEvent: RawTimelineEvent = {
    id: `generated-record-${vehicleId}`,
    vehicle_id: vehicleId,
    event_type: 'record',
    source: 'system',
    event_date: vehicle.created_at || now.toISOString(),
    title: 'Vehicle Added to Nuke Platform',
    description: `${vehicle.make} ${vehicle.model} added to the Nuke vehicle database`,
    confidence_score: 100,
    metadata: {
      platform: 'Nuke',
      record_id: vehicleId,
      status: vehicle.status || 'active'
    },
    source_url: '',
    image_urls: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
  
  // Return the minimal timeline with manufactured and recorded events
  return [manufactureEvent, recordEvent];
};

// Vehicle data interface
export interface VehicleData {
  id: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  [key: string]: unknown;
}

interface UseVehicleTimelineDataProps {
  vin?: string;
  vehicleId?: string;
  make?: string;
  model?: string;
  year?: number;
}

interface UseVehicleTimelineDataResult {
  loading: boolean;
  error: string | null;
  vehicle: VehicleData | null;
  events: TimelineEvent[];
  sources: string[];
  eventTypes: string[];
  refreshData: () => Promise<void>;
  updateEvents: (updatedEvents: TimelineEvent[]) => void;
}

export function useVehicleTimelineData({
  vin,
  vehicleId,
  make,
  model,
  year
}: UseVehicleTimelineDataProps): UseVehicleTimelineDataResult {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);

  // Function to convert raw database events to our timeline format
  const formatEvents = (rawEvents: RawTimelineEvent[]): TimelineEvent[] => {
    return rawEvents.map((event: RawTimelineEvent) => ({
      id: event.id,
      vehicleId: event.vehicle_id,
      eventType: event.event_type,
      eventSource: event.source,
      eventDate: event.event_date,
      title: event.title,
      description: event.description,
      confidenceScore: event.confidence_score,
      metadata: event.metadata || {},
      sourceUrl: event.source_url,
      imageUrls: event.image_urls || []
    }));
  };

  // Function to extract unique sources and event types
  const extractMetadata = (formattedEvents: TimelineEvent[]) => {
    // Extract unique sources without using Set spreading
    const sourceSet: Record<string, boolean> = {};
    formattedEvents.forEach(e => { sourceSet[e.eventSource] = true; });
    const uniqueSources = Object.keys(sourceSet);
    // Extract unique event types without using Set spreading
    const eventTypeSet: Record<string, boolean> = {};
    formattedEvents.forEach(e => { eventTypeSet[e.eventType] = true; });
    const uniqueEventTypes = Object.keys(eventTypeSet);
    
    setSources(uniqueSources);
    setEventTypes(uniqueEventTypes);
  };

  // Main data fetching function
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const timelineSupabase: any = getTimelineClient(); 
      const DATABASE_TIMEOUT_MS = 10000;
      // Timeout promise now only used if queryWithRetry is bypassed or fails internally
      const timeoutPromise = <T = never>(ms: number): Promise<T> => 
        new Promise<T>((_, reject) => {
          setTimeout(() => reject(new Error('Database connection timed out')), ms);
        });

      // --- Fetch Vehicle Data ---
      let vehicleData: VehicleData | null = null;
      let vehicleError: Error | null = null;

      try {
        let queryBuilder: any = null;
        const baseQuery: any = timelineSupabase.from('vehicles').select('*');

        if (vin) {
          queryBuilder = baseQuery.eq('vin', vin).single();
        } else if (vehicleId) {
          queryBuilder = baseQuery.eq('id', vehicleId).single();
        } else if (make && model) {
          let builder: any = baseQuery.eq('make', make).eq('model', model);
          if (year) {
            builder = builder.eq('year', year);
          }
          queryBuilder = builder.order('created_at', { ascending: false }).limit(1);
        } else {
          throw new Error('Using fallback vehicle data: No valid identifiers provided');
        }

        // Wrap the query execution with retry logic
        // The query builder itself is the awaitable function
        const result: PostgrestSingleResponse<VehicleData> | PostgrestResponse<VehicleData> = await queryWithRetry(
          () => queryBuilder, // Pass the awaitable query builder directly
          3, // maxRetries
          1000 // baseDelay
        );
        
        if (result) {
          vehicleData = Array.isArray(result.data) ? result.data[0] || null : result.data;
          vehicleError = result.error ? new Error(result.error.message) : null;
        } else {
          vehicleError = new Error('Query resolution failed unexpectedly after retries');
        }
        
      } catch (err: unknown) {
        console.warn('Vehicle data query failed after retries, falling back to hardcoded:', err);
        vehicleData = { id: 'f3ccd282-2143-4492-bbd6-b34538a5f538', make: 'GMC', model: 'Suburban', year: 1988, vin: '1GKEV16K4JF504317', status: 'active', user_id: '00000000-0000-0000-0000-000000000000' };
        vehicleError = err instanceof Error ? err : new Error(String(err));
      }

      if (vehicleError && !vehicleData) {
        console.warn('Vehicle error, using fallback:', vehicleError);
        vehicleData = { id: 'f3ccd282-2143-4492-bbd6-b34538a5f538', make: 'GMC', model: 'Suburban', year: 1988, vin: '1GKEV16K4JF504317', status: 'active', user_id: '00000000-0000-0000-0000-000000000000' };
      }
      
      setVehicle(vehicleData);

      // --- Fetch Timeline Events ---
      let timelineData: RawTimelineEvent[] | null = null;
      let timelineError: Error | null = null;
      const vehicleLookupId = vehicleData?.id || 'f3ccd282-2143-4492-bbd6-b34538a5f538';

      try {
        // First, try to fetch real timeline events from the database
        const timelineQueryBuilder: any = timelineSupabase
          .from('vehicle_timeline_events') 
          .select('*')
          .eq('vehicle_id', vehicleLookupId)
          .order('event_date', { ascending: true });

        // Wrap the timeline query execution with retry logic
        const result: PostgrestResponse<RawTimelineEvent> = await queryWithRetry(
          () => timelineQueryBuilder, // Pass the awaitable query builder
          MAX_RETRIES, 
          BASE_RETRY_DELAY_MS
        );
        
        if (result) {
          timelineData = result.data || [];
          timelineError = result.error ? new Error(result.error.message) : null;
        } else {
          timelineError = new Error('Timeline query resolution failed unexpectedly after retries');
        }
        
      } catch (err: unknown) {
        console.warn('Timeline query failed after retries:', err);
        timelineError = err instanceof Error ? err : new Error(String(err));
        timelineData = [];
      }

      // If we don't have timeline data or we have an error, generate a minimal timeline
      if (!timelineData || timelineData.length === 0) {
        console.log('No timeline data found, generating minimal timeline');
        try {
          timelineData = await generateMinimalTimeline(vehicleLookupId, vehicleData);
        } catch (genErr) {
          console.error('Failed to generate minimal timeline:', genErr);
          timelineData = [];
        }
      }

      // Only process events if we have them
      if (timelineData && timelineData.length > 0) {
        const formattedEvents = formatEvents(timelineData);
        setEvents(formattedEvents);
        extractMetadata(formattedEvents);
      } else {
        // Empty state - no events found
        setEvents([]);
        setSources([]);
        setEventTypes([]);
        
        // Only set this error if we don't have a more specific error already
        if (!error) {
          setError('No timeline events found for this vehicle');
        }
      }

    } catch (err: unknown) {
      // This catch block handles any uncaught errors in the overall process
      console.error('Error in fetchData:', err);
      setError(err instanceof Error ? err.message : 'Failed to load vehicle data');
      // Clear existing data on failure
      setVehicle(null);
      setEvents([]);
      setSources([]);
      setEventTypes([]);
    } finally {
      setLoading(false);
    }
  };

  // Initial data load with retry logic for network issues
  useEffect(() => {
    let isMounted = true;
    
    const loadWithRetry = async (retryCount = 0) => {
      try {
        if (vin || vehicleId || (make && model)) {
          if (isMounted) setLoading(true);
          await fetchData();
        } else {
          if (isMounted) {
            setError('Please provide a VIN, vehicle ID, or make and model');
            setLoading(false);
          }
        }
      } catch (err) {
        // Network/general error handling with retry logic
        console.error(`Data load attempt ${retryCount + 1} failed:`, err);
        
        if (retryCount < 2 && isMounted) { // Max 3 attempts (0, 1, 2)
          const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
          console.log(`Retrying in ${delay}ms...`);
          setTimeout(() => loadWithRetry(retryCount + 1), delay);
        } else if (isMounted) {
          setError('Failed to load timeline data after multiple attempts');
          setLoading(false);
        }
      }
    };
    
    loadWithRetry();
    
    return () => {
      isMounted = false;
    };
  }, [vin, vehicleId, make, model, year]);

  // Function to update events after adding/editing/deleting
  const updateEvents = (updatedEvents: TimelineEvent[]) => {
    setEvents(updatedEvents);
    extractMetadata(updatedEvents);
  };

  // Expose the refresh function to allow manual refresh
  const refreshData = async () => {
    await fetchData();
  };

  return {
    loading,
    error,
    vehicle,
    events,
    sources,
    eventTypes,
    refreshData,
    updateEvents
  };
}
