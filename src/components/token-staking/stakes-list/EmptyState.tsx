
import React from 'react';
import { Button } from "@/components/ui/button";
import { Coins } from "lucide-react";
import { motion } from "framer-motion";

const EmptyState = () => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="text-center p-8 bg-muted/20 rounded-md border-2 border-dashed border-muted"
    >
      <p className="text-muted-foreground mb-2">You don't have any staked tokens yet</p>
      <Button 
        variant="default" 
        className="stake-button mt-2 bg-gradient-to-r from-primary to-primary/80 hover:opacity-90"
      >
        <Coins className="h-4 w-4 mr-2" />
        Create your first stake
      </Button>
    </motion.div>
  );
};

export default EmptyState;
