import { Json } from '@/integrations/supabase/types';

export const toJson = (obj: unknown): Json => {
  return JSON.parse(JSON.stringify(obj)) as Json;
};

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};