
import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader, AlertCircle, RefreshCw, CheckCircle, Clock, TrendingUp, Coins } from "lucide-react";
import { TokenStake } from "@/types/token";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion, AnimatePresence } from "framer-motion";

interface StakesListProps {
  userStakes: TokenStake[];
  isLoadingStakes: boolean;
  hasError?: boolean; 
  onUnstake: (stakeId: string) => Promise<boolean>;
  onRetry?: () => void;
}

const StakesList = ({ 
  userStakes, 
  isLoadingStakes, 
  hasError = false,
  onUnstake, 
  onRetry 
}: StakesListProps) => {
  const [processingStakes, setProcessingStakes] = useState<Record<string, boolean>>({});
  const [unstakeError, setUnstakeError] = useState<string | null>(null);
  const [successfulUnstake, setSuccessfulUnstake] = useState<string | null>(null);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStakeStatus = (stake: TokenStake) => {
    const currentDate = new Date();
    const endDate = new Date(stake.end_date);
    
    if (stake.status === 'completed') return "Completed";
    if (currentDate > endDate) return "Ready to Claim";
    return "Active";
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case "Completed": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "Ready to Claim": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
      default: return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    }
  };

  const handleUnstake = async (stakeId: string) => {
    setUnstakeError(null);
    setSuccessfulUnstake(null);
    setProcessingStakes(prev => ({ ...prev, [stakeId]: true }));
    
    try {
      const success = await onUnstake(stakeId);
      if (success) {
        setSuccessfulUnstake(stakeId);
        setTimeout(() => setSuccessfulUnstake(null), 2000);
      } else {
        setUnstakeError("Failed to claim tokens. Please try again.");
      }
    } catch (error) {
      console.error("Error unstaking:", error);
      setUnstakeError(error instanceof Error ? error.message : "An unexpected error occurred while claiming tokens");
    } finally {
      setProcessingStakes(prev => ({ ...prev, [stakeId]: false }));
    }
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3 } }
  };

  if (hasError) {
    return (
      <Card className="border-2 border-red-200/20">
        <CardHeader>
          <CardTitle>My Staked Tokens</CardTitle>
          <CardDescription>View and manage your active stakes</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              There was an error loading your stakes
            </AlertDescription>
          </Alert>
          {onRetry && (
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button onClick={onRetry} variant="outline" className="mt-2 group">
                <RefreshCw className="h-4 w-4 mr-2 group-hover:rotate-180 transition-transform duration-500" /> 
                Retry
              </Button>
            </motion.div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 hover:border-primary/20 transition-all duration-300">
      <CardHeader>
        <CardTitle className="flex items-center">
          <Coins className="w-6 h-6 mr-2 text-primary" />
          My Staked Tokens
        </CardTitle>
        <CardDescription>
          View and manage your active stakes
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AnimatePresence>
          {unstakeError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{unstakeError}</AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>
        
        {isLoadingStakes ? (
          <div className="flex flex-col items-center justify-center p-8">
            <Loader className="h-8 w-8 animate-spin mb-4 text-primary" />
            <span className="text-muted-foreground">Loading your stakes...</span>
          </div>
        ) : userStakes.length > 0 ? (
          <motion.div 
            className="space-y-4"
            variants={container}
            initial="hidden"
            animate="show"
          >
            {userStakes.map(stake => (
              <motion.div key={stake.id} variants={item}>
                <Card 
                  className={`overflow-hidden border hover:shadow-md transition-all duration-300 ${
                    successfulUnstake === stake.id ? 'border-green-500 ring-2 ring-green-200' : 'hover:border-primary/30'
                  }`}
                >
                  <CardContent className="p-0">
                    <div className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold flex items-center">
                            {stake.token?.name ?? "Unknown Token"} 
                            {stake.token?.symbol ? ` (${stake.token.symbol})` : ""}
                          </h3>
                          <p className="text-sm text-muted-foreground flex items-center">
                            <Car className="h-3 w-3 mr-1 text-muted-foreground" />
                            {stake.vehicle ? 
                              `${stake.vehicle.year} ${stake.vehicle.make} ${stake.vehicle.model}` : 
                              (stake.vehicle_name ?? "Unknown Vehicle")}
                          </p>
                        </div>
                        <div className="text-right">
                          <motion.p 
                            className="font-medium"
                            initial={{ opacity: 1 }}
                            whileHover={{ scale: 1.05 }}
                          >
                            {stake.amount} tokens
                          </motion.p>
                          <p className="text-sm text-green-600 flex items-center justify-end">
                            <TrendingUp className="h-3 w-3 mr-1" />
                            + {stake.predicted_roi} (predicted)
                          </p>
                        </div>
                      </div>
                      
                      <div className="mt-4 grid grid-cols-2 gap-x-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Start Date</p>
                          <p>{formatDate(stake.start_date)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">End Date</p>
                          <p>{formatDate(stake.end_date)}</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between bg-muted/50 p-3">
                      <div className="flex items-center">
                        <span className="text-sm font-medium">Status: </span>
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded-full flex items-center ${
                          getStatusColor(getStakeStatus(stake))
                        }`}>
                          {getStakeStatus(stake) === "Completed" && <CheckCircle className="h-3 w-3 mr-1" />}
                          {getStakeStatus(stake) === "Ready to Claim" && <Clock className="h-3 w-3 mr-1" />}
                          {getStakeStatus(stake) === "Active" && <TrendingUp className="h-3 w-3 mr-1" />}
                          {getStakeStatus(stake)}
                        </span>
                      </div>
                      
                      {getStakeStatus(stake) === "Ready to Claim" && (
                        <motion.div whileTap={{ scale: 0.95 }}>
                          <Button 
                            size="sm" 
                            onClick={() => handleUnstake(stake.id)}
                            variant="outline"
                            disabled={processingStakes[stake.id]}
                            className="bg-gradient-to-r from-amber-500/80 to-amber-600/80 text-white hover:from-amber-500 hover:to-amber-600 border-none shadow-sm"
                          >
                            {processingStakes[stake.id] ? (
                              <>
                                <Loader className="h-3 w-3 animate-spin mr-1" />
                                Processing...
                              </>
                            ) : "Claim Tokens"}
                          </Button>
                        </motion.div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
};

export default StakesList;
