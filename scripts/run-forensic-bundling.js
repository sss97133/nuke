/**
 * Run Forensic Bundling on Taylor Customs Images
 * 
 * Groups images by date and calls generate-work-logs to create timeline events
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  // Try to read from .env.local
  const fs = await import('fs');
  const path = await import('path');
  try {
    const envPath = path.join(process.cwd(), 'nuke_frontend', '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/VITE_SUPABASE_SERVICE_ROLE_KEY=(.+)/);
    if (match) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = match[1].trim();
    }
  } catch (e) {
    console.log('Could not read .env.local');
  }
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  console.log('Set it with: export SUPABASE_SERVICE_ROLE_KEY=your_key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const TAYLOR_CUSTOMS_ID = '66352790-b70e-4de8-bfb1-006b91fa556f';

async function main() {
  console.log('🔬 Forensic Bundling for Taylor Customs');
  console.log('=====================================\n');

  // Get work sessions (images grouped by date)
  const { data: sessions, error: sessionsError } = await supabase
    .rpc('get_work_sessions_for_org', { p_organization_id: TAYLOR_CUSTOMS_ID });

  // If RPC doesn't exist, query directly
  let workSessions;
  if (sessionsError) {
    console.log('Querying work sessions directly...\n');
    
    const { data, error } = await supabase
      .from('vehicle_images')
      .select(`
        id,
        vehicle_id,
        taken_at,
        vehicles!inner (
          id, year, make, model
        )
      `)
      .in('vehicle_id', [
        'eea40748-cdc1-4ae9-ade1-4431d14a7726', // 1974 FORD Bronco
        '5a1deb95-4b67-4cc3-9575-23bb5b180693', // 1983 GMC K2500
        '80e04dd6-983e-4c78-ba15-c0599e50ecd9', // 1977 CHEVROLET K10
        '7176a5fc-24ae-4b42-9e65-0b96c4f9e50c'  // 1978 GMC Pickup
      ])
      .not('taken_at', 'is', null)
      .order('taken_at', { ascending: false });

    if (error) {
      console.error('Error fetching images:', error);
      return;
    }

    // Group by vehicle and date
    const grouped = {};
    for (const img of data) {
      const date = img.taken_at.split('T')[0];
      const key = `${img.vehicle_id}_${date}`;
      if (!grouped[key]) {
        grouped[key] = {
          vehicleId: img.vehicle_id,
          vehicle: img.vehicles,
          date: date,
          imageIds: []
        };
      }
      grouped[key].imageIds.push(img.id);
    }

    workSessions = Object.values(grouped).filter(s => s.imageIds.length >= 3);
  } else {
    workSessions = sessions;
  }

  console.log(`Found ${workSessions.length} work sessions with 3+ images\n`);

  // Process top 5 sessions
  const sessionsToProcess = workSessions.slice(0, 5);
  
  for (const session of sessionsToProcess) {
    const vehicleName = `${session.vehicle.year} ${session.vehicle.make} ${session.vehicle.model}`;
    console.log(`\n📸 ${vehicleName} - ${session.date}`);
    console.log(`   ${session.imageIds.length} images`);
    
    try {
      console.log('   Calling generate-work-logs...');
      
      const { data, error } = await supabase.functions.invoke('generate-work-logs', {
        body: {
          vehicleId: session.vehicleId,
          organizationId: TAYLOR_CUSTOMS_ID,
          imageIds: session.imageIds.slice(0, 10), // Limit to 10 images per call
          eventDate: session.date
        }
      });

      if (error) {
        console.log(`   ❌ Error: ${error.message}`);
        continue;
      }

      if (data?.success) {
        console.log(`   ✅ Created: "${data.workLog?.title}"`);
        console.log(`      Parts: ${data.partsCount || 0}`);
        console.log(`      Labor tasks: ${data.laborTasksCount || 0}`);
        console.log(`      Event ID: ${data.eventId}`);
      } else {
        console.log(`   ⚠️ No work log generated`);
      }

    } catch (err) {
      console.log(`   ❌ Exception: ${err.message}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n\n✅ Forensic bundling complete!');
}

main().catch(console.error);

