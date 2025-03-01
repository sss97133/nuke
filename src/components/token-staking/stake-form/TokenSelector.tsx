
import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader } from "lucide-react";
import { Token } from "@/types/token";
import { motion } from "framer-motion";

interface TokenSelectorProps {
  tokens: Token[];
  isLoading: boolean;
  selectedToken: string;
  availableBalance: number | null;
  onTokenChange: (value: string) => void;
}

const TokenSelector = ({ 
  tokens, 
  isLoading, 
  selectedToken, 
  availableBalance, 
  onTokenChange 
}: TokenSelectorProps) => {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Select Token</label>
      <Select value={selectedToken} onValueChange={onTokenChange}>
        <SelectTrigger className="transition-all duration-200 hover:border-primary">
          <SelectValue placeholder="Select a token" />
        </SelectTrigger>
        <SelectContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader className="h-4 w-4 animate-spin mr-2" />
              <span>Loading tokens...</span>
            </div>
          ) : tokens.length > 0 ? (
            tokens.map(token => (
              <SelectItem 
                key={token.id} 
                value={token.id}
                className="transition-colors hover:bg-primary/10"
              >
                {token.name} ({token.symbol})
              </SelectItem>
            ))
          ) : (
            <div className="p-2 text-center text-sm text-muted-foreground">
              No active tokens found
            </div>
          )}
        </SelectContent>
      </Select>
      {availableBalance !== null && (
        <motion.p 
          className="text-xs text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          Available: {availableBalance} tokens
        </motion.p>
      )}
    </div>
  );
};

export default TokenSelector;
