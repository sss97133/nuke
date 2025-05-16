import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { useToast } from "@/components/ui/use-toast";

// This would typically come from your contract deployment
const ESCROW_CONTRACT_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS;

const ESCROW_ABI = [
  // Escrow balance
  "function getBalance(address user) view returns (uint256)",
  "function deposit() payable",
  "function withdraw(uint256 amount)",
  
  // Bid-related functions
  "function lockBidAmount(uint256 auctionId, uint256 amount)",
  "function releaseBidAmount(uint256 auctionId, uint256 amount)",
  "function getLockedAmount(address user, uint256 auctionId) view returns (uint256)",
  
  // Events
  "event Deposit(address indexed user, uint256 amount)",
  "event Withdrawal(address indexed user, uint256 amount)",
  "event BidLocked(address indexed user, uint256 indexed auctionId, uint256 amount)",
  "event BidReleased(address indexed user, uint256 indexed auctionId, uint256 amount)"
];

export interface PendingBid {
  auctionId: string;
  amount: number;
  vehicleInfo: string;
}

export const useEscrow = (userAddress?: string) => {
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingBids, setPendingBids] = useState<PendingBid[]>([]);
  const { toast } = useToast();

  // Initialize contract
  const getContract = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum || !userAddress) {
      return null;
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      if (!ESCROW_CONTRACT_ADDRESS) {
        throw new Error('Escrow contract address not configured');
      }
      return new ethers.Contract(ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, signer);
    } catch (error) {
      console.error('Error initializing contract:', error);
      return null;
    }
  }, [userAddress]);

  // Fetch balance
  const fetchBalance = useCallback(async () => {
    const contract = await getContract();
    if (!contract || !userAddress) return;

    try {
      const balanceWei = await contract.getBalance(userAddress);
      const balanceEth = parseFloat(ethers.formatEther(balanceWei));
      setBalance(balanceEth);
    } catch (error) {
      console.error('Error fetching balance:', error);
    }
  }, [userAddress, getContract]);

  // Deposit funds
  const deposit = useCallback(async (amount: number) => {
    const contract = await getContract();
    if (!contract) throw new Error('Contract not initialized');

    setIsLoading(true);
    try {
      const tx = await contract.deposit({
        value: ethers.parseEther(amount.toString())
      });
      await tx.wait();
      await fetchBalance();
      
      toast({
        title: "Deposit Successful",
        description: `Successfully deposited ${amount} ETH to escrow`,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to deposit funds');
      console.error('Error depositing:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [getContract, fetchBalance, toast]);

  // Withdraw funds
  const withdraw = useCallback(async (amount: number) => {
    const contract = await getContract();
    if (!contract) throw new Error('Contract not initialized');

    setIsLoading(true);
    try {
      const tx = await contract.withdraw(ethers.parseEther(amount.toString()));
      await tx.wait();
      await fetchBalance();
      
      toast({
        title: "Withdrawal Successful",
        description: `Successfully withdrew ${amount} ETH from escrow`,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to withdraw funds');
      console.error('Error withdrawing:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [getContract, fetchBalance, toast]);

  // Lock bid amount
  const lockBid = useCallback(async (auctionId: string, amount: number, vehicleInfo: string) => {
    const contract = await getContract();
    if (!contract) throw new Error('Contract not initialized');

    setIsLoading(true);
    try {
      const tx = await contract.lockBidAmount(
        auctionId,
        ethers.parseEther(amount.toString())
      );
      await tx.wait();
      
      // Update pending bids
      setPendingBids(prev => [...prev, { auctionId, amount, vehicleInfo }]);
      await fetchBalance();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to lock bid');
      console.error('Error locking bid:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [getContract, fetchBalance]);

  // Release bid amount
  const releaseBid = useCallback(async (auctionId: string, amount: number) => {
    const contract = await getContract();
    if (!contract) throw new Error('Contract not initialized');

    setIsLoading(true);
    try {
      const tx = await contract.releaseBidAmount(
        auctionId,
        ethers.parseEther(amount.toString())
      );
      await tx.wait();
      
      // Remove from pending bids
      setPendingBids(prev => prev.filter(bid => bid.auctionId !== auctionId));
      await fetchBalance();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to release bid');
      console.error('Error releasing bid:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [getContract, fetchBalance]);

  return {
    balance,
    isLoading,
    pendingBids,
    deposit,
    withdraw,
    lockBid,
    releaseBid,
    fetchBalance
  };
};
