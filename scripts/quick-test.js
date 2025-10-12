#!/usr/bin/env node
/**
 * Quick Testing Script
 * Simple tests you can run to check profile sync status
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function quickHealthCheck() {
  console.log('🏥 NUKE Platform Health Check');
  console.log('============================\n');
  
  try {
    // 1. Database Connection
    console.log('🔍 Testing database connection...');
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .limit(1);
    
    if (profileError) {
      console.log('❌ Database connection failed:', profileError.message);
      return;
    }
    
    console.log('✅ Database connected');
    
    if (!profiles || profiles.length === 0) {
      console.log('⚠️  No user profiles found');
      return;
    }
    
    const user = profiles[0];
    console.log(`👤 Testing with user: ${user.full_name || user.email || 'Anonymous'}\n`);
    
    // 2. Profile Sync Check
    console.log('🔄 Checking profile synchronization...');
    
    const [vehiclesResult, statsResult, contributionsResult, activityResult] = await Promise.all([
      supabase.from('vehicles').select('id, make, model, year').eq('user_id', user.id),
      supabase.from('profile_stats').select('*').eq('user_id', user.id).single(),
      supabase.from('user_contributions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('profile_activity').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(3)
    ]);
    
    const vehicles = vehiclesResult.data || [];
    const stats = statsResult.data;
    const contributions = contributionsResult.data || [];
    const activities = activityResult.data || [];
    
    console.log(`🚗 Vehicles in database: ${vehicles.length}`);
    console.log(`📊 Vehicles in profile stats: ${stats?.total_vehicles || 0}`);
    
    if (vehicles.length === (stats?.total_vehicles || 0)) {
      console.log('✅ Vehicle counts are synchronized!');
    } else {
      console.log('⚠️  Vehicle count mismatch detected');
    }
    
    console.log(`🖼️  Total images tracked: ${stats?.total_images || 0}`);
    console.log(`📈 Recent contributions: ${contributions.length}`);
    console.log(`📝 Recent activities: ${activities.length}\n`);
    
    // 3. Recent Activity Summary
    if (activities.length > 0) {
      console.log('📋 Recent Activities:');
      activities.forEach((activity, i) => {
        const date = new Date(activity.created_at).toLocaleDateString();
        console.log(`  ${i + 1}. ${activity.activity_type}: ${activity.activity_title} (${date})`);
      });
      console.log('');
    }
    
    // 4. Sample Vehicles
    if (vehicles.length > 0) {
      console.log('🚙 Sample Vehicles:');
      vehicles.slice(0, 3).forEach((vehicle, i) => {
        console.log(`  ${i + 1}. ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      });
      if (vehicles.length > 3) {
        console.log(`  ... and ${vehicles.length - 3} more`);
      }
      console.log('');
    }
    
    // 5. Frontend URL
    console.log('🌐 Frontend URLs:');
    console.log('  Main App: http://localhost:5174');
    console.log('  Login: http://localhost:5174/login');
    console.log('  Profile: http://localhost:5174/profile');
    console.log('  Add Vehicle: http://localhost:5174/add-vehicle');
    console.log('');
    
    console.log('✅ Health check complete!');
    
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
  }
}

// Command line options
const command = process.argv[2];

switch (command) {
  case 'sync':
    // Just check sync status
    (async () => {
      const { data: profiles } = await supabase.from('profiles').select('id').limit(1);
      if (profiles && profiles.length > 0) {
        const userId = profiles[0].id;
        const [vehicles, stats] = await Promise.all([
          supabase.from('vehicles').select('id').eq('user_id', userId),
          supabase.from('profile_stats').select('total_vehicles').eq('user_id', userId).single()
        ]);
        
        const vehicleCount = vehicles.data?.length || 0;
        const trackedCount = stats.data?.total_vehicles || 0;
        
        console.log(`🚗 Actual vehicles: ${vehicleCount}`);
        console.log(`📊 Tracked vehicles: ${trackedCount}`);
        console.log(vehicleCount === trackedCount ? '✅ SYNCED' : '❌ OUT OF SYNC');
      }
    })();
    break;
    
  case 'stats':
    // Show detailed stats
    (async () => {
      const { data: stats } = await supabase.from('profile_stats').select('*');
      console.log('📊 All Profile Stats:');
      console.table(stats);
    })();
    break;
    
  case 'contributions':
    // Show recent contributions
    (async () => {
      const { data: contributions } = await supabase
        .from('user_contributions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      console.log('📈 Recent Contributions:');
      console.table(contributions);
    })();
    break;
    
  default:
    // Full health check
    quickHealthCheck();
}
