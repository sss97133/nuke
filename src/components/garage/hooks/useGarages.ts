
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Garage, MAX_GARAGES, MAX_RETRIES } from "../types";
import { assert } from "../utils/assertions";

export const useGarages = () => {
  return useQuery({
    queryKey: ['garages'],
    queryFn: fetchGarages,
    retry: MAX_RETRIES,
    staleTime: 5 * 60 * 1000, // 5 minutes
    onError: (error) => {
      console.error("[GarageSelector] Error fetching garages:", error);
    }
  });
};

const fetchGarages = async (): Promise<Garage[]> => {
  console.log("[GarageSelector] Starting garage fetch");
  
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) {
    console.error("[GarageSelector] User fetch failed:", userError);
    throw userError;
  }
  
  if (!user?.id) {
    console.error("[GarageSelector] No user ID found");
    throw new Error("No user ID found");
  }

  console.log("[GarageSelector] Fetching memberships for user:", user.id);
  const { data: memberships, error: membershipError } = await supabase
    .from('garage_members')
    .select('garage_id, role, status')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(MAX_GARAGES);

  if (membershipError) {
    console.error("[GarageSelector] Membership fetch failed:", membershipError);
    throw membershipError;
  }

  if (!Array.isArray(memberships)) {
    console.error("[GarageSelector] Memberships is not an array");
    return [];
  }

  if (memberships.length === 0) {
    console.log("[GarageSelector] No garage memberships found");
    return [];
  }

  console.log("[GarageSelector] Found memberships:", memberships);

  const { data: garages, error: garagesError } = await supabase
    .from('garages')
    .select('id, name')
    .in('id', memberships.map(m => m.garage_id))
    .limit(MAX_GARAGES);

  if (garagesError) {
    console.error("[GarageSelector] Garage fetch failed:", garagesError);
    throw garagesError;
  }

  if (!Array.isArray(garages)) {
    console.error("[GarageSelector] Garages is not an array");
    return [];
  }

  console.log("[GarageSelector] Successfully fetched garages:", garages);

  return garages.map(garage => {
    const membership = memberships.find(m => m.garage_id === garage.id);
    return {
      id: garage.id,
      name: garage.name,
      garage_members: [{
        role: membership?.role || 'member',
        status: 'active'
      }]
    };
  });
};
