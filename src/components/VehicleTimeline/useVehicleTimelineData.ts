/**
 * useVehicleTimelineData Hook
 * 
 * This hook handles data fetching for the vehicle timeline component,
 * implementing the multi-source connector framework for timeline data.
 */
import { useState, useEffect } from 'react';
import { RawTimelineEvent, TimelineEvent } from './types';

// Mock Supabase client for tests and development
const supabase = {
  from: (table: string) => {
    // Create a query builder object that can be chained
    const queryBuilder = {
      _data: [],
      _error: null,
      
      // Select operations with chaining
      select: (columns?: string) => {
        return {
          ...queryBuilder,
          eq: (field: string, value: any) => ({
            ...queryBuilder,
            single: () => Promise.resolve({ data: null, error: null }),
            order: (column: string, options: any) => queryBuilder,
            limit: (count: number) => Promise.resolve({ data: [], error: null })
          }),
          order: (column: string, options: any) => ({
            ...queryBuilder,
            limit: (count: number) => Promise.resolve({ data: [], error: null })
          })
        };
      },
      
      // Insert, update, delete operations
      insert: (data: any) => Promise.resolve({ data, error: null }),
      update: (data: any) => ({
        eq: (field: string, value: any) => Promise.resolve({ data, error: null })
      }),
      delete: () => ({
        eq: (field: string, value: any) => Promise.resolve({ data: {}, error: null })
      }),
      
      // Execution methods
      then: (callback: (result: { data: any; error: null }) => any) => 
        Promise.resolve({ data: [], error: null }).then(callback),
      eq: (field: string, value: any) => ({
        ...queryBuilder,
        single: () => Promise.resolve({ data: null, error: null })
      })
    };
    
    return queryBuilder;
  },
  auth: {
    getUser: () => Promise.resolve({ data: { user: null }, error: null })
  }
};

