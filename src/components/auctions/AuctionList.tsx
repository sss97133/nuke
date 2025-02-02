import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AuctionComments } from "./AuctionComments";
import { BidHistory } from "./BidHistory";
import { useState, useEffect } from "react";
import { AuctionCard } from "./AuctionCard";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Clock, TrendingUp, MessageSquare, Filter } from "lucide-react";

interface Auction {
  id: string;
  vehicle_id: string;
  starting_price: number;
  current_price: number;
  reserve_price: number | null;
  end_time: string;
  status: string;
  bid_count: number;
  comment_count: number;
  vehicle: {
    make: string;
    model: string;
    year: number;
  };
}

export const AuctionList = () => {
  const { toast } = useToast();
  const [selectedAuction, setSelectedAuction] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("ending-soon");
  const queryClient = useQueryClient();

  const { data: auctions, isLoading } = useQuery({
    queryKey: ['auctions', sortBy],
    queryFn: async () => {
      console.log('Fetching auctions data...');
      let query = supabase
        .from('auctions')
        .select(`
          *,
          vehicle:vehicles(make, model, year),
          bid_count:auction_bids(count),
          comment_count:auction_comments(count)
        `);

      switch (sortBy) {
        case "ending-soon":
          query = query.order('end_time', { ascending: true });
          break;
        case "newest":
          query = query.order('created_at', { ascending: false });
          break;
        case "most-bids":
          query = query.order('current_price', { ascending: false });
          break;
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching auctions:', error);
        throw error;
      }

      console.log('Received auctions data:', data);
      return data.map((auction: any) => ({
        ...auction,
        bid_count: auction.bid_count?.[0]?.count ?? 0,
        comment_count: auction.comment_count?.[0]?.count ?? 0
      })) as Auction[];
    }
  });

  // Subscribe to real-time updates for auctions
  useEffect(() => {
    console.log('Setting up real-time subscriptions...');
    
    // Channel for auction updates
    const auctionChannel = supabase
      .channel('auction_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auctions'
        },
        (payload) => {
          console.log('Received auction update:', payload);
          queryClient.invalidateQueries({ queryKey: ['auctions'] });
          
          if (payload.eventType === 'UPDATE') {
            toast({
              title: "Auction Updated",
              description: "New bid or update received",
              variant: "default",
            });
          }
        }
      )
      .subscribe();

    // Channel for bid updates
    const bidChannel = supabase
      .channel('bid_updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'auction_bids'
        },
        (payload) => {
          console.log('Received new bid:', payload);
          queryClient.invalidateQueries({ queryKey: ['auctions'] });
          toast({
            title: "New Bid",
            description: "A new bid has been placed",
            variant: "default",
          });
        }
      )
      .subscribe();

    // Channel for comment updates
    const commentChannel = supabase
      .channel('comment_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auction_comments'
        },
        (payload) => {
          console.log('Received comment update:', payload);
          queryClient.invalidateQueries({ queryKey: ['auctions'] });
        }
      )
      .subscribe();

    return () => {
      console.log('Cleaning up subscriptions...');
      supabase.removeChannel(auctionChannel);
      supabase.removeChannel(bidChannel);
      supabase.removeChannel(commentChannel);
    };
  }, [queryClient, toast]);

  const handleBidSubmit = async (auctionId: string, amount: number) => {
    const { error } = await supabase
      .from('auction_bids')
      .insert([{
        auction_id: auctionId,
        amount: amount,
        bidder_id: (await supabase.auth.getUser()).data.user?.id
      }]);

    if (error) {
      toast({
        title: "Error placing bid",
        description: error.message,
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Bid placed successfully",
      description: `Your bid of $${amount.toLocaleString()} has been placed.`
    });
  };

  const handleToggleDetails = (auctionId: string) => {
    setSelectedAuction(selectedAuction === auctionId ? null : auctionId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-pulse text-gray-400">Loading auctions...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Live Auctions</h1>
        <div className="flex items-center gap-4">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[180px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ending-soon">Ending Soon</SelectItem>
              <SelectItem value="newest">Newest Listings</SelectItem>
              <SelectItem value="most-bids">Most Bids</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {auctions?.map((auction) => (
          <div key={auction.id} className="space-y-6">
            <AuctionCard
              auction={{
                ...auction,
                _count: {
                  auction_bids: auction.bid_count,
                  auction_comments: auction.comment_count
                }
              }}
              onBidSubmit={handleBidSubmit}
              onToggleDetails={handleToggleDetails}
              selectedAuction={selectedAuction}
            />
            
            {selectedAuction === auction.id && (
              <div className="space-y-6 animate-fade-in">
                <div className="grid gap-6">
                  <div className="bg-[#2A2F3C] rounded-lg border border-[#3A3F4C]">
                    <BidHistory auctionId={auction.id} />
                  </div>
                  <div className="bg-[#2A2F3C] rounded-lg border border-[#3A3F4C]">
                    <AuctionComments auctionId={auction.id} />
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};