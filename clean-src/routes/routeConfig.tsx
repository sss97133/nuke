import React from 'react';
import { Navigate } from 'react-router-dom';

// Page imports
import Dashboard from "@/pages/Dashboard";
import Onboarding from "@/pages/Onboarding";
import Skills from "@/pages/Skills";
import Achievements from "@/pages/Achievements";
import Glossary from "@/pages/Glossary";
import Sitemap from "@/pages/Sitemap";
import Documentation from "@/pages/Documentation";
import Import from "@/pages/Import";
import DiscoveredVehicles from "@/pages/DiscoveredVehicles";
import AddVehicle from "@/pages/AddVehicle";
import Vehicles from "@/pages/Vehicles"; // Import the Vehicles list component
import TokenStaking from "@/pages/TokenStaking";
import TokensPage from "@/pages/Tokens";
import ServiceHistory from "@/pages/ServiceHistory";
import Parts from "@/pages/Parts";
import FuelTracking from "@/pages/FuelTracking";
import Diagnostics from "@/pages/Diagnostics";
import Analytics from "@/pages/Analytics";
import Schedule from "@/pages/Schedule";
import Service from "@/pages/Service";
import Maintenance from "@/pages/Maintenance";
import Studio from "@/pages/Studio";
import Explore from '@/pages/Explore';
import ExploreContentManagement from '@/pages/ExploreContentManagement';
import VehicleDetail from '@/pages/VehicleDetail';
import TeamMembers from '@/pages/TeamMembers';
import Profile from '@/pages/Profile';
import TestSupabase from '@/pages/TestSupabase';
import Marketplace from '@/pages/Marketplace';
import MarketplaceListingDetail from '@/pages/MarketplaceListingDetail';
import { AuthForm } from '@/components/auth/AuthForm';
import Streaming from '@/pages/Streaming';
import StreamViewer from '@/pages/StreamViewer';
import VehicleImport from "@/pages/VehicleImport"; // Import the new VehicleImport page
import AdminPanel from '@/pages/AdminPanel'; // Import the AdminPanel component
import VehicleTimelinePage from '@/pages/VehicleTimelinePage'; // Import the VehicleTimeline page
import DesignSystem from '@/components/ui/design-system'; // Import the Design System documentation
import TestVehicleInput from '@/test-vehicle-input'; // Import the TestVehicleInput component
import { AuthTestPage } from '@/components/auth-test/AuthTestPage'; // Import the Auth Test Page
import CaptureIntegration from '@/pages/CaptureIntegration'; // Import the Capture Integration page
import AuthTest from '@/pages/AuthTest'; // Import our new authentication test page
import DebugFixed from '@/pages/DebugFixed'; // Import our fixed debug page
import VehicleSetup from '@/pages/VehicleSetup'; // Import vehicle setup page

// Route type definitions
export enum RouteType {
  PUBLIC = 'public',
  PROTECTED = 'protected',
  AUTH = 'auth'
}

export interface RouteConfig {
  path: string;
  element: React.ReactNode;
  type: RouteType;
  redirectTo?: string;
}

// Auth routes - using Supabase UI components
import Auth from '@/pages/auth/Auth';
import TestAuth from '@/pages/auth/TestAuth';
import AuthCallback from '@/pages/auth/AuthCallback';
import ResetPassword from '@/pages/auth/ResetPassword';
import AuthProfile from '@/pages/auth/Profile';

// Import archived components for reference (these will be redirected to new components)
import NewLoginPage from '@/pages/auth/archive/NewLoginPage';
import NewSignUpPage from '@/pages/auth/archive/NewSignUpPage';
import NewResetPasswordPage from '@/pages/auth/archive/NewResetPasswordPage';
import EnhancedLoginPage from '@/pages/auth/archive/EnhancedLoginPage';
import EnhancedResetPasswordPage from '@/pages/auth/archive/EnhancedResetPasswordPage';
import VerifyEmailPage from '@/components/auth/VerifyEmailPage';

export const authRoutes: RouteConfig[] = [
  // Core Supabase Auth UI Routes
  { path: '/auth', element: <Auth />, type: RouteType.AUTH },
  { path: '/auth/callback', element: <AuthCallback />, type: RouteType.AUTH },
  { path: '/auth/reset-password', element: <ResetPassword />, type: RouteType.AUTH },
  { path: '/auth/profile', element: <AuthProfile />, type: RouteType.PROTECTED },
  
  // Test authentication page using new Supabase UI
  { path: '/test-auth', element: <TestAuth />, type: RouteType.AUTH },
  
  // Redirects for backward compatibility with old routes
  { path: '/login', element: <Navigate to="/auth" replace />, type: RouteType.AUTH },
  { path: '/signup', element: <Navigate to="/auth" replace />, type: RouteType.AUTH },
  { path: '/reset-password', element: <Navigate to="/auth/reset-password" replace />, type: RouteType.AUTH },
  { path: '/register', element: <Navigate to="/auth" replace />, type: RouteType.AUTH },
  { path: '/verify-email', element: <Navigate to="/auth/callback" replace />, type: RouteType.AUTH },
  
  // Legacy redirects
  { path: '/login/legacy', element: <Navigate to="/auth" replace />, type: RouteType.AUTH },
  { path: '/reset-password/legacy', element: <Navigate to="/auth/reset-password" replace />, type: RouteType.AUTH },
];

