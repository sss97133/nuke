
import React from "react";
import { Button } from "@/components/ui/button";
import { 
  RefreshCw, 
  Filter, 
  Plus, 
  Coins 
} from "lucide-react"; 
import { Link } from "react-router-dom";

interface TokenHeaderProps {
  onRefresh: () => void;
  onOpenFilter: () => void;
  onOpenCreate: () => void;
}

export const TokenHeader = ({ onRefresh, onOpenFilter, onOpenCreate }: TokenHeaderProps) => {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tokens</h1>
        <p className="text-muted-foreground">
          Manage tokens for vehicles and other assets
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button 
          variant="outline" 
          size="icon"
          onClick={onRefresh}
          title="Refresh Token List"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="icon"
          onClick={onOpenFilter}
          title="Filter Tokens"
        >
          <Filter className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline"
          asChild
          title="Stake Tokens"
        >
          <Link to="/token-staking">
            <Coins className="h-4 w-4 mr-2" />
            Stake
          </Link>
        </Button>
        <Button onClick={onOpenCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Token
        </Button>
      </div>
    </div>
  );
};
