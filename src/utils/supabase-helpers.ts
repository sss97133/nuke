
/**
 * Helper function to check for errors in Supabase queries
 * @param error - The error object returned from a Supabase query
 * @throws Error with the error message if error exists
 */
export const checkQueryError = (error: any): void => {
  if (error) {
    console.error("Supabase query error:", error);
    throw new Error(error.message || "An unknown error occurred");
  }
};
