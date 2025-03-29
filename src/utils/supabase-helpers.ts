/**
 * Custom error class for Supabase-related errors
 */
export class SupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseError';
  }
}

/**
 * Helper function to check for errors in Supabase queries
 * @param error - The error object returned from a Supabase query
 * @throws Error with the error message if error exists
 */
export const checkQueryError = (error: any): void => {
  if (error) {
    console.error("Supabase query error:", error);
    throw new SupabaseError(error.message || "An unknown error occurred");
  }
};
