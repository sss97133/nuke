import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Token } from "@/types/token";

interface TokenListProps {
  tokens: Token[];
  isLoading: boolean;
  searchQuery: string;
  handleTokenClick: (token: Token) => void;
}

export const TokenList = ({ tokens, isLoading, searchQuery, handleTokenClick }: TokenListProps) => {
  const formatContractAddress = (address: string | null) => {
    if (!address) return "N/A";
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-4 bg-muted/50">
            <div className="animate-pulse flex justify-between">
              <div className="space-y-2">
                <div className="h-4 w-40 bg-muted rounded"></div>
                <div className="h-3 w-20 bg-muted rounded"></div>
              </div>
              <div className="h-4 w-32 bg-muted rounded"></div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <Card className="p-4">
        {searchQuery ? (
          <p className="text-muted-foreground">No tokens found matching "{searchQuery}"</p>
        ) : (
          <div className="text-sm text-muted-foreground">
            Click &quot;Create Token&quot; to get started
          </div>
        )}
      </Card>
    );
  }

  return (
    <>
      {tokens.map((token) => (
        <Card 
          key={token.id} 
          className="p-4 hover:bg-muted/10 transition-colors cursor-pointer"
          onClick={() => handleTokenClick(token)}
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center">
                <h2 className="text-xl font-semibold">{token.name}</h2>
                <span className="ml-2 text-sm text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                  {token.symbol}
                </span>
                {token.status && (
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${getStatusColor(token.status)}`}>
                    {token.status}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Contract: {formatContractAddress(token.contract_address)}
              </p>
              <p className="mt-2">
                <span className="font-medium">Total Supply:</span> {token.total_supply.toLocaleString()}
              </p>
              {token.created_at && (
                <p className="text-xs text-muted-foreground mt-1">
                  Created: {formatDate(token.created_at)}
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon">
              <Info className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ))}
    </>
  );
};
