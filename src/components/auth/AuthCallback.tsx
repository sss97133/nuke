
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
        
        // If we're in a popup, send error to parent and close
        if (window.opener) {
          window.opener.postMessage(
            { type: 'supabase:auth:callback', error },
            window.location.origin
          );
        } else {
          navigate('/login');
        }
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

        // If we're in a popup, send success to parent and let it handle navigation
        if (window.opener) {
          window.opener.postMessage(
            { type: 'supabase:auth:callback', session },
            window.location.origin
          );
        } else {
          // Direct navigation if not in popup
          if (!profile?.username) {
            navigate('/onboarding');
          } else {
            navigate('/dashboard');
          }
        }
      } else {
        console.log("[AuthCallback] No session found");
        if (window.opener) {
          window.opener.postMessage(
            { type: 'supabase:auth:callback', error: 'No session found' },
            window.location.origin
          );
        } else {
          navigate('/login');
        }
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
