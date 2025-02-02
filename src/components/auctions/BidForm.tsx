import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface BidFormProps {
  auctionId: string;
  currentPrice: number;
  onSubmit: (auctionId: string, amount: number) => Promise<void>;
}

export const BidForm = ({ auctionId, currentPrice, onSubmit }: BidFormProps) => {
  const [bidAmount, setBidAmount] = useState<string>("");

  return (
    <div className="space-y-2">
      <div className="flex space-x-2">
        <Input
          type="number"
          placeholder={`Min bid: $${(currentPrice + 100).toLocaleString()}`}
          value={bidAmount}
          onChange={(e) => setBidAmount(e.target.value)}
          className="flex-1"
          min={currentPrice}
          step="100"
        />
        <Button 
          onClick={() => {
            onSubmit(auctionId, parseFloat(bidAmount));
            setBidAmount("");
          }}
          className="w-32"
        >
          Place Bid
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Enter amount greater than current bid
      </p>
    </div>
  );
};