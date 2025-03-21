
import type { Database } from '../types';
import { useState, useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";

export const useUserLocation = () => {
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const fetchUserLocation = async () => {
      const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      
      if (!user) {
        console.log('No authenticated user found');
        return;
      }

      const { data: profile, error } = await supabase
  if (error) console.error("Database query error:", error);
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
