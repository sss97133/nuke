import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";

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

  useEffect(() => {
    fetchBids();
    
    // Subscribe to new bids
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [auctionId]);

  const fetchBids = async () => {
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
      return;
    }

    if (data) {
      setBids(data as unknown as Bid[]);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Bid History</h3>
      <div className="space-y-4">
        {bids.map((bid) => {
          const profile = bid.profiles || { username: 'Unknown', avatar_url: '' };
          
          return (
            <div key={bid.id} className="flex items-center space-x-4">
              <Avatar>
                <AvatarImage src={profile.avatar_url} />
                <AvatarFallback>{profile.username[0]}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{profile.username}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(bid.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm">Bid amount: ${bid.amount}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};