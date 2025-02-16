
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/toaster";
import { BloombergTerminal } from "@/components/terminal/BloombergTerminal";
import { TokensPage } from "./pages/Tokens";
import { ImportPage } from "./pages/ImportPage";
import { Sitemap } from "./pages/Sitemap";
import { Glossary } from "./pages/Glossary";
import { Algorithms } from "./pages/Algorithms";
import { NewProject } from "./pages/NewProject";
import { ProfessionalDashboard } from "./pages/ProfessionalDashboard";
import { Skills } from "./pages/Skills";
import { Achievements } from "./pages/Achievements";
import { Settings } from "./pages/Settings";
import { Inventory } from "./pages/Inventory";
import { Service } from "./pages/Service";
import { VinScanner } from "./pages/VinScanner";
import { MarketAnalysis } from "./pages/MarketAnalysis";
import { Studio } from "./pages/Studio";
import { Streaming } from "./pages/Streaming";
import { AIExplanations } from "./pages/AIExplanations";
import { TokenAnalytics } from "./pages/TokenAnalytics";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthCallback } from "@/components/auth/AuthCallback";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

// Create a client
const queryClient = new QueryClient();

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
        setIsAuthenticated(!!session);
      });

      return () => subscription.unsubscribe();
    };

    checkAuth();
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <Router>
          <Routes>
            {/* Public routes */}
            <Route 
              path="/login" 
              element={isAuthenticated ? <Navigate to="/" /> : <AuthForm />} 
            />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Protected routes */}
            <Route element={!isAuthenticated ? <Navigate to="/login" /> : <DashboardLayout />}>
              <Route path="/" element={<BloombergTerminal />} />
              <Route path="/terminal" element={<BloombergTerminal />} />
              <Route path="/tokens" element={<TokensPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/sitemap" element={<Sitemap />} />
              <Route path="/glossary" element={<Glossary />} />
              <Route path="/algorithms" element={<Algorithms />} />
              <Route path="/projects/new" element={<NewProject />} />
              <Route path="/professional" element={<ProfessionalDashboard />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/achievements" element={<Achievements />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/service" element={<Service />} />
              <Route path="/vin-scanner" element={<VinScanner />} />
              <Route path="/market-analysis" element={<MarketAnalysis />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/streaming" element={<Streaming />} />
              <Route path="/ai-explanations" element={<AIExplanations />} />
              <Route path="/token-analytics" element={<TokenAnalytics />} />
            </Route>

            {/* Fallback route */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

