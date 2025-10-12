-- Simplify Overly Restrictive RLS Policies
-- These policies are causing legitimate operations to fail

-- 1. PROFILES TABLE - Simplify public read access
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
CREATE POLICY "Anyone can view public profiles" ON profiles
    FOR SELECT USING (is_public = true OR auth.uid() = id);

-- 2. VEHICLES TABLE - Allow public vehicle viewing
DROP POLICY IF EXISTS "Public vehicles are viewable by everyone" ON vehicles;
CREATE POLICY "Public vehicles viewable by all" ON vehicles
    FOR SELECT USING (is_public = true OR auth.uid() = user_id);

-- 3. VEHICLE_IMAGES TABLE - Simplify image access
DROP POLICY IF EXISTS "Public vehicle images are viewable" ON vehicle_images;
CREATE POLICY "Vehicle images follow vehicle visibility" ON vehicle_images
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = vehicle_images.vehicle_id 
            AND (v.is_public = true OR v.user_id = auth.uid())
        )
    );

-- 4. TIMELINE EVENTS - Allow viewing for public vehicles
DROP POLICY IF EXISTS "Users can view timeline events for vehicles they own" ON timeline_events;
CREATE POLICY "Timeline events follow vehicle visibility" ON timeline_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = timeline_events.vehicle_id 
            AND (v.is_public = true OR v.user_id = auth.uid())
        )
    );

-- 5. VEHICLE_TIMELINE_EVENTS - Same pattern
DROP POLICY IF EXISTS "Vehicle owners can manage timeline events" ON vehicle_timeline_events;
CREATE POLICY "Timeline events viewable for public vehicles" ON vehicle_timeline_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = vehicle_timeline_events.vehicle_id 
            AND (v.is_public = true OR v.user_id = auth.uid())
        )
    );

CREATE POLICY "Vehicle owners can manage their timeline events" ON vehicle_timeline_events
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = vehicle_timeline_events.vehicle_id 
            AND v.user_id = auth.uid()
        )
    );

-- 6. USER_CONTRIBUTIONS - Public read for profile viewing
ALTER TABLE user_contributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view contributions" ON user_contributions;
CREATE POLICY "Contributions are publicly viewable" ON user_contributions
    FOR SELECT USING (true);

-- 7. PROFILE_ACTIVITY - Public read for activity feeds
ALTER TABLE profile_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view activity" ON profile_activity;
CREATE POLICY "Activity is publicly viewable" ON profile_activity
    FOR SELECT USING (true);

-- 8. PROFILE_STATS - Public read for stats display
ALTER TABLE profile_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view stats" ON profile_stats;
CREATE POLICY "Stats are publicly viewable" ON profile_stats
    FOR SELECT USING (true);

-- 9. Remove overly complex policies that are blocking operations
-- These tables should have simple owner-based access
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON profiles;
CREATE POLICY "Users can insert their own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own vehicles" ON vehicles;
CREATE POLICY "Authenticated users can create vehicles" ON vehicles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 10. Fix any policies that might block profile creation
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Profile access policy" ON profiles
    FOR ALL USING (auth.uid() = id OR is_public = true);

-- List remaining policies for review
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN (
    'profiles', 'vehicles', 'vehicle_images', 'timeline_events', 
    'vehicle_timeline_events', 'user_contributions', 'profile_activity', 'profile_stats'
)
ORDER BY tablename, policyname;
