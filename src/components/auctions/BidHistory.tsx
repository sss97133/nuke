import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDistance } from "date-fns";
import { TrendingUp } from "lucide-react";

interface Bid {
  id: string;
  amount: number;
  created_at: string;
  profiles: {
    username: string;
    avatar_url: string;
  };
}

interface BidHistoryProps {
  auctionId: string;
}

export const BidHistory = ({ auctionId }: BidHistoryProps) => {
  const { toast } = useToast();
  const [bids, setBids] = useState<Bid[]>([]);

  useEffect(() => {
    fetchBids();
    subscribeToBids();
  }, [auctionId]);

  const fetchBids = async () => {
    const { data, error } = await supabase
      .from("auction_bids")
      .select(`
        *,
        profiles:bidder_id (
          username,
          avatar_url
        )
      `)
      .eq("auction_id", auctionId)
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        title: "Error fetching bids",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setBids(data);
  };

  const subscribeToBids = () => {
    const channel = supabase
      .channel("auction_bids")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "auction_bids",
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
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <TrendingUp className="h-5 w-5" />
        <h3 className="text-lg font-semibold">Bid History</h3>
      </div>

      <div className="space-y-4">
        {bids.map((bid) => (
          <div
            key={bid.id}
            className="flex items-center space-x-4 p-3 bg-background rounded-lg border animate-fade-in"
          >
            <Avatar className="h-8 w-8">
              <AvatarImage src={bid.profiles.avatar_url} />
              <AvatarFallback>
                {bid.profiles.username?.[0]?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <p className="text-sm font-medium">
                {bid.profiles.username || "Anonymous"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDistance(new Date(bid.created_at), new Date(), {
                  addSuffix: true,
                })}
              </p>
            </div>
            <p className="text-lg font-semibold">${bid.amount.toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
};