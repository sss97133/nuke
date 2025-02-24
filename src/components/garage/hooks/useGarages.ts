
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
  });
};

const fetchGarages = async (): Promise<Garage[]> => {
  console.log("[GarageSelector] Fetching garages for user");
  
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!assert(!userError, "User fetch succeeded")) {
    throw new Error("Failed to fetch user");
  }
  
  if (!assert(user?.id != null, "User ID exists")) {
    throw new Error("No user ID found");
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('garage_members')
    .select('garage_id, role, status')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(MAX_GARAGES);

  if (!assert(!membershipError, "Membership fetch succeeded")) {
    throw membershipError;
  }

  if (!assert(Array.isArray(memberships), "Memberships is an array")) {
    return [];
  }

  if (memberships.length === 0) {
    return [];
  }

  if (!assert(memberships.length <= MAX_GARAGES, "Membership count within bounds")) {
    throw new Error("Too many garages");
  }

  const { data: garages, error: garagesError } = await supabase
    .from('garages')
    .select('*')
    .in('id', memberships.map(m => m.garage_id))
    .limit(MAX_GARAGES);

  if (!assert(!garagesError, "Garage fetch succeeded")) {
    throw garagesError;
  }

  if (!assert(Array.isArray(garages), "Garages is an array")) {
    return [];
  }

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

