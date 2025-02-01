import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthForm } from "@/components/auth/AuthForm";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  // Temporarily bypass authentication by setting a mock session
  const mockSession = {
    user: {
      id: 'temporary-user-id',
      email: 'temp@example.com'
    }
  };
  
  const [session, setSession] = useState(mockSession);
  const [loading, setLoading] = useState(false); // Set to false to skip loading state
  const { toast } = useToast();

  // Comment out authentication logic temporarily
  /*
  useEffect(() => {
    // Check current session
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
      }
    });

    return () => subscription.unsubscribe();
  }, [toast]);
  */

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  // Always render DashboardLayout by removing the session check
  return <DashboardLayout />;
};

export default Index;