
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from 'lucide-react';

export const AuthCallback = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        console.log("[AuthCallback] Starting callback processing");
        
        // Get the session after OAuth redirect
        const { data: { session }, error } = await supabase.auth.getSession();
        
        console.log("[AuthCallback] Processing callback", { session: session?.user?.email, error });
        
        if (error) {
          console.error("[AuthCallback] Session error:", error);
          toast({
            variant: "destructive",
            title: "Authentication Error",
            description: error.message || "Failed to authenticate"
          });
          navigate('/login');
          return;
        }

        if (!session) {
          console.error("[AuthCallback] No session found");
          toast({
            variant: "destructive",
            title: "Authentication Error",
            description: "No session found"
          });
          navigate('/login');
          return;
        }

        console.log("[AuthCallback] Session established for:", session.user.email);
        
        // Check if user has a profile
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('username, onboarding_completed')
          .eq('id', session.user.id)
          .single();

        if (profileError && profileError.code !== 'PGRST116') {
          console.error("[AuthCallback] Profile error:", profileError);
        }

        // Extract GitHub profile data from user metadata
        const metadata = session.user.user_metadata;
        console.log("[AuthCallback] User metadata:", metadata);

        // Store GitHub data in localStorage for onboarding
        if (metadata) {
          localStorage.setItem('onboarding_data', JSON.stringify({
            firstName: metadata.name ? metadata.name.split(' ')[0] : '',
            lastName: metadata.name ? metadata.name.split(' ').slice(1).join(' ') : '',
            avatarUrl: metadata.avatar_url || '',
            email: session.user.email || '',
            username: metadata.user_name || metadata.preferred_username || '',
            socialLinks: {
              github: metadata.user_name ? `https://github.com/${metadata.user_name}` : '',
              twitter: '',
              instagram: '',
              linkedin: ''
            }
          }));
        }

        // Redirect based on profile status
        if (profile?.onboarding_completed === false) {
          navigate('/onboarding');
        } else {
          navigate('/dashboard');
        }
        
      } catch (error) {
        console.error("[AuthCallback] Error:", error);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: error instanceof Error ? error.message : 'Failed to authenticate'
        });
        navigate('/login');
      }
    };

    // Process the callback immediately
    handleCallback();
  }, [navigate, toast]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
};
