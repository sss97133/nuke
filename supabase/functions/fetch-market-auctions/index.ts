
// supabase/functions/fetch-market-auctions/index.ts
import { serve } from 'https://deno.land/std@0.131.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.0.0'

// Mock auction data for fallback and development
const mockAuctions = [
  {
    id: 'auction1',
    title: '1967 Shelby GT500',
    current_bid: 125000,
    image_url: 'https://images.unsplash.com/photo-1603386329225-868f9b1ee6c9?auto=format&fit=crop&w=800&q=80',
    end_date: new Date(Date.now() + 3600000 * 24 * 2).toISOString(), // 2 days from now
    location: 'Los Angeles, CA',
    bids_count: 17,
    vehicle: {
      year: 1967,
      make: 'Ford',
      model: 'Mustang Shelby GT500',
      mileage: 42650,
      exterior_color: 'Blue',
      engine: '428 Police Interceptor V8'
    }
  },
  {
    id: 'auction2',
    title: '2005 Ford GT',
    current_bid: 380000,
    image_url: 'https://images.unsplash.com/photo-1544829099-b9a0c07fad1a?auto=format&fit=crop&w=800&q=80',
    end_date: new Date(Date.now() + 3600000 * 24 * 5).toISOString(), // 5 days from now
    location: 'Miami, FL',
    bids_count: 31,
    vehicle: {
      year: 2005,
      make: 'Ford',
      model: 'GT',
      mileage: 4850,
      exterior_color: 'Red',
      engine: '5.4L Supercharged V8'
    }
  },
  {
    id: 'auction3',
    title: '1970 Plymouth Hemi Cuda',
    current_bid: 215000,
    image_url: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=800&q=80',
    end_date: new Date(Date.now() + 3600000 * 24 * 1).toISOString(), // 1 day from now
    location: 'Chicago, IL',
    bids_count: 23,
    vehicle: {
      year: 1970,
      make: 'Plymouth',
      model: 'Hemi Cuda',
      mileage: 38200,
      exterior_color: 'Orange',
      engine: '426 Hemi V8'
    }
  }
];

// Feature flag for gradual migration
const USE_REAL_DATA = {
  auctions: true
};

serve(async (req) => {
  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    // Check for environment variables
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      
      if (!USE_REAL_DATA.auctions) {
        console.log('Using mock auction data (feature flag off)');
        return new Response(JSON.stringify(mockAuctions), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      
      throw new Error('Missing required environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request parameters
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '10');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const orderBy = url.searchParams.get('orderBy') || 'end_date';
    const orderDirection = url.searchParams.get('orderDirection') || 'asc';
    
    // Validate order parameters to prevent SQL injection
    const validOrderFields = ['end_date', 'current_bid', 'created_at', 'bids_count'];
    const validOrderDirections = ['asc', 'desc'];
    
    const safeOrderField = validOrderFields.includes(orderBy) ? orderBy : 'end_date';
    const safeOrderDirection = validOrderDirections.includes(orderDirection) ? orderDirection : 'asc';
    
    if (!USE_REAL_DATA.auctions) {
      console.log('Using mock auction data (feature flag off)');
      return new Response(JSON.stringify(mockAuctions), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }
    
    try {
      console.log('Attempting to fetch auctions from database');
      
      // Query auctions table with joins for vehicle data
      const { data, error } = await supabase
        .from('auctions')
        .select(`
          *,
          vehicle:vehicle_id (
            id,
            year,
            make,
            model,
            mileage,
            exterior_color,
            engine
          )
        `)
        .order(safeOrderField, { ascending: safeOrderDirection === 'asc' })
        .limit(limit)
        .range(offset, offset + limit - 1);
      
      if (error) {
        throw error;
      }
      
      if (!data || data.length === 0) {
        console.log('No auctions found in database, returning mock data');
        return new Response(JSON.stringify(mockAuctions), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      
      // Transform data to match expected format if needed
      const transformedData = data.map(auction => {
        return {
          id: auction.id,
          title: auction.title || `${auction.vehicle?.year || ''} ${auction.vehicle?.make || ''} ${auction.vehicle?.model || ''}`,
          current_bid: auction.current_bid,
          image_url: auction.image_url,
          end_date: auction.end_date,
          location: auction.location,
          bids_count: auction.bids_count,
          vehicle: auction.vehicle || {}
        };
      });
      
      return new Response(JSON.stringify(transformedData), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    } catch (dbError) {
      console.error('Database error:', dbError);
      
      // Fall back to mock data
      console.log('Error fetching from database, falling back to mock data');
      return new Response(JSON.stringify(mockAuctions), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }
  } catch (err) {
    console.error('Error in fetch-market-auctions function:', err);
    
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      message: err.message
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
