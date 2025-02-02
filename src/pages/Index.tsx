import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthForm } from "@/components/auth/AuthForm";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useToast } from "@/hooks/use-toast";
import { Session } from "@supabase/supabase-js";

const Index = () => {
  // For development, we'll create a mock session
  const mockSession: Session = {
    access_token: "mock_token",
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "mock_refresh",
    user: {
      id: "mock_user_id",
      aud: "authenticated",
      role: "authenticated",
      email: "shkylar@gmail.com",
      email_confirmed_at: new Date().toISOString(),
      phone: "",
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: {
        provider: "email",
        providers: ["email"],
      },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };

  const [session, setSession] = useState<Session | null>(mockSession); // Set mock session as default
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Comment out the actual auth check for development
    /*
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

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
      }
    });

    return () => subscription.unsubscribe();
    */
    
    // Instead, just set loading to false
    setLoading(false);
  }, [toast]);

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

  // Skip the auth form completely
  return <DashboardLayout />;
};

export default Index;