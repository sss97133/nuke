
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "lucide-react";

const StakingHeader = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How Vehicle Staking Works</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start space-x-3 rounded-md border p-3">
          <Info className="h-5 w-5 text-blue-500" />
          <div className="text-sm">
            <p className="font-medium">Vehicle-based Predictive Staking</p>
            <p className="text-muted-foreground">
              Stake your tokens on vehicles to earn rewards based on predicted performance.
              The system uses market data, vehicle condition, and historical trends to predict returns.
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <h3 className="font-medium mb-2">Select a Vehicle</h3>
              <p className="text-sm text-muted-foreground">Choose a vehicle that you believe will perform well in the market</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <h3 className="font-medium mb-2">Stake Tokens</h3>
              <p className="text-sm text-muted-foreground">Lock your tokens for a specific duration to earn predictive returns</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <h3 className="font-medium mb-2">Collect Rewards</h3>
              <p className="text-sm text-muted-foreground">Earn rewards based on the vehicle's market performance over time</p>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
};

export default StakingHeader;
