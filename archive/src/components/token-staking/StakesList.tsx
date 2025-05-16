
import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Coins, AlertCircle } from "lucide-react";
import { TokenStake } from "@/types/token";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion, AnimatePresence } from "framer-motion";
import StakeCard from "./stakes-list/StakeCard";
import ErrorDisplay from "./stakes-list/ErrorDisplay";
import EmptyState from "./stakes-list/EmptyState";
import LoadingState from "./stakes-list/LoadingState";
import { useStakesList } from "./stakes-list/useStakesList";

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
  const {
    processingStakes,
    unstakeError,
    successfulUnstake,
    setUnstakeError,
    handleUnstake,
    formatDate,
    getStakeStatus,
    getStatusColor
  } = useStakesList({ onUnstake });

  if (hasError) {
    return <ErrorDisplay onRetry={onRetry} />;
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

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
          <LoadingState />
        ) : userStakes.length > 0 ? (
          <motion.div 
            className="space-y-4"
            variants={container}
            initial="hidden"
            animate="show"
          >
            {userStakes.map(stake => (
              <StakeCard 
                key={stake.id}
                stake={stake}
                processingStakes={processingStakes}
                successfulUnstake={successfulUnstake}
                handleUnstake={handleUnstake}
                formatDate={formatDate}
                getStakeStatus={getStakeStatus}
                getStatusColor={getStatusColor}
              />
            ))}
          </motion.div>
        ) : (
          <EmptyState />
        )}
      </CardContent>
    </Card>
  );
};

export default StakesList;
