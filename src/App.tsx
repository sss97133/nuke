
import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from "@/components/ui/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { useAuthState } from './hooks/auth/use-auth-state'
import { AuthForm } from './components/auth/AuthForm'
import Profile from "./pages/Profile"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Temporary placeholder components for missing pages
const Dashboard = () => <div className="p-6"><h1 className="text-2xl font-bold">Dashboard</h1><p>Dashboard content will go here</p></div>;
const Onboarding = () => <div className="p-6"><h1 className="text-2xl font-bold">Onboarding</h1><p>Onboarding content will go here</p></div>;
const Skills = () => <div className="p-6"><h1 className="text-2xl font-bold">Skills</h1><p>Skills content will go here</p></div>;
const Achievements = () => <div className="p-6"><h1 className="text-2xl font-bold">Achievements</h1><p>Achievements content will go here</p></div>;
const Studio = () => <div className="p-6"><h1 className="text-2xl font-bold">Studio</h1><p>Studio content will go here</p></div>;
const Glossary = () => <div className="p-6"><h1 className="text-2xl font-bold">Glossary</h1><p>Glossary content will go here</p></div>;
const Sitemap = () => <div className="p-6"><h1 className="text-2xl font-bold">Sitemap</h1><p>Sitemap content will go here</p></div>;
const Documentation = () => <div className="p-6"><h1 className="text-2xl font-bold">Documentation</h1><p>Documentation content will go here</p></div>;
const Import = () => <div className="p-6"><h1 className="text-2xl font-bold">Import</h1><p>Import content will go here</p></div>;
const DiscoveredVehicles = () => <div className="p-6"><h1 className="text-2xl font-bold">Discovered Vehicles</h1><p>Discovered vehicles content will go here</p></div>;

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
    </Routes>
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
