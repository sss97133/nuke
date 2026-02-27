/**
 * useSession — layout-level session + user profile hook.
 *
 * Delegates session/loading to the global AuthContext so there is exactly ONE
 * `getSession()` call in the whole app (inside AuthProvider). This hook only
 * adds profile-fetching on top.
 */
import { useState, useEffect, useRef, useContext } from 'react';
import { supabase } from '../../../lib/supabase';
import { AuthContext } from '../../../contexts/AuthContext';

export function useSession() {
  // Read auth state from the global provider — no extra getSession() call
  const { session, loading } = useContext(AuthContext);
  const [userProfile, setUserProfile] = useState<any>(null);
  // Guard against duplicate fetches when userId hasn't changed
  const fetchedForUserId = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user?.id;
    if (userId) {
      fetchProfile(userId);
    } else {
      setUserProfile(null);
      fetchedForUserId.current = null;
    }
  }, [session?.user?.id]);

  const fetchProfile = async (userId: string) => {
    if (fetchedForUserId.current === userId) return;
    fetchedForUserId.current = userId;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, user_type, role, moderator_level')
        .eq('id', userId)
        .single();
      if (!error && data) setUserProfile(data);
      else if (error) fetchedForUserId.current = null; // allow retry on transient error
    } catch {
      fetchedForUserId.current = null;
    }
  };

  return { session, loading, userProfile };
}
