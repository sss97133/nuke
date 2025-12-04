require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTimelineEvents() {
  const vehicleId = '7b07531f-e73a-4adb-b52c-d45922063edf';
  
  console.log('Checking timeline events for vehicle:', vehicleId);
  
  const { data: events, error } = await supabase
    .from('vehicle_timeline_events')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: false });
    
  if (error) {
    console.error('Error fetching timeline events:', error);
  } else {
    console.log(`\nFound ${events?.length || 0} timeline events:`);
    events?.forEach(event => {
      console.log(`\n--- ${event.title} ---`);
      console.log(`Type: ${event.event_type}`);
      console.log(`Date: ${event.event_date}`);
      console.log(`Description: ${event.description}`);
      console.log(`Source: ${event.source}`);
      if (event.metadata) {
        console.log('Metadata:', JSON.stringify(event.metadata, null, 2));
      }
    });
  }
  
  // Check for photo_added events specifically
  const photoEvents = events?.filter(e => e.event_type === 'photo_added') || [];
  console.log(`\n📸 Found ${photoEvents.length} photo upload events`);
}

checkTimelineEvents().catch(console.error);
