import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useToast } from "@/components/ui/use-toast";

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      selectedAddress?: string;
      chainId?: string;
      isConnected?: () => boolean;
      request: (request: { method: string; params?: any[] }) => Promise<any>;
      on: (eventName: string, callback: any) => void;
      removeListener: (eventName: string, callback: any) => void;
    };
  }
}

interface WalletContextType {
  address: string | null;
  chainId: number | null;
  balance: string | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: (chainId: number) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

interface WalletProviderProps {
  children: React.ReactNode;
  requiredChainId?: number;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ 
  children,
  requiredChainId = 1 // Default to Ethereum mainnet
}) => {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();

  // Update balance
  const updateBalance = useCallback(async () => {
    if (!address || !window.ethereum) return;

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const balance = await provider.getBalance(address);
      setBalance(ethers.formatEther(balance));
    } catch (error) {
      console.error('Error fetching balance:', error);
    }
  }, [address]);

  // Connect wallet
  const connect = async () => {
    if (!window.ethereum) {
      toast({
        title: "MetaMask Required",
        description: "Please install MetaMask to connect your wallet.",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      
      // Request account access
      const accounts = await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      
      setAddress(accounts[0]);
      setChainId(Number(network.chainId));
      
      // Check if we're on the required network
      if (requiredChainId && Number(network.chainId) !== requiredChainId) {
        await switchNetwork(requiredChainId);
      }
      
      await updateBalance();
      
      toast({
        title: "Wallet Connected",
        description: "Successfully connected to your wallet.",
      });
    } catch (error: any) {
      console.error('Error connecting wallet:', error);
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect wallet
  const disconnect = () => {
    setAddress(null);
    setChainId(null);
    setBalance(null);
    toast({
      title: "Wallet Disconnected",
      description: "Your wallet has been disconnected.",
    });
  };

  // Switch network
  const switchNetwork = async (targetChainId: number) => {
    if (!window.ethereum) return;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      });
    } catch (error: any) {
      if (error.code === 4902) {
        toast({
          title: "Network Not Found",
          description: "Please add this network to your wallet.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Network Switch Failed",
          description: error.message,
          variant: "destructive",
        });
      }
      throw error;
    }
  };

  // Listen for account changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    const ethereum = window.ethereum;
    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect();
      } else {
        setAddress(accounts[0]);
        updateBalance();
      }
    };

    const handleChainChanged = (chainId: string) => {
      setChainId(Number(chainId));
      updateBalance();
    };

    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);

    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
      ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [updateBalance, disconnect]);

  // Update balance periodically
  useEffect(() => {
    if (!address) return;

    const interval = setInterval(updateBalance, 15000); // Every 15 seconds
    return () => clearInterval(interval);
  }, [address, updateBalance]);

  const value = {
    address,
    chainId,
    balance,
    isConnecting,
    connect,
    disconnect,
    switchNetwork,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};
