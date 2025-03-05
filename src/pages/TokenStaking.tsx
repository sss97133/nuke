
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, Clock, TrendingUp, Coins } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import StakeForm from "@/components/token-staking/StakeForm";
import StakesList from "@/components/token-staking/StakesList";
import StakingHeader from "@/components/token-staking/StakingHeader";
import StakingPortfolioStats from "@/components/token-staking/StakingPortfolioStats";
import { useTokenStaking } from '@/components/token-staking/useTokenStaking';

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
    handleUnstake,
    fetchUserStakes,
    retry
  } = useTokenStaking();

  // State for documentation dialog
  const [isDocOpen, setIsDocOpen] = useState(false);

  // Function to handle when a new stake is created
  const handleStakeCreated = () => {
    fetchUserStakes();
  };

  return (
    <div className="min-h-screen bg-background">
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="container max-w-7xl mx-auto p-6 space-y-6">
          <StakingHeader />
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Staked</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stakingStats ? `${stakingStats.total_staked.toFixed(0)} VTK` : "0 VTK"}
                </div>
                <p className="text-xs text-muted-foreground">+20% from last month</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Stakes</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stakingStats?.active_stakes || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  Across {stakingStats?.vehicle_count || 0} vehicles
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Average ROI</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stakingStats ? `${stakingStats.avg_roi_percent.toFixed(1)}%` : "0%"}
                </div>
                <p className="text-xs text-muted-foreground">Based on completed stakes</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Available Rewards</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stakingStats ? `${stakingStats.total_predicted_roi.toFixed(0)} VTK` : "0 VTK"}
                </div>
                <p className="text-xs text-muted-foreground">Ready to claim</p>
              </CardContent>
            </Card>
          </div>
          
          <div className="grid gap-6 md:grid-cols-12">
            {/* Staking Form Section */}
            <div className="md:col-span-5">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Create New Stake</CardTitle>
                  <CardDescription>
                    Stake your tokens on vehicle performance
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <StakeForm 
                    tokens={tokens}
                    vehicles={vehicles}
                    isLoadingTokens={isLoadingTokens}
                    isLoadingVehicles={isLoadingVehicles}
                    onStakeCreated={handleStakeCreated}
                  />
                </CardContent>
              </Card>
            </div>
            
            {/* Active Stakes Section */}
            <div className="md:col-span-7">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Your Active Stakes</CardTitle>
                  <CardDescription>
                    Manage your current vehicle token stakes
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <StakesList 
                    userStakes={userStakes}
                    isLoadingStakes={isLoadingStakes}
                    hasError={hasError}
                    onUnstake={handleUnstake}
                    onRetry={retry}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
          
          {/* Portfolio Stats */}
          <Card>
            <CardHeader>
              <CardTitle>Staking Portfolio</CardTitle>
              <CardDescription>
                Performance metrics for your vehicle token stakes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StakingPortfolioStats 
                stats={stakingStats}
                isLoading={isLoadingStats}
                hasError={hasError}
                onRetry={retry}
              />
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>About Vehicle Predictive Staking</CardTitle>
              <CardDescription>
                Learn how vehicle token staking works and its benefits
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>
                Vehicle Predictive Staking is an innovative way to create a financial ecosystem around 
                vehicles, allowing stakeholders to participate in the tokenized vehicle economy while 
                aligning incentives toward proper vehicle maintenance and market performance.
              </p>
              <p>
                By staking tokens on vehicle performance, you can earn returns based on how well the 
                vehicle maintains its value, its maintenance history, and market demand. The system 
                uses predictive analytics to estimate potential returns.
              </p>
              <p>
                Our algorithmic framework employs machine learning to analyze historical data and 
                predict future performance, evaluating risk factors and market correlations to 
                determine appropriate reward levels.
              </p>
              <div className="mt-6">
                <Button 
                  variant="outline"
                  onClick={() => setIsDocOpen(true)}
                >
                  Read Full Documentation
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      {/* Documentation Dialog */}
      <Dialog open={isDocOpen} onOpenChange={setIsDocOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vehicle Predictive Staking Documentation</DialogTitle>
            <DialogDescription>
              Complete guide to the vehicle token staking system
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <h3 className="text-lg font-semibold">Introduction to Vehicle Token Staking</h3>
            <p>
              Vehicle Predictive Staking represents a revolutionary approach to creating a financial ecosystem
              centered around vehicle assets. This system enables vehicle owners, enthusiasts, and investors
              to participate in a tokenized economy that directly reflects and influences real-world vehicle
              value and performance.
            </p>
            
            <h3 className="text-lg font-semibold">How It Works</h3>
            <p>
              The system operates on a blockchain-based token economy where VTK (Vehicle Tokens) can be staked
              on specific vehicles. When you stake tokens on a vehicle, you're essentially betting on its
              future performance based on various metrics:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Value retention compared to market averages</li>
              <li>Maintenance history and adherence to scheduled service</li>
              <li>Usage patterns and mileage accumulation</li>
              <li>Market demand for the specific make and model</li>
              <li>Historical performance data of similar vehicles</li>
            </ul>
            
            <h3 className="text-lg font-semibold">Reward Mechanism</h3>
            <p>
              Stakes generate rewards through a combination of:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Base Interest:</strong> A minimum guaranteed return for all stakes</li>
              <li><strong>Performance Bonus:</strong> Additional rewards when vehicles outperform their predicted metrics</li>
              <li><strong>Loyalty Multipliers:</strong> Increased returns for longer staking periods</li>
              <li><strong>Rarity Factors:</strong> Enhanced rewards for unique or collectible vehicles</li>
            </ul>
            
            <h3 className="text-lg font-semibold">Technical Implementation</h3>
            <p>
              The predictive analytics engine uses a sophisticated machine learning model trained on millions
              of vehicle data points. This model evaluates:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Time-series analysis of value fluctuations</li>
              <li>Seasonal market patterns</li>
              <li>Maintenance event correlations</li>
              <li>Market sentiment analysis from automotive forums and sales platforms</li>
              <li>Economic indicators affecting vehicle markets</li>
            </ul>
            
            <h3 className="text-lg font-semibold">Risk Factors</h3>
            <p>
              While our predictive models are highly accurate, all staking involves inherent risks:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Market volatility can affect vehicle valuations</li>
              <li>Unexpected vehicle issues may impact performance metrics</li>
              <li>Regulatory changes in the automotive or cryptocurrency sectors</li>
              <li>Token price fluctuations independent of vehicle performance</li>
            </ul>
            
            <h3 className="text-lg font-semibold">Getting Started</h3>
            <p>
              To begin staking tokens on vehicles:
            </p>
            <ol className="list-decimal pl-6 space-y-2">
              <li>Acquire VTK tokens through the token marketplace</li>
              <li>Select a vehicle from your garage or the public vehicle registry</li>
              <li>Choose your staking amount and duration</li>
              <li>Review the predicted ROI and confirm your stake</li>
              <li>Monitor performance through your staking dashboard</li>
            </ol>
          </div>
          
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Close Documentation</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TokenStaking;
