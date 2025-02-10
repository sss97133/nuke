
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
    console.log("[Index] Current route:", location.pathname);

    const handleAuthCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const error = params.get('error');
      const error_description = params.get('error_description');
      
      if (error) {
        console.error("[Index] OAuth error:", { error, error_description });
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: error_description || "Failed to authenticate"
        });
        navigate('/login');
        return;
      }

      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) throw sessionError;
        
        if (session) {
          console.log("[Index] Session found:", session);
          setSession(session);
          
          const { data: profile } = await supabase
            .from('profiles')
            .select('onboarding_completed')
            .eq('id', session.user.id)
            .single();
            
          if (!profile?.onboarding_completed) {
            navigate('/onboarding');
          } else {
            navigate('/dashboard');
          }
        }
      } catch (error) {
        console.error("[Index] Session error:", error);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: "Failed to verify session"
        });
        navigate('/login');
      }
    };

    if (location.pathname === '/auth/callback') {
      handleAuthCallback();
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log("[Index] Initial session check:", session ? "Found" : "None");
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("[Index] Auth state changed:", _event, session ? "Session exists" : "No session");
      setSession(session);
      
      if (!session && location.pathname !== '/login' && location.pathname !== '/auth/callback') {
        navigate('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [toast, navigate, location]);

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
      <Route 
        path="/auth/callback" 
        element={
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-muted-foreground">Processing authentication...</p>
            </div>
          </div>
        }
      />
      
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
        path="/*" 
        element={
          session ? <DashboardLayout /> : <Navigate to="/login" replace />
        } 
      />
    </Routes>
  );
};

export default Index;
