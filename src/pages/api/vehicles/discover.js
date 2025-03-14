/**
 * API Handler for Vehicle Discovery
 * 
 * Handles vehicle discoveries from the browser extension and other sources
 * Integrates with the multi-source connector framework
 */

import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * API route handler for vehicle discovery
 * Receives vehicle data from external sources and integrates it into the user's profile
 */
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Initialize Supabase client
  const supabase = createServerSupabaseClient({ req, res });

  // Get user session
  const { data: { session } } = await supabase.auth.getSession();
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const userId = session.user.id;
    const vehicleData = req.body;
    
    // Validate required fields
    if (!vehicleData.title || !vehicleData.source_url) {
      return res.status(400).json({ error: 'Missing required vehicle data' });
    }
    
    // Prepare vehicle data
    const vehicleId = uuidv4();
    const now = new Date().toISOString();
    
    const vehicle = {
      id: vehicleId,
      user_id: userId,
      vin: vehicleData.vin || null,
      year: vehicleData.year || null,
      make: vehicleData.make || '',
      model: vehicleData.model || '',
      title: vehicleData.title,
      description: vehicleData.description || '',
      source_url: vehicleData.source_url,
      public_vehicle: false,
      created_at: now,
      updated_at: now,
      price: vehicleData.price || null,
      source: vehicleData.source || 'unknown'
    };
    
    // Create vehicle in database
    const { data: vehicleResult, error: vehicleError } = await supabase
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
      .from('vehicles')
      .insert(vehicle)
      .select()
      .single();
      
    if (vehicleError) {
      console.error('Error creating vehicle:', vehicleError);
      return res.status(500).json({ error: 'Failed to create vehicle' });
    }

    // Process timeline events if they exist
    if (vehicleData.timeline_events && vehicleData.timeline_events.length > 0) {
      // Process each timeline event
      const timelinePromises = vehicleData.timeline_events.map(async (event) => {
        const timelineEvent = {
          id: uuidv4(),
          vehicle_id: vehicleId,
          event_type: event.event_type,
          source: event.source,
          event_date: event.event_date || now,
          title: event.title,
          description: event.description || '',
          confidence_score: event.confidence_score || 0.7,
          metadata: event.metadata || {},
          created_at: now,
          updated_at: now,
          user_id: userId
        };
        
        // Create timeline event
        return supabase
          
          .insert(timelineEvent);
      });
      
      // Execute all timeline event inserts
      await Promise.all(timelinePromises);
    }
    
    // Process images if they exist
    if (vehicleData.images && vehicleData.images.length > 0) {
      // Process each image
      const imagePromises = vehicleData.images.map(async (imageUrl, index) => {
        const imageRecord = {
          id: uuidv4(),
          vehicle_id: vehicleId,
          user_id: userId,
          url: imageUrl,
          source_url: vehicleData.source_url,
          position: index,
          is_primary: index === 0,
          created_at: now,
          source: vehicleData.source || 'unknown'
        };
        
        // Create image record
        return supabase
          
          .insert(imageRecord);
      });
      
      // Execute all image inserts
      await Promise.all(imagePromises);
    }
    
    // Store the discovered data as raw data for future reference
    if (vehicleData.discovered_data) {
      const rawData = {
        id: uuidv4(),
        vehicle_id: vehicleId,
        data_type: 'discovery',
        data: vehicleData.discovered_data,
        source: vehicleData.source || 'unknown',
        created_at: now,
        updated_at: now
      };
      
      await supabase
        
        .insert(rawData);
    }

    // Return success with the created vehicle
    return res.status(200).json({
      success: true,
      id: vehicleId,
      message: 'Vehicle discovered successfully'
    });
    
  } catch (error) {
    console.error('Error processing vehicle discovery:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
