import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DollarSign, ArrowUpCircle, ArrowDownCircle, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface EscrowManagerProps {
  userAddress?: string;
  escrowBalance: number;
  onDeposit: (amount: number) => Promise<void>;
  onWithdraw: (amount: number) => Promise<void>;
  minRequiredBalance?: number;
  pendingBids?: Array<{
    auctionId: string;
    amount: number;
    vehicleInfo: string;
  }>;
}

export const EscrowManager = ({
  userAddress,
  escrowBalance,
  onDeposit,
  onWithdraw,
  minRequiredBalance = 0,
  pendingBids = []
}: EscrowManagerProps) => {
  const [amount, setAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const totalPendingAmount = pendingBids.reduce((sum, bid) => sum + bid.amount, 0);
  const availableBalance = escrowBalance - totalPendingAmount;

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    
    try {
      setIsProcessing(true);
      await onDeposit(parseFloat(amount));
      setAmount("");
      toast({
        title: "Deposit Successful",
        description: `Successfully deposited $${parseFloat(amount).toLocaleString()} to escrow`,
      });
    } catch (error) {
      toast({
        title: "Deposit Failed",
        description: "There was an error processing your deposit. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0 || parseFloat(amount) > availableBalance) return;
    
    try {
      setIsProcessing(true);
      await onWithdraw(parseFloat(amount));
      setAmount("");
      toast({
        title: "Withdrawal Successful",
        description: `Successfully withdrew $${parseFloat(amount).toLocaleString()} from escrow`,
      });
    } catch (error) {
      toast({
        title: "Withdrawal Failed",
        description: "There was an error processing your withdrawal. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!userAddress) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            Connect your wallet to manage escrow funds
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Escrow Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Balance Information */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Total Balance</span>
            <span className="font-medium">${escrowBalance.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Pending in Bids</span>
            <span className="font-medium">${totalPendingAmount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Available Balance</span>
            <span className="font-medium">${availableBalance.toLocaleString()}</span>
          </div>
          {minRequiredBalance > 0 && (
            <div className="flex justify-between items-center text-amber-600">
              <span>Minimum Required</span>
              <span>${minRequiredBalance.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Pending Bids */}
        {pendingBids.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium">Pending Bids</h4>
            <div className="space-y-1">
              {pendingBids.map((bid) => (
                <div key={bid.auctionId} className="text-sm flex justify-between">
                  <span className="text-muted-foreground truncate">{bid.vehicleInfo}</span>
                  <span>${bid.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deposit/Withdraw Controls */}
        <div className="space-y-2">
          <div className="flex space-x-2">
            <div className="relative flex-1">
              <DollarSign className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
              <Input
                type="number"
                placeholder="Enter amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-10"
                min="0"
                step="100"
                disabled={isProcessing}
              />
            </div>
          </div>
          
          <div className="flex space-x-2">
            <Button
              className="flex-1"
              onClick={handleDeposit}
              disabled={!amount || parseFloat(amount) <= 0 || isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-4 w-4 mr-2" />
              )}
              Deposit
            </Button>
            <Button
              className="flex-1"
              onClick={handleWithdraw}
              disabled={
                !amount || 
                parseFloat(amount) <= 0 || 
                parseFloat(amount) > availableBalance || 
                isProcessing
              }
              variant="outline"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowDownCircle className="h-4 w-4 mr-2" />
              )}
              Withdraw
            </Button>
          </div>
        </div>

        {/* Minimum Balance Warning */}
        {minRequiredBalance > escrowBalance && (
          <div className="text-sm text-red-600">
            ⚠️ Your current balance is below the minimum required for active auctions
          </div>
        )}
      </CardContent>
    </Card>
  );
};
