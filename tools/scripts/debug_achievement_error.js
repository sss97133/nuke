#!/usr/bin/env node
/**
 * Debug Achievement Error - Find what achievement type is causing the constraint violation
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function debugAchievements() {
  console.log('🔍 Debugging Achievement Constraint Error');
  console.log('=========================================\n');
  
  try {
    // Check existing achievements
    console.log('📊 Checking existing achievements...');
    const { data: achievements, error: queryError } = await supabase
      .from('profile_achievements')
      .select('*');
      
    if (queryError) {
      console.log('❌ Error querying achievements:', queryError.message);
      return;
    }
    
    console.log(`✅ Found ${achievements.length} existing achievements:`);
    achievements.forEach(ach => {
      console.log(`   - ${ach.achievement_type}: ${ach.achievement_title}`);
    });
    
    // Test inserting each valid achievement type
    const validTypes = [
      'first_vehicle', 'profile_complete', 'first_image', 'contributor', 
      'vehicle_collector', 'image_enthusiast', 'community_member', 'verified_user'
    ];
    
    const testUserId = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // Your user ID
    
    console.log('\n🧪 Testing achievement type insertions...');
    
    for (const type of validTypes) {
      try {
        const { data, error } = await supabase
          .from('profile_achievements')
          .insert({
            user_id: testUserId,
            achievement_type: type,
            achievement_title: `Test ${type}`,
            achievement_description: `Test description for ${type}`,
            points_awarded: 10
          })
          .select();
          
        if (error) {
          if (error.message.includes('duplicate key')) {
            console.log(`   ✅ ${type}: Already exists (duplicate key)`);
          } else if (error.message.includes('violates check constraint')) {
            console.log(`   ❌ ${type}: CONSTRAINT VIOLATION - ${error.message}`);
          } else {
            console.log(`   ⚠️  ${type}: Other error - ${error.message}`);
          }
        } else {
          console.log(`   ✅ ${type}: Successfully inserted`);
          // Clean up test data
          await supabase
            .from('profile_achievements')
            .delete()
            .eq('id', data[0].id);
        }
      } catch (err) {
        console.log(`   ❌ ${type}: Exception - ${err.message}`);
      }
    }
    
    // Test an invalid achievement type
    console.log('\n🚫 Testing invalid achievement type...');
    try {
      const { error } = await supabase
        .from('profile_achievements')
        .insert({
          user_id: testUserId,
          achievement_type: 'invalid_type',
          achievement_title: 'Test Invalid',
          achievement_description: 'This should fail',
          points_awarded: 10
        });
        
      if (error) {
        console.log(`   ❌ invalid_type: Expected error - ${error.message}`);
      } else {
        console.log(`   ⚠️  invalid_type: Unexpectedly succeeded!`);
      }
    } catch (err) {
      console.log(`   ❌ invalid_type: Exception - ${err.message}`);
    }
    
  } catch (error) {
    console.log('❌ Unexpected error:', error.message);
  }
}

debugAchievements().catch(console.error);
