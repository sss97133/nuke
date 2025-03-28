import { Database } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';

export interface StakingToken {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  stakingEnabled: boolean;
}

export interface StakingPosition {
  id: string;
  tokenId: string;
  amount: string;
  startTime: number;
  endTime: number | null;
  rewards: string;
}

export interface StakingReward {
  id: string;
  tokenId: string;
  amount: string;
  timestamp: number;
}

export interface StakingStats {
  totalStaked: string;
  totalRewards: string;
  stakersCount: number;
}

export async function getStakingTokens(): Promise<StakingToken[]> {
  const { data, error } = await supabase
    .from('staking_tokens')
    .select('*') as { data: StakingToken[] | null; error: Error | null };
  
  if (error) throw error;
  return data || [];
}

export async function getStakingPositions(address: string): Promise<StakingPosition[]> {
  const { data, error } = await supabase
    .from('staking_positions')
    .select('*')
    .eq('address', address) as { data: StakingPosition[] | null; error: Error | null };
  
  if (error) throw error;
  return data || [];
}

export async function getStakingRewards(address: string): Promise<StakingReward[]> {
  const { data, error } = await supabase
    .from('staking_rewards')
    .select('*')
    .eq('address', address) as { data: StakingReward[] | null; error: Error | null };
  
  if (error) throw error;
  return data || [];
}

export async function getStakingStats(): Promise<StakingStats> {
  const { data, error } = await supabase
    .from('staking_stats')
    .select('*')
    .single() as { data: StakingStats | null; error: Error | null };
  
  if (error) throw error;
  return data || {
    totalStaked: '0',
    totalRewards: '0',
    stakersCount: 0
  };
}

export async function stakeTokens(tokenId: string, amount: string): Promise<void> {
  const { error } = await supabase
    .from('staking_positions')
    .insert({
      tokenId,
      amount,
      startTime: Math.floor(Date.now() / 1000),
      rewards: '0'
    }) as { error: Error | null };
  
  if (error) throw error;
}

export async function unstakeTokens(positionId: string): Promise<boolean> {
  try {
    // Get the stake details first
    const { data: stakeData, error: stakeError } = await supabase
      .from('staking_positions')
      .select('*')
      .eq('id', positionId)
      .maybeSingle() as { data: StakingPosition | null; error: Error | null };
    
    if (stakeError) throw new Error(`Failed to find stake: ${stakeError.message}`);
    if (!stakeData) throw new Error('Stake not found');
    
    // Check if the stake is already ended
    if (stakeData.endTime) {
      throw new Error('Stake has already been ended');
    }
    
    // Get the current authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    // Update the stake status
    const { error: updateError } = await supabase
      .from('staking_positions')
      .update({
        endTime: Math.floor(Date.now() / 1000)
      })
      .eq('id', positionId) as { error: Error | null };
    
    if (updateError) throw updateError;
    
    // Get the current user balance
    const { data: currentBalance, error: balanceError } = await supabase
      .from('user_balances')
      .select('balance')
      .eq('user_id', user.id)
      .eq('token_id', stakeData.tokenId)
      .maybeSingle() as { data: { balance: number } | null; error: Error | null };
      
    if (balanceError && !balanceError.message.includes('No rows found')) {
      throw balanceError;
    }
      
    const newBalance = (currentBalance?.balance || 0) + Number(stakeData.amount) + Number(stakeData.rewards);
    
    // Update the user's token balance
    const { error: holdingsError } = await supabase
      .from('user_balances')
      .upsert([
        {
          user_id: user.id,
          token_id: stakeData.tokenId,
          balance: newBalance
        }
      ]) as { error: Error | null };
    
    if (holdingsError) throw holdingsError;
    
    return true;
  } catch (error) {
    console.error('Error unstaking tokens:', error);
    throw error;
  }
}

export async function claimRewards(positionId: string): Promise<void> {
  const { error } = await supabase
    .from('staking_rewards')
    .insert({
      positionId,
      timestamp: Math.floor(Date.now() / 1000)
    }) as { error: Error | null };
  
  if (error) throw error;
}
