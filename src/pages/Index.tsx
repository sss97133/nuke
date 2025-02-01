import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthForm } from "@/components/auth/AuthForm";
import { DashboardSummary } from "@/components/dashboard/DashboardSummary";
import { CommandBar } from "@/components/dashboard/CommandBar";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
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
    return <AuthForm />;
  }

  return (
    <div className="min-h-screen bg-white font-mono">
      <header className="border-b border-gov-blue bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-8">
            <div className="flex items-center gap-4">
              <span className="text-tiny text-gov-blue">TAMS/v1.0</span>
              <span className="text-tiny text-gray-600">SID:{new Date().getTime()}</span>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              className="px-2 py-0.5 bg-gray-100 text-tiny hover:bg-gray-200 transition-colors border border-gray-400"
            >
              EXIT_SYS
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="mb-2 text-tiny">
          <span className="text-[#666]">[SYS_MSG]</span>
          <span className="text-gray-600 ml-2">TERMINAL_READY</span>
        </div>

        <DashboardSummary />
        <CommandBar />
        <ActivityFeed />

        <div className="text-tiny text-[#666] border-t border-gov-blue mt-4 pt-2">
          <div className="flex justify-between">
            <span>LAST_UPDATE: {new Date().toISOString()}</span>
            <span>MEM_USAGE: {memoryUsage}MB</span>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;