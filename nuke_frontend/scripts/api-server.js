import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();

// Configure CORS to allow Chrome extensions
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests from Chrome extensions and localhost
    if (!origin || origin.startsWith('chrome-extension://') || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Initialize Supabase clients
const supabase = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
);

// Service role client for bypassing RLS
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
); // Local dev service key

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password required' 
      });
    }
    
    // Authenticate with Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      return res.status(401).json({ 
        success: false, 
        error: error.message 
      });
    }
    
    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    
    return res.json({
      success: true,
      token: data.session.access_token,
      userId: data.user.id,
      profile
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Create vehicle from BAT data
app.post('/api/vehicles/create-from-bat', async (req, res) => {
  try {
    const { extractedData, userId } = req.body;
    
    // Get auth token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        error: 'No authorization token provided' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify the token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid or expired token' 
      });
    }
    
    // Verify userId matches token
    if (user.id !== userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'User ID mismatch' 
      });
    }
    
    if (!extractedData) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing extracted data' 
      });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Profile not found for user:', user.id);
      return res.status(404).json({ 
        success: false, 
        error: 'User profile not found. Please complete your profile first.' 
      });
    }

    // Parse title for make/model/year if not provided
    let make = extractedData.make;
    let model = extractedData.model;
    let year = extractedData.year;
    
    if (extractedData.title) {
      // Try to extract from title like "1987 GMC Suburban"
      const titleMatch = extractedData.title.match(/(\d{4})\s+(\w+)\s+([\w\s]+?)(?:\s+for|$)/i);
      if (titleMatch) {
        year = year || titleMatch[1];
        make = make || titleMatch[2];
        model = model || titleMatch[3];
      }
    }
    
    // Ensure we always have make and model for the trigger
    make = make || 'Unknown';
    model = model || extractedData.title || 'Vehicle';

    // Pre-create user_contributions record using admin client to bypass RLS
    const contributionDate = new Date().toISOString().split('T')[0];
    await supabaseAdmin
      .from('user_contributions')
      .insert({
        user_id: profile.id,
        contribution_date: contributionDate,
        contribution_type: 'vehicle_data',
        contribution_count: 0,
        metadata: {}
      })
      .then(() => {})
      .catch(() => {}); // Ignore if already exists

    // Create vehicle with fields matching the database schema
    const vehicleData = {
      // Core vehicle info (required)
      user_id: profile.id,
      make: make,
      model: model,
      year: year ? parseInt(year) : null,
      vin: extractedData.vin || null,
      
      // Details (matching DB columns)
      mileage: extractedData.mileage ? parseInt(extractedData.mileage) : null,
      color: extractedData.exterior_color || null,
      engine_size: extractedData.engine_size || extractedData.engine || null,
      transmission: extractedData.transmission || null,
      drivetrain: extractedData.drivetrain || null,
      fuel_type: extractedData.fuel_type || null,
      
      // Sale info
      purchase_price: extractedData.sale_price || extractedData.current_price 
        ? parseFloat(extractedData.sale_price || extractedData.current_price) 
        : null,
      
      // Notes field to store BAT metadata
      notes: `Discovered from BAT: ${extractedData.url}\nSeller: ${extractedData.seller || 'Unknown'}\nBids: ${extractedData.bids || extractedData.number_of_bids || 0}\nComments: ${extractedData.comments || extractedData.number_of_comments || 0}\nViews: ${extractedData.views || 0}`,
      
      // Default visibility
      is_public: false
    };

    // Use admin client to insert vehicle and bypass RLS issues
    const { data: vehicle, error: vehicleError } = await supabaseAdmin
      .from('vehicles')
      .insert([vehicleData])
      .select()
      .single();

    if (vehicleError) {
      console.error('Vehicle creation error:', vehicleError);
      return res.status(500).json({ 
        success: false, 
        error: vehicleError.message || 'Failed to create vehicle profile' 
      });
    }

    // Create timeline event using admin client
    const eventData = {
      vehicle_id: vehicle.id,
      event_type: 'discovered',
      event_title: 'Vehicle Discovered on Bring a Trailer',
      event_description: `Discovered via BAT Chrome Extension from ${extractedData.url}`,
      confidence_score: 100,
      metadata: {
        source: 'bat_extension',
        url: extractedData.url,
        discovered_by: profile.email,
        bat_listing_title: extractedData.title,
        bat_bids: extractedData.bids || extractedData.number_of_bids,
        bat_comments: extractedData.comments || extractedData.number_of_comments,
        bat_views: extractedData.views,
        bat_seller: extractedData.seller || extractedData.seller_username,
        bat_sale_status: extractedData.sale_status,
        extraction_data: extractedData
      }
    };

    const { error: eventError } = await supabaseAdmin
      .from('timeline_events')
      .insert([eventData]);

    if (eventError) {
      console.error('Timeline event error:', eventError);
      // Don't fail the whole request if timeline event fails
    }

    return res.json({
      success: true,
      vehicleId: vehicle.id,
      redirectUrl: `/vehicle-edit/${vehicle.id}`
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

const PORT = process.env.API_PORT || 4000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
