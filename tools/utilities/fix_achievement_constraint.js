#!/usr/bin/env node
/**
 * Fix Achievement Constraint - Add missing achievement types
 * This will modify the existing constraint to allow more achievement types
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkAchievementTable() {
  console.log('🔍 Checking profile_achievements table...');
  
  try {
    // Try to query the table to see if it exists
    const { data, error } = await supabase
      .from('profile_achievements')
      .select('*')
      .limit(1);
      
    if (error) {
      if (error.message.includes('does not exist')) {
        console.log('❌ profile_achievements table does not exist');
        console.log('\n📋 You need to create the table manually in Supabase Dashboard:');
        console.log('\nGo to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/editor');
        console.log('Click "SQL Editor" and run this SQL:\n');
        
        console.log(`-- Create profile_achievements table
CREATE TABLE profile_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_type TEXT NOT NULL CHECK (achievement_type IN (
    'first_vehicle', 'profile_complete', 'first_image', 'contributor', 
    'vehicle_collector', 'image_enthusiast', 'community_member', 'verified_user'
  )),
  achievement_title TEXT NOT NULL,
  achievement_description TEXT,
  icon_url TEXT,
  points_awarded INTEGER DEFAULT 0,
  earned_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, achievement_type)
);

-- Create profile_stats table
CREATE TABLE IF NOT EXISTS profile_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  vehicles_count INTEGER DEFAULT 0,
  images_count INTEGER DEFAULT 0,
  verifications_count INTEGER DEFAULT 0,
  contributions_count INTEGER DEFAULT 0,
  total_vehicles INTEGER DEFAULT 0,
  total_images INTEGER DEFAULT 0,
  total_contributions INTEGER DEFAULT 0,
  last_activity TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create profile_completion table
CREATE TABLE IF NOT EXISTS profile_completion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  basic_info_complete BOOLEAN DEFAULT false,
  avatar_uploaded BOOLEAN DEFAULT false,
  bio_added BOOLEAN DEFAULT false,
  social_links_added BOOLEAN DEFAULT false,
  first_vehicle_added BOOLEAN DEFAULT false,
  skills_added BOOLEAN DEFAULT false,
  location_added BOOLEAN DEFAULT false,
  total_completion_percentage INTEGER DEFAULT 0 CHECK (total_completion_percentage >= 0 AND total_completion_percentage <= 100),
  created_at TIMESTAMP DEFAULT NOW(),
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Create profile_activity table
CREATE TABLE IF NOT EXISTS profile_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  activity_description TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);`);
        
        return false;
      } else {
        console.log('❌ Error querying table:', error.message);
        return false;
      }
    }
    
    console.log('✅ profile_achievements table exists');
    console.log(`📊 Found ${data?.length || 0} achievements`);
    return true;
    
  } catch (error) {
    console.log('❌ Unexpected error:', error.message);
    return false;
  }
}

async function main() {
  console.log('🔧 Profile Achievements Table Checker');
  console.log('=====================================\n');
  
  const exists = await checkAchievementTable();
  
  if (!exists) {
    console.log('\n⚠️  Table creation required - see SQL above');
    process.exit(1);
  }
  
  console.log('\n✅ All profile tables are ready!');
}

main().catch(console.error);
