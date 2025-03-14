import React from 'react';
import { useTableQuery, useJoinQuery } from '@/hooks/useSupabaseQuery';
import type { Database } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';
import { handleQueryError } from '@/utils/supabase-helpers';

type Profile = Database['public']['Tables']['profiles']['Row'];
type Achievement = Database['public']['Tables']['achievements']['Row'];

export function SupabaseExample() {
  // Example of a simple table query
  const {
    data: profiles,
    error: profilesError,
    isLoading: profilesLoading,
    refetch: refetchProfiles
  } = useTableQuery<Profile>(
    'profiles',
    async (query) => {
      const { data, error } = await query
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (error) {
        handleQueryError(error);
      }
      
      return { data, error };
    }
  );

  // Example of a query with joins
  const {
    data: achievementsWithUsers,
    error: achievementsError,
    isLoading: achievementsLoading
  } = useJoinQuery<(Achievement & { user: Profile })[]>(
    async () => {
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('achievements')
        .select(`
          *,
          user:profiles(*)
        `)
        .limit(10);

      if (error) {
        handleQueryError(error);
      }

      return { data, error };
    }
  );

  if (profilesLoading || achievementsLoading) {
    return <div>Loading...</div>;
  }

  if (profilesError) {
    return <div>Error loading profiles: {profilesError.message}</div>;
  }

  if (achievementsError) {
    return <div>Error loading achievements: {achievementsError.message}</div>;
  }

  return (
    <div>
      <h2>Profiles</h2>
      <button onClick={() => refetchProfiles()}>Refresh</button>
      <ul>
        {profiles?.map(profile => (
          <li key={profile.id}>
            {profile.full_name || profile.email}
            {profile.bio && <p>{profile.bio}</p>}
          </li>
        ))}
      </ul>

      <h2>User Achievements</h2>
      <ul>
        {achievementsWithUsers?.map(achievement => (
          <li key={achievement.id}>
            <strong>{achievement.title}</strong> - {achievement.description}
            <br />
            Earned by: {achievement.user.full_name || achievement.user.email}
            <br />
            Skills: {achievement.skills.join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
} 