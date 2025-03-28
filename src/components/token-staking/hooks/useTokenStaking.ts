import { useState, useEffect } from 'react';
import { Token, Vehicle, TokenStake, TokenStakeStats } from '@/types/token';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/types/database';

type TokenRow = Database['public']['Tables']['tokens']['Row'];
type VehicleRow = Database['public']['Tables']['vehicles']['Row'];
type StakeRow = Database['public']['Tables']['stakes']['Row'];
type StakingStatsRow = Database['public']['Tables']['staking_stats']['Row'];

interface UseTokenStakingReturn {
  tokens: Token[];
  vehicles: Vehicle[];
  stakes: TokenStake[];
  stakingStats: TokenStakeStats;
  isLoading: boolean;
  error: Error | null;
  handleUnstake: (stakeId: string) => Promise<boolean>;
  refreshData: () => Promise<void>;
}

export function useTokenStaking(): UseTokenStakingReturn {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [stakes, setStakes] = useState<TokenStake[]>([]);
  const [stakingStats, setStakingStats] = useState<TokenStakeStats>({
    total_staked: 0,
    total_predicted_roi: 0,
    active_stakes: 0,
    completed_stakes: 0,
    avg_roi_percent: 0,
    vehicle_count: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshData = async () => {
    try {
      setIsLoading(true);
      const [tokensResult, vehiclesResult, stakesResult, statsResult] = await Promise.all([
        supabase.from('tokens').select('*'),
        supabase.from('vehicles').select('*'),
        supabase.from('stakes').select('*, vehicle:vehicles(*)'),
        supabase.from('staking_stats').select('*').single()
      ]);

      if (tokensResult.error) throw tokensResult.error;
      if (vehiclesResult.error) throw vehiclesResult.error;
      if (stakesResult.error) throw stakesResult.error;
      if (statsResult.error) throw statsResult.error;

      // Convert database rows to component types
      const convertedTokens: Token[] = (tokensResult.data || []).map((row: TokenRow) => ({
        id: row.id,
        name: row.name,
        symbol: row.symbol,
        total_supply: row.total_supply,
        metadata: row.metadata,
        contract_address: row.contract_address,
        created_at: row.created_at,
        decimals: row.decimals,
        description: row.description,
        owner_id: row.owner_id,
        status: row.status,
        updated_at: row.updated_at,
        vehicle_id: row.vehicle_id,
        current_price: row.current_price,
        image_url: row.image_url
      }));

      const convertedVehicles: Vehicle[] = (vehiclesResult.data || []).map((row: VehicleRow) => ({
        id: row.id,
        make: row.make,
        model: row.model,
        year: row.year,
        vin: row.vin,
        description: row.notes,
        image_url: undefined,
        tags: [],
        price: row.current_value,
        rarity_score: undefined,
        status: row.status,
        user_id: row.user_id
      }));

      const convertedStakes: TokenStake[] = (stakesResult.data || []).map((row: StakeRow & { vehicle: VehicleRow }) => ({
        id: row.id,
        user_id: row.user_id,
        token_id: row.token_id,
        vehicle_id: row.vehicle_id,
        amount: row.amount,
        start_date: row.start_date,
        end_date: row.end_date,
        status: row.status,
        predicted_roi: row.predicted_roi,
        actual_roi: row.actual_roi,
        created_at: row.created_at,
        vehicle_name: row.vehicle_name,
        vehicle: row.vehicle ? {
          id: row.vehicle.id,
          make: row.vehicle.make,
          model: row.vehicle.model,
          year: row.vehicle.year,
          vin: row.vehicle.vin,
          description: row.vehicle.notes,
          image_url: undefined,
          tags: [],
          price: row.vehicle.current_value,
          rarity_score: undefined,
          status: row.vehicle.status,
          user_id: row.vehicle.user_id
        } : undefined
      }));

      const convertedStats: TokenStakeStats = statsResult.data || {
        total_staked: 0,
        total_predicted_roi: 0,
        active_stakes: 0,
        completed_stakes: 0,
        avg_roi_percent: 0,
        vehicle_count: 0
      };

      setTokens(convertedTokens);
      setVehicles(convertedVehicles);
      setStakes(convertedStakes);
      setStakingStats(convertedStats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch staking data'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnstake = async (stakeId: string): Promise<boolean> => {
    try {
      const { error: unstakeError } = await supabase
        .from('stakes')
        .update({ status: 'cancelled' })
        .eq('id', stakeId);

      if (unstakeError) throw unstakeError;
      await refreshData();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to unstake'));
      return false;
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  return {
    tokens,
    vehicles,
    stakes,
    stakingStats,
    isLoading,
    error,
    handleUnstake,
    refreshData
  };
} 