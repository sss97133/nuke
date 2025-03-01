
import React, { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StakingHeader from "@/components/token-staking/StakingHeader";
import StakeForm from "@/components/token-staking/StakeForm";
import StakesList from "@/components/token-staking/StakesList";
import { useTokenStaking } from "@/components/token-staking/useTokenStaking";

const TokenStaking = () => {
  const {
    tokens,
    vehicles,
    isLoadingTokens,
    isLoadingVehicles,
    userStakes,
    isLoadingStakes,
    fetchUserStakes,
    handleUnstake
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
            <StakesList
              userStakes={userStakes}
              isLoadingStakes={isLoadingStakes}
              onUnstake={handleUnstake}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default TokenStaking;
