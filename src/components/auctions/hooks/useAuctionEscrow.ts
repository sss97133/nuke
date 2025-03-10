import { useState, useEffect, useCallback } from 'react';
import { useEscrow } from './useEscrow';
import { ethers } from 'ethers';

export interface AuctionEscrowConfig {
  auctionId: string;
  currentPrice: number;
  minimumBidIncrement: number;
  escrowRequired: boolean;
  autoTransfer: boolean;
}

export const useAuctionEscrow = (config: AuctionEscrowConfig) => {
  const {
    balance: escrowBalance,
    isLoading,
    pendingBids,
    deposit,
    withdraw,
    lockBid,
    releaseBid,
    fetchBalance
  } = useEscrow();

  const [requiredAmount, setRequiredAmount] = useState<number>(0);
  const [canBid, setCanBid] = useState<boolean>(false);

  // Calculate required escrow amount (current price + increment)
  useEffect(() => {
    if (config.escrowRequired) {
      const required = config.currentPrice + config.minimumBidIncrement;
      setRequiredAmount(required);
      setCanBid(escrowBalance >= required);
    } else {
      setRequiredAmount(0);
      setCanBid(true);
    }
  }, [config.currentPrice, config.minimumBidIncrement, config.escrowRequired, escrowBalance]);

  // Place bid with escrow
  const placeBid = useCallback(async (amount: number, vehicleInfo?: string) => {
    if (!config.escrowRequired) {
      return true;
    }

    if (amount > escrowBalance) {
      throw new Error('Insufficient escrow balance');
    }

    try {
      await lockBid(config.auctionId, amount, vehicleInfo || `Auction ${config.auctionId}`);
      return true;
    } catch (error) {
      console.error('Error locking bid:', error);
      throw error;
    }
  }, [config.auctionId, config.escrowRequired, escrowBalance, lockBid]);

  // Release bid (for non-winners)
  const releaseBidAmount = useCallback(async () => {
    try {
      const pendingBid = getPendingBid();
      if (!pendingBid) throw new Error('No pending bid found');
      await releaseBid(config.auctionId, pendingBid.amount);
      return true;
    } catch (error) {
      console.error('Error releasing bid:', error);
      throw error;
    }
  }, [config.auctionId, releaseBid]);

  // Get pending bid for this auction
  const getPendingBid = useCallback(() => {
    return pendingBids.find(bid => bid.auctionId === config.auctionId);
  }, [config.auctionId, pendingBids]);

  return {
    escrowBalance,
    requiredAmount,
    canBid,
    isLoading,
    pendingBid: getPendingBid(),
    placeBid,
    releaseBidAmount,
    deposit,
    withdraw,
    refreshBalance: fetchBalance
  };
};
