/**
 * useAuth — Auth hook backed by the global AuthContext.
 *
 * Reads from the single cached auth state initialised at app boot.
 * Zero additional network calls. Components that previously called
 * `supabase.auth.getSession()` directly on mount should use this instead.
 *
 * If this hook is used outside an <AuthProvider> it falls back gracefully
 * to the legacy behaviour (reads localStorage + async getSession).
 */

import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext';

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);

  return {
    /** The authenticated user, or null when logged out / not yet resolved. */
    user: ctx.user as AuthUser | null,
    /** The full Supabase session object. */
    session: ctx.session,
    /**
     * True only while the first auth check is in-flight for a visitor with
     * no cached session (new user / incognito). For returning users this is
     * false on the very first render.
     */
    loading: ctx.loading,
  };
};
