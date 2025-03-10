import React from "react";
import { AlertTriangle, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuctionDetailsProps {
  currentPrice: number;
  startingPrice: number;
  reservePrice: number | null;
  endTime: string;
  smartContract?: {
    auctionAddress: string;
    minimumBidIncrement: number;
    escrowRequired: boolean;
    autoTransfer: boolean;
  };
  escrowBalance?: number;
  requiredEscrowAmount?: number;
}

export const AuctionDetails = ({
  currentPrice,
  startingPrice,
  reservePrice,
  smartContract,
  escrowBalance = 0,
  requiredEscrowAmount = 0,
}: AuctionDetailsProps) => {
  const hasReserve = reservePrice !== null;
  const reserveMet = hasReserve && currentPrice >= reservePrice!;
  const hasEscrowRequirement = smartContract?.escrowRequired && requiredEscrowAmount > 0;
  const meetsEscrowRequirement = escrowBalance >= requiredEscrowAmount;

  return (
    <div className="space-y-4">
      {/* Current Bid Info */}
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

      {/* Smart Contract Info */}
      {smartContract && (
        <div className="bg-blue-50 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-900">
              Smart Contract Auction
            </span>
            <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded">
              Verified
            </span>
          </div>

          <div className="space-y-2">
            {/* Minimum Bid Increment */}
            <div className="flex justify-between text-sm">
              <span className="text-blue-700">Minimum Increment</span>
              <span className="font-medium text-blue-900">
                ${smartContract.minimumBidIncrement.toLocaleString()}
              </span>
            </div>

            {/* Auto Transfer */}
            {smartContract.autoTransfer && (
              <div className="flex items-center text-sm text-blue-700">
                <DollarSign className="w-4 h-4 mr-1" />
                Auto-transfer enabled
              </div>
            )}
          </div>
        </div>
      )}

      {/* Escrow Requirements */}
      {hasEscrowRequirement && (
        <div className={cn(
          "rounded-lg p-4 space-y-2",
          meetsEscrowRequirement ? "bg-green-50" : "bg-amber-50"
        )}>
          <div className="flex justify-between items-center">
            <span className={cn(
              "text-sm font-medium",
              meetsEscrowRequirement ? "text-green-900" : "text-amber-900"
            )}>
              Escrow Status
            </span>
            <span className={cn(
              "text-xs px-2 py-1 rounded",
              meetsEscrowRequirement 
                ? "bg-green-200 text-green-800" 
                : "bg-amber-200 text-amber-800"
            )}>
              {meetsEscrowRequirement ? "Ready" : "Action Required"}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className={cn(
                meetsEscrowRequirement ? "text-green-700" : "text-amber-700"
              )}>
                Required Balance
              </span>
              <span className="font-medium">
                ${requiredEscrowAmount.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className={cn(
                meetsEscrowRequirement ? "text-green-700" : "text-amber-700"
              )}>
                Your Balance
              </span>
              <span className="font-medium">
                ${escrowBalance.toLocaleString()}
              </span>
            </div>

            {!meetsEscrowRequirement && (
              <p className="text-xs text-amber-600 mt-2">
                ⚠️ Deposit more funds to participate in this auction
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};