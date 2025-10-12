#!/usr/bin/env node
/**
 * Fix Profile Contributions
 * Clear mock data and ensure real contribution data is used
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function fixProfileContributions() {
  console.log('🔧 Fixing Profile Contribution Data');
  console.log('==================================\n');

  const userId = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // skylar williams
  
  try {
    // 1. Check current state
    console.log('🔍 Analyzing current contribution data...');
    
    const [contributionsResult, vehiclesResult, imagesResult] = await Promise.all([
      supabase.from('user_contributions').select('*').eq('user_id', userId),
      supabase.from('vehicles').select('id, created_at, make, model, year').eq('user_id', userId),
      supabase.from('vehicle_images').select('id, created_at, category').eq('user_id', userId)
    ]);
    
    const contributions = contributionsResult.data || [];
    const vehicles = vehiclesResult.data || [];
    const images = imagesResult.data || [];
    
    console.log(`📊 Current state:`);
    console.log(`   user_contributions: ${contributions.length} records`);
    console.log(`   vehicles: ${vehicles.length} records`);
    console.log(`   vehicle_images: ${images.length} records`);
    
    const currentTotal = contributions.reduce((sum, c) => sum + c.contribution_count, 0);
    console.log(`   Total contributions shown: ${currentTotal}`);
    
    if (currentTotal === 369) {
      console.log('🎯 Found the 369 mock data in user_contributions!');
    }
    
    // 2. Calculate what contributions should be based on real data
    console.log('\n🧮 Calculating real contributions...');
    
    const realContributions = new Map();
    
    // Add vehicle creation contributions
    vehicles.forEach(vehicle => {
      const date = vehicle.created_at.split('T')[0];
      const key = `${date}-vehicle_data`;
      const existing = realContributions.get(key) || {
        user_id: userId,
        contribution_date: date,
        contribution_type: 'vehicle_data',
        contribution_count: 0,
        related_vehicle_id: vehicle.id,
        metadata: {
          action: 'added_vehicle',
          vehicle_info: {
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year
          }
        }
      };
      existing.contribution_count += 1;
      realContributions.set(key, existing);
    });
    
    // Add image upload contributions
    images.forEach(image => {
      const date = image.created_at.split('T')[0];
      const key = `${date}-image_upload`;
      const existing = realContributions.get(key) || {
        user_id: userId,
        contribution_date: date,
        contribution_type: 'image_upload',
        contribution_count: 0,
        metadata: {
          action: 'image_uploaded',
          category: image.category
        }
      };
      existing.contribution_count += 1;
      realContributions.set(key, existing);
    });
    
    const realContribArray = Array.from(realContributions.values());
    const realTotal = realContribArray.reduce((sum, c) => sum + c.contribution_count, 0);
    
    console.log(`✅ Real contributions calculated: ${realTotal}`);
    console.log(`   Vehicle contributions: ${vehicles.length}`);
    console.log(`   Image contributions: ${images.length}`);
    
    // 3. Generate SQL to fix the data
    console.log('\n📝 Generating SQL to fix contributions...');
    
    let sql = `-- Clear mock contribution data for user ${userId}\n`;
    sql += `DELETE FROM user_contributions WHERE user_id = '${userId}';\n\n`;
    
    sql += `-- Insert real contribution data\n`;
    
    if (realContribArray.length > 0) {
      realContribArray.forEach(contrib => {
        sql += `INSERT INTO user_contributions (
  user_id,
  contribution_date,
  contribution_type,
  contribution_count,
  related_vehicle_id,
  metadata
) VALUES (
  '${contrib.user_id}',
  '${contrib.contribution_date}',
  '${contrib.contribution_type}',
  ${contrib.contribution_count},
  ${contrib.related_vehicle_id ? `'${contrib.related_vehicle_id}'` : 'NULL'},
  '${JSON.stringify(contrib.metadata)}'
);\n\n`;
      });
    }
    
    sql += `-- Update profile_stats to match real data\n`;
    sql += `UPDATE profile_stats SET 
  total_contributions = ${realTotal},
  updated_at = NOW()
WHERE user_id = '${userId}';\n`;
    
    console.log('📄 SQL Script to Fix Contributions:');
    console.log('=====================================');
    console.log(sql);
    console.log('=====================================\n');
    
    console.log('🎯 TO FIX THE PROFILE:');
    console.log('1. Copy the SQL above');
    console.log('2. Go to Supabase Dashboard → SQL Editor');
    console.log('3. Paste and run the SQL');
    console.log('4. Refresh the profile page');
    console.log('');
    console.log(`📊 Expected result: ${realTotal} contributions instead of ${currentTotal}`);
    console.log('🔥 Heatmap will show real activity based on actual vehicle/image dates');
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

// Run the analysis
if (require.main === module) {
  fixProfileContributions()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Script error:', error.message);
      process.exit(1);
    });
}

module.exports = { fixProfileContributions };
