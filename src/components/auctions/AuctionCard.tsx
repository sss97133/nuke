import React from "react";
import { Card } from "@/components/ui/card";
import { Camera, Clock, AlertTriangle, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistance } from "date-fns";
import { BidForm } from "./BidForm";
import { AuctionActions } from "./AuctionActions";

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
  const timeRemaining = formatDistance(new Date(auction.end_time), new Date(), { addSuffix: true });
  const hasReserve = auction.reserve_price !== null;
  const reserveMet = hasReserve && auction.current_price >= auction.reserve_price!;

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-200",
      isEnded ? "opacity-75" : "hover:shadow-lg"
    )}>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="relative aspect-video bg-muted rounded-l-lg flex items-center justify-center group">
          <Camera className="w-12 h-12 text-muted-foreground/50 group-hover:scale-110 transition-transform" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
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
        </div>
      </div>
    </Card>
  );
};