// Public routes configuration
export const publicRoutes: RouteConfig[] = [
  // Debug page (always accessible)
  { path: '/debug', element: <DebugFixed />, type: RouteType.PUBLIC },
  { path: '/vehicle-setup', element: <VehicleSetup />, type: RouteType.PUBLIC },
  { path: '/vehicle/:vin', element: <VehicleTimelinePage />, type: RouteType.PUBLIC },
  { path: '/vehicle/id/:id', element: <VehicleTimelinePage />, type: RouteType.PUBLIC },
  { path: '/vehicle-timeline', element: <VehicleTimelinePage />, type: RouteType.PUBLIC },
  { path: '/explore', element: <Explore />, type: RouteType.PUBLIC },
  { path: '/discover', element: <Navigate to="/explore" replace />, type: RouteType.PUBLIC, redirectTo: '/explore' },
  { path: '/marketplace', element: <Marketplace />, type: RouteType.PUBLIC },
  { path: '/marketplace/listing/:id', element: <MarketplaceListingDetail />, type: RouteType.PUBLIC },
  { path: '/glossary', element: <Glossary />, type: RouteType.PUBLIC },
  { path: '/sitemap', element: <Sitemap />, type: RouteType.PUBLIC },
  { path: '/documentation', element: <Documentation />, type: RouteType.PUBLIC },
  { path: '/test-supabase', element: <TestSupabase />, type: RouteType.PUBLIC },
  // Authentication test page (protected by internal route guard)
  { path: '/auth-test', element: <AuthTest />, type: RouteType.PUBLIC },
  // Ensure the crypto route has proper redirectTo property
  { path: '/crypto', element: <Navigate to="/explore" replace />, type: RouteType.PUBLIC, redirectTo: '/explore' },
];

// Protected routes configuration
export const protectedRoutes: RouteConfig[] = [
  { path: '/dashboard', element: <Dashboard />, type: RouteType.PROTECTED },
  { path: '/onboarding', element: <Onboarding />, type: RouteType.PROTECTED },
  { path: '/skills', element: <Skills />, type: RouteType.PROTECTED },
  { path: '/achievements', element: <Achievements />, type: RouteType.PROTECTED },
  { path: '/maintenance', element: <Maintenance />, type: RouteType.PROTECTED },
  { path: '/service', element: <Service />, type: RouteType.PROTECTED },
  { path: '/schedule', element: <Schedule />, type: RouteType.PROTECTED },
  { path: '/analytics', element: <Analytics />, type: RouteType.PROTECTED },
  { path: '/fuel', element: <FuelTracking />, type: RouteType.PROTECTED },
  { path: '/diagnostics', element: <Diagnostics />, type: RouteType.PROTECTED },
  { path: '/parts', element: <Parts />, type: RouteType.PROTECTED },
  { path: '/service-history', element: <ServiceHistory />, type: RouteType.PROTECTED },
  { path: '/token-staking', element: <TokenStaking />, type: RouteType.PROTECTED },
  { path: '/tokens', element: <TokensPage />, type: RouteType.PROTECTED },
  { path: '/import', element: <Import />, type: RouteType.PROTECTED },
  { path: '/discovered-vehicles', element: <DiscoveredVehicles />, type: RouteType.PROTECTED },
  { path: '/vehicles', element: <Vehicles />, type: RouteType.PROTECTED },
  { path: '/add-vehicle', element: <AddVehicle />, type: RouteType.PROTECTED },
  { path: '/import-vehicles', element: <VehicleImport />, type: RouteType.PROTECTED },
  { path: '/vehicles/:id', element: <VehicleDetail />, type: RouteType.PROTECTED },
  { path: '/vehicle/:id', element: <Navigate to="/vehicles/:id" replace />, type: RouteType.PROTECTED, redirectTo: '/vehicles/:id' },
  { path: '/profile', element: <Navigate to="/auth/profile" replace />, type: RouteType.PROTECTED },
  { path: '/team-members', element: <TeamMembers />, type: RouteType.PROTECTED },
  { path: '/professional-dashboard', element: <Profile />, type: RouteType.PROTECTED },
  { path: '/studio', element: <Studio />, type: RouteType.PROTECTED },
  { path: '/explore/manage', element: <ExploreContentManagement />, type: RouteType.PROTECTED },
  { path: '/streaming', element: <Streaming />, type: RouteType.PROTECTED },
  { path: '/streaming/watch/:username', element: <StreamViewer />, type: RouteType.PROTECTED },
  { path: '/test-vehicle-input', element: <TestVehicleInput />, type: RouteType.PROTECTED },
  { path: '/admin', element: <AdminPanel />, type: RouteType.PROTECTED },
  { path: '/design-system', element: <DesignSystem />, type: RouteType.PROTECTED },
  { path: '/capture-integration', element: <CaptureIntegration />, type: RouteType.PROTECTED },
  { path: '/vehicle-setup', element: <VehicleSetup />, type: RouteType.PROTECTED },
];

// Special routes
export const specialRoutes: RouteConfig[] = [
  { path: '/', element: null, type: RouteType.PUBLIC, redirectTo: '/explore' },
  { path: '*', element: <Navigate to="/explore" replace />, type: RouteType.PUBLIC },
];

// Utility functions
export const isPublicPath = (path: string): boolean => {
  if (publicRoutes.some(route => route.path === path)) {
    return true;
  }
  
  return publicRoutes.some(route => {
    const routeSegments = route.path.split('/');
    const pathSegments = path.split('/');
    
    if (routeSegments.length !== pathSegments.length) return false;
    
    return routeSegments.every((segment, i) => {
      if (segment.startsWith(':')) return true;
      return segment === pathSegments[i];
    });
  });
};

// Create a unified routes collection
export const allRoutes: RouteConfig[] = [
  ...authRoutes, 
  ...publicRoutes, 
  ...protectedRoutes,
  ...specialRoutes
];
