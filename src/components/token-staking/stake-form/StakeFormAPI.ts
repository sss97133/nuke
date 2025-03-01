
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const fetchTokenBalance = async (tokenId: string) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;

    const { data, error } = await supabase
      .from('token_holdings')
      .select('balance')
      .eq('user_id', user.id)
      .eq('token_id', tokenId)
      .maybeSingle();

    if (error) throw error;
    return data?.balance || 0;
  } catch (err) {
    console.error("Error fetching token balance:", err);
    return 0;
  }
};

export const createStake = async (
  selectedToken: string,
  selectedVehicle: string,
  stakeAmount: number,
  stakeDuration: number,
  vehicleName: string
) => {
  try {
    // Get the current authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error("You must be logged in to stake tokens");
    }
    
    // Check if the user has enough tokens to stake
    const { data: holdings, error: holdingsError } = await supabase
      .from('token_holdings')
      .select('balance')
      .eq('user_id', user.id)
      .eq('token_id', selectedToken)
      .maybeSingle();
    
    if (holdingsError) {
      if (holdingsError.message.includes('No rows found')) {
        throw new Error(`You don't have any of these tokens to stake`);
      } else {
        throw new Error("Failed to verify token balance");
      }
    }
    
    const balance = holdings?.balance || 0;
    
    if (Number(balance) < stakeAmount) {
      throw new Error(`Insufficient balance. You have ${balance} tokens available.`);
    }
    
    // Calculate end date based on stake duration
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + stakeDuration);
    
    // Try to use an RPC function first
    try {
      const { error } = await supabase.rpc('create_stake', { 
        user_id_param: user.id,
        token_id_param: selectedToken,
        vehicle_id_param: selectedVehicle,
        amount_param: stakeAmount.toString(),
        start_date_param: startDate.toISOString(),
        end_date_param: endDate.toISOString(),
        predicted_roi_param: parseFloat((stakeAmount * (0.05 + 0.02) / 365 * stakeDuration).toFixed(2)),
        vehicle_name_param: vehicleName
      });
      
      if (!error) {
        return true;
      }
    } catch (rpcError) {
      console.warn('RPC for creating stake not available:', rpcError);
      // Continue with fallback implementation
    }
    
    // Create the stake record (fallback)
    const stakeData = {
      user_id: user.id,
      token_id: selectedToken,
      vehicle_id: selectedVehicle,
      amount: stakeAmount.toString(),
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      status: 'active',
      predicted_roi: parseFloat((stakeAmount * (0.05 + 0.02) / 365 * stakeDuration).toFixed(2)),
      vehicle_name: vehicleName
    };
    
    // Direct insert
    const { error } = await supabase
      .from('token_stakes' as any)
      .insert([stakeData]);
          
    if (error) throw error;

    // Update the user's token holdings
    const { error: updateError } = await supabase
      .from('token_holdings')
      .update({ balance: Number(balance) - stakeAmount })
      .eq('user_id', user.id)
      .eq('token_id', selectedToken);

    if (updateError) throw updateError;

    return true;
  } catch (error: any) {
    console.error('Error staking tokens:', error);
    throw new Error(error instanceof Error ? error.message : "Failed to stake tokens");
  }
};
