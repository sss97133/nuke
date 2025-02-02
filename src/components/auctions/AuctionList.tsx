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
import { MessageSquare, TrendingUp, Clock, DollarSign, AlertTriangle, Camera } from "lucide-react";
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
      {auctions?.map((auction) => {
        const isEnded = new Date(auction.end_time) < new Date();
        const timeRemaining = formatDistance(new Date(auction.end_time), new Date(), { addSuffix: true });
        const hasReserve = auction.reserve_price !== null;
        const reserveMet = hasReserve && (auction.current_price >= auction.reserve_price!);

        return (
          <Card key={auction.id} className={cn(
            "overflow-hidden transition-all duration-200",
            isEnded ? "opacity-75" : "hover:shadow-lg"
          )}>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="relative aspect-video bg-muted rounded-l-lg flex items-center justify-center">
                <Camera className="w-12 h-12 text-muted-foreground/50" />
                <span className="absolute top-4 left-4 bg-black/75 text-white px-3 py-1 rounded-full text-sm">
                  {auction.vehicle.year} {auction.vehicle.make} {auction.vehicle.model}
                </span>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <h2 className="text-2xl font-bold">
                      {auction.vehicle.year} {auction.vehicle.make} {auction.vehicle.model}
                    </h2>
                    <div className="flex flex-col items-end">
                      <span className="text-sm text-muted-foreground">Current Bid:</span>
                      <span className="text-2xl font-bold text-primary">
                        ${(auction.current_price || auction.starting_price).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center space-x-4">
                      <span className="flex items-center">
                        <Clock className="w-4 h-4 mr-1" />
                        {timeRemaining}
                      </span>
                      {hasReserve && (
                        <span className={cn(
                          "flex items-center",
                          reserveMet ? "text-green-500" : "text-amber-500"
                        )}>
                          <AlertTriangle className="w-4 h-4 mr-1" />
                          {reserveMet ? "Reserve met" : "Reserve not met"}
                        </span>
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
                          className="flex-1"
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
                      <p className="text-xs text-muted-foreground">
                        Enter amount greater than current bid
                      </p>
                    </div>
                  )}

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
                </div>

                {selectedAuction === auction.id && (
                  <div className="grid gap-6 md:grid-cols-2 animate-fade-in">
                    <BidHistory auctionId={auction.id} />
                    <AuctionComments auctionId={auction.id} />
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
};