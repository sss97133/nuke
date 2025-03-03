
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, safeQuery } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const useAuthNavigation = (userId: string | undefined) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isChecking, setIsChecking] = useState(false);
  const [shouldNavigate, setShouldNavigate] = useState(false);
  const [destinationPath, setDestinationPath] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    
    let mounted = true;
    setIsChecking(true);

    const checkProfile = async () => {
      try {
        console.info('[useAuthNavigation] Checking profile for user:', userId);
        
        // Use safeQuery for error handling
        const profile = await safeQuery(() => 
          supabase
            .from('profiles')
            .select('onboarding_completed')
            .eq('id', userId)
            .single()
        );

        if (!mounted) return;
        
        if (!profile) {
          // If no profile is found at all
          console.warn('[useAuthNavigation] No profile found, directing to onboarding');
          setDestinationPath('/onboarding');
          setShouldNavigate(true);
          return;
        }
        
        if (profile.onboarding_completed === false) {
          console.info('[useAuthNavigation] Onboarding incomplete, redirecting');
          setDestinationPath('/onboarding');
          setShouldNavigate(true);
        } else {
          console.info('[useAuthNavigation] Profile check complete, no redirection needed');
        }
      } catch (error: any) {
        console.error('[useAuthNavigation] Error fetching profile:', error);
        
        // Check if it's a network or connection error
        if (error.message?.includes('network') || error.message?.includes('Load failed')) {
          toast({
            title: "Connection Error",
            description: "Unable to connect to the server. Please check your internet connection.",
            variant: "destructive",
          });
        }
        
        // Don't redirect on error, just stay on the current page
      } finally {
        if (mounted) {
          setIsChecking(false);
        }
      }
    };

    checkProfile();

    return () => {
      mounted = false;
    };
  }, [userId, navigate, toast]);

  // Navigate if needed
  useEffect(() => {
    if (shouldNavigate && destinationPath) {
      navigate(destinationPath, { replace: true });
    }
  }, [shouldNavigate, destinationPath, navigate]);

  return { isChecking };
};
