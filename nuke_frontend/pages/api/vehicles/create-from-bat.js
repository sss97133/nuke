import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { extractedData, userEmail } = req.body;
    
    if (!extractedData || !userEmail) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    // Get user ID from email
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', userEmail)
      .single();

    if (userError || !userData) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Create vehicle record with discovered_by field
    const vehicleData = {
      user_id: userData.id,
      discovered_by: userData.id, // Track who discovered this vehicle
      discovery_source: 'bat_extension',
      discovery_url: extractedData.url || null,
      
      // Core vehicle info
      year: extractedData.year ? parseInt(extractedData.year) : null,
      make: extractedData.make || null,
      model: extractedData.model || null,
      trim: extractedData.trim || null,
      vin: extractedData.vin || null,
      
      // Details
      engine: extractedData.engine || null,
      displacement: extractedData.displacement || null,
      transmission: extractedData.transmission || null,
      drivetrain: extractedData.drivetrain || null,
      fuel_type: extractedData.fuel_type || null,
      
      // Condition
      mileage: extractedData.mileage ? parseInt(extractedData.mileage) : null,
      exterior_color: extractedData.exterior_color || null,
      interior_color: extractedData.interior_color || null,
      
      // Auction data
      current_price: extractedData.current_price ? parseInt(extractedData.current_price) : null,
      sale_price: extractedData.sale_price ? parseInt(extractedData.sale_price) : null,
      sale_status: extractedData.sale_status || 'discovered',
      auction_end_date: extractedData.auction_end_date || null,
      
      // Metadata
      bat_listing_title: extractedData.title || null,
      bat_bids: extractedData.bids ? parseInt(extractedData.bids) : null,
      bat_comments: extractedData.comments ? parseInt(extractedData.comments) : null,
      bat_views: extractedData.views ? parseInt(extractedData.views) : null,
      bat_location: extractedData.location || null,
      bat_seller: extractedData.seller || null,
      
      // Status
      status: 'draft', // Start as draft for user to complete
      completion_percentage: calculateCompletion(extractedData),
      
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .insert([vehicleData])
      .select()
      .single();

    if (vehicleError) {
      console.error('Vehicle creation error:', vehicleError);
      return res.status(500).json({ error: 'Failed to create vehicle profile' });
    }

    // Create discovery event
    await supabase
      .from('timeline_events')
      .insert([{
        vehicle_id: vehicle.id,
        user_id: userData.id,
        event_type: 'discovery',
        event_date: new Date().toISOString(),
        description: `Vehicle discovered on Bring a Trailer`,
        metadata: {
          source: 'bat_extension',
          url: extractedData.url,
          price_at_discovery: extractedData.current_price
        }
      }]);

    return res.status(200).json({ 
      success: true,
      vehicleId: vehicle.id,
      message: 'Vehicle profile created successfully',
      redirectUrl: `/vehicles/${vehicle.id}/edit`
    });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function calculateCompletion(data) {
  const fields = [
    'year', 'make', 'model', 'vin', 'engine', 'transmission',
    'mileage', 'exterior_color', 'interior_color', 'current_price'
  ];
  
  const filledFields = fields.filter(field => data[field] && data[field] !== 'Unknown');
  return Math.round((filledFields.length / fields.length) * 100);
}
