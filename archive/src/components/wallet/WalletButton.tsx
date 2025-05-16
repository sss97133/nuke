import React from 'react';
import { Button } from "@/components/ui/button";
import { Loader2, Wallet, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from './WalletContext';

export const WalletButton = () => {
  const { address, balance, isConnecting, connect, disconnect } = useWallet();

  if (isConnecting) {
    return (
      <Button disabled variant="outline" className="w-[200px]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Connecting...
      </Button>
    );
  }

  if (!address) {
    return (
      <Button onClick={connect} variant="outline" className="w-[200px]">
        <Wallet className="mr-2 h-4 w-4" />
        Connect Wallet
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-[200px]">
          <Wallet className="mr-2 h-4 w-4" />
          <span className="truncate">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuItem className="text-muted-foreground">
          {balance ? `${Number(balance).toFixed(4)} ETH` : 'Loading...'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={disconnect} className="text-red-600">
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
