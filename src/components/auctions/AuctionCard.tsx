import React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BidForm } from "./BidForm";
import { AuctionActions } from "./AuctionActions";
import { AuctionGallery } from "./AuctionGallery";
import { AuctionDetails } from "./AuctionDetails";

interface AuctionCardProps {
  auction: {
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
  };
  onBidSubmit: (auctionId: string, amount: number) => Promise<void>;
  onToggleDetails: (auctionId: string) => void;
  selectedAuction: string | null;
}

export const AuctionCard = ({ 
  auction, 
  onBidSubmit, 
  onToggleDetails,
  selectedAuction 
}: AuctionCardProps) => {
  const isEnded = new Date(auction.end_time) < new Date();

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-200",
      isEnded ? "opacity-75" : "hover:shadow-lg"
    )}>
      <AuctionGallery
        make={auction.vehicle.make}
        model={auction.vehicle.model}
        year={auction.vehicle.year}
      />
      
      <AuctionDetails
        currentPrice={auction.current_price}
        startingPrice={auction.starting_price}
        reservePrice={auction.reserve_price}
        endTime={auction.end_time}
      />

      <div className="p-6 pt-0 space-y-6">
        {!isEnded && (
          <BidForm 
            auctionId={auction.id}
            currentPrice={auction.current_price || auction.starting_price}
            onSubmit={onBidSubmit}
          />
        )}

        <AuctionActions 
          auctionId={auction.id}
          isSelected={selectedAuction === auction.id}
          onToggle={onToggleDetails}
        />
      </div>
    </Card>
  );
};