import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import { readCachedSession } from '../../../utils/cachedSession';

export function useSession() {
  const [session, setSession] = useState<any>(() => readCachedSession());
  const [loading, setLoading] = useState<boolean>(() => readCachedSession() === null);
  const [userProfile, setUserProfile] = useState<any>(null);
  // Guard against the double-fetch that happens because both getSession() and
  // onAuthStateChange(INITIAL_SESSION) resolve nearly simultaneously on mount.
  const fetchedForUserId = useRef<string | null>(null);

  useEffect(() => {
    // Verify/refresh the cached session in the background.  For users who had
    // a valid cached token, loading is already false and the page is visible.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session?.user) fetchProfile(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
        if (session?.user) {
          fetchProfile(session.user.id);
        } else {
          setUserProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

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
