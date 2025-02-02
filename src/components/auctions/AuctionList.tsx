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
import { MessageSquare, TrendingUp, Clock, DollarSign, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Auction {
  id: string;
  vehicle_id: string;
  starting_price: number;
  current_price: number;
  reserve_price: number | null;
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
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-pulse text-muted-foreground">Loading auctions...</div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {auctions?.map((auction) => {
        const isEnded = new Date(auction.end_time) < new Date();
        const timeRemaining = formatDistance(new Date(auction.end_time), new Date(), { addSuffix: true });
        const hasReserve = auction.reserve_price !== null;
        const reserveMet = hasReserve && (auction.current_price >= auction.reserve_price!);

        return (
          <Card key={auction.id} className={cn(
            "p-6 transition-all duration-200 hover:shadow-lg",
            isEnded ? "opacity-75" : "hover:scale-[1.01]"
          )}>
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <h3 className="text-2xl font-semibold">
                    {auction.vehicle.year} {auction.vehicle.make} {auction.vehicle.model}
                  </h3>
                  <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                    <div className="flex items-center">
                      <DollarSign className="w-4 h-4 mr-1" />
                      <span>Current Bid: </span>
                      <span className="font-semibold ml-1">
                        ${(auction.current_price || auction.starting_price).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center">
                      <Clock className="w-4 h-4 mr-1" />
                      <span>{timeRemaining}</span>
                    </div>
                    {hasReserve && (
                      <div className="flex items-center">
                        <AlertTriangle className={cn(
                          "w-4 h-4 mr-1",
                          reserveMet ? "text-green-500" : "text-amber-500"
                        )} />
                        <span>{reserveMet ? "Reserve met" : "Reserve not met"}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {!isEnded && (
                  <div className="space-y-2">
                    <div className="flex space-x-2">
                      <Input
                        type="number"
                        placeholder={`Min bid: $${((auction.current_price || auction.starting_price) + 100).toLocaleString()}`}
                        value={bidAmount}
                        onChange={(e) => setBidAmount(e.target.value)}
                        className="w-[200px]"
                        min={auction.current_price || auction.starting_price}
                        step="100"
                      />
                      <Button 
                        onClick={() => placeBid(auction.id, auction.current_price || auction.starting_price)}
                        className="w-32"
                        disabled={auction.status !== 'active'}
                      >
                        Place Bid
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground text-right">
                      Enter amount greater than current bid
                    </p>
                  </div>
                )}
              </div>

              <div className="flex space-x-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedAuction(selectedAuction === auction.id ? null : auction.id)}
                  className="flex items-center"
                >
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Comments
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedAuction(selectedAuction === auction.id ? null : auction.id)}
                  className="flex items-center"
                >
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Bid History
                </Button>
              </div>

              {selectedAuction === auction.id && (
                <div className="mt-4 grid gap-6 md:grid-cols-2 animate-fade-in">
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
        );
      })}
    </div>
  );
};