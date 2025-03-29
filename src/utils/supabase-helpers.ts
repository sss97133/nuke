
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

/**
 * Helper function to format authentication errors into user-friendly messages
 * @param error - The error object returned from a Supabase auth operation
 * @returns A user-friendly error message
 */
export const formatAuthError = (error: any): string => {
  if (!error) return '';
  
  console.error("Auth error details:", error);
  
  // Common auth error patterns
  if (error.message?.includes('Email not confirmed')) {
    return 'Please check your email to confirm your account before logging in.';
  }
  
  if (error.message?.includes('Invalid login credentials')) {
    return 'Invalid email or password. Please try again.';
  }
  
  if (error.message?.includes('User already registered')) {
    return 'This email is already registered. Please try logging in instead.';
  }
  
  if (error.message?.includes('Password should be')) {
    return error.message; // Supabase password requirement message is already user-friendly
  }
  
  if (error.message?.includes('Email link is invalid or has expired')) {
    return 'Your sign-in link is invalid or has expired. Please request a new one.';
  }
  
  if (error.message?.includes('rate limit')) {
    return 'Too many attempts. Please try again later.';
  }
  
  // Database constraint errors
  if (error.code === '23505') { // unique_violation
    return 'This account already exists.';
  }
  
  if (error.code === '23503') { // foreign_key_violation
    return 'There was a problem with your account. Please contact support.';
  }
  
  // Return original message if we can't categorize it
  return error.message || 'An unexpected error occurred. Please try again.';
};

/**
 * Helper function to handle authentication errors
 * @param error - The error object returned from a Supabase auth operation
 * @param toast - The toast function to display errors
 * @returns Formatted error message
 */
export const handleAuthError = (error: any, toast?: any): string => {
  const errorMessage = formatAuthError(error);
  
  if (toast) {
    toast({
      variant: "destructive",
      title: "Authentication Error",
      description: errorMessage,
    });
  }
  
  return errorMessage;
};

/**
 * Check if we're getting database schema mismatch errors
 * @param error - The error object from Supabase
 * @returns True if the error indicates a schema mismatch
 */
export const isSchemaError = (error: any): boolean => {
  if (!error) return false;
  
  const message = error.message?.toLowerCase() || '';
  return message.includes('column') && message.includes('does not exist');
};
