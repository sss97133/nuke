
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
      const [vehicles, assets, services, auctions] = await Promise.all([
        supabase.from('vehicles').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('assets').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('service_tickets').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('auctions').select('*').order('created_at', { ascending: false }).limit(5)
      ]);

      const allItems: FeedItem[] = [
        ...(vehicles.data || []).map(v => ({ 
          type: 'vehicle' as const, 
          data: v, 
          date: v.created_at 
        })),
        ...(assets.data || []).map(i => ({ 
          type: 'asset' as const, 
          data: i, 
          date: i.created_at 
        })),
        ...(services.data || []).map(s => ({ 
          type: 'service' as const, 
          data: s, 
          date: s.created_at 
        })),
        ...(auctions.data || []).map(a => ({ 
          type: 'auction' as const, 
          data: a, 
          date: a.created_at 
        }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return allItems;
    }
  });

  return {
    vehicles,
    assets,
    serviceTickets,
    feedItems
  };
};
