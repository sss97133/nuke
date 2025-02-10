
import { useState, useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";

export type Garage = {
  id: string;
  name: string;
  location: { lat: number; lng: number } | null;
  address: string | null;
};

export const useGarages = () => {
  const [garages, setGarages] = useState<Garage[]>([]);

  useEffect(() => {
    const fetchGarages = async () => {
      const { data } = await supabase
        .from('garages')
        .select('id, name, location, address')
        .not('location', 'is', null);
      
      if (data) {
        const formattedGarages: Garage[] = data.map(garage => ({
          id: garage.id,
          name: garage.name,
          location: garage.location ? {
            lat: (garage.location as any).lat,
            lng: (garage.location as any).lng
          } : null,
          address: garage.address
        }));
        setGarages(formattedGarages);
      }
    };

    fetchGarages();

    const channel = supabase
      .channel('garage-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'garages'
        },
        (payload) => {
          console.log('Garage update:', payload);
          fetchGarages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return garages;
};
