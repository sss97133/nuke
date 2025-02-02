import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AuctionComments } from "./AuctionComments";
import { BidHistory } from "./BidHistory";
import { useState } from "react";
import { AuctionCard } from "./AuctionCard";

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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 bg-[#1A1F2C] min-h-screen py-8">
      {auctions?.map((auction) => (
        <div key={auction.id} className="space-y-6">
          <AuctionCard
            auction={auction}
            onBidSubmit={handleBidSubmit}
            onToggleDetails={handleToggleDetails}
            selectedAuction={selectedAuction}
          />
          
          {selectedAuction === auction.id && (
            <div className="grid gap-6 md:grid-cols-2 animate-fade-in">
              <div className="bg-[#2A2F3C] p-6 rounded-lg border border-[#3A3F4C]">
                <BidHistory auctionId={auction.id} />
              </div>
              <div className="bg-[#2A2F3C] p-6 rounded-lg border border-[#3A3F4C]">
                <AuctionComments auctionId={auction.id} />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};