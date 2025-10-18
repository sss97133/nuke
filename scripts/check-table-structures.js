#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkTables() {
  console.log('\n=== CHECKING TABLE STRUCTURES ===\n');
  
  // Check vehicle_timeline
  const { count: vehicleTimelineCount, error: vtError } = await supabase
    .from('vehicle_timeline')
    .select('*', { count: 'exact', head: true });
  
  console.log(`vehicle_timeline: ${vtError ? 'ERROR - ' + vtError.message : `EXISTS (${vehicleTimelineCount} rows)`}`);
  
  // Check vehicle_timeline_events  
  const { count: vehicleTimelineEventsCount, error: vteError } = await supabase
    .from('vehicle_timeline_events')
    .select('*', { count: 'exact', head: true });
  
  console.log(`vehicle_timeline_events: ${vteError ? 'ERROR - ' + vteError.message : `EXISTS (${vehicleTimelineEventsCount} rows)`}`);
  
  // Check timeline_events
  const { count: timelineEventsCount, error: teError } = await supabase
    .from('timeline_events')
    .select('*', { count: 'exact', head: true });
  
  console.log(`timeline_events: ${teError ? 'ERROR - ' + teError.message : `EXISTS (${timelineEventsCount} rows)`}\n`);
  
  // Sample one row from each to see structure
  if (!vtError && vehicleTimelineCount > 0) {
    const { data } = await supabase.from('vehicle_timeline').select('*').limit(1).single();
    console.log('vehicle_timeline sample fields:', Object.keys(data || {}).join(', '));
  }
  
  if (!vteError && vehicleTimelineEventsCount > 0) {
    const { data } = await supabase.from('vehicle_timeline_events').select('*').limit(1).single();
    console.log('vehicle_timeline_events sample fields:', Object.keys(data || {}).join(', '));
  }
  
  console.log('\n=== RECOMMENDATION ===');
  console.log('The backend should use: vehicle_timeline_events (which has all the data)');
  console.log('The Elixir schema currently points to: vehicle_timeline\n');
}

checkTables();

