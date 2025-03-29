
import { useState, useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";

export const useUserLocation = () => {
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const fetchUserLocation = async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError) {
        console.error("Auth error:", authError);
        return;
      }
      
      if (!user) {
        console.log('No authenticated user found');
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('home_location')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching user location:', error);
        return;
      }

      if (profile?.home_location) {
        setUserLocation(profile.home_location as { lat: number; lng: number });
      }
    };

    fetchUserLocation();
  }, []);

  return userLocation;
};
