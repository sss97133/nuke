import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DollarSign } from "lucide-react";

import { useAuctionEscrow } from './hooks/useAuctionEscrow';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

interface BidFormProps {
  auctionId: string;
  currentPrice: number;
  onSubmit: (auctionId: string, amount: number) => Promise<void>;
  smartContract?: {
    auctionAddress: string;
    minimumBidIncrement: number;
    escrowRequired: boolean;
    autoTransfer: boolean;
  };
  userWalletAddress?: string;
  vehicleInfo: string;
}

export const BidForm = ({ 
  auctionId, 
  currentPrice, 
  onSubmit,
  smartContract,
  userWalletAddress,
  vehicleInfo
}: BidFormProps) => {
  const [bidAmount, setBidAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  // Initialize auction escrow
  const {
    escrowBalance,
    requiredAmount,
    canBid,
    isLoading,
    placeBid,
    deposit
  } = useAuctionEscrow({
    auctionId,
    currentPrice,
    minimumBidIncrement: smartContract?.minimumBidIncrement || 100,
    escrowRequired: smartContract?.escrowRequired || false,
    autoTransfer: smartContract?.autoTransfer || false
  });

  const minBid = smartContract 
    ? currentPrice + smartContract.minimumBidIncrement
    : currentPrice + 100;

  return (
    <div className="space-y-4">
      {/* Smart Contract Info */}
      {smartContract && (
        <div className="bg-blue-50 p-3 rounded-lg space-y-2">
          <h4 className="font-medium text-blue-900">Smart Contract Auction</h4>
          {smartContract.escrowRequired && (
            <div className="text-sm text-blue-800">
              <p>Escrow Required</p>
              <p>Your Escrow Balance: ${escrowBalance.toLocaleString()}</p>
              <p>Required for Bid: ${requiredAmount.toLocaleString()}</p>
              {!canBid && (
                <div className="mt-2 space-y-2">
                  <p className="text-red-600">
                    ⚠️ Insufficient escrow balance
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => deposit(requiredAmount - escrowBalance)}
                    disabled={isProcessing || isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <DollarSign className="w-4 h-4 mr-2" />
                    )}
                    Deposit Required Amount
                  </Button>
                </div>
              )}
            </div>
          )}
          {smartContract.autoTransfer && (
            <p className="text-sm text-blue-800">
              🔄 Auto-transfer enabled: Vehicle NFT will transfer automatically upon auction end
            </p>
          )}
        </div>
      )}

      {/* Bid Input */}
      <div className="flex space-x-2">
        <div className="relative flex-1">
          <DollarSign className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
          <Input
            type="number"
            placeholder={`Min bid: $${minBid.toLocaleString()}`}
            value={bidAmount}
            onChange={(e) => setBidAmount(e.target.value)}
            className="pl-10"
            min={minBid}
            step={smartContract?.minimumBidIncrement || 100}
          />
        </div>
        <Button 
          onClick={async () => {
            if (!bidAmount) return;
            
            setIsProcessing(true);
            try {
              // If smart contract auction, handle escrow
              if (smartContract?.escrowRequired) {
                await placeBid(parseFloat(bidAmount), vehicleInfo);
              }

              // Submit bid
              await onSubmit(auctionId, parseFloat(bidAmount));
              setBidAmount("");
              
              toast({
                title: "Bid Placed Successfully",
                description: `Your bid of $${parseFloat(bidAmount).toLocaleString()} has been placed.`
              });
            } catch (error: any) {
              toast({
                title: "Error Placing Bid",
                description: error.message,
                variant: "destructive",
              });
            } finally {
              setIsProcessing(false);
            }
          }}
          className="w-32"
          disabled={isProcessing ||
            isLoading ||
            !bidAmount || 
            parseFloat(bidAmount) < minBid ||
            (smartContract?.escrowRequired && !canBid) ||
            !userWalletAddress
          }
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing
            </>
          ) : (
            "Place Bid"
          )}
        </Button>
      </div>

      {/* Bid Requirements */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Minimum bid: ${minBid.toLocaleString()}
        </p>
        {smartContract && (
          <p className="text-xs text-muted-foreground">
            Bid increment: ${smartContract.minimumBidIncrement.toLocaleString()}
          </p>
        )}
        {!userWalletAddress && (
          <p className="text-xs text-red-600">
            Connect your wallet to place bids
          </p>
        )}
      </div>
    </div>
  );
};