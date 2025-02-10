
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
    const handleAuthCallback = async () => {
      console.log("Handling auth callback");
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get('code');
      
      if (code) {
        try {
          console.log("Exchanging code for session");
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error("Error exchanging code for session:", error);
            toast({
              title: "Authentication Error",
              description: error.message,
              variant: "destructive",
            });
            navigate('/login');
          } else if (data.session) {
            console.log("Successfully authenticated, session:", data.session);
            setSession(data.session);
            navigate('/dashboard');
          }
        } catch (error) {
          console.error("Error in auth callback:", error);
          navigate('/login');
        }
      }
    };

    if (location.pathname === '/auth/callback') {
      handleAuthCallback();
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log("Initial session check:", session ? "Found" : "None");
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("Auth state changed:", _event, session ? "Session exists" : "No session");
      setSession(session);
      
      if (!session && location.pathname !== '/login' && location.pathname !== '/auth/callback') {
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
        element={
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <p>Processing authentication...</p>
            </div>
          </div>
        }
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
