import React from "react";
import { AlertTriangle, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuctionDetailsProps {
  currentPrice: number;
  startingPrice: number;
  reservePrice: number | null;
  endTime: string;
}

export const AuctionDetails = ({
  currentPrice,
  startingPrice,
  reservePrice,
}: AuctionDetailsProps) => {
  const hasReserve = reservePrice !== null;
  const reserveMet = hasReserve && currentPrice >= reservePrice!;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-3xl font-bold">
            ${(currentPrice || startingPrice).toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground ml-2">
            current bid
          </span>
        </div>
        
        {hasReserve && (
          <span
            className={cn(
              "inline-flex items-center text-sm font-medium",
              reserveMet ? "text-green-500" : "text-amber-500"
            )}
          >
            <AlertTriangle className="w-4 h-4 mr-1" />
            {reserveMet ? "Reserve met" : "Reserve not met"}
          </span>
        )}
      </div>
    </div>
  );
};