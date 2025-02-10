
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
    const handleAuthCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const error = params.get('error');
      const error_description = params.get('error_description');
      
      if (error) {
        console.error("[Index] OAuth error:", { error, error_description });
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: error_description || "Failed to authenticate",
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
            .select('username')
            .eq('id', session.user.id)
            .single();
            
          if (!profile?.username) {
            navigate('/onboarding');
          } else {
            navigate('/dashboard');
          }
        }
      } catch (error) {
        console.error("[Index] Session error:", error);
        navigate('/login');
      }
    };

    const handleAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      
      if (event.data?.type === 'auth:success') {
        console.log("[Index] Received auth success message:", event.data);
        navigate(event.data.redirect);
      } else if (event.data?.type === 'auth:error') {
        console.error("[Index] Received auth error message:", event.data);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: event.data.error
        });
        navigate('/login');
      }
    };

    if (location.pathname === '/auth/callback') {
      handleAuthCallback();
    }

    window.addEventListener('message', handleAuthMessage);

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
      window.removeEventListener('message', handleAuthMessage);
    };
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
