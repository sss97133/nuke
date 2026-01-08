/**
 * Global error cache to prevent repeated logging of the same errors
 * This reduces console noise from React Strict Mode double-renders and
 * multiple components making the same failing requests
 */

const errorCache = new Map<string, number>();
const ERROR_CACHE_TTL = 5000; // Only log same error once per 5 seconds

export function shouldLogError(errorKey: string): boolean {
  const now = Date.now();
  const lastLogged = errorCache.get(errorKey);
  
  if (!lastLogged || (now - lastLogged) > ERROR_CACHE_TTL) {
    errorCache.set(errorKey, now);
    return true;
  }
  
  return false;
}

export function getErrorKey(error: any, context?: string): string {
  const code = error?.code || 'unknown';
  const message = error?.message || String(error);
  const contextStr = context || '';
  return `${code}:${message.substring(0, 100)}:${contextStr}`;
}

/**
 * Log error only if we haven't seen it recently
 */
export function logErrorOnce(error: any, context?: string): void {
  const key = getErrorKey(error, context);
  if (shouldLogError(key)) {
    console.error(`[${context || 'Error'}]`, error);
  }
}

/**
 * Silently handle expected errors (missing features, etc.)
 */
export function handleExpectedError(error: any, featureName: string): boolean {
  const isExpected = 
    error?.code === 'PGRST202' || // Function doesn't exist
    error?.code === 'PGRST200' || // Relationship doesn't exist
    error?.code === '42P01' ||    // Table doesn't exist
    error?.status === 404 ||
    error?.message?.includes('does not exist') ||
    error?.message?.includes('not found');
  
  if (isExpected) {
    // Only log once per feature
    const key = `expected:${featureName}`;
    if (shouldLogError(key)) {
      console.debug(`[Feature Unavailable] ${featureName} is not implemented yet`);
    }
    return true;
  }
  
  return false;
}

