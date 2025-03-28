import { PostgrestError } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';

/**
 * Utility functions for working with Supabase
 */

// Helper function to handle error checking after Supabase queries
export const checkQueryError = (error: unknown): void => {
  if (error) {
    console.error("Database query error:", error);
  }
};

// Function to safely execute Supabase queries with error handling
export async function safeQuery<T>(queryPromise: Promise<{ data: T; error: any }>): Promise<T | null> {
  try {
    const { data, error } = await queryPromise;
    if (error) {
      console.error("Database query error:", error);
      return null;
    }
    return data;
  } catch (err) {
    console.error("Query execution error:", err);
    return null;
  }
}

export type SupabaseResult<T> = {
  data: T | null;
  error: PostgrestError | null;
};

export type TableNames = keyof Database['public']['Tables'];

export class SupabaseError extends Error {
  constructor(
    message: string,
    public details?: unknown,
    public code?: string
  ) {
    super(message);
    this.name = 'SupabaseError';
  }
}

export function handleSupabaseError(error: PostgrestError | null, context?: string): never {
  if (error) {
    throw new SupabaseError(
      `Supabase error${context ? ` in ${context}` : ''}: ${error.message}`,
      error.details,
      error.code
    );
  }
  throw new SupabaseError('Unknown Supabase error occurred');
}

export function assertData<T>(
  result: SupabaseResult<T>,
  context?: string
): asserts result is { data: T; error: null } {
  if (result.error) {
    handleSupabaseError(result.error, context);
  }
  if (result.data === null) {
    throw new SupabaseError(`No data returned${context ? ` from ${context}` : ''}`);
  }
}

export function validateTableAccess<T extends TableNames>(
  tableName: T,
  result: SupabaseResult<unknown>
): void {
  if (result.error?.message.includes(`relation "${tableName}" does not exist`)) {
    throw new SupabaseError(`Table "${tableName}" does not exist or is not accessible`);
  }
}

export function isSupabaseError(error: unknown): error is SupabaseError {
  return error instanceof SupabaseError;
}

export function handleQueryError(error: unknown, context?: string): never {
  if (isSupabaseError(error)) {
    throw error;
  }
  throw new SupabaseError(
    `Query error${context ? ` in ${context}` : ''}: ${error instanceof Error ? error.message : String(error)}`
  );
}

/**
 * Safely invoke a Supabase Edge Function with proper error handling
 * @param functionName Name of the Edge Function to invoke
 * @param body Request body to send to the function
 * @param context Optional context for error messages
 */
export async function invokeSafeFunction<T = any>(
  functionName: string, 
  body: any,
  context?: string
): Promise<T> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body });
    
    if (error) {
      throw new SupabaseError(
        `Error invoking function "${functionName}"${context ? ` in ${context}` : ''}: ${error.message}`,
        error.details,
        error.code
      );
    }
    
    return data as T;
  } catch (error) {
    if (error instanceof SupabaseError) {
      throw error;
    }
    throw new SupabaseError(
      `Failed to invoke function "${functionName}"${context ? ` in ${context}` : ''}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
