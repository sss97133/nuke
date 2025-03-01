
import React, { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StakingHeader from "@/components/token-staking/StakingHeader";
import StakeForm from "@/components/token-staking/StakeForm";
import StakesList from "@/components/token-staking/StakesList";
import StakingPortfolioStats from "@/components/token-staking/StakingPortfolioStats";
import { useTokenStaking } from "@/components/token-staking/useTokenStaking";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, RefreshCw, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

const TokenStaking = () => {
  const {
    tokens,
    vehicles,
    isLoadingTokens,
    isLoadingVehicles,
    userStakes,
    isLoadingStakes,
    stakingStats,
    isLoadingStats,
    hasError,
    fetchUserStakes,
    handleUnstake,
    retry
  } = useTokenStaking();

  const [activeTab, setActiveTab] = useState<string>("stake");

  // Function to handle tab changes and enable stake button click in the empty state
  const handleTabChange = (value: string) => {
    setActiveTab(value);
  };

  // Handler for when a button is clicked in the empty state
  const handleEmptyStateButtonClick = () => {
    setActiveTab("stake");
  };

  // Ensure the empty state button works
  useEffect(() => {
    const stakeButton = document.querySelector('.stake-button');
    if (stakeButton) {
      stakeButton.addEventListener('click', handleEmptyStateButtonClick);
    }

    return () => {
      if (stakeButton) {
        stakeButton.removeEventListener('click', handleEmptyStateButtonClick);
      }
    };
  }, [userStakes]);

  const pageVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.3 } },
    exit: { opacity: 0, transition: { duration: 0.2 } }
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <motion.div
        initial="initial"
        animate="animate"
        exit="exit"
        variants={pageVariants}
        className="container mx-auto space-y-6"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center">
              <Coins className="w-6 h-6 mr-2 text-primary" />
              Token Staking
            </h1>
            <p className="text-sm text-muted-foreground">Stake your tokens on vehicles for predictive returns</p>
          </div>
        </div>
        
        <AnimatePresence>
          {hasError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex justify-between items-center">
                  <span>There was an error loading staking data</span>
                  <motion.div whileTap={{ scale: 0.97 }}>
                    <Button onClick={retry} variant="outline" size="sm" className="ml-2 group">
                      <RefreshCw className="h-4 w-4 mr-2 group-hover:rotate-180 transition-transform duration-500" /> 
                      Retry
                    </Button>
                  </motion.div>
                </AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>
        
        <Tabs 
          value={activeTab} 
          onValueChange={handleTabChange}
          className="animate-fade-in"
        >
          <TabsList className="grid w-full max-w-md grid-cols-2 p-1 rounded-lg bg-muted/80">
            <TabsTrigger 
              value="stake"
              className="rounded-md data-[state=active]:shadow-sm data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 transition-all duration-200"
            >
              Stake Tokens
            </TabsTrigger>
            <TabsTrigger 
              value="mystakes"
              className="rounded-md data-[state=active]:shadow-sm data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 transition-all duration-200"
            >
              My Stakes
            </TabsTrigger>
          </TabsList>
          
          <AnimatePresence mode="wait">
            <TabsContent 
              value="stake" 
              className="space-y-6 pt-4"
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <StakeForm
                  tokens={tokens}
                  vehicles={vehicles}
                  isLoadingTokens={isLoadingTokens}
                  isLoadingVehicles={isLoadingVehicles}
                  onStakeCreated={fetchUserStakes}
                />
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.3 }}
              >
                <StakingHeader />
              </motion.div>
            </TabsContent>
          
            <TabsContent 
              value="mystakes" 
              className="space-y-6 pt-4"
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <StakingPortfolioStats 
                  stats={stakingStats} 
                  isLoading={isLoadingStats}
                  hasError={hasError}
                  onRetry={retry}
                />
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.3 }}
              >
                <StakesList
                  userStakes={userStakes}
                  isLoadingStakes={isLoadingStakes}
                  hasError={hasError}
                  onUnstake={handleUnstake}
                  onRetry={retry}
                />
              </motion.div>
            </TabsContent>
          </AnimatePresence>
        </Tabs>
      </motion.div>
    </ScrollArea>
  );
};

export default TokenStaking;
