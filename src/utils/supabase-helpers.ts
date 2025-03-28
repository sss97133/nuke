
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
