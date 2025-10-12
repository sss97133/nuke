import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔧 Consolidating photo events for vehicle 05f27cc4-914e-425a-8ed8-cfea35c1928d...');

// Step 1: Get all photo_added events
const { data: events, error: fetchError } = await supabase
  .from('vehicle_timeline_events')
  .select('*')
  .eq('vehicle_id', '05f27cc4-914e-425a-8ed8-cfea35c1928d')
  .eq('event_type', 'photo_added')
  .order('event_date', { ascending: true })
  .order('created_at', { ascending: true });

if (fetchError) {
  console.error('Error fetching events:', fetchError);
  process.exit(1);
}

console.log(`📊 Found ${events.length} photo_added events`);

// Step 2: Group into sessions (30 min gap)
const sessions = [];
let currentSession = null;
const GAP_MS = 30 * 60 * 1000;

for (const event of events) {
  const eventTime = new Date(event.event_date).getTime();
  
  if (!currentSession || (eventTime - currentSession.end) > GAP_MS) {
    // Start new session
    if (currentSession) sessions.push(currentSession);
    currentSession = {
      vehicle_id: event.vehicle_id,
      user_id: event.user_id,
      start: eventTime,
      end: eventTime,
      count: 1,
      event_ids: [event.id]
    };
  } else {
    // Add to current session
    currentSession.end = eventTime;
    currentSession.count++;
    currentSession.event_ids.push(event.id);
  }
}
if (currentSession) sessions.push(currentSession);

console.log(`📦 Grouped into ${sessions.length} work sessions`);

// Step 3: Create consolidated events
const newEvents = sessions.map(session => {
  const duration = (session.end - session.start) / (1000 * 60);
  return {
    vehicle_id: session.vehicle_id,
    user_id: session.user_id,
    event_type: 'photo_session',
    source: 'consolidated',
    event_date: new Date(session.start).toISOString().split('T')[0],
    title: session.count === 1 ? 'Photo Added' : `Work Session - ${session.count} photos`,
    description: session.count === 1 
      ? 'Vehicle photo'
      : duration < 1 
        ? `${session.count} photos`
        : `${session.count} photos over ${Math.round(duration)} min`,
    metadata: {
      photo_count: session.count,
      duration_minutes: Math.round(duration),
      start_time: new Date(session.start).toISOString(),
      end_time: new Date(session.end).toISOString(),
      consolidated: true
    }
  };
});

// Insert into both tables
console.log('💾 Inserting consolidated events...');
const [vteResult, legacyResult] = await Promise.all([
  supabase.from('vehicle_timeline_events').insert(newEvents),
  supabase.from('timeline_events').insert(newEvents)
]);

if (vteResult.error) console.error('vehicle_timeline_events error:', vteResult.error);
if (legacyResult.error) console.error('timeline_events error:', legacyResult.error);

// Step 4: Delete old events
console.log('🗑️  Deleting old photo_added events...');
const [delVte, delLegacy] = await Promise.all([
  supabase.from('vehicle_timeline_events')
    .delete()
    .eq('vehicle_id', '05f27cc4-914e-425a-8ed8-cfea35c1928d')
    .eq('event_type', 'photo_added'),
  supabase.from('timeline_events')
    .delete()
    .eq('vehicle_id', '05f27cc4-914e-425a-8ed8-cfea35c1928d')
    .eq('event_type', 'photo_added')
]);

if (delVte.error) console.error('Delete vehicle_timeline_events error:', delVte.error);
if (delLegacy.error) console.error('Delete timeline_events error:', delLegacy.error);

// Step 5: Show results
const { data: final } = await supabase
  .from('vehicle_timeline_events')
  .select('event_type')
  .eq('vehicle_id', '05f27cc4-914e-425a-8ed8-cfea35c1928d');

const counts = final.reduce((acc, e) => {
  acc[e.event_type] = (acc[e.event_type] || 0) + 1;
  return acc;
}, {});

console.log('✅ Final event counts:', counts);
console.log(`✨ Reduced ${events.length} events to ${sessions.length} work sessions!`);
