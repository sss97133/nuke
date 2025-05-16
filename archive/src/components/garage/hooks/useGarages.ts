
import type { Database } from '../types';
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Garage, MAX_GARAGES, MAX_RETRIES } from "../types";
import { useToast } from "@/hooks/use-toast";

export const useGarages = () => {
  const { toast } = useToast();
  
  return useQuery({
    queryKey: ['garages'],
    queryFn: fetchGarages,
    retry: MAX_RETRIES,
    staleTime: 5 * 60 * 1000, // 5 minutes
    meta: {
      onError: (error: Error) => {
        console.error("[GarageSelector] Error in useQuery:", error);
        toast({
          title: "Error",
          description: "Failed to load garages. Please try again.",
          variant: "destructive"
        });
      }
    }
  });
};

const fetchGarages = async (): Promise<Garage[]> => {
  try {
    console.log("[GarageSelector] Starting garage fetch");
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
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

    if (!memberships || !Array.isArray(memberships)) {
      console.error("[GarageSelector] Memberships is not an array:", memberships);
      return [];
    }

    if (memberships.length === 0) {
      console.log("[GarageSelector] No garage memberships found");
      return [];
    }

    console.log("[GarageSelector] Found memberships:", memberships);
    const garageIds = memberships.map(m => m.garage_id);
    
    console.log("[GarageSelector] Fetching garages with IDs:", garageIds);
    const { data: garages, error: garagesError } = await supabase
        .select('id, name')
      .in('id', garageIds)
      .limit(MAX_GARAGES);

    if (garagesError) {
      console.error("[GarageSelector] Garage fetch failed:", garagesError);
      throw garagesError;
    }

    if (!garages || !Array.isArray(garages)) {
      console.error("[GarageSelector] Garages is not an array:", garages);
      return [];
    }

    console.log("[GarageSelector] Successfully fetched garages:", garages);

    return garages.map(garage => ({
      id: garage.id,
      name: garage.name,
      garage_members: [{
        role: memberships.find(m => m.garage_id === garage.id)?.role || 'member',
        status: 'active'
      }]
    }));
  } catch (error) {
    console.error("[GarageSelector] Unexpected error in fetchGarages:", error);
    throw error; // Re-throw to trigger the onError callback
  }
};
