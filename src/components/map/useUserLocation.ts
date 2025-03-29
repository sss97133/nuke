
import { useState, useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useUserLocation = () => {
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let isMounted = true;
    let retryCount = 0;
    const maxRetries = 3;
    
    const fetchUserLocation = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError) {
          console.error("Auth error:", authError);
          if (isMounted) {
            setError("Authentication error");
            setIsLoading(false);
          }
          return;
        }
        
        if (!user) {
          console.log('No authenticated user found');
          if (isMounted) {
            setIsLoading(false);
          }
          return;
        }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('home_location')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error fetching user location:', error);
          
          // Check if it's a connection error and retry
          if (error.message?.includes('network') && retryCount < maxRetries) {
            retryCount++;
            console.log(`Retrying location fetch (${retryCount}/${maxRetries})...`);
            
            // Exponential backoff
            setTimeout(fetchUserLocation, 1000 * Math.pow(2, retryCount));
            return;
          }
          
          if (isMounted) {
            setError("Could not fetch location data");
            setIsLoading(false);
          }
          return;
        }

        if (profile?.home_location && isMounted) {
          setUserLocation(profile.home_location as { lat: number; lng: number });
        }
        
        if (isMounted) {
          setIsLoading(false);
        }
      } catch (err) {
        console.error("Unexpected error in useUserLocation:", err);
        if (isMounted) {
          setError("An unexpected error occurred");
          setIsLoading(false);
        }
      }
    };

    fetchUserLocation();

    return () => {
      isMounted = false;
    };
  }, [toast]);

  return { userLocation, isLoading, error };
};
