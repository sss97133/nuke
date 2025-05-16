
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useWebSocketStatus } from '@/integrations/supabase/WebSocketManager';

export const useAuctionSubscription = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { status: connectionStatus, reconnect } = useWebSocketStatus();
  const [subscribed, setSubscribed] = useState(false);

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
          console.log('Connected to auction updates channel');
          setSubscribed(true);
        } else if (event === 'disconnected') {
          console.error('Disconnected from auction updates channel');
          setSubscribed(false);
          
          // Don't try to reconnect immediately as the WebSocketManager will handle this
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to auction updates');
          setSubscribed(true);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Failed to subscribe to auction updates');
          setSubscribed(false);
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
        }
      })
      .subscribe();

    return () => {
      console.log('Removing Supabase channels');
      supabase.removeChannel(channel);
      supabase.removeChannel(bidsChannel);
    };
  }, [queryClient, toast]);

  // Re-subscribe if connection is lost and restored
  useEffect(() => {
    if (connectionStatus === 'connected' && !subscribed) {
      // Give a slight delay to ensure WebSocket is stable
      const timer = setTimeout(() => {
        console.log('Reconnecting to auction channels after connection restored');
        reconnect();
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [connectionStatus, subscribed, reconnect]);

  return { connectionStatus, subscribed };
};
