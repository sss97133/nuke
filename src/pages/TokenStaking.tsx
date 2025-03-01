
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, Clock, TrendingUp, Coins } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const TokenStaking = () => {
  return (
    <div className="min-h-screen bg-background">
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="container max-w-7xl mx-auto p-6 space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Predictive Vehicle Token Staking</h1>
            <p className="text-muted-foreground">
              Stake tokens on vehicle performance and earn rewards based on predictive analytics.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Staked</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">50,000 VTK</div>
                <p className="text-xs text-muted-foreground">+20% from last month</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Stakes</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">12</div>
                <p className="text-xs text-muted-foreground">Across 8 vehicles</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Average ROI</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">8.3%</div>
                <p className="text-xs text-muted-foreground">Based on completed stakes</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Available Rewards</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">2,450 VTK</div>
                <p className="text-xs text-muted-foreground">Ready to claim</p>
              </CardContent>
            </Card>
          </div>
          
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
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
};

export default TokenStaking;
