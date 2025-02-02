import React from "react";
import { Clock, AlertTriangle, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistance } from "date-fns";

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
  endTime,
}: AuctionDetailsProps) => {
  const isEnded = new Date(endTime) < new Date();
  const timeRemaining = formatDistance(new Date(endTime), new Date(), { addSuffix: true });
  const hasReserve = reservePrice !== null;
  const reserveMet = hasReserve && currentPrice >= reservePrice!;

  return (
    <div className="space-y-4 p-6">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <span className="text-sm text-muted-foreground">Current Bid:</span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              ${(currentPrice || startingPrice).toLocaleString()}
            </span>
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
        <div className="text-right">
          <div className="flex items-center text-sm text-muted-foreground">
            <Clock className="w-4 h-4 mr-1" />
            {timeRemaining}
          </div>
        </div>
      </div>
    </div>
  );
};