
import React from "react";
import { Button } from "@/components/ui/button";
import { Check, Loader } from "lucide-react";
import { motion } from "framer-motion";

interface StakeButtonProps {
  onStake: () => void;
  isStaking: boolean;
  isSuccess: boolean;
  isDisabled: boolean;
}

const StakeButton = ({ 
  onStake, 
  isStaking, 
  isSuccess, 
  isDisabled 
}: StakeButtonProps) => {
  const calculateButtonStyle = {
    scale: [1, 0.95, 1],
    transition: { duration: 0.2 }
  };

  return (
    <motion.div className="w-full" whileTap={!isStaking ? calculateButtonStyle : {}}>
      <Button 
        onClick={onStake} 
        disabled={isDisabled || isStaking}
        className="w-full bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 transition-all duration-300"
      >
        {isStaking ? (
          <>
            <Loader className="h-4 w-4 animate-spin mr-2" />
            Staking...
          </>
        ) : isSuccess ? (
          <>
            <Check className="h-4 w-4 mr-2" />
            Staked Successfully!
          </>
        ) : "Stake Tokens"}
      </Button>
    </motion.div>
  );
};

export default StakeButton;
