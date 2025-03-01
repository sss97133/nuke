
import { Json } from "@/integrations/supabase/types";

export interface Token {
  id: string;
  name: string;
  symbol: string;
  total_supply: number;
  metadata: Json;
  contract_address: string;
  created_at: string;
  decimals: number;
  description: string;
  owner_id: string;
  status: string;
  updated_at: string;
  vehicle_id?: string;
}

export interface NewToken {
  name: string;
  symbol: string;
  total_supply: number;
  decimals: number;
  description: string;
  status: string;
  vehicle_id?: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
}

export interface TokenStake {
  id: string;
  user_id: string;
  token_id: string;
  vehicle_id: string;
  amount: number;
  start_date: string;
  end_date: string;
  status: 'active' | 'completed' | 'cancelled';
  predicted_roi: number;
  actual_roi?: number;
  created_at: string;
  // References to related objects
  token?: Token;
  vehicle?: Vehicle;
}
