import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { useAuthState } from './hooks/auth/use-auth-state'
import { Dashboard } from './pages/Dashboard'
import { AuthForm } from './components/auth/AuthForm'
import Onboarding from './pages/Onboarding'
import Skills from './pages/Skills'
import Achievements from './pages/Achievements'
import Studio from './pages/Studio'
import Glossary from './pages/Glossary'
import Sitemap from './pages/Sitemap'
import Documentation from './pages/Documentation'
import Import from './pages/Import'
import DiscoveredVehicles from './pages/DiscoveredVehicles'
import Profile from "./pages/Profile";

function App() {
  const { loading, session } = useAuthState();
  const location = useLocation();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Prevent rendering routes until the component is mounted
  if (!isMounted) {
    return null;
  }

  // Show a loading indicator while the auth state is loading
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  const isAuthenticated = !!session;
  const isAuthPath = ['/login', '/register'].includes(location.pathname);

  // If the user is authenticated and trying to access an auth page, redirect to the dashboard
  if (isAuthenticated && isAuthPath) {
    return <Navigate to="/dashboard" replace />;
  }

  // If the user is not authenticated, redirect to the login page, except for the auth callback page
  if (!isAuthenticated && !isAuthPath && !location.pathname.startsWith('/auth/callback')) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="App">
      <ThemeProvider>
        <Toaster />
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
        </Routes>
      </ThemeProvider>
    </div>
  );
}

export default App;
