/**
 * ProtectedRoute — wraps any route that requires an authenticated user.
 *
 * Behaviour:
 *  - While auth is resolving (first visit / incognito): renders a minimal
 *    loading state so the child component never mounts with user=null.
 *  - If not authenticated: redirects to /login?returnUrl=<current-path> so
 *    the user lands back here after signing in.
 *  - If authenticated: renders <Outlet /> (or `children` prop).
 *
 * Usage in routes:
 *   <Route element={<ProtectedRoute />}>
 *     <Route path="/inbox" element={<TeamInbox />} />
 *   </Route>
 *
 * Or wrapping a single element:
 *   <ProtectedRoute><MyPage /></ProtectedRoute>
 */

import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children?: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '50vh',
        color: 'var(--text-muted)',
        fontSize: '12px',
      }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
