import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDistance } from "date-fns";

interface Auction {
  id: string;
  vehicle_id: string;
  starting_price: number;
  current_price: number;
  end_time: string;
  status: string;
  vehicle: {
    make: string;
    model: string;
    year: number;
  };
}

export const AuctionList = () => {
  const { toast } = useToast();

  const { data: auctions, isLoading } = useQuery({
    queryKey: ['auctions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auctions')
        .select(`
          *,
          vehicle:vehicles(make, model, year)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Auction[];
    }
  });

  const placeBid = async (auctionId: string, currentPrice: number) => {
    const bidAmount = currentPrice + 100; // Simple increment, could be made more sophisticated
    
    const { error } = await supabase
      .from('auction_bids')
      .insert([{
        auction_id: auctionId,
        amount: bidAmount,
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
      description: `Your bid of $${bidAmount} has been placed.`
    });
  };

  if (isLoading) {
    return <div className="text-center">Loading auctions...</div>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {auctions?.map((auction) => (
        <Card key={auction.id} className="p-4">
          <div className="space-y-2">
            <h3 className="font-semibold">
              {auction.vehicle.year} {auction.vehicle.make} {auction.vehicle.model}
            </h3>
            <div className="text-sm text-muted-foreground">
              <p>Current Bid: ${auction.current_price || auction.starting_price}</p>
              <p>
                Ends: {formatDistance(new Date(auction.end_time), new Date(), { addSuffix: true })}
              </p>
              <p>Status: {auction.status}</p>
            </div>
            <Button 
              onClick={() => placeBid(auction.id, auction.current_price || auction.starting_price)}
              className="w-full mt-2"
              disabled={auction.status !== 'active'}
            >
              Place Bid
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
};