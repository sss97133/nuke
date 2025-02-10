
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const AuthCallback = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const handleCallback = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      console.log("[AuthCallback] Processing callback", { session, error });
      
      if (error) {
        console.error("[AuthCallback] Error:", error);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: error.message
        });
        navigate('/login');
        return;
      }

      if (session) {
        console.log("[AuthCallback] Session established:", session);
        
        // Check if user has a profile
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
      } else {
        console.log("[AuthCallback] No session found");
        navigate('/login');
      }
    };

    handleCallback();
  }, [navigate, toast]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-lg">Completing sign in...</p>
      </div>
    </div>
  );
};