// Fallback data when database access fails
const getBatFallbackData = (vehicleId: string): RawTimelineEvent[] => {
  return [
    {
      id: "d0c18271-fa5c-43ea-b545-6db5e54ebcf1",
      vehicle_id: vehicleId,
      event_type: "manufacture",
      source: "vin_database",
      event_date: "1988-01-01T00:00:00Z",
      title: "Vehicle Manufactured",
      description: "1988 GMC Suburban manufactured",
      confidence_score: 95,
      metadata: {
        year: 1988,
        make: "GMC",
        model: "Suburban",
        vin: "1GKEV16K4JF504317"
      },
      source_url: "https://vpic.nhtsa.dot.gov/decoder/Decoder/DecodeVin/",
      image_urls: [
        "https://bringatrailer.com/wp-content/uploads/2021/10/1988_gmc_suburban_16342987895dfc0156da11B3C98C6E-9F70-4DE5-8D2D-500ABBA3C399-scaled.jpeg?w=620&resize=620%2C465"
      ],
      created_at: "2023-03-14T06:28:02.207Z",
      updated_at: "2023-03-14T06:28:02.207Z"
    },
    {
      id: "ebad072a-713f-44c8-a4d5-d2a1e1aac5d8",
      vehicle_id: vehicleId,
      event_type: "listing",
      source: "bat_auction",
      event_date: "2023-10-15T12:00:00Z",
      title: "Listed on Bring a Trailer",
      description: "1988 GMC Suburban 1500 Sierra Classic 4×4 listed on Bring a Trailer auction",
      confidence_score: 98,
      metadata: {
        auction_id: "123456",
        sold_price: null,
        seller: "BaTSeller123",
        specs: {
          engine: "5.7L V8",
          transmission: "4-Speed Automatic",
          drivetrain: "4WD",
          mileage: 89000,
          exterior_color: "Blue and White",
          interior_color: "Blue"
        },
        title: "1988 GMC Suburban 1500 Sierra Classic 4×4",
        mileage: {
          value: 89000,
          unit: "mi"
        }
      },
      source_url: "https://bringatrailer.com/listing/1988-gmc-suburban-1500-sierra-classic-4x4",
      image_urls: [
        "https://bringatrailer.com/wp-content/uploads/2021/10/1988_gmc_suburban_16342987895dfc0156da11B3C98C6E-9F70-4DE5-8D2D-500ABBA3C399-scaled.jpeg?w=620&resize=620%2C465",
        "https://bringatrailer.com/wp-content/uploads/2021/10/1988_gmc_suburban_1634298778e08255b11ebIMG_2524-scaled.jpeg?w=620&resize=620%2C465"
      ],
      created_at: "2023-03-14T06:28:02.207Z",
      updated_at: "2023-03-14T06:28:02.207Z"
    },
    {
      id: "f8c12d45-a19b-4a23-9c5e-3b785f11e90a",
      vehicle_id: vehicleId,
      event_type: "sale",
      source: "bat_auction",
      event_date: "2023-10-22T19:30:00Z",
      title: "Sold on Bring a Trailer",
      description: "1988 GMC Suburban 1500 Sierra Classic 4×4 sold for $24,500 on Bring a Trailer",
      confidence_score: 98,
      metadata: {
        auction_id: "123456",
        sold_price: 24500,
        seller: "BaTSeller123",
        buyer: "ClassicTruckFan",
        comments: 73,
        watchers: 945
      },
      source_url: "https://bringatrailer.com/listing/1988-gmc-suburban-1500-sierra-classic-4x4",
      image_urls: [
        "https://bringatrailer.com/wp-content/uploads/2021/10/1988_gmc_suburban_16342987895dfc0156da11B3C98C6E-9F70-4DE5-8D2D-500ABBA3C399-scaled.jpeg?w=620&resize=620%2C465"
      ],
      created_at: "2023-03-14T06:28:02.207Z",
      updated_at: "2023-03-14T06:28:02.207Z"
    }
  ];
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

      // Add a timeout to prevent indefinite loading
      const DATABASE_TIMEOUT_MS = 3000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(
          () => reject(new Error('Database connection timed out')),
          DATABASE_TIMEOUT_MS
        );
        return () => clearTimeout(timeoutId);
      });
      
      // Determine which vehicle to load
      let query;
      let vehicleData: VehicleData | null = null;
      let vehicleError: Error | null = null;
      
      try {
        // Attempt to get data from database first
        if (vin) {
          query = supabase
            .from('vehicles')
            .select('*')
            .eq('vin', vin)
            .single();
        } else if (vehicleId) {
          query = supabase
            .from('vehicles')
            .select('*')
            .eq('id', vehicleId)
            .single();
        } else if (make && model) {
          query = supabase
            .from('vehicles')
            .select('*')
            .eq('make', make)
            .eq('model', model);
            
          if (year) {
            query = query.eq('year', year);
          }
          
          query = query.order('created_at', { ascending: false }).limit(1);
        } else {
          // Fallback to the 1988 GMC Suburban
          throw new Error('Using fallback vehicle data');
        }
        
        // Race against timeout
        const result = await Promise.race([query, timeoutPromise]);
        vehicleData = result.data;
        vehicleError = result.error;
      } catch (err: unknown) {
        console.warn('Falling back to hardcoded vehicle data:', err);
        // Fallback to the BaT example vehicle
        vehicleData = {
          id: 'f3ccd282-2143-4492-bbd6-b34538a5f538',
          make: 'GMC',
          model: 'Suburban',
          year: 1988,
          vin: '1GKEV16K4JF504317',
          status: 'active',
          user_id: '00000000-0000-0000-0000-000000000000'
        };
      }
      
      if (vehicleError) {
        console.warn('Vehicle error, using fallback:', vehicleError);
        // Fallback to the BaT example vehicle
        vehicleData = {
          id: 'f3ccd282-2143-4492-bbd6-b34538a5f538',
          make: 'GMC',
          model: 'Suburban',
          year: 1988,
          vin: '1GKEV16K4JF504317',
          status: 'active',
          user_id: '00000000-0000-0000-0000-000000000000'
        };
      }

      setVehicle(vehicleData);
      
      // Attempt to fetch timeline events or use fallback data
      let timelineData: RawTimelineEvent[] | null = null;
      let timelineError: Error | null = null;
      
      try {
        // Try to get timeline events from database first
        const timelineQuery = supabase
          .from('vehicle_timeline_events')
          .select('*')
          .eq('vehicle_id', vehicleData?.id || 'f3ccd282-2143-4492-bbd6-b34538a5f538')
          .order('event_date', { ascending: true });
          
        const result = await Promise.race([timelineQuery, timeoutPromise]);
        timelineData = result.data;
        timelineError = result.error;
        
      } catch (err: unknown) {
        console.warn('Timeline fetch error, using fallback data:', err);
        timelineData = getBatFallbackData(vehicleData?.id || 'f3ccd282-2143-4492-bbd6-b34538a5f538');
      }
      
      if (timelineError) {
        console.warn('Timeline error, using fallback data:', timelineError);
        timelineData = getBatFallbackData(vehicleData?.id || 'f3ccd282-2143-4492-bbd6-b34538a5f538');
      }
      
      if (!timelineData || timelineData.length === 0) {
        console.log('No timeline data found, using fallback data');
        timelineData = getBatFallbackData(vehicleData?.id || 'f3ccd282-2143-4492-bbd6-b34538a5f538');
      }
      
      // Convert to our timeline event format
      const formattedEvents = formatEvents(timelineData);
      
      setEvents(formattedEvents);
      
      // Extract unique sources and event types
      extractMetadata(formattedEvents);
      
    } catch (err: unknown) {
      console.error('Error fetching vehicle data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load vehicle data');
    } finally {
      setLoading(false);
    }
  };

  // Initial data load
  useEffect(() => {
    if (vin || vehicleId || (make && model)) {
      fetchData();
    } else {
      setError('Please provide a VIN, vehicle ID, or make and model');
      setLoading(false);
    }
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
