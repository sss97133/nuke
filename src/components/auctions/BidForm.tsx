import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DollarSign } from "lucide-react";

interface BidFormProps {
  auctionId: string;
  currentPrice: number;
  onSubmit: (auctionId: string, amount: number) => Promise<void>;
}

export const BidForm = ({ auctionId, currentPrice, onSubmit }: BidFormProps) => {
  const [bidAmount, setBidAmount] = useState<string>("");
  const minBid = currentPrice + 100;

  return (
    <div className="space-y-2">
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
            step="100"
          />
        </div>
        <Button 
          onClick={() => {
            onSubmit(auctionId, parseFloat(bidAmount));
            setBidAmount("");
          }}
          className="w-32"
          disabled={!bidAmount || parseFloat(bidAmount) < minBid}
        >
          Place Bid
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Enter amount greater than ${minBid.toLocaleString()}
      </p>
    </div>
  );
};