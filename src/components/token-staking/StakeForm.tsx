import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Token, Vehicle } from "@/types/token";
import { calculatePredictedROI } from "./utils/stakingUtils";

interface StakeFormProps {
  tokens: Token[];
  vehicles: Vehicle[];
  isLoadingTokens: boolean;
  isLoadingVehicles: boolean;
  onStakeCreated: () => void;
}

const StakeForm = ({ 
  tokens, 
  vehicles, 
  isLoadingTokens, 
  isLoadingVehicles,
  onStakeCreated 
}: StakeFormProps) => {
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [stakeAmount, setStakeAmount] = useState<string>("");
  const [stakeDuration, setStakeDuration] = useState<string>("30");
  const [isStaking, setIsStaking] = useState(false);

  const handleStake = async () => {
    if (!selectedToken || !selectedVehicle || !stakeAmount || !stakeDuration) {
      toast("Please fill all required fields");
      return;
    }

    if (isNaN(Number(stakeAmount)) || Number(stakeAmount) <= 0) {
      toast("Please enter a valid stake amount");
      return;
    }

    setIsStaking(true);
    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast("You must be logged in to stake tokens");
        return;
      }
      
      // Check if the user has enough tokens to stake
      const { data: holdings, error: holdingsError } = await supabase
        .from('token_holdings')
        .select('balance')
        .eq('user_id', user.id)
        .eq('token_id', selectedToken)
        .single();
      
      if (holdingsError) {
        toast("Failed to verify token balance");
        return;
      }
      
      const balance = holdings?.balance || 0;
      const stakeValue = Number(stakeAmount);
      
      if (balance < stakeValue) {
        toast(`Insufficient balance. You have ${balance} tokens available.`);
        return;
      }
      
      // Calculate end date based on stake duration
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + Number(stakeDuration));
      
      // Create the stake using the rpc function or fallback to direct insert
      const vehicleInfo = vehicles.find(v => v.id === selectedVehicle);
      const vehicleName = vehicleInfo ? `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}` : "";
      
      try {
        // Find vehicle name from the selected vehicle
        
        const stakeData = {
          user_id: user.id,
          token_id: selectedToken,
          vehicle_id: selectedVehicle,
          amount: stakeValue,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          status: 'active',
          predicted_roi: Number(calculatePredictedROI(stakeValue, Number(stakeDuration))),
          vehicle_name: vehicleName
        };
        
        // Insert stake data directly since type checking for rpc is causing issues
        const { error } = await supabase
          .from('token_stakes')
          .insert([stakeData]) as { error: Error | null };
          
        if (error) throw error;
      } catch (error) {
        console.error('Error creating stake:', error);
        throw new Error('Failed to create stake record');
      }

      // Update the user's token holdings
      const { error: updateError } = await supabase
        .from('token_holdings')
        .update({ balance: balance - stakeValue })
        .eq('user_id', user.id)
        .eq('token_id', selectedToken);

      if (updateError) throw updateError;

      toast("Tokens staked successfully!");
      
      // Reset form fields
      setSelectedToken("");
      setSelectedVehicle("");
      setStakeAmount("");
      setStakeDuration("30");
      
      // Refresh user stakes
      onStakeCreated();
      
    } catch (error) {
      console.error('Error staking tokens:', error);
      toast("Failed to stake tokens");
    } finally {
      setIsStaking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a New Stake</CardTitle>
        <CardDescription>
          Stake your tokens on a vehicle to earn rewards based on performance predictions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Token</label>
          <Select value={selectedToken} onValueChange={setSelectedToken}>
            <SelectTrigger>
              <SelectValue placeholder="Select a token" />
            </SelectTrigger>
            <SelectContent>
              {isLoadingTokens ? (
                <div className="flex items-center justify-center p-4">
                  <Loader className="h-4 w-4 animate-spin mr-2" />
                  <span>Loading tokens...</span>
                </div>
              ) : tokens.length > 0 ? (
                tokens.map(token => (
                  <SelectItem key={token.id} value={token.id}>
                    {token.name} ({token.symbol})
                  </SelectItem>
                ))
              ) : (
                <div className="p-2 text-center text-sm text-muted-foreground">
                  No active tokens found
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Vehicle</label>
          <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
            <SelectTrigger>
              <SelectValue placeholder="Select a vehicle" />
            </SelectTrigger>
            <SelectContent>
              {isLoadingVehicles ? (
                <div className="flex items-center justify-center p-4">
                  <Loader className="h-4 w-4 animate-spin mr-2" />
                  <span>Loading vehicles...</span>
                </div>
              ) : vehicles.length > 0 ? (
                vehicles.map(vehicle => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </SelectItem>
                ))
              ) : (
                <div className="p-2 text-center text-sm text-muted-foreground">
                  No vehicles found
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">Stake Amount</label>
          <Input 
            type="number" 
            placeholder="Enter amount to stake"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            min="0"
          />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">Stake Duration (Days)</label>
          <Select value={stakeDuration} onValueChange={setStakeDuration}>
            <SelectTrigger>
              <SelectValue placeholder="Select duration" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 Days</SelectItem>
              <SelectItem value="60">60 Days</SelectItem>
              <SelectItem value="90">90 Days</SelectItem>
              <SelectItem value="180">180 Days</SelectItem>
              <SelectItem value="365">365 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {selectedToken && selectedVehicle && stakeAmount && (
          <Card className="bg-muted/50">
            <CardContent className="pt-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Predicted ROI:</span>
                <span className="font-semibold flex items-center">
                  <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                  {calculatePredictedROI(Number(stakeAmount), Number(stakeDuration))}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
      <CardFooter>
        <Button 
          onClick={handleStake} 
          disabled={isStaking || !selectedToken || !selectedVehicle || !stakeAmount || !stakeDuration}
          className="w-full"
        >
          {isStaking ? (
            <>
              <Loader className="h-4 w-4 animate-spin mr-2" />
              Staking...
            </>
          ) : "Stake Tokens"}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default StakeForm;
