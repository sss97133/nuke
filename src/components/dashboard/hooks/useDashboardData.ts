
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "@/types/feed";

export const useDashboardData = () => {
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*');
      if (error) throw error;
      return data;
    }
  });

  const { data: assets } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('assets').select('*');
      if (error) throw error;
      return data;
    }
  });

  const { data: serviceTickets } = useQuery({
    queryKey: ['service_tickets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_tickets').select('*');
      if (error) throw error;
      return data;
    }
  });

  const { data: feedItems } = useQuery({
    queryKey: ['feed'],
    queryFn: async () => {
      const { data: feedData, error } = await supabase
        .from('feed_items')
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
