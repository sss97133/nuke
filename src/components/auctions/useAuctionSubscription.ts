
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export const useAuctionSubscription = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');

  useEffect(() => {
    // Create channel for auction updates
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
      .on('system', (event) => {
        // Handle connection status updates
        if (event === 'connected') {
          setConnectionStatus('connected');
          console.log('Connected to auction updates channel');
        } else if (event === 'disconnected') {
          setConnectionStatus('disconnected');
          console.error('Disconnected from auction updates channel');
          
          // Attempt to reconnect after a delay
          setTimeout(() => {
            if (channel.state !== 'joined') {
              console.log('Attempting to reconnect to auction updates channel');
              channel.subscribe();
            }
          }, 5000);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to auction updates');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Failed to subscribe to auction updates');
          setConnectionStatus('disconnected');
        }
      });

    // Create channel for bid updates
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
      .on('system', (event) => {
        if (event === 'connected') {
          console.log('Connected to bid updates channel');
        } else if (event === 'disconnected') {
          console.error('Disconnected from bid updates channel');
          
          // Attempt to reconnect after a delay
          setTimeout(() => {
            if (bidsChannel.state !== 'joined') {
              console.log('Attempting to reconnect to bid updates channel');
              bidsChannel.subscribe();
            }
          }, 5000);
        }
      })
      .subscribe();

    return () => {
      console.log('Removing Supabase channels');
      supabase.removeChannel(channel);
      supabase.removeChannel(bidsChannel);
    };
  }, [queryClient, toast]);

  return { connectionStatus };
};
