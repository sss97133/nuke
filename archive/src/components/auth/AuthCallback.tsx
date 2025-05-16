
import type { Database } from '../types';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const AuthCallback = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        console.log("[AuthCallback] Starting callback processing");
        const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.error("Database query error:", error);
        
        console.log("[AuthCallback] Processing callback", { session, error });
        
        if (error) {
          console.error("[AuthCallback] Session error:", error);
          throw error;
        }

        if (!session) {
          console.error("[AuthCallback] No session found");
          throw new Error('No session found');
        }

        console.log("[AuthCallback] Session established:", session);
        
        // Check if user has a profile
        const { data: profile, error: profileError } = await supabase
        .from('profiles')
          .select('username, onboarding_completed')
          .eq('id', session.user.id)
          .single();

        if (profileError) {
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
        if (!profile?.username || !profile?.onboarding_completed) {
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
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
};
