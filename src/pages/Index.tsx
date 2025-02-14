
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthForm } from "@/components/auth/AuthForm";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useToast } from "@/hooks/use-toast";
import { Session } from "@supabase/supabase-js";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { Route, Routes, useNavigate, useLocation, Navigate } from "react-router-dom";
import { AuthCallback } from "@/components/auth/AuthCallback";
import { Sitemap } from "@/components/sitemap/Sitemap";
import { Glossary } from "@/components/glossary/Glossary";

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/sitemap', '/glossary'];

const Index = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    console.log("[Index] Current route:", location.pathname);

    const initializeSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      console.log("[Index] Initial session check:", session ? "Found" : "None");
      setSession(session);
      setLoading(false);
    };

    initializeSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("[Index] Auth state changed:", _event, session ? "Session exists" : "No session");
      setSession(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [toast, navigate, location]);

  const isPublicRoute = (path: string) => {
    return PUBLIC_ROUTES.some(route => path.startsWith(route));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse space-y-4 text-center">
          <div className="h-8 w-32 bg-muted rounded mx-auto"></div>
          <p className="text-muted-foreground">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      
      <Route 
        path="/login" 
        element={
          session ? <Navigate to="/dashboard" replace /> : <AuthForm />
        } 
      />

      <Route 
        path="/onboarding" 
        element={
          session ? <OnboardingWizard /> : <Navigate to="/login" replace />
        } 
      />

      <Route 
        path="/sitemap" 
        element={<Sitemap />} 
      />

      <Route 
        path="/glossary" 
        element={<Glossary />} 
      />

      <Route 
        path="/dashboard/*" 
        element={
          session ? <DashboardLayout /> : <Navigate to="/login" state={{ from: location }} replace />
        } 
      />

      <Route 
        path="/" 
        element={
          session ? <Navigate to="/dashboard" replace /> : <Navigate to="/sitemap" replace />
        } 
      />

      <Route 
        path="*" 
        element={
          isPublicRoute(location.pathname) ? (
            <Navigate to={location.pathname} replace />
          ) : (
            session ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/login" state={{ from: location }} replace />
            )
          )
        } 
      />
    </Routes>
  );
};

export default Index;

