
import React from 'react';
import { Button } from "@/components/ui/button";
import { Coins, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const EmptyState = () => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="text-center p-8 bg-muted/20 rounded-md border-2 border-dashed border-muted"
    >
      <p className="text-muted-foreground mb-2">You don't have any staked tokens yet</p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center mt-4">
        <Button 
          variant="default" 
          className="stake-button bg-gradient-to-r from-primary to-primary/80 hover:opacity-90"
        >
          <Coins className="h-4 w-4 mr-2" />
          Create your first stake
        </Button>
        <Button 
          variant="outline"
          asChild
        >
          <Link to="/tokens">
            <Plus className="h-4 w-4 mr-2" />
            Create New Tokens
          </Link>
        </Button>
      </div>
    </motion.div>
  );
};

export default EmptyState;
