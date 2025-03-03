
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
import TokensPage from "./pages/Tokens"  // Make sure it's imported as default export
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
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    console.log("App mounted, session:", session);
    return () => setIsMounted(false);
  }, [session]);

  if (!isMounted) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  const isAuthenticated = !!session;
  const isAuthPath = ['/login', '/register'].includes(location.pathname);
  const isRootPath = location.pathname === '/';

  if (isRootPath) {
    return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />;
  }

  if (isAuthenticated && isAuthPath) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!isAuthenticated && !isAuthPath && !location.pathname.startsWith('/auth/callback')) {
    return <Navigate to="/login" replace />;
  }

  if (isAuthPath || location.pathname.startsWith('/auth/callback')) {
    return (
      <div className="min-h-screen bg-background">
        <Routes>
          <Route path="/login" element={<AuthForm />} />
          <Route path="/register" element={<AuthForm />} />
          <Route path="/auth/callback" element={<div className="flex items-center justify-center h-screen">Completing login...</div>} />
          <Route path="/" element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    );
  }

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
          <Route path="/glossary" element={<Glossary />} />
          <Route path="/sitemap" element={<Sitemap />} />
          <Route path="/documentation" element={<Documentation />} />
          <Route path="/import" element={<Import />} />
          <Route path="/discovered-vehicles" element={<DiscoveredVehicles />} />
          <Route path="/vehicle/:id" element={<VehicleDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/team-members" element={<TeamMembers />} />
          <Route path="/professional-dashboard" element={<Profile />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/explore/manage" element={<ExploreContentManagement />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function App() {
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
            <AppContent />
          </div>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
