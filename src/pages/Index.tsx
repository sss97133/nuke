
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthForm } from "@/components/auth/AuthForm";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useToast } from "@/hooks/use-toast";
import { Session } from "@supabase/supabase-js";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { Route, Routes, useNavigate, useLocation, Navigate } from "react-router-dom";

const Index = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Handle the OAuth callback
    if (location.hash && location.hash.includes("access_token")) {
      const params = new URLSearchParams(location.hash.substring(1));
      if (params.get("error")) {
        toast({
          title: "Authentication Error",
          description: params.get("error_description") || "Failed to authenticate",
          variant: "destructive",
        });
      }
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        toast({
          title: "Session Expired",
          description: "Please log in again to continue.",
          variant: "destructive",
        });
        navigate('/login');
      }
    });

    return () => subscription.unsubscribe();
  }, [toast, navigate, location]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary dark:bg-secondary-dark">
        <div className="animate-pulse space-y-4 text-center">
          <div className="h-8 w-32 bg-muted dark:bg-muted-dark rounded mx-auto"></div>
          <p className="text-muted-foreground dark:text-muted-foreground-dark">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Auth callback route */}
      <Route 
        path="/auth/callback" 
        element={<Navigate to="/dashboard" replace />} 
      />
      
      {/* Public routes */}
      <Route 
        path="/login" 
        element={
          session ? <Navigate to="/dashboard" replace /> : <AuthForm />
        } 
      />

      {/* Protected routes */}
      <Route 
        path="/onboarding" 
        element={
          session ? <OnboardingWizard /> : <Navigate to="/login" replace />
        } 
      />
      <Route 
        path="/*" 
        element={
          session ? <DashboardLayout /> : <Navigate to="/login" replace />
        } 
      />
    </Routes>
  );
};

export default Index;
