import React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BidForm } from "./BidForm";
import { AuctionActions } from "./AuctionActions";
import { AuctionGallery } from "./AuctionGallery";
import { AuctionDetails } from "./AuctionDetails";
import { Clock, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AuctionCardProps {
  auction: {
    id: string;
    vehicle_id: string;
    starting_price: number;
    current_price: number;
    reserve_price: number | null;
    end_time: string;
    status: string;
    _count?: {
      auction_bids: number;
      auction_comments: number;
    };
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
  const timeRemaining = formatDistanceToNow(new Date(auction.end_time), { addSuffix: true });
  const bidCount = auction._count?.auction_bids || 0;
  const commentCount = auction._count?.auction_comments || 0;

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-200 hover:shadow-lg",
      isEnded ? "opacity-75" : ""
    )}>
      <div className="relative">
        <AuctionGallery
          make={auction.vehicle.make}
          model={auction.vehicle.model}
          year={auction.vehicle.year}
        />
        
        <div className="absolute top-4 right-4 bg-black/80 text-white px-3 py-1 rounded-full flex items-center">
          <Clock className="w-4 h-4 mr-2" />
          {timeRemaining}
        </div>
      </div>
      
      <div className="p-4 space-y-4">
        <div>
          <h3 className="text-xl font-semibold">
            {auction.vehicle.year} {auction.vehicle.make} {auction.vehicle.model}
          </h3>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
            <span className="flex items-center">
              <MessageSquare className="w-4 h-4 mr-1" />
              {commentCount} comments
            </span>
            <span>{bidCount} bids</span>
          </div>
        </div>

        <AuctionDetails
          currentPrice={auction.current_price}
          startingPrice={auction.starting_price}
          reservePrice={auction.reserve_price}
          endTime={auction.end_time}
        />

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