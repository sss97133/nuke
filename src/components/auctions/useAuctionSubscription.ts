import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export const useAuctionSubscription = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const channel = supabase
      .channel('auction_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auctions'
        },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ['auctions'] });
          
          if (payload.eventType === 'UPDATE') {
            toast({
              title: "Auction Updated",
              description: "The auction has been updated with new information."
            });
          }
        }
      )
      .subscribe();

    const bidsChannel = supabase
      .channel('bid_updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'auction_bids'
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['auctions'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(bidsChannel);
    };
  }, [queryClient, toast]);
};