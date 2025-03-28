import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useToast } from "@/components/ui/use-toast";

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: <T>(params: { method: string; params?: unknown[] }) => Promise<T>;
      on: (event: string, callback: (params: unknown[]) => void) => void;
      removeListener: (event: string, callback: (params: unknown[]) => void) => void;
      selectedAddress?: string;
      chainId?: string;
      isConnected?: () => boolean;
    };
  }
}

interface WalletState {
  address: string | null;
  balance: number;
  isConnected: boolean;
  network: string | null;
}

interface WalletContextType {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  state: WalletState;
  sendTransaction: (to: string, amount: number) => Promise<string>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    balance: 0,
    isConnected: false,
    network: null
  });
  const { toast } = useToast();

  const connect = async (): Promise<void> => {
    if (!window.ethereum) {
      toast({
        title: "Wallet Error",
        description: "Please install MetaMask to connect your wallet.",
        variant: "destructive",
      });
      return;
    }

    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      }) as string[];

      const chainId = await window.ethereum.request({
        method: 'eth_chainId'
      }) as string;

      setState({
        address: accounts[0],
        balance: 0,
        isConnected: true,
        network: `Chain ${parseInt(chainId, 16)}`
      });
      
      toast({
        title: "Wallet Connected",
        description: "Successfully connected to your wallet.",
      });
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Failed to connect wallet",
        variant: "destructive",
      });
    }
  };

  const disconnect = async (): Promise<void> => {
    setState({
      address: null,
      balance: 0,
      isConnected: false,
      network: null
    });
    toast({
      title: "Wallet Disconnected",
      description: "Your wallet has been disconnected.",
    });
  };

  const sendTransaction = async (to: string, amount: number): Promise<string> => {
    if (!window.ethereum || !state.address) {
      throw new Error('Wallet not connected');
    }

    const transaction = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: state.address,
        to,
        value: `0x${amount.toString(16)}`,
        gas: '0x5208', // 21000
      }]
    }) as string;

    return transaction;
  };

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;

    const handleAccountsChanged = (params: unknown[]) => {
      const accounts = params as string[];
      if (accounts.length === 0) {
        disconnect();
      } else {
        setState(prev => ({ ...prev, address: accounts[0], isConnected: true }));
      }
    };

    const handleChainChanged = (params: unknown[]) => {
      const chainId = params[0] as string;
      setState(prev => ({ ...prev, network: `Chain ${parseInt(chainId, 16)}` }));
    };

    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);

    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
      ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, []);

  return (
    <WalletContext.Provider value={{ connect, disconnect, state, sendTransaction }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
