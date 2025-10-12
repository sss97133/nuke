#!/usr/bin/env node
/**
 * Fix RLS Policy - Provide SQL to fix Row Level Security on profile_achievements
 */

console.log('🔧 Profile Achievements RLS Policy Fix');
console.log('======================================\n');

console.log('❌ The issue is Row Level Security (RLS) blocking insertions to profile_achievements table.');
console.log('📋 You need to run this SQL in your Supabase Dashboard:\n');

console.log('Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/editor');
console.log('Click "SQL Editor" and run this SQL:\n');

console.log(`-- Fix RLS policies for profile_achievements table
-- Allow users to insert their own achievements

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can insert their own achievements" ON profile_achievements;
DROP POLICY IF EXISTS "Users can view their own achievements" ON profile_achievements;
DROP POLICY IF EXISTS "Users can update their own achievements" ON profile_achievements;

-- Create proper RLS policies
CREATE POLICY "Users can insert their own achievements" ON profile_achievements
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own achievements" ON profile_achievements
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own achievements" ON profile_achievements
  FOR UPDATE USING (auth.uid() = user_id);

-- Ensure RLS is enabled
ALTER TABLE profile_achievements ENABLE ROW LEVEL SECURITY;

-- Also fix other profile tables while we're at it
DROP POLICY IF EXISTS "Users can insert their own stats" ON profile_stats;
DROP POLICY IF EXISTS "Users can view their own stats" ON profile_stats;
DROP POLICY IF EXISTS "Users can update their own stats" ON profile_stats;

CREATE POLICY "Users can insert their own stats" ON profile_stats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own stats" ON profile_stats
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own stats" ON profile_stats
  FOR UPDATE USING (auth.uid() = user_id);

ALTER TABLE profile_stats ENABLE ROW LEVEL SECURITY;

-- Fix profile_completion table
DROP POLICY IF EXISTS "Users can insert their own completion" ON profile_completion;
DROP POLICY IF EXISTS "Users can view their own completion" ON profile_completion;
DROP POLICY IF EXISTS "Users can update their own completion" ON profile_completion;

CREATE POLICY "Users can insert their own completion" ON profile_completion
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own completion" ON profile_completion
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own completion" ON profile_completion
  FOR UPDATE USING (auth.uid() = user_id);

ALTER TABLE profile_completion ENABLE ROW LEVEL SECURITY;

-- Fix profile_activity table
DROP POLICY IF EXISTS "Users can insert their own activity" ON profile_activity;
DROP POLICY IF EXISTS "Users can view their own activity" ON profile_activity;

CREATE POLICY "Users can insert their own activity" ON profile_activity
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own activity" ON profile_activity
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE profile_activity ENABLE ROW LEVEL SECURITY;`);

console.log('\n✅ After running this SQL, vehicle saving should work without RLS violations!');
console.log('\n🔄 Then restart your frontend to test the fix.');
