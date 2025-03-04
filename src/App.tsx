import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from "@/components/ui/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { useAuthState } from './hooks/auth/use-auth-state'
import { AuthForm } from './components/auth/AuthForm'
import { NetworkStatus } from './components/ui/network-status'
import Profile from "./pages/Profile"
import Dashboard from "./pages/Dashboard"
import Onboarding from "./pages/Onboarding"
import OnboardingCheck from "./components/onboarding/OnboardingCheck"
import Skills from "./pages/Skills"
import Achievements from "./pages/Achievements"
import Glossary from "./pages/Glossary"
import Sitemap from "./pages/Sitemap"
import Documentation from "./pages/Documentation"
import Import from "./pages/Import"
import DiscoveredVehicles from "./pages/DiscoveredVehicles"
import TokenStaking from "./pages/TokenStaking"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NavSidebar } from './components/layout/NavSidebar'
import TokensPage from "./pages/Tokens"
import ServiceHistory from "./pages/ServiceHistory"
import Parts from "./pages/Parts"
import FuelTracking from "./pages/FuelTracking"
import Diagnostics from "./pages/Diagnostics"
import Analytics from "./pages/Analytics"
import Schedule from "./pages/Schedule"
import Service from "./pages/Service"
import Maintenance from "./pages/Maintenance"
import Studio from "./pages/Studio"
import Explore from "./pages/Explore"
import ExploreContentManagement from './pages/ExploreContentManagement'
import VehicleDetail from './pages/VehicleDetail'
import TeamMembers from './pages/TeamMembers'
import { Helmet } from 'react-helmet'
import Marketplace from './pages/Marketplace'
import MarketplaceListingDetail from './pages/MarketplaceListingDetail'
import { Loader2 } from 'lucide-react'
import { AuthRequiredModal } from './components/auth/AuthRequiredModal'
import { AuthCallback } from './components/auth/AuthCallback'

// Define public routes that don't require authentication
const PUBLIC_ROUTES = [
  '/explore',
  '/marketplace',
  '/marketplace/listing',
  '/glossary',
  '/documentation',
  '/sitemap'
];

// Helper function to check if a path is public
const isPublicPath = (path: string) => {
  return PUBLIC_ROUTES.some(route => path.startsWith(route));
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false
    }
  }
});

function AppContent() {
  const { loading, session } = useAuthState();
  const location = useLocation();

  // Debug information
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
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <p className="mt-4 text-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If this is the auth callback path, show the callback component
  if (isAuthCallbackPath) {
    return (
      <div className="min-h-screen bg-background">
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Routes>
      </div>
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
      <div className="flex min-h-screen bg-background">
        <NavSidebar />
        <div className="flex-1 pt-14 md:pt-0">
          <AuthRequiredModal />
          <Routes>
            <Route path="/explore" element={<Explore />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/marketplace/listing/:id" element={<MarketplaceListingDetail />} />
            <Route path="/glossary" element={<Glossary />} />
            <Route path="/documentation" element={<Documentation />} />
            <Route path="/sitemap" element={<Sitemap />} />
          </Routes>
        </div>
      </div>
    );
  }

  // Auth pages handling
  if (!isAuthenticated) {
    // Allow access to auth pages without redirection
    if (isAuthPath) {
      return (
        <div className="min-h-screen bg-background">
          <Routes>
            <Route path="/login" element={<AuthForm />} />
            <Route path="/register" element={<AuthForm />} />
          </Routes>
        </div>
      );
    }
    
    // Redirect to login for protected routes
    return <Navigate to="/login" replace />;
  }

  // Main app layout with authenticated routes
  return (
    <div className="flex min-h-screen bg-background">
      <NavSidebar />
      <div className="flex-1 pt-14 md:pt-0">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/service" element={<Service />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/fuel" element={<FuelTracking />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="/parts" element={<Parts />} />
          <Route path="/service-history" element={<ServiceHistory />} />
          <Route path="/token-staking" element={<TokenStaking />} />
          <Route path="/tokens" element={<TokensPage />} />
          <Route path="/import" element={<Import />} />
          <Route path="/discovered-vehicles" element={<DiscoveredVehicles />} />
          <Route path="/vehicle/:id" element={<VehicleDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/team-members" element={<TeamMembers />} />
          <Route path="/professional-dashboard" element={<Profile />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/explore/manage" element={<ExploreContentManagement />} />
        </Routes>
      </div>
    </div>
  );
}

function App() {
  console.log("App component initializing");
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
          <Helmet>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
            <meta name="theme-color" content="#1A1F2C" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          </Helmet>
          <div className="App">
            <Toaster />
            <NetworkStatus />
            <OnboardingCheck>
              <AppContent />
            </OnboardingCheck>
          </div>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
