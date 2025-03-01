
import React, { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StakingHeader from "@/components/token-staking/StakingHeader";
import StakeForm from "@/components/token-staking/StakeForm";
import StakesList from "@/components/token-staking/StakesList";
import StakingPortfolioStats from "@/components/token-staking/StakingPortfolioStats";
import { useTokenStaking } from "@/components/token-staking/useTokenStaking";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  React.useEffect(() => {
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

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="container mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Token Staking</h1>
            <p className="text-sm text-muted-foreground">Stake your tokens on vehicles for predictive returns</p>
          </div>
        </div>
        
        {hasError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex justify-between items-center">
              <span>There was an error loading staking data</span>
              <Button onClick={retry} variant="outline" size="sm" className="ml-2">
                <RefreshCw className="h-4 w-4 mr-2" /> Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="stake">Stake Tokens</TabsTrigger>
            <TabsTrigger value="mystakes">My Stakes</TabsTrigger>
          </TabsList>
          
          <TabsContent value="stake" className="space-y-4 pt-4">
            <StakeForm
              tokens={tokens}
              vehicles={vehicles}
              isLoadingTokens={isLoadingTokens}
              isLoadingVehicles={isLoadingVehicles}
              onStakeCreated={fetchUserStakes}
            />
            
            <StakingHeader />
          </TabsContent>
          
          <TabsContent value="mystakes" className="space-y-4 pt-4">
            <StakingPortfolioStats 
              stats={stakingStats} 
              isLoading={isLoadingStats}
              hasError={hasError}
              onRetry={retry}
            />
            
            <StakesList
              userStakes={userStakes}
              isLoadingStakes={isLoadingStakes}
              hasError={hasError}
              onUnstake={handleUnstake}
              onRetry={retry}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default TokenStaking;
