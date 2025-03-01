
import React, { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader, Info, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Token, Vehicle } from "@/types/token";

const TokenStaking = () => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [stakeAmount, setStakeAmount] = useState<string>("");
  const [stakeDuration, setStakeDuration] = useState<string>("30");
  const [isStaking, setIsStaking] = useState(false);
  const [userStakes, setUserStakes] = useState<any[]>([]);
  const [isLoadingStakes, setIsLoadingStakes] = useState(true);

  // Fetch tokens and vehicles on component mount
  useEffect(() => {
    fetchTokens();
    fetchVehicles();
    fetchUserStakes();
  }, []);

  const fetchTokens = async () => {
    setIsLoadingTokens(true);
    try {
      const { data, error } = await supabase
        .from('tokens')
        .select('*')
        .eq('status', 'active');

      if (error) throw error;
      setTokens(data || []);
    } catch (error) {
      console.error('Error fetching tokens:', error);
      toast("Failed to load tokens");
    } finally {
      setIsLoadingTokens(false);
    }
  };

  const fetchVehicles = async () => {
    setIsLoadingVehicles(true);
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*');

      if (error) throw error;
      setVehicles(data || []);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      toast("Failed to load vehicles");
    } finally {
      setIsLoadingVehicles(false);
    }
  };

  const fetchUserStakes = async () => {
    setIsLoadingStakes(true);
    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setUserStakes([]);
        return;
      }
      
      const { data, error } = await supabase
        .from('token_stakes')
        .select(`
          *,
          tokens:token_id(*),
          vehicles:vehicle_id(*)
        `)
        .eq('user_id', user.id);

      if (error) throw error;
      setUserStakes(data || []);
    } catch (error) {
      console.error('Error fetching user stakes:', error);
      toast("Failed to load your stakes");
    } finally {
      setIsLoadingStakes(false);
    }
  };

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
      
      // Create the stake
      const { data, error } = await supabase
        .from('token_stakes')
        .insert([
          {
            user_id: user.id,
            token_id: selectedToken,
            vehicle_id: selectedVehicle,
            amount: stakeValue,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            status: 'active',
            predicted_roi: calculatePredictedROI(stakeValue, Number(stakeDuration)),
          }
        ]);

      if (error) throw error;

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
      fetchUserStakes();
      
    } catch (error) {
      console.error('Error staking tokens:', error);
      toast("Failed to stake tokens");
    } finally {
      setIsStaking(false);
    }
  };

  const calculatePredictedROI = (amount: number, days: number) => {
    // Simple calculation - in a real app, this would be more sophisticated based on vehicle performance, market data, etc.
    const baseRate = 0.05; // 5% base annual rate
    const vehicleBonus = 0.02; // 2% bonus for vehicle-based stakes
    const annualRate = baseRate + vehicleBonus;
    const dailyRate = annualRate / 365;
    
    return (amount * dailyRate * days).toFixed(4);
  };

  const handleUnstake = async (stakeId: string) => {
    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast("You must be logged in to unstake tokens");
        return;
      }
      
      // Get the stake details
      const { data: stake, error: stakeError } = await supabase
        .from('token_stakes')
        .select('*')
        .eq('id', stakeId)
        .single();
      
      if (stakeError || !stake) {
        toast("Failed to find stake information");
        return;
      }
      
      // Check if the stake is finished
      const currentDate = new Date();
      const endDate = new Date(stake.end_date);
      
      if (currentDate < endDate) {
        toast("Cannot unstake before the staking period ends");
        return;
      }
      
      // Update stake status
      const { error: updateStakeError } = await supabase
        .from('token_stakes')
        .update({ status: 'completed' })
        .eq('id', stakeId);
      
      if (updateStakeError) throw updateStakeError;
      
      // Return tokens to user's holdings with rewards
      const finalAmount = Number(stake.amount) + Number(stake.predicted_roi);
      
      // Get current balance
      const { data: holdings, error: holdingsError } = await supabase
        .from('token_holdings')
        .select('balance')
        .eq('user_id', user.id)
        .eq('token_id', stake.token_id)
        .single();
      
      if (holdingsError) {
        toast("Failed to verify token balance");
        return;
      }
      
      const currentBalance = holdings?.balance || 0;
      
      // Update balance
      const { error: updateBalanceError } = await supabase
        .from('token_holdings')
        .update({ balance: currentBalance + finalAmount })
        .eq('user_id', user.id)
        .eq('token_id', stake.token_id);
      
      if (updateBalanceError) throw updateBalanceError;
      
      toast("Tokens unstaked successfully with rewards!");
      
      // Refresh user stakes
      fetchUserStakes();
      
    } catch (error) {
      console.error('Error unstaking tokens:', error);
      toast("Failed to unstake tokens");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStakeStatus = (stake: any) => {
    const currentDate = new Date();
    const endDate = new Date(stake.end_date);
    
    if (stake.status === 'completed') return "Completed";
    if (currentDate > endDate) return "Ready to Claim";
    return "Active";
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="container mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Token Staking</h1>
            <p className="text-sm text-muted-foreground">Stake your tokens on vehicles for predictive returns</p>
          </div>
        </div>
        
        <Tabs defaultValue="stake">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="stake">Stake Tokens</TabsTrigger>
            <TabsTrigger value="mystakes">My Stakes</TabsTrigger>
          </TabsList>
          
          <TabsContent value="stake" className="space-y-4 pt-4">
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
          </TabsContent>
          
          <TabsContent value="mystakes" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle>My Staked Tokens</CardTitle>
                <CardDescription>
                  View and manage your active stakes
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingStakes ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader className="h-4 w-4 animate-spin mr-2" />
                    <span>Loading your stakes...</span>
                  </div>
                ) : userStakes.length > 0 ? (
                  <div className="space-y-4">
                    {userStakes.map(stake => (
                      <Card key={stake.id} className="overflow-hidden">
                        <CardContent className="p-0">
                          <div className="p-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h3 className="font-semibold">
                                  {stake.tokens?.name} ({stake.tokens?.symbol})
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                  {stake.vehicles?.year} {stake.vehicles?.make} {stake.vehicles?.model}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-medium">{stake.amount} tokens</p>
                                <p className="text-sm text-muted-foreground">
                                  + {stake.predicted_roi} (predicted)
                                </p>
                              </div>
                            </div>
                            
                            <div className="mt-4 grid grid-cols-2 gap-x-4 text-sm">
                              <div>
                                <p className="text-muted-foreground">Start Date</p>
                                <p>{formatDate(stake.start_date)}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">End Date</p>
                                <p>{formatDate(stake.end_date)}</p>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between bg-muted/50 p-3">
                            <div className="flex items-center">
                              <span className="text-sm font-medium">Status: </span>
                              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                                stake.status === 'completed' 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-blue-100 text-blue-800'
                              }`}>
                                {getStakeStatus(stake)}
                              </span>
                            </div>
                            
                            {getStakeStatus(stake) === "Ready to Claim" && (
                              <Button 
                                size="sm" 
                                onClick={() => handleUnstake(stake.id)}
                                variant="outline"
                              >
                                Claim Tokens
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center p-6 bg-muted/20 rounded-md">
                    <p className="text-muted-foreground">You don't have any staked tokens yet</p>
                    <Button 
                      variant="link" 
                      onClick={() => document.querySelector('button[value="stake"]')?.click()}
                    >
                      Create your first stake
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default TokenStaking;
