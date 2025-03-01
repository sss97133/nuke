
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { motion } from 'framer-motion';

const EmptyState = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-2 hover:border-primary/20 transition-all duration-300">
        <CardHeader>
          <CardTitle>Portfolio Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center p-6 bg-muted/20 rounded-md border border-dashed border-muted">
            <p className="text-muted-foreground">You don't have any staking activity yet.</p>
            <p className="text-sm text-muted-foreground mt-2">Stake tokens to see your portfolio statistics.</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default EmptyState;
