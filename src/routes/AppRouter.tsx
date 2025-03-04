
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { LoadingScreen } from '@/components/common/LoadingScreen';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { MainLayout } from '@/components/layout/MainLayout';
import { allRoutes, RouteType, isPublicPath } from './routeConfig';
import { toast } from '@/components/ui/use-toast';

export const AppRouter: React.FC = () => {
  const { loading, session } = useAuthState();
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = !!session;
  const isAuthCallbackPath = location.pathname.startsWith('/auth/callback');
  const currentPath = location.pathname;

  // Enhanced logging for route debugging
  useEffect(() => {
    console.log("Router state:", { 
      currentPath, 
      isAuthenticated, 
      loading, 
      isAuthCallbackPath,
      isPublicRoute: isPublicPath(currentPath),
      availableRoutes: allRoutes.map(r => r.path)
    });
  }, [currentPath, isAuthenticated, loading, isAuthCallbackPath]);

  // Handle route not found
  useEffect(() => {
    const matchingRoute = allRoutes.find(route => {
      // Exact match
      if (route.path === currentPath) return true;
      
      // Parameter match (like /vehicle/:id)
      const routeParts = route.path.split('/');
      const pathParts = currentPath.split('/');
      
      if (routeParts.length !== pathParts.length) return false;
      
      return routeParts.every((part, i) => {
        if (part.startsWith(':')) return true; // Parameter matches anything
        return part === pathParts[i];
      });
    });
    
    if (!matchingRoute && !loading && currentPath !== '/') {
      console.warn(`Route not found: ${currentPath}, redirecting to home`);
      toast({
        title: "Route Not Found",
        description: `The page at ${currentPath} does not exist. Redirecting to home.`,
        variant: "destructive"
      });
      navigate('/');
    }
  }, [currentPath, loading, navigate]);

  // Show loading state while auth is being determined
  if (loading) {
    console.log("Auth loading state...");
    return <LoadingScreen />;
  }

  // Handle auth callback path
  if (isAuthCallbackPath) {
    console.log("Auth callback path detected");
    return (
      <Routes>
        <Route path="/auth/callback" element={
          <LoadingScreen message="Completing authentication..." />
        } />
      </Routes>
    );
  }

  // Render all routes with appropriate wrappers based on authentication status
  return (
    <Routes>
      {/* Special root route */}
      <Route 
        path="/" 
        element={
          isAuthenticated 
            ? <Navigate to="/dashboard" replace /> 
            : <Navigate to="/explore" replace />
        } 
      />

      {/* Auth routes - when authenticated, redirect to dashboard */}
      {allRoutes
        .filter(route => route.type === RouteType.AUTH)
        .map(route => (
          <Route
            key={route.path}
            path={route.path}
            element={
              isAuthenticated
                ? <Navigate to="/dashboard" replace />
                : <AuthLayout>{route.element}</AuthLayout>
            }
          />
        ))}

      {/* Public routes - accessible to everyone */}
      {allRoutes
        .filter(route => route.type === RouteType.PUBLIC && route.path !== '/' && route.path !== '*')
        .map(route => (
          <Route
            key={route.path}
            path={route.path}
            element={
              route.redirectTo
                ? <Navigate to={route.redirectTo} replace />
                : <MainLayout>{route.element}</MainLayout>
            }
          />
        ))}

      {/* Protected routes - redirect to login if not authenticated */}
      {allRoutes
        .filter(route => route.type === RouteType.PROTECTED)
        .map(route => (
          <Route
            key={route.path}
            path={route.path}
            element={
              isAuthenticated
                ? <MainLayout>{route.element}</MainLayout>
                : <Navigate to="/login" state={{ from: location }} replace />
            }
          />
        ))}

      {/* Catch-all route for undefined routes */}
      <Route path="*" element={<Navigate to="/explore" replace />} />
    </Routes>
  );
};
