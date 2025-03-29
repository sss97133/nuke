
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DollarSign, TrendingUp, WifiOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Profile {
  username: string;
  avatar_url: string;
}

interface Bid {
  id: string;
  amount: number;
  created_at: string;
  profiles: Profile;
}

interface BidHistoryProps {
  auctionId: string;
}

export const BidHistory = ({ auctionId }: BidHistoryProps) => {
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');

  useEffect(() => {
    fetchBids();
    
    const channel = supabase
      .channel('auction_bids')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'auction_bids',
          filter: `auction_id=eq.${auctionId}`,
        },
        () => {
          fetchBids();
        }
      )
      .on('system', (event) => {
        // Handle connection status updates
        if (event === 'connected') {
          setConnectionStatus('connected');
          console.log('Connected to auction bids channel');
        } else if (event === 'disconnected') {
          setConnectionStatus('disconnected');
          console.error('Disconnected from auction bids channel');
          
          // Attempt to reconnect after a delay
          setTimeout(() => {
            if (channel.state !== 'joined') {
              console.log('Attempting to reconnect to auction bids channel');
              channel.subscribe();
            }
          }, 5000);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to auction bids');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Failed to subscribe to auction bids');
          setConnectionStatus('disconnected');
        }
      });

    return () => {
      console.log('Removing auction bids channel');
      supabase.removeChannel(channel);
    };
  }, [auctionId]);

  const fetchBids = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase
        .from('auction_bids')
        .select(`
          id,
          amount,
          created_at,
          profiles:bidder_id (
            username,
            avatar_url
          )
        `)
        .eq('auction_id', auctionId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching bids:', error);
        setError('Failed to load bid history. Please try again.');
        return;
      }

      if (data) {
        setBids(data as unknown as Bid[]);
      }
    } catch (err) {
      console.error('Unexpected error fetching bids:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 bg-card p-4 rounded-lg border">
      <h3 className="text-lg font-semibold flex items-center">
        <TrendingUp className="w-5 h-5 mr-2" />
        Bid History
      </h3>
      
      {connectionStatus === 'disconnected' && (
        <Alert variant="warning" className="bg-amber-50 text-amber-800 border-amber-200">
          <WifiOff className="h-4 w-4 mr-2" />
          <AlertDescription>
            Connection lost. Bid updates may be delayed. Reconnecting...
          </AlertDescription>
        </Alert>
      )}
      
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <ScrollArea className="h-[300px] pr-4">
        {loading && <div className="flex justify-center p-4">Loading bids...</div>}
        
        <div className="space-y-4">
          {bids.map((bid) => {
            const profile = bid.profiles || { username: 'Unknown', avatar_url: '' };
            
            return (
              <div key={bid.id} className="flex items-center space-x-4 group hover:bg-accent/50 p-2 rounded-lg transition-colors">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={profile.avatar_url} />
                  <AvatarFallback>{profile.username[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{profile.username}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(bid.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm flex items-center text-primary">
                    <DollarSign className="w-4 h-4 mr-1" />
                    {bid.amount.toLocaleString()}
                  </p>
                </div>
              </div>
            );
          })}
          
          {!loading && bids.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              No bids have been placed yet.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
