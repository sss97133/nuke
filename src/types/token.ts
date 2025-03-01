
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
}

export interface NewToken {
  name: string;
  symbol: string;
  total_supply: number;
  decimals: number;
  description: string;
  status: string;
}
