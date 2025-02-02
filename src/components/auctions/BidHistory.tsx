import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DollarSign, TrendingUp } from "lucide-react";

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
    <div className="space-y-4 bg-card p-4 rounded-lg border">
      <h3 className="text-lg font-semibold flex items-center">
        <TrendingUp className="w-5 h-5 mr-2" />
        Bid History
      </h3>
      <ScrollArea className="h-[300px] pr-4">
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
        </div>
      </ScrollArea>
    </div>
  );
};