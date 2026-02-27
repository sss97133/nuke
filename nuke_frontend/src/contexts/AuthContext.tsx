/**
 * AuthContext — Global auth state provider
 *
 * SINGLE source of truth for auth state. Initialised synchronously from
 * localStorage so components never flash a loading state for returning users.
 * Background `getSession()` validates + refreshes the token silently.
 *
 * Usage:
 *   const { user, session, loading } = useAuthContext();
 *
 * All consumers read from this context — no component should call
 * `supabase.auth.getSession()` or `supabase.auth.getUser()` on its own.
 */

import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { readCachedSession } from '../utils/cachedSession';

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AuthState {
  /** The current Supabase session (null = logged out). */
  session: any | null;
  /** Convenience accessor — session?.user, typed. */
  user: AuthUser | null;
  /**
   * True only while the very first async `getSession()` is in-flight AND the
   * localStorage cache was empty (i.e., new visitor or private browsing).
   * Returning users see `loading = false` immediately on mount.
   */
  loading: boolean;
}

export const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const cachedRaw = readCachedSession();
  const [session, setSession] = useState<any | null>(cachedRaw ?? null);
  // Only show loading spinner when there is NO cached session (new/incognito user)
  const [loading, setLoading] = useState<boolean>(cachedRaw === null);
  // Prevent double-fetch: onAuthStateChange(INITIAL_SESSION) fires ~same time as getSession()
  const resolvedRef = useRef(false);

  useEffect(() => {
    // Background validation — validates the cached token and gets a fresh one if needed.
    // For returning users this resolves in ~50ms from Supabase's in-memory cache.
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!resolvedRef.current) {
        resolvedRef.current = true;
        setSession(s);
        setLoading(false);
      }
    });

    // Subscribe to auth changes (sign-in, sign-out, token refresh, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      resolvedRef.current = true;
      setSession(s);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const user = (session?.user as AuthUser) ?? null;

  return (
    <AuthContext.Provider value={{ session, user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Consume the global auth state. */
export function useAuthContext(): AuthState {
  return useContext(AuthContext);
}
