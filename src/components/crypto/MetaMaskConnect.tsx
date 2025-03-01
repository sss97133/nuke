
import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Wallet, AlertCircle, ExternalLink } from "lucide-react";

// Define types for our component state
interface MetaMaskState {
  isInstalled: boolean;
  isConnected: boolean;
  accounts: string[];
  chainId: string | null;
  balance: string | null;
  error: string | null;
}

export const MetaMaskConnect: React.FC = () => {
  const { toast } = useToast();
  const [state, setState] = useState<MetaMaskState>({
    isInstalled: false,
    isConnected: false,
    accounts: [],
    chainId: null,
    balance: null,
    error: null,
  });

  // Check if MetaMask is installed when component mounts
  useEffect(() => {
    checkMetaMaskInstalled();
    
    // Setup event listeners for MetaMask
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
      window.ethereum.on('disconnect', handleDisconnect);
    }

    return () => {
      // Clean up event listeners
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
        window.ethereum.removeListener('disconnect', handleDisconnect);
      }
    };
  }, []);

  // Check if user has MetaMask installed
  const checkMetaMaskInstalled = () => {
    setState(prev => ({
      ...prev,
      isInstalled: typeof window.ethereum !== 'undefined'
    }));
  };

  // Handle account changes
  const handleAccountsChanged = (accounts: string[]) => {
    if (accounts.length === 0) {
      // User disconnected their account
      setState(prev => ({
        ...prev,
        isConnected: false,
        accounts: [],
        balance: null
      }));
      toast({
        title: "Disconnected",
        description: "Your wallet has been disconnected",
      });
    } else {
      // User switched accounts
      setState(prev => ({
        ...prev,
        accounts,
        isConnected: true
      }));
      fetchBalance(accounts[0]);
      toast({
        title: "Account Changed",
        description: `Connected to account ${shortenAddress(accounts[0])}`,
      });
    }
  };

  // Handle chain changes
  const handleChainChanged = (chainId: string) => {
    // Need to reload the page as recommended by MetaMask
    window.location.reload();
  };

  // Handle disconnect events
  const handleDisconnect = () => {
    setState(prev => ({
      ...prev,
      isConnected: false,
      accounts: [],
      balance: null
    }));
  };

  // Connect to MetaMask
  const connectToMetaMask = async () => {
    if (!window.ethereum) {
      setState(prev => ({
        ...prev,
        error: "MetaMask is not installed"
      }));
      return;
    }

    try {
      setState(prev => ({ ...prev, error: null }));
      
      // Request account access
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      
      setState(prev => ({
        ...prev,
        isConnected: true,
        accounts,
        chainId: network.chainId.toString()
      }));
      
      // Get the balance for the connected account
      fetchBalance(accounts[0]);
      
      toast({
        title: "Connected",
        description: `Successfully connected to ${shortenAddress(accounts[0])}`,
      });
    } catch (error) {
      console.error("Error connecting to MetaMask:", error);
      let errorMessage = "Failed to connect to MetaMask";
      
      // Handle specific error messages
      if (error instanceof Error) {
        if (error.message.includes("user rejected")) {
          errorMessage = "Connection rejected by user";
        }
      }
      
      setState(prev => ({
        ...prev,
        error: errorMessage
      }));
      
      toast({
        variant: "destructive",
        title: "Connection Failed",
        description: errorMessage,
      });
    }
  };

  // Fetch the balance for an account
  const fetchBalance = async (account: string) => {
    if (!window.ethereum || !account) return;
    
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const balance = await provider.getBalance(account);
      const formattedBalance = ethers.formatEther(balance);
      
      setState(prev => ({
        ...prev,
        balance: formattedBalance
      }));
    } catch (error) {
      console.error("Error fetching balance:", error);
    }
  };

  // Helper to shorten ethereum addresses for display
  const shortenAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          MetaMask Connection
        </CardTitle>
        <CardDescription>
          Connect your MetaMask wallet to interact with blockchain features
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {!state.isInstalled && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>MetaMask Not Detected</AlertTitle>
            <AlertDescription>
              Please install the MetaMask browser extension to continue.
              <a 
                href="https://metamask.io/download/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-500 hover:underline mt-2"
              >
                Download MetaMask <ExternalLink className="h-3 w-3" />
              </a>
            </AlertDescription>
          </Alert>
        )}

        {state.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        {state.isConnected && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="text-sm text-muted-foreground">Connected Account:</div>
              <div className="text-sm font-medium">
                {state.accounts[0] ? shortenAddress(state.accounts[0]) : "None"}
              </div>
              
              <div className="text-sm text-muted-foreground">Balance:</div>
              <div className="text-sm font-medium">
                {state.balance ? `${parseFloat(state.balance).toFixed(4)} ETH` : "Loading..."}
              </div>
              
              <div className="text-sm text-muted-foreground">Network:</div>
              <div className="text-sm font-medium">
                {state.chainId ? `Chain ID: ${state.chainId}` : "Unknown"}
              </div>
            </div>
          </div>
        )}
      </CardContent>
      
      <CardFooter>
        <Button
          onClick={connectToMetaMask}
          disabled={!state.isInstalled || state.isConnected}
          className="w-full"
        >
          {state.isConnected ? "Connected" : "Connect Wallet"}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default MetaMaskConnect;
