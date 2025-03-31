import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, BrowserRouter } from 'react-router-dom';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { LoadingScreen } from '@/components/common/LoadingScreen';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { MainLayout } from '@/components/layout/MainLayout';
import { allRoutes, RouteType, isPublicPath } from './routeConfig';
import { toast } from '@/components/ui/use-toast';
// Fix the import to use the default export
import StreamViewer from '@/pages/StreamViewer';
// Import new auth callback components
import AuthCallback from '@/pages/auth/AuthCallback';
import ResetPassword from '@/pages/auth/ResetPassword';

const AppRouterContent: React.FC = () => {
  const { loading, session } = useAuthState();
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = !!session;
  const isAuthCallbackPath = location.pathname.startsWith('/auth/callback');
  const currentPath = location.pathname;

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

  // Handle hash-based auth callbacks (#access_token, etc.)
  useEffect(() => {
    // Detect if we have a hash in the URL that looks like an auth token
    const hasAuthToken = location.hash && 
      (location.hash.includes('access_token') || 
       location.hash.includes('error_description'));
       
    if (hasAuthToken) {
      // Let the AuthCallback component handle the token processing
      navigate('/auth/callback', { replace: true });
    }
  }, [location.hash, navigate]);

  useEffect(() => {
    if (loading) return;

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
    
    const redirectRoute = allRoutes.find(route => 
      route.path === currentPath && route.redirectTo
    );
    
    if (redirectRoute) {
      console.log(`Route ${currentPath} has redirect defined to ${redirectRoute.redirectTo}`);
      return;
    }
    
    if (!matchingRoute && currentPath !== '/' && !isAuthCallbackPath) {
      console.warn(`Route not found: ${currentPath}, redirecting to home`);
      toast({
        title: "Route Not Found",
        description: `The page at ${currentPath} does not exist. Redirecting to home.`,
        variant: "destructive"
      });
      navigate('/');
    }
  }, [currentPath, loading, navigate, isAuthCallbackPath]);

  if (loading) {
    console.log("Auth loading state...");
    return <LoadingScreen />;
  }

  // Auth callback handling now moved to the AuthCallback component

  const getRouteElement = (route: typeof allRoutes[0]) => {
    if (route.redirectTo) {
      return <Navigate to={route.redirectTo} replace />;
    }

    if (route.type === RouteType.AUTH) {
      return isAuthenticated 
        ? <Navigate to="/dashboard" replace />
        : <AuthLayout>{route.element}</AuthLayout>;
    }

    if (route.type === RouteType.PROTECTED) {
      return isAuthenticated
        ? <MainLayout>{route.element}</MainLayout>
        : <Navigate to="/login" state={{ from: location }} replace />;
    }

    return <MainLayout>{route.element}</MainLayout>;
  };

  return (
    <Routes>
      {/* Special auth callback routes with direct component mapping */}
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      
      <Route 
        path="/" 
        element={
          isAuthenticated 
            ? <Navigate to="/dashboard" replace /> 
            : <Navigate to="/explore" replace />
        } 
      />

      {allRoutes.map(route => (
        <Route
          key={route.path}
          path={route.path}
          element={getRouteElement(route)}
        />
      ))}

      <Route path="*" element={<Navigate to="/explore" replace />} />
    </Routes>
  );
};

export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <AppRouterContent />
    </BrowserRouter>
  );
};
