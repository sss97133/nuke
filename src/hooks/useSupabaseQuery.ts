import { useState, useEffect, useCallback } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';
import { handleQueryError } from '@/utils/supabase-helpers';

export type QueryOptions<T> = {
  onSuccess?: (data: T) => void;
  onError?: (error: PostgrestError) => void;
};

export type QueryState<T> = {
  data: T | null;
  error: PostgrestError | null;
  isLoading: boolean;
};

export function useSupabaseQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: PostgrestError | null }>,
  options: QueryOptions<T> = {}
): QueryState<T> & { refetch: () => Promise<void> } {
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    error: null,
    isLoading: true
  });

  const executeQuery = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true }));
      const { data, error } = await queryFn();
      
      if (error) {
        const postgrestError = error as PostgrestError;
        handleQueryError(postgrestError);
        setState({ data: null, error: postgrestError, isLoading: false });
        options.onError?.(postgrestError);
      } else {
        setState({ data, error: null, isLoading: false });
        options.onSuccess?.(data as T);
      }
    } catch (error) {
      const postgrestError = error as PostgrestError;
      handleQueryError(postgrestError);
      setState({ data: null, error: postgrestError, isLoading: false });
      options.onError?.(postgrestError);
    }
  }, [queryFn, options]);

  useEffect(() => {
    executeQuery();
  }, [executeQuery]);

  return {
    ...state,
    refetch: executeQuery
  };
}

export function useTableQuery<T extends Database['public']['Tables'][keyof Database['public']['Tables']]['Row']>(
  tableName: keyof Database['public']['Tables'],
  queryBuilder: (query: ReturnType<typeof supabase.from>) => Promise<{ data: T[] | null; error: PostgrestError | null }>,
  options: QueryOptions<T[]> = {}
) {
  return useSupabaseQuery<T[]>(
    async () => {
      const query = supabase.from(tableName);
      return queryBuilder(query);
    },
    options
  );
}

export function useJoinQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: PostgrestError | null }>,
  options: QueryOptions<T> = {}
) {
  return useSupabaseQuery<T>(queryFn, options);
} 