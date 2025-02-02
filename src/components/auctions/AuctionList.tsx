import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDistance } from "date-fns";
import { AuctionComments } from "./AuctionComments";
import { BidHistory } from "./BidHistory";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { MessageSquare, TrendingUp } from "lucide-react";

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
  const [selectedAuction, setSelectedAuction] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState<string>("");

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
    const amount = parseFloat(bidAmount);
    if (isNaN(amount) || amount <= currentPrice) {
      toast({
        title: "Invalid bid amount",
        description: "Bid must be higher than the current price",
        variant: "destructive"
      });
      return;
    }
    
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
    setBidAmount("");
  };

  if (isLoading) {
    return <div className="text-center">Loading auctions...</div>;
  }

  return (
    <div className="grid gap-6">
      {auctions?.map((auction) => (
        <Card key={auction.id} className="p-6">
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-semibold">
                  {auction.vehicle.year} {auction.vehicle.make} {auction.vehicle.model}
                </h3>
                <div className="text-sm text-muted-foreground">
                  <p>Current Bid: ${(auction.current_price || auction.starting_price).toLocaleString()}</p>
                  <p>
                    Ends: {formatDistance(new Date(auction.end_time), new Date(), { addSuffix: true })}
                  </p>
                  <p>Status: {auction.status}</p>
                </div>
              </div>
              
              <div className="space-y-2">
                <Input
                  type="number"
                  placeholder="Enter bid amount"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  className="w-[200px]"
                  min={auction.current_price || auction.starting_price}
                  step="100"
                />
                <Button 
                  onClick={() => placeBid(auction.id, auction.current_price || auction.starting_price)}
                  className="w-full"
                  disabled={auction.status !== 'active'}
                >
                  Place Bid
                </Button>
              </div>
            </div>

            <div className="flex space-x-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedAuction(selectedAuction === auction.id ? null : auction.id)}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Comments
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedAuction(selectedAuction === auction.id ? null : auction.id)}
              >
                <TrendingUp className="mr-2 h-4 w-4" />
                Bid History
              </Button>
            </div>

            {selectedAuction === auction.id && (
              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <BidHistory auctionId={auction.id} />
                </div>
                <div className="space-y-4">
                  <AuctionComments auctionId={auction.id} />
                </div>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
};