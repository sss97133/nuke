import type { Database } from '../types';
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Location = {
  id: string;
  name: string;
  type: string;
  rating: number | null;
};

export const LocationsList = () => {
  const { data: locations } = useQuery({
    queryKey: ['automotive-locations'],
    queryFn: async () => {
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('automotive_locations')
        .select('*');
      
      if (error) throw error;
      return (data || []) as Location[];
    }
  });

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {locations?.map((location) => (
        <div 
          key={location.id} 
          className="p-4 bg-card rounded-lg shadow-sm border"
        >
          <h3 className="font-semibold">{location.name}</h3>
          <p className="text-sm text-muted-foreground">{location.type}</p>
          {location.rating && (
            <div className="mt-2 text-sm">
              Rating: {location.rating}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};