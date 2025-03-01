
import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from "@/components/ui/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { useAuthState } from './hooks/auth/use-auth-state'
import { AuthForm } from './components/auth/AuthForm'
import Profile from "./pages/Profile"
import Dashboard from "./pages/Dashboard"
import Onboarding from "./pages/Onboarding"
import Skills from "./pages/Skills"
import Achievements from "./pages/Achievements"
import Studio from "./pages/Studio"
import Glossary from "./pages/Glossary"
import Sitemap from "./pages/Sitemap"
import Documentation from "./pages/Documentation"
import Import from "./pages/Import"
import DiscoveredVehicles from "./pages/DiscoveredVehicles"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Create a new QueryClient instance
const queryClient = new QueryClient();

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

  if (isAuthenticated && isAuthPath) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!isAuthenticated && !isAuthPath && !location.pathname.startsWith('/auth/callback')) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Routes>
        <Route path="/login" element={<AuthForm />} />
        <Route path="/register" element={<AuthForm />} />
        <Route path="/auth/callback" element={<AuthForm />} />
        <Route path="/" element={<AuthForm />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/achievements" element={<Achievements />} />
        <Route path="/studio" element={<Studio />} />
        <Route path="/glossary" element={<Glossary />} />
        <Route path="/sitemap" element={<Sitemap />} />
        <Route path="/documentation" element={<Documentation />} />
        <Route path="/import" element={<Import />} />
        <Route path="/discovered-vehicles" element={<DiscoveredVehicles />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/professional-dashboard" element={<Profile />} />
        <Route path="/service" element={<Dashboard />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
          <div className="App">
            <Toaster />
            <AppContent />
          </div>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
