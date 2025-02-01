import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthForm } from "@/components/auth/AuthForm";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useMemoryUsage } from "@/hooks/useMemoryUsage";

const Index = () => {
  const [session, setSession] = useState(null);
  const memoryUsage = useMemoryUsage();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              TAMS Login
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              Terminal Access Management System
            </p>
          </div>
          <AuthForm />
        </div>
      </div>
    );
  }

  return <DashboardLayout />;
};

export default Index;