import React, { useEffect, memo } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, BrowserRouter } from 'react-router-dom';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { LoadingScreen } from '@/components/common/LoadingScreen';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { MainLayout } from '@/components/layout/MainLayout';
import { allRoutes, RouteType, isPublicPath } from './routeConfig';
import { toast } from '@/components/ui/use-toast';

// Memoize the AppRouterContent component to prevent unnecessary rerenders
const AppRouterContent = memo(() => {
  const { loading, session } = useAuthState();
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = !!session;
  const isAuthCallbackPath = location.pathname.startsWith('/auth/callback');
  const currentPath = location.pathname;

  // Only log in development mode
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("Router state:", { 
        currentPath, 
        isAuthenticated, 
        loading
      });
    }
  }, [currentPath, isAuthenticated, loading]);

  // Handle successful auth callback with reduced complexity
  useEffect(() => {
    if (isAuthCallbackPath && !loading && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthCallbackPath, loading, isAuthenticated, navigate]);

  // Route validation and redirection logic
  useEffect(() => {
    if (loading) return;

    // Skip validation for known system routes
    if (isAuthCallbackPath || currentPath === '/') return;

    const matchingRoute = allRoutes.find(route => {
      // Exact match
      if (route.path === currentPath) return true;
      
      // Parameter match (for routes with dynamic segments like :id)
      const routeParts = route.path.split('/');
      const pathParts = currentPath.split('/');
      
      if (routeParts.length !== pathParts.length) return false;
      
      return routeParts.every((part, i) => {
        if (part.startsWith(':')) return true;
        return part === pathParts[i];
      });
    });
    
    if (!matchingRoute) {
      toast({
        title: "Page Not Found",
        description: "Redirecting to home page",
        variant: "destructive"
      });
      navigate('/', { replace: true });
    }
  }, [currentPath, loading, navigate, isAuthCallbackPath]);

  if (loading) {
    return <LoadingScreen />;
  }

  // Simplified auth callback handling
  if (isAuthCallbackPath) {
    return (
      <Routes>
        <Route path="/auth/callback" element={
          <LoadingScreen message="Completing authentication..." />
        } />
      </Routes>
    );
  }

  // Efficient route element generation
  const getRouteElement = (route: typeof allRoutes[0]) => {
    // Handle redirects
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

    // Handle public routes
    return <MainLayout>{route.element}</MainLayout>;
  };

  return (
    <Routes>
      {/* Root path handling */}
      <Route 
        path="/" 
        element={
          isAuthenticated 
            ? <Navigate to="/dashboard" replace /> 
            : <Navigate to="/explore" replace />
        } 
      />

      {/* Dynamically generated routes */}
      {allRoutes.map(route => (
        <Route
          key={route.path}
          path={route.path}
          element={getRouteElement(route)}
        />
      ))}

      {/* Catch-all route for 404s */}
      <Route path="*" element={<Navigate to="/explore" replace />} />
    </Routes>
  );
});

// Export the wrapped router
export const AppRouter = () => {
  return (
    <BrowserRouter>
      <AppRouterContent />
    </BrowserRouter>
  );
};
