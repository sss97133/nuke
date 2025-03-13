import { PostgrestError } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

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