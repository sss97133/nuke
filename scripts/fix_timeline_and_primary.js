const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixTimelineAndPrimary() {
  // First, authenticate to get proper access
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'test@example.com',
    password: 'test123456'
  });
  
  if (authError) {
    console.error('Auth error:', authError);
    // Try with test credentials
    const { data: authData2, error: authError2 } = await supabase.auth.signInWithPassword({
      email: 'testuser@example.com', 
      password: 'testpass123'
    });
    
    if (authError2) {
      console.error('Auth error 2:', authError2);
      console.log('Proceeding without auth...');
    }
  } else {
    console.log('Authenticated as:', authData.user.email);
  }
  
  const vehicleId = '7b07531f-e73a-4adb-b52c-d45922063edf';
  
  // Check primary image status
  console.log('\n--- Checking Primary Image Status ---');
  const { data: images, error: imgError } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', vehicleId);
    
  if (imgError) {
    console.error('Error fetching images:', imgError);
  } else {
    console.log(`Found ${images?.length || 0} images for vehicle`);
    if (images && images.length > 0) {
      images.forEach(img => {
        console.log(`Image ID: ${img.id}`);
        console.log(`  Primary: ${img.is_primary}`);
        console.log(`  URL: ${img.image_url}`);
      });
      
      // Check if any is marked as primary
      const primaryImage = images.find(img => img.is_primary === true);
      if (!primaryImage) {
        console.log('\n⚠️  No primary image set! Setting first image as primary...');
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({ is_primary: true })
          .eq('id', images[0].id);
          
        if (updateError) {
          console.error('Error setting primary:', updateError);
        } else {
          console.log('✅ Primary image set successfully');
        }
      } else {
        console.log('✅ Primary image already set:', primaryImage.id);
      }
    }
  }
  
  // Check timeline events
  console.log('\n--- Checking Timeline Events ---');
  const { data: events, error: eventsError } = await supabase
    .from('vehicle_timeline_events')
    .select('*')
    .eq('vehicle_id', vehicleId);
    
  if (eventsError) {
    console.error('Error fetching events:', eventsError);
  } else {
    console.log(`Found ${events?.length || 0} timeline events`);
    
    if (!events || events.length === 0) {
      console.log('\n⚠️  No timeline events! Creating one...');
      
      // Get vehicle details
      const { data: vehicle, error: vError } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();
        
      if (vError) {
        console.error('Error fetching vehicle:', vError);
      } else {
        // Create a timeline event
        const newEvent = {
          vehicle_id: vehicleId,
          user_id: vehicle.user_id,
          event_type: 'vehicle_added',
          source: 'user_input',
          title: 'Vehicle Added to Collection',
          description: `Added ${vehicle.year} ${vehicle.make} ${vehicle.model} to the system`,
          event_date: new Date().toISOString().split('T')[0],
          metadata: {
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            vin: vehicle.vin,
            mileage: vehicle.mileage
          }
        };
        
        console.log('Creating event:', newEvent);
        
        const { data: createdEvent, error: createError } = await supabase
          .from('vehicle_timeline_events')
          .insert(newEvent)
          .select();
          
        if (createError) {
          console.error('Error creating event:', createError);
        } else {
          console.log('✅ Timeline event created successfully:', createdEvent);
        }
      }
    } else {
      console.log('✅ Timeline events exist:');
      events.forEach(evt => {
        console.log(`  - ${evt.title} (${evt.event_date})`);
      });
    }
  }
  
  // Check vehicle details for debugging
  console.log('\n--- Vehicle Details ---');
  const { data: vehicle, error: vError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
    
  if (vError) {
    console.error('Error fetching vehicle:', vError);
  } else {
    console.log('Vehicle:', {
      id: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      user_id: vehicle.user_id
    });
  }
}

fixTimelineAndPrimary().catch(console.error);
