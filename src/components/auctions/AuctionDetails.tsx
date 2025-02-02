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
    <div className="space-y-4 p-6 bg-[#1A1F2C] text-white">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <span className="text-sm text-gray-400">Current Bid:</span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">
              ${(currentPrice || startingPrice).toLocaleString()}
            </span>
            {hasReserve && (
              <span
                className={cn(
                  "inline-flex items-center text-sm font-medium",
                  reserveMet ? "text-green-400" : "text-amber-400"
                )}
              >
                <AlertTriangle className="w-4 h-4 mr-1" />
                {reserveMet ? "Reserve met" : "Reserve not met"}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center text-sm text-gray-400">
            <Clock className="w-4 h-4 mr-1" />
            {timeRemaining}
          </div>
        </div>
      </div>
    </div>
  );
};