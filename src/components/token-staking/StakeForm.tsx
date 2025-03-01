
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader, TrendingUp, AlertCircle, Check, Coins, Car } from "lucide-react";
import { Token, Vehicle } from "@/types/token";
import { calculatePredictedROI } from "./utils/stakingUtils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";

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
  const [successAnimation, setSuccessAnimation] = useState(false);
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);

  const clearError = () => {
    if (errorMessage) setErrorMessage(null);
  };

  // Fetch token balance when a token is selected
  useEffect(() => {
    if (selectedToken) {
      fetchTokenBalance(selectedToken);
    } else {
      setAvailableBalance(null);
    }
  }, [selectedToken]);

  const fetchTokenBalance = async (tokenId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('token_holdings')
        .select('balance')
        .eq('user_id', user.id)
        .eq('token_id', tokenId)
        .single() as { data: any, error: Error | null };

      if (!error && data) {
        setAvailableBalance(data.balance);
      } else {
        setAvailableBalance(0);
      }
    } catch (err) {
      console.error("Error fetching token balance:", err);
      setAvailableBalance(0);
    }
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
        
        // Direct insert since we determined the RPC method may not be available
        const { error } = await supabase
          .from('token_stakes')
          .insert([stakeData as any]) as { error: Error | null };
              
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
        .eq('token_id', selectedToken) as { error: Error | null };

      if (updateError) throw updateError;

      // Show success animation before resetting the form
      setSuccessAnimation(true);
      toast("Tokens staked successfully!");
      
      // Reset form fields after a small delay for animation
      setTimeout(() => {
        setSelectedToken("");
        setSelectedVehicle("");
        setStakeAmount("");
        setStakeDuration("30");
        setSuccessAnimation(false);
        
        // Refresh user stakes
        onStakeCreated();
      }, 1000);
      
    } catch (error) {
      console.error('Error staking tokens:', error);
      setErrorMessage(error instanceof Error ? error.message : "Failed to stake tokens");
    } finally {
      setIsStaking(false);
    }
  };

  // Max button handler
  const handleSetMaxAmount = () => {
    if (availableBalance !== null) {
      setStakeAmount(availableBalance.toString());
    }
  };

  const cardVariants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
    success: { 
      scale: [1, 1.03, 1],
      boxShadow: [
        "0 0 0 rgba(74, 222, 128, 0)",
        "0 0 20px rgba(74, 222, 128, 0.5)",
        "0 0 0 rgba(74, 222, 128, 0)"
      ],
      transition: { duration: 1 }
    }
  };

  const calculateButtonStyle = {
    scale: [1, 0.95, 1],
    transition: { duration: 0.2 }
  };

  return (
    <motion.div
      initial="initial"
      animate={successAnimation ? "success" : "animate"}
      variants={cardVariants}
    >
      <Card className="border-2 hover:border-primary/20 transition-all duration-300">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl flex items-center">
            <Coins className="w-6 h-6 mr-2 text-primary" />
            Create a New Stake
          </CardTitle>
          <CardDescription>
            Stake your tokens on a vehicle to earn rewards based on performance predictions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            </motion.div>
          )}
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Token</label>
            <Select value={selectedToken} onValueChange={(value) => { setSelectedToken(value); clearError(); }}>
              <SelectTrigger className="transition-all duration-200 hover:border-primary">
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
                    <SelectItem 
                      key={token.id} 
                      value={token.id}
                      className="transition-colors hover:bg-primary/10"
                    >
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
            {availableBalance !== null && (
              <motion.p 
                className="text-xs text-muted-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                Available: {availableBalance} tokens
              </motion.p>
            )}
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Vehicle</label>
            <Select value={selectedVehicle} onValueChange={(value) => { setSelectedVehicle(value); clearError(); }}>
              <SelectTrigger className="transition-all duration-200 hover:border-primary">
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
                    <SelectItem 
                      key={vehicle.id} 
                      value={vehicle.id}
                      className="transition-colors hover:bg-primary/10"
                    >
                      <div className="flex items-center">
                        <Car className="h-3 w-3 mr-2 text-muted-foreground" />
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
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
            <div className="flex justify-between">
              <label className="text-sm font-medium">Stake Amount</label>
              {availableBalance !== null && availableBalance > 0 && (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={handleSetMaxAmount}
                >
                  Max
                </motion.button>
              )}
            </div>
            <Input 
              type="number" 
              placeholder="Enter amount to stake"
              value={stakeAmount}
              onChange={(e) => { setStakeAmount(e.target.value); clearError(); }}
              min="0"
              className="transition-all duration-200 hover:border-primary"
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Stake Duration (Days)</label>
            <Select value={stakeDuration} onValueChange={(value) => { setStakeDuration(value); clearError(); }}>
              <SelectTrigger className="transition-all duration-200 hover:border-primary">
                <SelectValue placeholder="Select duration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30" className="transition-colors hover:bg-primary/10">30 Days</SelectItem>
                <SelectItem value="60" className="transition-colors hover:bg-primary/10">60 Days</SelectItem>
                <SelectItem value="90" className="transition-colors hover:bg-primary/10">90 Days</SelectItem>
                <SelectItem value="180" className="transition-colors hover:bg-primary/10">180 Days</SelectItem>
                <SelectItem value="365" className="transition-colors hover:bg-primary/10">365 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {selectedToken && selectedVehicle && stakeAmount && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="bg-muted/50 border-primary/10 hover:border-primary/30 transition-all duration-300">
                <CardContent className="pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Predicted ROI:</span>
                    <motion.span 
                      className="font-semibold flex items-center text-green-600"
                      initial={{ scale: 1 }}
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 0.5, repeat: 0 }}
                    >
                      <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                      {calculatePredictedROI(Number(stakeAmount), Number(stakeDuration))}
                    </motion.span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </CardContent>
        <CardFooter>
          <motion.div className="w-full" whileTap={!isStaking ? calculateButtonStyle : {}}>
            <Button 
              onClick={handleStake} 
              disabled={isStaking || !selectedToken || !selectedVehicle || !stakeAmount || !stakeDuration}
              className="w-full bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 transition-all duration-300"
            >
              {isStaking ? (
                <>
                  <Loader className="h-4 w-4 animate-spin mr-2" />
                  Staking...
                </>
              ) : successAnimation ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Staked Successfully!
                </>
              ) : "Stake Tokens"}
            </Button>
          </motion.div>
        </CardFooter>
      </Card>
    </motion.div>
  );
};

export default StakeForm;
