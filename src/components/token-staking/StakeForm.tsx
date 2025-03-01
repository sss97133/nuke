
import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader, TrendingUp, AlertCircle } from "lucide-react";
import { Token, Vehicle } from "@/types/token";
import { calculatePredictedROI } from "./utils/stakingUtils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearError = () => {
    if (errorMessage) setErrorMessage(null);
  };

  const handleStake = async () => {
    clearError();
    
    if (!selectedToken || !selectedVehicle || !stakeAmount || !stakeDuration) {
      setErrorMessage("Please fill all required fields");
      return;
    }

    if (isNaN(Number(stakeAmount)) || Number(stakeAmount) <= 0) {
      setErrorMessage("Please enter a valid stake amount");
      return;
    }

    setIsStaking(true);
    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setErrorMessage("You must be logged in to stake tokens");
        return;
      }
      
      // Check if the user has enough tokens to stake
      const { data: holdings, error: holdingsError } = await supabase
        .from('token_holdings')
        .select('balance')
        .eq('user_id', user.id)
        .eq('token_id', selectedToken)
        .single() as { data: any, error: Error | null };
      
      if (holdingsError) {
        if (holdingsError.message.includes('no rows returned')) {
          setErrorMessage(`You don't have any of these tokens to stake`);
        } else {
          setErrorMessage("Failed to verify token balance");
        }
        return;
      }
      
      const balance = holdings?.balance || 0;
      const stakeValue = Number(stakeAmount);
      
      if (balance < stakeValue) {
        setErrorMessage(`Insufficient balance. You have ${balance} tokens available.`);
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
        
        // Try to use RPC function if available
        try {
          const { error: rpcError } = await supabase.rpc('create_token_stake', stakeData) as { error: Error | null };
          if (rpcError) throw rpcError;
        } catch (rpcError) {
          console.warn('RPC function not available, falling back to direct insert:', rpcError);
          
          // Fallback to direct insert
          const { error } = await supabase
            .from('token_stakes')
            .insert([stakeData]) as { error: Error | null };
              
          if (error) throw error;
        }
      } catch (error) {
        console.error('Error creating stake:', error);
        throw new Error('Failed to create stake record');
      }

      // Update the user's token holdings
      const { error: updateError } = await supabase
        .from('token_holdings')
        .update({ balance: balance - stakeValue })
        .eq('user_id', user.id)
        .eq('token_id', selectedToken) as { error: Error | null };

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
      setErrorMessage(error instanceof Error ? error.message : "Failed to stake tokens");
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
        {errorMessage && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Token</label>
          <Select value={selectedToken} onValueChange={(value) => { setSelectedToken(value); clearError(); }}>
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
          <Select value={selectedVehicle} onValueChange={(value) => { setSelectedVehicle(value); clearError(); }}>
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
            onChange={(e) => { setStakeAmount(e.target.value); clearError(); }}
            min="0"
          />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">Stake Duration (Days)</label>
          <Select value={stakeDuration} onValueChange={(value) => { setStakeDuration(value); clearError(); }}>
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
