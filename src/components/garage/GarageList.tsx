import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GarageCard } from "./GarageCard";

type Garage = {
  id: string;
  name: string;
  address: string | null;
  rating: number | null;
  garage_members: { user_id: string }[];
};

export const GarageList = () => {
  const { data: garages } = useQuery({
    queryKey: ['garages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('garages')
        .select(`
          id,
          name,
          address,
          rating,
          garage_members (
            user_id
          )
        `);
      
      if (error) throw error;
      return (data || []) as Garage[];
    }
  });

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {garages?.map((garage) => (
        <GarageCard key={garage.id} garage={garage} />
      ))}
    </div>
  );
};