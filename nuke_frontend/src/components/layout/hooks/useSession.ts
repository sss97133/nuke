import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

// Read the Supabase session synchronously from localStorage so that returning
// users see content immediately, without waiting for the async getSession()
// network round-trip.  The async call still runs in the background to validate
// the token and handle refresh/logout, but we no longer block first paint on it.
function readCachedSession(): any | null {
  try {
    const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined ?? '';
    const projectRef = url.match(/\/\/([^.]+)\./)?.[1];
    if (!projectRef) return null;
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token || !parsed?.user) return null;
    // Reject already-expired tokens so we don't flash stale user state
    if (parsed.expires_at && Date.now() / 1000 > parsed.expires_at) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function useSession() {
  const [session, setSession] = useState<any>(() => readCachedSession());
  const [loading, setLoading] = useState<boolean>(() => readCachedSession() === null);
  const [userProfile, setUserProfile] = useState<any>(null);

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
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, user_type, trust_score, role, moderator_level')
        .eq('id', userId)
        .single();
      if (!error && data) setUserProfile(data);
    } catch {
      // silent
    }
  };

  return { session, loading, userProfile };
}
