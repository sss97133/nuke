
import React from 'react';
import Dashboard from "@/pages/Dashboard";
import Onboarding from "@/pages/Onboarding";
import Skills from "@/pages/Skills";
import Achievements from "@/pages/Achievements";
import Glossary from "@/pages/Glossary";
import Sitemap from "@/pages/Sitemap";
import Documentation from "@/pages/Documentation";
import Import from "@/pages/Import";
import DiscoveredVehicles from "@/pages/DiscoveredVehicles";
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
import Explore from "@/pages/Explore";
import ExploreContentManagement from '@/pages/ExploreContentManagement';
import VehicleDetail from '@/pages/VehicleDetail';
import TeamMembers from '@/pages/TeamMembers';
import Profile from '@/pages/Profile';
import Marketplace from '@/pages/Marketplace';
import MarketplaceListingDetail from '@/pages/MarketplaceListingDetail';
import { AuthForm } from '@/components/auth/AuthForm';
import Streaming from '@/pages/Streaming';
import { Navigate } from 'react-router-dom';

export interface RouteConfig {
  path: string;
  element: React.ReactNode;
  public?: boolean;
}

// Define public routes that don't require authentication
export const PUBLIC_ROUTES: string[] = [
  '/explore',
  '/discover', // Add discover to public routes
  '/marketplace',
  '/marketplace/listing',
  '/glossary',
  '/documentation',
  '/sitemap'
];

// Helper function to check if a path is public
export const isPublicPath = (path: string): boolean => {
  return PUBLIC_ROUTES.some(route => path.startsWith(route));
};

// Auth routes
export const authRoutes: RouteConfig[] = [
  { path: '/login', element: <AuthForm />, public: true },
  { path: '/register', element: <AuthForm />, public: true },
];

// Public routes configuration
export const publicRoutes: RouteConfig[] = [
  { path: '/explore', element: <Explore />, public: true },
  // Add a redirect from /discover to /explore
  { path: '/discover', element: <Navigate to="/explore" replace />, public: true },
  { path: '/marketplace', element: <Marketplace />, public: true },
  { path: '/marketplace/listing/:id', element: <MarketplaceListingDetail />, public: true },
  { path: '/glossary', element: <Glossary />, public: true },
  { path: '/documentation', element: <Documentation />, public: true },
  { path: '/sitemap', element: <Sitemap />, public: true },
];

// Protected routes configuration
export const protectedRoutes: RouteConfig[] = [
  { path: '/dashboard', element: <Dashboard /> },
  { path: '/onboarding', element: <Onboarding /> },
  { path: '/skills', element: <Skills /> },
  { path: '/achievements', element: <Achievements /> },
  { path: '/maintenance', element: <Maintenance /> },
  { path: '/service', element: <Service /> },
  { path: '/schedule', element: <Schedule /> },
  { path: '/analytics', element: <Analytics /> },
  { path: '/fuel', element: <FuelTracking /> },
  { path: '/diagnostics', element: <Diagnostics /> },
  { path: '/parts', element: <Parts /> },
  { path: '/service-history', element: <ServiceHistory /> },
  { path: '/token-staking', element: <TokenStaking /> },
  { path: '/tokens', element: <TokensPage /> },
  { path: '/import', element: <Import /> },
  { path: '/discovered-vehicles', element: <DiscoveredVehicles /> },
  { path: '/vehicle/:id', element: <VehicleDetail /> },
  { path: '/profile', element: <Profile /> },
  { path: '/team-members', element: <TeamMembers /> },
  { path: '/professional-dashboard', element: <Profile /> },
  { path: '/studio', element: <Studio /> },
  { path: '/explore/manage', element: <ExploreContentManagement /> },
  { path: '/streaming', element: <Streaming /> },
];

// All routes combined
export const allRoutes: RouteConfig[] = [
  ...authRoutes,
  ...publicRoutes,
  ...protectedRoutes
];
