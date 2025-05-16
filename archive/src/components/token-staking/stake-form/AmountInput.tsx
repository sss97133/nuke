
import React from "react";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";

interface AmountInputProps {
  amount: string;
  onAmountChange: (value: string) => void;
  availableBalance: number | null;
  onSetMaxAmount: () => void;
}

const AmountInput = ({ 
  amount, 
  onAmountChange, 
  availableBalance, 
  onSetMaxAmount 
}: AmountInputProps) => {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <label className="text-sm font-medium">Stake Amount</label>
        {availableBalance !== null && availableBalance > 0 && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={onSetMaxAmount}
          >
            Max
          </motion.button>
        )}
      </div>
      <Input 
        type="number" 
        placeholder="Enter amount to stake"
        value={amount}
        onChange={(e) => onAmountChange(e.target.value)}
        min="0"
        className="transition-all duration-200 hover:border-primary"
      />
    </div>
  );
};

export default AmountInput;
