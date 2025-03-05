
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, BrowserRouter } from 'react-router-dom';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { LoadingScreen } from '@/components/common/LoadingScreen';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { MainLayout } from '@/components/layout/MainLayout';
import { allRoutes, RouteType, isPublicPath } from './routeConfig';
import { toast } from '@/components/ui/use-toast';

// Create a component with the router navigation logic
const AppRouterContent: React.FC = () => {
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

  // Handle route not found - but only after auth is determined
  useEffect(() => {
    if (loading) return; // Don't check routes while still loading auth

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
    
    // Handle redirect routes directly - don't toast or navigate
    const redirectRoute = allRoutes.find(route => 
      route.path === currentPath && route.redirectTo
    );
    
    if (redirectRoute) {
      console.log(`Route ${currentPath} has redirect defined to ${redirectRoute.redirectTo}`);
      // The actual redirect will be handled by the Routes/Route components
      return;
    }
    
    if (!matchingRoute && currentPath !== '/') {
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

  // Process redirect routes first to avoid blinking
  const getRouteElement = (route: typeof allRoutes[0]) => {
    // Handle redirects immediately
    if (route.redirectTo) {
      return <Navigate to={route.redirectTo} replace />;
    }

    // Handle auth routes
    if (route.type === RouteType.AUTH) {
      return isAuthenticated 
        ? <Navigate to="/dashboard" replace />
        : <AuthLayout>{route.element}</AuthLayout>;
    }

    // Handle protected routes
    if (route.type === RouteType.PROTECTED) {
      return isAuthenticated
        ? <MainLayout>{route.element}</MainLayout>
        : <Navigate to="/login" state={{ from: location }} replace />;
    }

    // Handle public routes (default case)
    return <MainLayout>{route.element}</MainLayout>;
  };

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

      {/* Map all routes except the root and catch-all */}
      {allRoutes
        .filter(route => route.path !== '/' && route.path !== '*')
        .map(route => (
          <Route
            key={route.path}
            path={route.path}
            element={getRouteElement(route)}
          />
        ))}

      {/* Catch-all route for undefined routes */}
      <Route path="*" element={<Navigate to="/explore" replace />} />
    </Routes>
  );
};

// Main router component that wraps the content with BrowserRouter
export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <AppRouterContent />
    </BrowserRouter>
  );
};
