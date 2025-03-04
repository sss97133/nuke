
import React, { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthState } from '@/hooks/auth/use-auth-provider';
import { Loader2 } from 'lucide-react';

export const AuthRequiredLayout: React.FC = () => {
  const { session, loading } = useAuthState();
  const location = useLocation();

  useEffect(() => {
    console.log("AuthRequiredLayout: Checking auth", { authenticated: !!session, loading, path: location.pathname });
  }, [session, loading, location.pathname]);

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Verifying authentication...</span>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!session) {
    console.log("AuthRequiredLayout: Not authenticated, redirecting to login");
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // User is authenticated, render the protected route
  return <Outlet />;
};
