
import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { LoadingScreen } from '@/components/common/LoadingScreen';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { MainLayout } from '@/components/layout/MainLayout';
import { allRoutes, isPublicPath } from './routeConfig';

export const AppRouter: React.FC = () => {
  const { loading, session } = useAuthState();
  const location = useLocation();
  const isAuthenticated = !!session;
  const isAuthPath = location.pathname === '/login' || location.pathname === '/register';
  const isAuthCallbackPath = location.pathname.startsWith('/auth/callback');
  const isRootPath = location.pathname === '/';
  const isPublicRoute = isPublicPath(location.pathname);

  console.log("Auth state:", { 
    path: location.pathname, 
    isAuthenticated, 
    loading, 
    isAuthPath, 
    isAuthCallbackPath,
    isPublicRoute
  });

  // Show loading state while auth is being determined
  if (loading) {
    return <LoadingScreen />;
  }

  // If this is the auth callback path, show a loading screen
  if (isAuthCallbackPath) {
    return (
      <Routes>
        <Route path="/auth/callback" element={
          <LoadingScreen message="Completing authentication..." />
        } />
      </Routes>
    );
  }

  // Simple redirect rules
  // If at root, redirect based on auth
  if (isRootPath) {
    return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Navigate to="/explore" replace />;
  }

  // If trying to access auth pages while logged in, redirect to dashboard
  if (isAuthenticated && isAuthPath) {
    return <Navigate to="/dashboard" replace />;
  }

  // For public routes, allow access regardless of authentication
  if (isPublicRoute) {
    return (
      <MainLayout>
        <Routes>
          {allRoutes
            .filter(route => route.public)
            .map(route => (
              <Route key={route.path} path={route.path} element={route.element} />
            ))}
        </Routes>
      </MainLayout>
    );
  }

  // Auth pages handling
  if (!isAuthenticated) {
    // Allow access to auth pages without redirection
    if (isAuthPath) {
      return (
        <AuthLayout>
          <Routes>
            {allRoutes
              .filter(route => route.path === '/login' || route.path === '/register')
              .map(route => (
                <Route key={route.path} path={route.path} element={route.element} />
              ))}
          </Routes>
        </AuthLayout>
      );
    }
    
    // Redirect to login for protected routes
    return <Navigate to="/login" replace />;
  }

  // Main app layout with authenticated routes
  return (
    <MainLayout>
      <Routes>
        {allRoutes
          .filter(route => !route.public)
          .map(route => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
      </Routes>
    </MainLayout>
  );
};
