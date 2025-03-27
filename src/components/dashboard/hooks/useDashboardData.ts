
import type { Database } from '../types';
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "@/types/feed";

export const useDashboardData = () => {
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*');
  if (error) console.error("Database query error:", error);
      if (error) throw error;
      return data;
    }
  });

  const { data: assets } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const { data, error } = await supabase.select('*');
  if (error) console.error("Database query error:", error);
      if (error) throw error;
      return data;
    }
  });

  const { data: serviceTickets } = useQuery({
    queryKey: ['service_tickets'],
    queryFn: async () => {
      const { data, error } = await supabase.select('*');
  if (error) console.error("Database query error:", error);
      if (error) throw error;
      return data;
    }
  });

  const { data: feedItems } = useQuery({
    queryKey: ['feed'],
    queryFn: async () => {
      const { data: feedData, error } = await supabase
        .select(`
          *,
          profile:profiles(username, avatar_url)
        `)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return feedData as FeedItem[];
    }
  });

  return {
    vehicles,
    assets,
    serviceTickets,
    feedItems
  };
};
